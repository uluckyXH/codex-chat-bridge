import type { ApprovalDecision } from "../approvals/types.js";
import { ApprovalManager } from "../approvals/approval-manager.js";
import type { CodexAdapter, CodexSession, CodexSessionStatus } from "../codex/types.js";
import { parseCommand } from "../commands/parser.js";
import type { Logger } from "../logging/logger.js";
import { SilentLogger } from "../logging/logger.js";
import type { ChannelAdapter, ChannelMessage, ChannelTarget } from "../protocol/channel.js";
import { replyTargetFromMessage } from "../protocol/channel.js";
import { MemoryStateStore } from "../state/memory-state-store.js";

export interface BridgeOptions {
  channel: ChannelAdapter;
  codex: CodexAdapter;
  state?: MemoryStateStore;
  approvals?: ApprovalManager;
  logger?: Logger;
  cwd?: string;
  initialSessionId?: string;
}

export class Bridge {
  private readonly channel: ChannelAdapter;
  private readonly codex: CodexAdapter;
  private readonly state: MemoryStateStore;
  private readonly approvals: ApprovalManager;
  private readonly logger: Logger;
  private readonly cwd: string;
  private initialSessionId?: string;

  constructor(options: BridgeOptions) {
    this.channel = options.channel;
    this.codex = options.codex;
    this.state = options.state ?? new MemoryStateStore();
    this.approvals = options.approvals ?? new ApprovalManager();
    this.logger = options.logger ?? new SilentLogger();
    this.cwd = options.cwd ?? process.cwd();
    this.initialSessionId = options.initialSessionId;
  }

  async start(): Promise<void> {
    this.channel.onMessage((message) => this.handleMessage(message));
    await this.channel.start();
    this.logger.info("bridge started", { channel: this.channel.id });
  }

  async stop(): Promise<void> {
    await this.channel.stop();
    this.logger.info("bridge stopped", { channel: this.channel.id });
  }

  async handleMessage(message: ChannelMessage): Promise<void> {
    const text = message.text?.trim();
    if (!text) return;
    const target = replyTargetFromMessage(message);
    const command = parseCommand(text);
    if (command.isCommand) {
      await this.handleCommand(message, target, command.name ?? "", command.args);
      return;
    }
    await this.forwardPrompt(message, target, text);
  }

  private async handleCommand(
    message: ChannelMessage,
    target: ChannelTarget,
    name: string,
    args: string[],
  ): Promise<void> {
    switch (name) {
      case "help":
        await this.channel.sendText(target, this.helpText());
        return;
      case "new":
        await this.createNewSession(message, target);
        return;
      case "status":
        await this.channel.sendText(target, await this.statusText(message.routeKey));
        return;
      case "sessions":
        await this.channel.sendText(target, await this.sessionsText(args[0]?.toLowerCase() === "all" ? undefined : message.routeKey));
        return;
      case "all-sessions":
        await this.channel.sendText(target, await this.sessionsText(undefined));
        return;
      case "use":
      case "resume":
        await this.resumeOrUseSession(message, target, args[0]);
        return;
      case "whoami":
        await this.channel.sendText(target, this.whoamiText(message));
        return;
      case "debug":
        await this.channel.sendText(target, await this.debugText(message.routeKey));
        return;
      case "approve":
        await this.resolveApproval(message, target, args[0], "approve");
        return;
      case "approve-session":
        await this.resolveApproval(message, target, args[0], "approve-session");
        return;
      case "deny":
      case "reject":
        await this.resolveApproval(message, target, args[0], "deny");
        return;
      case "cancel":
        if (args[0]) {
          await this.resolveApproval(message, target, args[0], "cancel");
        } else {
          await this.cancelSession(message, target);
        }
        return;
      default:
        await this.channel.sendText(target, `未知命令: /${name}\n发送 /help 查看可用命令。`);
    }
  }

