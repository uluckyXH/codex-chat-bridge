import type { ApprovalDecision } from "../approvals/types.js";
import { ApprovalManager } from "../approvals/approval-manager.js";
import type { CodexAdapter, CodexProgressKind, CodexSession, CodexSessionStatus } from "../codex/types.js";
import { parseCommand } from "../commands/parser.js";
import type { Logger } from "../logging/logger.js";
import { SilentLogger } from "../logging/logger.js";
import type { TranscriptSink } from "../logging/transcript.js";
import type { ChannelAdapter, ChannelMedia, ChannelMessage, ChannelTarget } from "../protocol/channel.js";
import { replyTargetFromMessage } from "../protocol/channel.js";
import { MemoryStateStore } from "../state/memory-state-store.js";
import { extractMediaRefs } from "./media-extractor.js";

export interface BridgeOptions {
  channel: ChannelAdapter;
  codex: CodexAdapter;
  state?: MemoryStateStore;
  approvals?: ApprovalManager;
  logger?: Logger;
  transcript?: TranscriptSink;
  cwd?: string;
  initialSessionId?: string;
  progressMode?: ProgressDeliveryMode;
}

interface QueuedPrompt {
  message: ChannelMessage;
  target: ChannelTarget;
  prompt: string;
}

export type ProgressDeliveryMode = "brief" | "detailed" | "silent";

export class Bridge {
  private readonly channel: ChannelAdapter;
  private readonly codex: CodexAdapter;
  private readonly state: MemoryStateStore;
  private readonly approvals: ApprovalManager;
  private readonly logger: Logger;
  private readonly transcript?: TranscriptSink;
  private readonly cwd: string;
  private readonly defaultProgressMode: ProgressDeliveryMode;
  private readonly routeProgressModes = new Map<string, ProgressDeliveryMode>();
  private readonly routeQueues = new Map<string, QueuedPrompt[]>();
  private readonly routeWorkers = new Map<string, Promise<void>>();
  private initialSessionId?: string;

  constructor(options: BridgeOptions) {
    this.channel = options.channel;
    this.codex = options.codex;
    this.state = options.state ?? new MemoryStateStore();
    this.approvals = options.approvals ?? new ApprovalManager();
    this.logger = options.logger ?? new SilentLogger();
    this.transcript = options.transcript;
    this.cwd = options.cwd ?? process.cwd();
    this.initialSessionId = options.initialSessionId;
    this.defaultProgressMode = options.progressMode ?? "brief";
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
    this.transcript?.inbound(message, text);
    const target = replyTargetFromMessage(message);
    const command = parseCommand(text);
    if (command.isCommand) {
      await this.handleCommand(message, target, command.name ?? "", command.args);
      return;
    }
    await this.enqueuePrompt(message, target, text);
  }

  async waitForIdle(): Promise<void> {
    while (this.routeWorkers.size > 0) {
      await Promise.all([...this.routeWorkers.values()]);
    }
  }

  private async handleCommand(
    message: ChannelMessage,
    target: ChannelTarget,
    name: string,
    args: string[],
  ): Promise<void> {
    switch (name) {
      case "help":
        await this.sendText(target, this.helpText());
        return;
      case "new":
        await this.createNewSession(message, target);
        return;
      case "status":
        await this.sendText(target, await this.statusText(message.routeKey));
        return;
      case "sessions":
        await this.sendText(target, await this.sessionsText(args[0]?.toLowerCase() === "all" ? undefined : message.routeKey));
        return;
      case "all-sessions":
        await this.sendText(target, await this.sessionsText(undefined));
        return;
      case "use":
      case "resume":
        await this.resumeOrUseSession(message, target, args[0]);
        return;
      case "whoami":
        await this.sendText(target, this.whoamiText(message));
        return;
      case "debug":
        await this.sendText(target, await this.debugText(message.routeKey));
        return;
      case "progress":
      case "mode":
        await this.handleProgressModeCommand(message, target, args[0]);
        return;
      case "ok":
      case "yes":
        await this.resolveApproval(message, target, args, "approve");
        return;
      case "no":
        await this.resolveApproval(message, target, args, "deny");
        return;
      case "approve":
        await this.resolveApproval(message, target, args, "approve");
        return;
      case "approve-session":
        await this.resolveApproval(message, target, args, "approve-session");
        return;
      case "deny":
      case "reject":
        await this.resolveApproval(message, target, args, "deny");
        return;
      case "stop":
        await this.stopCurrentTask(message, target);
        return;
      case "cancel":
        if (args[0]) {
          await this.resolveApproval(message, target, args, "cancel");
        } else {
          await this.stopCurrentTask(message, target);
        }
        return;
      default:
        await this.sendText(target, `未知命令: /${name}\n发送 /help 查看可用命令。`);
    }
  }

  private async createNewSession(message: ChannelMessage, target: ChannelTarget): Promise<CodexSession> {
    const session = await this.codex.startSession({
      routeKey: message.routeKey,
      cwd: this.cwd,
      title: `channel:${message.routeKey}`,
    });
    this.state.bindSession(message.routeKey, session);
    await this.sendText(target, `已创建新 Codex 会话\nSession: ${session.id}\nCwd: ${session.cwd}\nStatus: idle`);
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

  private async enqueuePrompt(message: ChannelMessage, target: ChannelTarget, prompt: string): Promise<void> {
    const queue = this.routeQueues.get(message.routeKey) ?? [];
    const pendingAhead = queue.length + (this.routeWorkers.has(message.routeKey) ? 1 : 0);
    queue.push({ message, target, prompt });
    this.routeQueues.set(message.routeKey, queue);
    if (pendingAhead > 0) {
      await this.sendText(target, `已加入队列，前面还有 ${pendingAhead} 条消息。`);
    }
    if (!this.routeWorkers.has(message.routeKey)) {
      this.startRouteWorker(message.routeKey);
    }
  }

  private startRouteWorker(routeKey: string): void {
    const worker = this.drainRouteQueue(routeKey).finally(() => {
      this.routeWorkers.delete(routeKey);
      if ((this.routeQueues.get(routeKey)?.length ?? 0) > 0) {
        this.startRouteWorker(routeKey);
      } else {
        this.routeQueues.delete(routeKey);
      }
    });
    this.routeWorkers.set(routeKey, worker);
  }

  private async drainRouteQueue(routeKey: string): Promise<void> {
    for (;;) {
      const queue = this.routeQueues.get(routeKey);
      const task = queue?.shift();
      if (!task) return;
      try {
        await this.forwardPrompt(task.message, task.target, task.prompt, queue?.length ?? 0);
      } catch (error) {
        await this.sendText(task.target, `Codex 执行失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async forwardPrompt(message: ChannelMessage, target: ChannelTarget, prompt: string, remainingQueued: number): Promise<void> {
    const session = await this.ensureSession(message);
    await this.sendText(target, [
      "Codex 开始处理",
      `Session: ${session.id}`,
      remainingQueued > 0 ? `Queue: 后面还有 ${remainingQueued} 条` : undefined,
    ].filter(Boolean).join("\n"));
    await this.withTyping(target, async () => {
      let finalText = "";
      const sentMediaKeys = new Set<string>();
      for await (const event of this.codex.run(session.id, prompt)) {
        if (event.type === "turn.started") {
          this.state.setSessionStatus(session.id, {
            type: "running",
            turnId: event.turnId,
            task: truncateForChannel(prompt, 120),
          });
        } else if (event.type === "assistant.progress") {
          if (this.shouldDeliverProgress(message.routeKey, event.kind)) {
            await this.sendProgressText(target, `Codex 进度:\n${truncateForChannel(event.text)}`);
          }
          await this.sendExtractedMedia(target, event.text, session.cwd, sentMediaKeys);
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
          await this.sendText(target, this.approvals.formatForChannel(pending));
        } else if (event.type === "turn.completed") {
          this.state.setSessionStatus(session.id, { type: "idle" });
        } else if (event.type === "turn.failed") {
          this.state.setSessionStatus(session.id, { type: "failed", error: event.error });
          await this.sendText(target, `Codex 执行失败: ${event.error}`);
        }
      }
      if (finalText) {
        await this.sendText(target, finalText);
        await this.sendExtractedMedia(target, finalText, session.cwd, sentMediaKeys);
      }
    });
  }

  private async resumeOrUseSession(
    message: ChannelMessage,
    target: ChannelTarget,
    sessionId: string | undefined,
  ): Promise<void> {
    if (!sessionId) {
      await this.sendText(target, "缺少 Session ID，例如 /resume cdx-123");
      return;
    }
    try {
      const session = await this.codex.resumeSession(sessionId);
      this.state.bindSession(message.routeKey, session);
      await this.sendText(target, `已绑定 Codex 会话\nSession: ${session.id}\nCwd: ${session.cwd}\nStatus: idle`);
    } catch (error) {
      await this.sendText(target, error instanceof Error ? error.message : String(error));
    }
  }

  private async resolveApproval(
    message: ChannelMessage,
    target: ChannelTarget,
    args: string[],
    decision: ApprovalDecision,
  ): Promise<void> {
    const parsed = this.parseApprovalArgs(message.routeKey, args, decision);
    const key = parsed.approvalKey ?? this.approvals.latest(message.routeKey)?.approvalKey;
    if (!key) {
      await this.sendText(target, "当前没有待处理审批。");
      return;
    }
    try {
      const pending = this.approvals.decide(key, message.routeKey, decision, parsed.reason);
      await this.codex.resolveApproval?.(pending.approvalKey, decision, parsed.reason);
      await this.sendText(target, [
        `审批已处理 [${pending.approvalKey}]: ${decision}`,
        parsed.reason ? `理由: ${parsed.reason}` : undefined,
      ].filter(Boolean).join("\n"));
    } catch (error) {
      await this.sendText(target, error instanceof Error ? error.message : String(error));
    }
  }

  private parseApprovalArgs(routeKey: string, args: string[], decision: ApprovalDecision): {
    approvalKey?: string;
    reason?: string;
  } {
    if (args.length === 0) return {};
    const [first = "", ...rest] = args;
    const knownApproval = this.approvals.get(first);
    if (knownApproval?.routeKey === routeKey) {
      return {
        approvalKey: first,
        reason: decision === "deny" ? rest.join(" ").trim() || undefined : undefined,
      };
    }
    if (decision === "deny") {
      return { reason: args.join(" ").trim() || undefined };
    }
    return { approvalKey: first };
  }

  private async stopCurrentTask(message: ChannelMessage, target: ChannelTarget): Promise<void> {
    const binding = this.state.getBinding(message.routeKey);
    if (!binding) {
      await this.sendText(target, "当前没有活跃 Codex 会话。");
      return;
    }
    const status = await this.codex.getStatus(binding.sessionId);
    const workerRunning = this.routeWorkers.has(message.routeKey);
    if (!workerRunning && status.type !== "running" && status.type !== "waiting_approval") {
      await this.sendText(target, "当前没有正在运行的 Codex 任务。");
      return;
    }
    if (!this.codex.cancel) {
      await this.sendText(target, "当前 Codex Adapter 不支持取消。");
      return;
    }
    await this.codex.cancel(binding.sessionId);
    this.state.setSessionStatus(binding.sessionId, { type: "idle" });
    await this.sendTyping(target, false);
    await this.sendText(target, `已请求停止当前 Codex 任务\nSession: ${binding.sessionId}`);
  }

  private async handleProgressModeCommand(
    message: ChannelMessage,
    target: ChannelTarget,
    rawMode: string | undefined,
  ): Promise<void> {
    if (!rawMode) {
      await this.sendText(target, this.progressModeText(message.routeKey));
      return;
    }
    const mode = parseProgressDeliveryMode(rawMode);
    if (!mode) {
      await this.sendText(target, "未知进度模式。可用值: brief, detailed, silent。");
      return;
    }
    this.routeProgressModes.set(message.routeKey, mode);
    await this.sendText(target, this.progressModeText(message.routeKey));
  }

  private async sendText(target: ChannelTarget, text: string): Promise<void> {
    await this.channel.sendText(target, text);
    this.transcript?.outbound(target, text);
  }

  private async sendProgressText(target: ChannelTarget, text: string): Promise<void> {
    try {
      await this.sendText(target, text);
    } catch (error) {
      this.logger.warn("progress message send failed", {
        channel: this.channel.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async sendExtractedMedia(
    target: ChannelTarget,
    text: string,
    cwd: string,
    sentMediaKeys: Set<string>,
  ): Promise<void> {
    const mediaItems = extractMediaRefs(text, cwd);
    for (const media of mediaItems) {
      const key = mediaKey(media);
      if (!key || sentMediaKeys.has(key)) continue;
      sentMediaKeys.add(key);
      await this.sendMedia(target, media);
    }
  }

  private async sendMedia(target: ChannelTarget, media: ChannelMedia): Promise<void> {
    const capabilities = this.channel.getCapabilities();
    if (capabilities.media && this.channel.sendMedia) {
      try {
        await this.channel.sendMedia(target, media);
        this.transcript?.outboundMedia?.(target, media);
        return;
      } catch (error) {
        this.logger.warn("channel media send failed, falling back to text", {
          channel: this.channel.id,
          media: media.path ?? media.url ?? media.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await this.sendText(target, fallbackMediaText(media, capabilities.media));
  }

  private async withTyping<T>(target: ChannelTarget, operation: () => Promise<T>): Promise<T> {
    const capabilities = this.channel.getCapabilities();
    if (!capabilities.typing || !this.channel.sendTyping) {
      return operation();
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      await this.sendTyping(target, true);
      if (stopped) return;
      timer = setTimeout(() => {
        void tick();
      }, 5000);
      timer.unref?.();
    };
    await tick();
    try {
      return await operation();
    } finally {
      stopped = true;
      if (timer) clearTimeout(timer);
      await this.sendTyping(target, false);
    }
  }

  private async sendTyping(target: ChannelTarget, typing: boolean): Promise<void> {
    const capabilities = this.channel.getCapabilities();
    if (!capabilities.typing || !this.channel.sendTyping) return;
    try {
      await this.channel.sendTyping(target, typing);
    } catch (error) {
      this.logger.warn("channel typing send failed", {
        channel: this.channel.id,
        typing,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async statusText(routeKey: string): Promise<string> {
    const channelStatus = await this.channel.getStatus();
    const binding = this.state.getBinding(routeKey);
    const localSession = binding ? this.state.getSession(binding.sessionId) : undefined;
    const adapterStatus: CodexSessionStatus = binding
      ? await this.codex.getStatus(binding.sessionId)
      : { type: "unknown", detail: "no active session" };
    const sessionStatus: CodexSessionStatus = adapterStatus.type === "unknown" && localSession
      ? localSession.status
      : adapterStatus;
    const approvals = this.approvals.list(routeKey);
    const latestApproval = approvals.at(-1);
    const workerRunning = this.routeWorkers.has(routeKey);
    return [
      `Bridge: ok`,
      `Channel: ${channelStatus.channelId} ${channelStatus.state}`,
      `Processing: ${workerRunning ? "yes" : "no"}`,
      `Codex: ${formatCodexStatus(sessionStatus)}`,
      `Session: ${binding?.sessionId ?? "none"}`,
      `Progress mode: ${this.progressModeFor(routeKey)}`,
      binding ? `Cwd: ${localSession?.session.cwd ?? "unknown"}` : undefined,
      `Queued messages: ${this.routeQueues.get(routeKey)?.length ?? 0}`,
      `Pending approvals: ${approvals.length}`,
      latestApproval ? `Latest approval: ${latestApproval.approvalKey}` : undefined,
      workerRunning && binding ? "操作: /stop 终止当前任务" : undefined,
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
      "/progress [brief|detailed|silent] - 查看或设置当前上下文进度投递模式",
      "/OK 或 /approve [id] - 批准当前或指定审批",
      "/NO [理由] 或 /deny [id] [理由] - 拒绝当前或指定审批",
      "/approve-session [id] - 本会话批准当前或指定审批",
      "/stop - 终止当前正在处理的 Codex 任务",
      "/cancel [id] - 取消审批；无 id 时同 /stop",
    ].join("\n");
  }

  private progressModeFor(routeKey: string): ProgressDeliveryMode {
    return this.routeProgressModes.get(routeKey) ?? this.defaultProgressMode;
  }

  private shouldDeliverProgress(routeKey: string, kind: CodexProgressKind | undefined): boolean {
    const mode = this.progressModeFor(routeKey);
    if (mode === "silent") return false;
    if (mode === "detailed") return true;
    return kind === "reasoning" || kind === "todo" || kind === "search" || kind === "file_change" || kind === "other";
  }

  private progressModeText(routeKey: string): string {
    const mode = this.progressModeFor(routeKey);
    return [
      `当前进度投递模式: ${mode}`,
      "brief: 只发送计划、自言自语、搜索和文件变更摘要，不发送命令/工具细节。",
      "detailed: 发送所有可见进度，包括命令和工具调用细节。",
      "silent: 不发送进度文本，只发送开始、审批、最终回复和媒体。",
    ].join("\n");
  }
}

function truncateForChannel(text: string, maxLength = 600): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function mediaKey(media: ChannelMedia): string | undefined {
  return media.path ?? media.url;
}

function formatCodexStatus(status: CodexSessionStatus): string {
  const parts: string[] = [status.type];
  if ("turnId" in status && status.turnId) parts.push(`turn=${status.turnId}`);
  if ("task" in status && status.task) parts.push(`task=${truncateForChannel(status.task, 80)}`);
  if ("detail" in status && status.detail) parts.push(status.detail);
  if ("error" in status && status.error) parts.push(status.error);
  return parts.join(" ");
}

function fallbackMediaText(media: ChannelMedia, mediaCapability: boolean): string {
  const location = media.path ?? media.url ?? media.name ?? "unknown";
  const reason = mediaCapability ? "通道媒体发送失败，已退回文本引用。" : "当前通道不支持媒体发送，已退回文本引用。";
  return [
    "Codex 生成了媒体文件",
    `Type: ${media.type}`,
    media.name ? `Name: ${media.name}` : undefined,
    media.mimeType ? `Mime: ${media.mimeType}` : undefined,
    media.sizeBytes !== undefined ? `Size: ${media.sizeBytes} bytes` : undefined,
    media.caption ? `Caption: ${media.caption}` : undefined,
    `Location: ${location}`,
    reason,
  ].filter(Boolean).join("\n");
}

export function parseProgressDeliveryMode(value: string): ProgressDeliveryMode | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "brief" || normalized === "normal") return "brief";
  if (normalized === "detailed" || normalized === "verbose" || normalized === "debug") return "detailed";
  if (normalized === "silent" || normalized === "quiet" || normalized === "off" || normalized === "none") return "silent";
  return undefined;
}