  private async createNewSession(message: ChannelMessage, target: ChannelTarget): Promise<CodexSession> {
    const session = await this.codex.startSession({
      routeKey: message.routeKey,
      cwd: this.cwd,
      title: `channel:${message.routeKey}`,
    });
    this.state.bindSession(message.routeKey, session);
    await this.channel.sendText(target, `已创建新 Codex 会话\nSession: ${session.id}\nCwd: ${session.cwd}\nStatus: idle`);
    return session;
  }

  private async ensureSession(message: ChannelMessage): Promise<CodexSession> {
    const binding = this.state.getBinding(message.routeKey);
    if (binding) {
      const stored = this.state.getSession(binding.sessionId);
      if (stored) return stored.session;
      return this.codex.resumeSession(binding.sessionId);
    }
    if (this.initialSessionId) {
      const sessionId = this.initialSessionId;
      this.initialSessionId = undefined;
      const session = await this.codex.resumeSession(sessionId);
      this.state.bindSession(message.routeKey, session);
      return session;
    }
    const session = await this.codex.startSession({
      routeKey: message.routeKey,
      cwd: this.cwd,
      title: `channel:${message.routeKey}`,
    });
    this.state.bindSession(message.routeKey, session);
    return session;
  }

  private async forwardPrompt(message: ChannelMessage, target: ChannelTarget, prompt: string): Promise<void> {
    const session = await this.ensureSession(message);
    let finalText = "";
    for await (const event of this.codex.run(session.id, prompt)) {
      if (event.type === "turn.started") {
        this.state.setSessionStatus(session.id, { type: "running", turnId: event.turnId });
      } else if (event.type === "assistant.delta") {
        finalText += event.text;
      } else if (event.type === "assistant.completed") {
        finalText = event.text;
      } else if (event.type === "approval.requested") {
        this.state.setSessionStatus(session.id, {
          type: "waiting_approval",
          detail: event.approval.reason ?? event.approval.kind,
        });
        const pending = this.approvals.create(message.routeKey, message.sender.id, event.approval);
        await this.channel.sendText(target, this.approvals.formatForChannel(pending));
      } else if (event.type === "turn.completed") {
        this.state.setSessionStatus(session.id, { type: "idle" });
      } else if (event.type === "turn.failed") {
        this.state.setSessionStatus(session.id, { type: "failed", error: event.error });
        await this.channel.sendText(target, `Codex 执行失败: ${event.error}`);
      }
    }
    if (finalText) {
      await this.channel.sendText(target, finalText);
    }
  }

  private async resumeOrUseSession(
    message: ChannelMessage,
    target: ChannelTarget,
    sessionId: string | undefined,
  ): Promise<void> {
    if (!sessionId) {
      await this.channel.sendText(target, "缺少 Session ID，例如 /resume cdx-123");
      return;
    }
    try {
      const session = await this.codex.resumeSession(sessionId);
      this.state.bindSession(message.routeKey, session);
      await this.channel.sendText(target, `已绑定 Codex 会话\nSession: ${session.id}\nCwd: ${session.cwd}\nStatus: idle`);
    } catch (error) {
      await this.channel.sendText(target, error instanceof Error ? error.message : String(error));
    }
  }

  private async resolveApproval(
    message: ChannelMessage,
    target: ChannelTarget,
    approvalKey: string | undefined,
    decision: ApprovalDecision,
  ): Promise<void> {
    if (!approvalKey) {
      await this.channel.sendText(target, "缺少审批 ID，例如 /approve a001");
      return;
    }
    try {
      const pending = this.approvals.decide(approvalKey, message.routeKey, decision);
      await this.codex.resolveApproval?.(pending.approvalKey, decision);
      await this.channel.sendText(target, `审批已处理 [${approvalKey}]: ${decision}`);
    } catch (error) {
      await this.channel.sendText(target, error instanceof Error ? error.message : String(error));
    }
  }

  private async cancelSession(message: ChannelMessage, target: ChannelTarget): Promise<void> {
    const binding = this.state.getBinding(message.routeKey);
    if (!binding) {
      await this.channel.sendText(target, "当前没有活跃 Codex 会话。");
      return;
    }
    if (!this.codex.cancel) {
      await this.channel.sendText(target, "当前 Codex Adapter 不支持取消。");
      return;
    }
    await this.codex.cancel(binding.sessionId);
    this.state.setSessionStatus(binding.sessionId, { type: "idle" });
    await this.channel.sendText(target, `已请求取消会话: ${binding.sessionId}`);
  }

  private async statusText(routeKey: string): Promise<string> {
    const channelStatus = await this.channel.getStatus();
    const binding = this.state.getBinding(routeKey);
    const sessionStatus: CodexSessionStatus = binding
      ? await this.codex.getStatus(binding.sessionId)
      : { type: "unknown", detail: "no active session" };
    const approvals = this.approvals.list(routeKey);
    return [
      `Bridge: ok`,
      `Channel: ${channelStatus.channelId} ${channelStatus.state}`,
      `Codex: ${sessionStatus.type}`,
      `Session: ${binding?.sessionId ?? "none"}`,
      binding ? `Cwd: ${this.state.getSession(binding.sessionId)?.session.cwd ?? "unknown"}` : undefined,
      `Pending approvals: ${approvals.length}`,
      channelStatus.lastError ? `Last channel error: ${channelStatus.lastError}` : undefined,
    ].filter(Boolean).join("\n");
  }

  private async sessionsText(routeKey?: string): Promise<string> {
    const localSessions = this.state.listSessions(routeKey);
    const codexSessions = await this.codex.listSessions(routeKey);
    const seen = new Set<string>();
    const lines = [routeKey ? "当前上下文 Codex 会话:" : "全部可发现 Codex 会话:"];
    for (const stored of localSessions) {
      seen.add(stored.session.id);
      lines.push(this.formatSessionLine(stored.session.id, stored.status.type, stored.updatedAt, stored.session.cwd, stored.session.title));
    }
    for (const session of codexSessions) {
      if (seen.has(session.id)) continue;
      lines.push(this.formatSessionLine(session.id, session.status.type, session.updatedAt, session.cwd, session.title));
    }
    if (lines.length === 1) {
      lines.push("无。发送 /new 创建新会话，或 /resume <session> 绑定已有会话。");
    }
    return lines.join("\n");
  }

  private formatSessionLine(id: string, status: string, updatedAt: string, cwd?: string, title?: string): string {
    const parts = [`- ${id}`, status];
    if (updatedAt) parts.push(updatedAt);
    if (title) parts.push(title);
    if (cwd) parts.push(`cwd=${cwd}`);
    return parts.join(" ");
  }

  private whoamiText(message: ChannelMessage): string {
    return [
      "当前通道身份:",
      `Route: ${message.routeKey}`,
      `Channel: ${message.channelId}`,
      `Account: ${message.accountId ?? "default"}`,
      `Sender: ${message.sender.displayName ?? message.sender.id} (${message.sender.id})`,
      `Conversation: ${message.conversation.kind}:${message.conversation.id}`,
    ].join("\n");
  }

  private async debugText(routeKey: string): Promise<string> {
    const status = await this.statusText(routeKey);
    const capabilities = this.channel.getCapabilities();
    const sessions = this.state.listSessions(routeKey);
    return [
      status,
      "",
      "Capabilities:",
      JSON.stringify(capabilities, null, 2),
      "",
      `Local sessions: ${sessions.length}`,
    ].join("\n");
  }

  private helpText(): string {
    return [
      "可用命令:",
      "/help - 查看命令",
      "/new - 创建新 Codex 会话",
      "/status - 查看状态",
      "/sessions - 列出当前上下文会话",
      "/sessions all - 列出全部可发现 Codex 会话",
      "/all-sessions - 同 /sessions all",
      "/resume <session> - 恢复并绑定已有会话",
      "/use <session> - 切换到已有会话",
      "/whoami - 查看当前通道身份",
      "/debug - 查看调试状态",
      "/approve <id> - 批准一次",
      "/approve-session <id> - 本会话批准",
      "/deny <id> - 拒绝一次",
      "/cancel [id] - 取消审批或当前任务",
    ].join("\n");
  }
}
