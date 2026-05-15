import type { ApprovalDecision, PendingApproval } from "../approvals/types.js";
import { ApprovalManager } from "../approvals/approval-manager.js";
import type { CodexRunPolicy, CodexRunPolicyStatus } from "../codex/codex-cli.js";
import type { CodexAdapter, CodexCollaborationMode, CodexGoal, CodexGoalStatus, CodexModelOption, CodexModelPolicy, CodexProgressKind, CodexReasoningEffort, CodexSession, CodexSessionContextUsage, CodexSessionModelInfo, CodexSessionStatus } from "../codex/types.js";
import { CODEX_REASONING_EFFORTS } from "../codex/types.js";
import { parseCommand } from "../commands/parser.js";
import type { Logger } from "../logging/logger.js";
import { SilentLogger } from "../logging/logger.js";
import type { TranscriptSink } from "../logging/transcript.js";
import { ChannelRegistry, createSingleChannelRegistry } from "../channels/registry.js";
import type { ChannelAdapter, ChannelMedia, ChannelMessage, ChannelTarget } from "../protocol/channel.js";
import { replyTargetFromMessage } from "../protocol/channel.js";
import type { ChannelDeliveryPolicy, ChannelRefreshCommandPolicy } from "../protocol/delivery-policy.js";
import { DEFAULT_CHANNEL_DELIVERY_POLICY, normalizeChannelDeliveryPolicy, normalizeDeliveryCommandName } from "../protocol/delivery-policy.js";
import { MemoryStateStore } from "../state/memory-state-store.js";
import type { SessionBindings } from "../state/session-bindings.js";
import { BRIDGE_SEND_FILE_PREFIX, extractBridgeSendFileRefs, stripBridgeSendFileRefs } from "./media-extractor.js";
import type { TurnScheduler } from "./turn-scheduler.js";
import { TurnSchedulerAbortError, UnlimitedTurnScheduler } from "./turn-scheduler.js";

export interface BridgeOptions {
  channel?: ChannelAdapter;
  channels?: ChannelRegistry;
  codex: CodexAdapter;
  state?: MemoryStateStore;
  sessionBindings?: SessionBindings;
  approvals?: ApprovalManager;
  turnScheduler?: TurnScheduler;
  logger?: Logger;
  transcript?: TranscriptSink;
  cwd?: string;
  initialSessionId?: string;
  unboundRoutePolicy?: UnboundRoutePolicy;
  progressMode?: ProgressDeliveryMode;
  approvalSendRetryDelayMs?: number;
}

interface QueuedPrompt {
  message: ChannelMessage;
  target: ChannelTarget;
  prompt: string;
  collaborationMode?: CodexCollaborationMode;
  sendFile: boolean;
}

export type ProgressDeliveryMode = "brief" | "detailed" | "silent";
export type UnboundRoutePolicy = "auto_new" | "ask";

const PROGRESS_SEND_FAILURE_COOLDOWN_MS = 60_000;
const APPROVAL_SEND_RETRY_DELAY_MS = 10_000;
const SEND_FILE_MAX_FILES = 3;

export class Bridge {
  private readonly channels: ChannelRegistry;
  private readonly codex: CodexAdapter;
  private readonly state: MemoryStateStore;
  private readonly approvals: ApprovalManager;
  private readonly turnScheduler: TurnScheduler;
  private readonly logger: Logger;
  private readonly transcript?: TranscriptSink;
  private readonly cwd: string;
  private readonly unboundRoutePolicy: UnboundRoutePolicy;
  private readonly defaultProgressMode: ProgressDeliveryMode;
  private readonly approvalSendRetryDelayMs: number;
  private readonly routeProgressModes = new Map<string, ProgressDeliveryMode>();
  private readonly routeCollaborationModes = new Map<string, CodexCollaborationMode>();
  private readonly routeQueues = new Map<string, QueuedPrompt[]>();
  private readonly routeWorkers = new Map<string, Promise<void>>();
  private readonly routeAbortControllers = new Map<string, AbortController>();
  private readonly progressSendSuppressedUntil = new Map<string, number>();
  private initialSessionId?: string;

  constructor(options: BridgeOptions) {
    if (Boolean(options.channel) === Boolean(options.channels)) {
      throw new Error("Bridge requires exactly one of channel or channels");
    }
    if (options.state && options.sessionBindings && options.state.sessionBindings !== options.sessionBindings) {
      throw new Error("Bridge state and sessionBindings must share the same SessionBindings instance");
    }
    this.codex = options.codex;
    this.state = options.state ?? new MemoryStateStore(options.sessionBindings);
    this.approvals = options.approvals ?? new ApprovalManager();
    this.logger = options.logger ?? new SilentLogger();
    this.channels = options.channels ?? createSingleChannelRegistry(options.channel as ChannelAdapter, this.logger);
    this.turnScheduler = options.turnScheduler ?? new UnlimitedTurnScheduler();
    this.transcript = options.transcript;
    this.cwd = options.cwd ?? process.cwd();
    this.initialSessionId = options.initialSessionId;
    this.unboundRoutePolicy = options.unboundRoutePolicy ?? "auto_new";
    this.defaultProgressMode = options.progressMode ?? "brief";
    this.approvalSendRetryDelayMs = options.approvalSendRetryDelayMs ?? APPROVAL_SEND_RETRY_DELAY_MS;
  }

  async start(): Promise<void> {
    this.channels.onMessage((message) => this.handleMessage(message));
    await this.channels.start();
    this.logger.info("bridge started", { channels: this.channels.ids().join(",") });
  }

  async stop(): Promise<void> {
    await this.channels.stop();
    await this.codex.stop?.();
    this.logger.info("bridge stopped", { channels: this.channels.ids().join(",") });
  }

  async handleMessage(message: ChannelMessage): Promise<void> {
    const text = message.text?.trim();
    if (!text) return;
    this.transcript?.inbound(message, text);
    const target = replyTargetFromMessage(message);
    const command = parseCommand(text);
    if (command.isCommand) {
      await this.handleCommand(message, target, command.name ?? "", command.args, text);
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
    rawText: string,
  ): Promise<void> {
    const deliveryPolicy = this.deliveryPolicyFor(message);
    const refreshCommand = this.refreshCommandFor(deliveryPolicy, name);
    if (refreshCommand) {
      this.logger.info("channel refresh command received", {
        channel: message.channelId,
        command: refreshCommand.command,
        routeKey: message.routeKey,
      });
      if (!refreshCommand.silent) {
        await this.sendText(target, refreshCommand.replyText ?? "已刷新。");
      }
      return;
    }
    switch (name) {
      case "help":
        await this.sendText(target, this.helpText(message));
        return;
      case "new":
        await this.createNewSession(message, target);
        return;
      case "status":
        await this.sendText(target, await this.statusText(message));
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
        await this.sendText(target, await this.debugText(message));
        return;
      case "plan":
        await this.handleCollaborationModeCommand(message, target, "plan", rawText, name);
        return;
      case "code":
      case "default":
        await this.handleCollaborationModeCommand(message, target, "default", rawText, name);
        return;
      case "goal":
        await this.handleGoalCommand(message, target, rawText);
        return;
      case "progress":
      case "mode":
        if (deliveryPolicy.progressCommand === "disabled") {
          await this.sendText(target, deliveryPolicy.progressDisabledMessage ?? "当前渠道已禁用进度投递，/progress 不可用。");
          return;
        }
        await this.handleProgressModeCommand(message, target, args[0]);
        return;
      case "sendfile":
        await this.handleSendFileCommand(message, target, rawText);
        return;
      case "model":
        await this.handleModelCommand(message, target, args);
        return;
      case "permission":
      case "permissions":
      case "perm":
      case "policy":
        await this.handlePermissionCommand(message, target, args);
        return;
      case "ok":
      case "yes":
        await this.resolveApproval(message, target, [], "approve");
        return;
      case "p":
      case "yes-session":
      case "ok-session":
      case "approve-session":
        await this.resolveApproval(message, target, args, "approve-session");
        return;
      case "no":
        await this.resolveApproval(message, target, [], "deny");
        return;
      case "approve":
        await this.resolveApproval(message, target, args, "approve");
        return;
      case "deny":
      case "reject":
        await this.resolveApproval(message, target, args, "deny");
        return;
      case "stop":
        await this.stopCurrentTask(message, target);
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
    this.applyRouteCollaborationModeToSession(message.routeKey, session.id);
    await this.sendText(target, [
      "已创建新 Codex 会话",
      `Session: ${session.id}`,
      `Cwd: ${session.cwd}`,
      "Status: idle",
      `Mode: ${this.collaborationModeForRoute(message.routeKey, session.id)}`,
    ].join("\n"));
    return session;
  }

  private async ensureSession(message: ChannelMessage): Promise<CodexSession> {
    const binding = this.state.getBinding(message.routeKey);
    if (binding) {
      const stored = this.state.getSession(binding.sessionId);
      if (stored) return stored.session;
      const session = await this.codex.resumeSession(binding.sessionId);
      const activated = this.state.activateOwnedSession(message.routeKey, session);
      if (!activated.ok) {
        throw new Error(`Codex session is owned by another route: ${activated.owner?.ownerRouteKey ?? "unknown"}`);
      }
      return session;
    }
    if (this.initialSessionId) {
      const sessionId = this.initialSessionId;
      this.initialSessionId = undefined;
      const claim = this.state.claimSessionOwner(message.routeKey, sessionId);
      if (!claim.ok) throw ownerConflictError(sessionId, claim.owner.ownerRouteKey);
      let session: CodexSession;
      try {
        session = await this.codex.resumeSession(sessionId);
      } catch (error) {
        if (claim.newlyClaimed) this.state.rollbackSessionOwnerClaim(message.routeKey, sessionId);
        throw error;
      }
      const activated = this.state.activateOwnedSession(message.routeKey, session);
      if (!activated.ok) throw ownerConflictError(sessionId, activated.owner?.ownerRouteKey ?? "unknown");
      if (this.routeCollaborationModes.has(message.routeKey)) {
        this.applyRouteCollaborationModeToSession(message.routeKey, session.id);
      } else {
        this.syncRouteCollaborationModeFromSession(message.routeKey, session.id);
      }
      return session;
    }
    const session = await this.codex.startSession({
      routeKey: message.routeKey,
      cwd: this.cwd,
      title: `channel:${message.routeKey}`,
    });
    this.state.bindSession(message.routeKey, session);
    this.applyRouteCollaborationModeToSession(message.routeKey, session.id);
    return session;
  }

  private async enqueuePrompt(
    message: ChannelMessage,
    target: ChannelTarget,
    prompt: string,
    options?: { collaborationMode?: CodexCollaborationMode; sendFile?: boolean },
  ): Promise<void> {
    if (this.shouldAskBeforeBindingSession(message)) {
      await this.sendText(target, this.unboundRoutePromptText(message));
      return;
    }
    const queue = this.routeQueues.get(message.routeKey) ?? [];
    const pendingAhead = queue.length + (this.routeWorkers.has(message.routeKey) ? 1 : 0);
    queue.push({
      message,
      target,
      prompt,
      collaborationMode: options?.collaborationMode ?? this.routeCollaborationModes.get(message.routeKey),
      sendFile: options?.sendFile ?? false,
    });
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

  private shouldAskBeforeBindingSession(message: ChannelMessage): boolean {
    return this.unboundRoutePolicy === "ask"
      && !this.state.getBinding(message.routeKey)
      && !this.initialSessionId;
  }

  private unboundRoutePromptText(message: ChannelMessage): string {
    return [
      "当前聊天还没有绑定 Codex 会话。",
      "请先发送 /new 创建新会话，或发送 /resume <session-id> 绑定已有会话。",
      `Route: ${message.routeKey}`,
    ].join("\n");
  }

  private async drainRouteQueue(routeKey: string): Promise<void> {
    for (;;) {
      const queue = this.routeQueues.get(routeKey);
      const task = queue?.shift();
      if (!task) return;
      try {
        await this.forwardPrompt(task.message, task.target, task.prompt, queue?.length ?? 0, task.sendFile, task.collaborationMode);
      } catch (error) {
        if (error instanceof TurnSchedulerAbortError) continue;
        await this.sendText(task.target, `Codex 执行失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async forwardPrompt(
    message: ChannelMessage,
    target: ChannelTarget,
    prompt: string,
    remainingQueued: number,
    sendFile: boolean,
    collaborationMode: CodexCollaborationMode | undefined,
  ): Promise<void> {
    const session = await this.ensureSession(message);
    const abortController = new AbortController();
    this.routeAbortControllers.set(message.routeKey, abortController);
    try {
      await this.turnScheduler.run({
        routeKey: message.routeKey,
        sessionId: session.id,
        enqueuedAt: new Date().toISOString(),
      }, async () => {
        const deliveryPolicy = this.deliveryPolicyFor(message);
        if (deliveryPolicy.taskStart === "send") {
          await this.sendText(target, [
            "Codex 正在处理这条消息。",
            "可发送 /status 查看状态，/stop 终止。",
            sendFile ? "本轮已启用 /sendfile，只会发送最终回复中明确声明的文件。" : undefined,
            remainingQueued > 0 ? `Queue: 后面还有 ${remainingQueued} 条` : undefined,
          ].filter(Boolean).join("\n"));
        }
        await this.withTyping(target, async () => {
          let finalText = "";
          let finalPlanText = "";
          const codexPrompt = sendFile ? withSendFileInstruction(prompt) : prompt;
          for await (const event of this.codex.run(session.id, codexPrompt, collaborationMode ? { collaborationMode } : undefined)) {
            if (event.type === "turn.started") {
              this.state.setSessionStatus(session.id, {
                type: "running",
                turnId: event.turnId,
                task: truncateForChannel(prompt, 120),
              });
            } else if (event.type === "assistant.progress") {
              const progressText = `Codex 进度:\n${truncateForChannel(event.text)}`;
              if (this.shouldDeliverProgressWithPolicy(deliveryPolicy, message.routeKey, event.kind)) {
                await this.sendProgressText(message.routeKey, target, progressText);
              } else if (deliveryPolicy.progress === "suppress") {
                this.transcript?.localProgress?.(target, progressText);
              }
            } else if (event.type === "assistant.plan") {
              finalPlanText = event.text;
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
              await this.sendApprovalTextUntilDelivered(message.routeKey, target, pending);
            } else if (event.type === "turn.completed") {
              this.state.setSessionStatus(session.id, { type: "idle" });
            } else if (event.type === "turn.failed") {
              this.state.setSessionStatus(session.id, { type: "failed", error: event.error });
              await this.sendText(target, `Codex 执行失败: ${event.error}`);
            }
          }
          const composedFinalText = composeFinalAnswer(finalPlanText, finalText);
          if (composedFinalText) {
            const visibleText = sendFile ? stripBridgeSendFileRefs(composedFinalText) : composedFinalText;
            if (visibleText) await this.sendText(target, visibleText);
            if (sendFile) {
              await this.sendRequestedFiles(target, composedFinalText, session.cwd);
            }
          }
        });
      }, { signal: abortController.signal });
    } finally {
      if (this.routeAbortControllers.get(message.routeKey) === abortController) {
        this.routeAbortControllers.delete(message.routeKey);
      }
    }
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
    const claim = this.state.claimSessionOwner(message.routeKey, sessionId);
    if (!claim.ok) {
      await this.sendText(target, ownerConflictText(sessionId, claim.owner.ownerRouteKey));
      return;
    }
    try {
      const session = await this.codex.resumeSession(sessionId);
      const activated = this.state.activateOwnedSession(message.routeKey, session);
      if (!activated.ok) {
        if (claim.newlyClaimed) this.state.rollbackSessionOwnerClaim(message.routeKey, sessionId);
        await this.sendText(target, ownerConflictText(sessionId, activated.owner?.ownerRouteKey ?? "unknown"));
        return;
      }
      const mode = this.syncRouteCollaborationModeFromSession(message.routeKey, session.id);
      await this.sendText(target, [
        "已绑定 Codex 会话",
        `Session: ${session.id}`,
        `Cwd: ${session.cwd}`,
        "Status: idle",
        `Mode: ${mode}`,
      ].join("\n"));
    } catch (error) {
      if (claim.newlyClaimed) this.state.rollbackSessionOwnerClaim(message.routeKey, sessionId);
      await this.sendText(target, error instanceof Error ? error.message : String(error));
    }
  }

  private async resolveApproval(
    message: ChannelMessage,
    target: ChannelTarget,
    args: string[],
    decision: ApprovalDecision,
  ): Promise<void> {
    const parsed = this.parseApprovalArgs(message.routeKey, args);
    const key = parsed.approvalKey ?? this.approvals.latest(message.routeKey)?.approvalKey;
    if (!key) {
      await this.sendText(target, "当前没有待处理审批。");
      return;
    }
    try {
      const pending = this.approvals.decide(key, message.routeKey, decision);
      await this.codex.resolveApproval?.(pending.adapterApprovalId ?? pending.approvalKey, decision);
      await this.sendText(target, `审批已处理: ${formatApprovalDecision(decision)}`);
    } catch (error) {
      await this.sendText(target, error instanceof Error ? error.message : String(error));
    }
  }

  private parseApprovalArgs(routeKey: string, args: string[]): {
    approvalKey?: string;
  } {
    if (args.length === 0) return {};
    const [first = ""] = args;
    const knownApproval = this.approvals.get(first);
    if (knownApproval?.routeKey === routeKey) {
      return { approvalKey: first };
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
    const queued = this.routeQueues.get(message.routeKey);
    const clearedQueued = queued?.length ?? 0;
    if (queued) queued.length = 0;
    this.routeAbortControllers.get(message.routeKey)?.abort();
    await this.codex.cancel(binding.sessionId);
    this.approvals.cancelRoute(message.routeKey, "任务已停止");
    this.state.setSessionStatus(binding.sessionId, { type: "idle" });
    await this.sendTyping(target, false);
    await this.sendText(target, [
      "已请求停止当前 Codex 任务。",
      clearedQueued > 0 ? `已清空 ${clearedQueued} 条排队消息。` : undefined,
    ].filter(Boolean).join("\n"));
  }

  private async handleCollaborationModeCommand(
    message: ChannelMessage,
    target: ChannelTarget,
    mode: CodexCollaborationMode,
    rawText: string,
    commandName: string,
  ): Promise<void> {
    if (!this.codex.setCollaborationMode || !this.codex.getCollaborationMode) {
      await this.sendText(target, "当前 Codex Adapter 不支持 Plan mode 切换。请使用 app-server adapter。");
      return;
    }
    const prompt = commandBody(rawText, commandName);
    this.setRouteCollaborationMode(message.routeKey, mode);
    const messageLines = mode === "plan"
      ? [
          "已进入 Plan mode。后续消息只做计划，不执行代码修改。",
          "发送 /code 切回默认执行模式。",
        ]
      : [
          "已切回默认执行模式。后续消息可按正常 Codex 行为执行。",
          "发送 /plan 切回计划模式。",
        ];
    await this.sendText(target, [
      ...messageLines,
      this.routeWorkers.has(message.routeKey) ? "当前正在运行的任务不会被改写；新模式只影响后续任务。" : undefined,
      prompt ? `已用 ${mode} mode 加入任务。` : undefined,
    ].filter(Boolean).join("\n"));
    if (prompt) {
      await this.enqueuePrompt(message, target, prompt, { collaborationMode: mode });
    }
  }

  private async handleGoalCommand(
    message: ChannelMessage,
    target: ChannelTarget,
    rawText: string,
  ): Promise<void> {
    if (!this.codex.getGoal || !this.codex.setGoal || !this.codex.setGoalStatus || !this.codex.clearGoal) {
      await this.sendText(target, "当前 Codex Adapter 不支持 Goal。请使用 app-server adapter，并确认 Codex 已启用 features.goals。");
      return;
    }
    const body = commandBody(rawText, "goal");
    const action = body.toLowerCase();
    const binding = this.state.getBinding(message.routeKey);
    try {
      if (!body) {
        if (!binding) {
          await this.sendText(target, [
            "**Goal**",
            "- 当前没有绑定 Codex 会话，也没有 Goal。",
            "- 发送 `/goal <目标>` 可为当前微信上下文创建/绑定会话并设置长期目标。",
          ].join("\n"));
          return;
        }
        await this.sendText(target, this.goalText(await this.codex.getGoal(binding.sessionId)));
        return;
      }
      if (action === "clear") {
        if (!binding) {
          await this.sendText(target, "当前没有绑定 Codex 会话，也没有可清除的 Goal。");
          return;
        }
        const cleared = await this.codex.clearGoal(binding.sessionId);
        await this.sendText(target, cleared ? "已清除 Goal。后续任务不再按该长期目标追踪。" : "当前会话没有 Goal。");
        return;
      }
      if (action === "pause" || action === "resume") {
        if (!binding) {
          await this.sendText(target, "当前没有绑定 Codex 会话，也没有可暂停/恢复的 Goal。");
          return;
        }
        const status: CodexGoalStatus = action === "pause" ? "paused" : "active";
        const goal = await this.codex.setGoalStatus(binding.sessionId, status);
        await this.sendText(target, this.goalText(goal, action === "pause" ? "已暂停 Goal。" : "已恢复 Goal。"));
        return;
      }
      const session = await this.ensureSession(message);
      const goal = await this.codex.setGoal(session.id, body);
      await this.sendText(target, this.goalText(goal, "已设置 Goal。"));
    } catch (error) {
      await this.sendText(target, goalErrorText(error));
    }
  }

  private goalText(goal: CodexGoal | null, title = "**Goal**"): string {
    if (!goal) {
      return [
        title,
        "- 当前没有 Goal。",
        "- 发送 `/goal <目标>` 设置长期目标。",
      ].join("\n");
    }
    return [
      title,
      `- Objective: ${goal.objective}`,
      `- Status: \`${formatGoalStatus(goal.status)}\``,
      goal.tokenBudget !== null ? `- Token budget: \`${formatNumber(goal.tokenBudget)}\`` : undefined,
      `- Tokens used: \`${formatNumber(goal.tokensUsed)}\``,
      `- Time used: \`${formatDuration(goal.timeUsedSeconds)}\``,
      "",
      "命令说明：",
      "- `/goal pause`：暂停追踪，保留目标但暂时不让 Codex 按它推进。",
      "- `/goal resume`：恢复追踪，让 Codex 继续按该目标推进。",
      "- `/goal clear`：清除目标，也就是退出当前 Goal 追踪。",
    ].filter(Boolean).join("\n");
  }

  private async handleSendFileCommand(message: ChannelMessage, target: ChannelTarget, rawText: string): Promise<void> {
    const prompt = commandBody(rawText, "sendfile");
    if (!prompt) {
      await this.sendText(target, [
        "缺少任务内容。",
        "用法: `/sendfile <你要 Codex 做什么，并在最终结果里发文件>`",
      ].join("\n"));
      return;
    }
    await this.enqueuePrompt(message, target, prompt, { sendFile: true });
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

  private async handleModelCommand(
    message: ChannelMessage,
    target: ChannelTarget,
    args: string[],
  ): Promise<void> {
    const listModels = this.codex.listModels?.bind(this.codex);
    const getModelPolicy = this.codex.getModelPolicy?.bind(this.codex);
    const setModelPolicy = this.codex.setModelPolicy?.bind(this.codex);
    if (!listModels || !getModelPolicy || !setModelPolicy) {
      await this.sendText(target, "当前 Codex Adapter 不支持模型列表或运行时模型切换。");
      return;
    }

    const includeHidden = args.some(isModelAllToken);
    const commandArgs = args.filter((arg) => !isModelAllToken(arg) && !isModelListToken(arg));
    const binding = this.state.getBinding(message.routeKey);
    const sessionId = binding?.sessionId;
    const parsed = parseModelCommandArgs(commandArgs);
    if (parsed.type === "error") {
      await this.sendText(target, parsed.message);
      return;
    }
    if (parsed.type === "reset") {
      setModelPolicy({}, sessionId);
      await this.sendText(target, [
        "已清除 Codex 模型覆盖。",
        `作用范围: ${formatModelScope(sessionId)}`,
        this.routeWorkers.has(message.routeKey) ? "当前正在运行的任务不会被改写；需要立即生效请先 /stop。" : undefined,
      ].filter(Boolean).join("\n"));
      return;
    }

    let models: CodexModelOption[];
    try {
      models = await listModels({ includeHidden });
    } catch (error) {
      await this.sendText(target, `获取 Codex 模型列表失败: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const policy = getModelPolicy(sessionId);
    const status = binding ? await this.codex.getStatus(binding.sessionId).catch(() => undefined) : undefined;

    if (parsed.type === "list") {
      await this.sendText(target, this.modelText(models, policy, status?.model, sessionId, includeHidden));
      return;
    }

    if (parsed.type === "effort") {
      const effort = parseReasoningEffort(parsed.effort);
      if (!effort) {
        await this.sendText(target, invalidReasoningEffortText(parsed.effort));
        return;
      }
      let currentModel = currentModelOption(models, policy, status?.model);
      if (!currentModel && !includeHidden) {
        currentModel = currentModelOption(await listModels({ includeHidden: true }), policy, status?.model);
      }
      if (!currentModel) {
        await this.sendText(target, "无法确认当前模型，不能只设置思考程度。请使用 `/model <模型> <effort>`。");
        return;
      }
      if (!modelSupportsEffort(currentModel, effort)) {
        await this.sendText(target, unsupportedReasoningEffortText(currentModel, effort));
        return;
      }
      const nextPolicy: CodexModelPolicy = { ...policy, reasoningEffort: effort };
      setModelPolicy(nextPolicy, sessionId);
      await this.sendText(target, [
        "已设置 Codex 思考程度。",
        `作用范围: ${formatModelScope(sessionId)}`,
        `Model: \`${nextPolicy.model ?? currentModel.model}\``,
        `Effort: \`${effort}\``,
        this.routeWorkers.has(message.routeKey) ? "当前正在运行的任务不会被改写；需要立即生效请先 /stop。" : undefined,
      ].filter(Boolean).join("\n"));
      return;
    }

    const resolved = resolveModelReference(parsed.modelRef, models);
    if (resolved.type === "error") {
      await this.sendText(target, resolved.message);
      return;
    }
    const model = resolved.model;
    const requestedEffort = parsed.effort ? parseReasoningEffort(parsed.effort) : model.defaultReasoningEffort;
    if (parsed.effort && !requestedEffort) {
      await this.sendText(target, invalidReasoningEffortText(parsed.effort));
      return;
    }
    if (requestedEffort && !modelSupportsEffort(model, requestedEffort)) {
      await this.sendText(target, unsupportedReasoningEffortText(model, requestedEffort));
      return;
    }
    const nextPolicy: CodexModelPolicy = {
      model: model.model,
      ...(requestedEffort ? { reasoningEffort: requestedEffort } : {}),
    };
    setModelPolicy(nextPolicy, sessionId);
    await this.sendText(target, [
      "已设置 Codex 模型。",
      `作用范围: ${formatModelScope(sessionId)}`,
      `Model: \`${model.model}\`${model.id !== model.model ? ` (id \`${model.id}\`)` : ""}`,
      `Effort: \`${requestedEffort ?? "default"}\``,
      this.routeWorkers.has(message.routeKey) ? "当前正在运行的任务不会被改写；需要立即生效请先 /stop。" : undefined,
    ].filter(Boolean).join("\n"));
  }

  private async handlePermissionCommand(
    message: ChannelMessage,
    target: ChannelTarget,
    args: string[],
  ): Promise<void> {
    if (!this.codex.getRunPolicy || !this.codex.setRunPolicy) {
      await this.sendText(target, "当前 Codex Adapter 不支持运行时切换权限模式。");
      return;
    }
    const binding = this.state.getBinding(message.routeKey);
    const sessionId = binding?.sessionId;
    const rawMode = args[0]?.toLowerCase();
    if (!rawMode) {
      await this.sendText(target, this.permissionText(sessionId));
      return;
    }
    if (rawMode === "approval" || rawMode === "approve" || rawMode === "safe" || rawMode === "审批") {
      this.codex.setRunPolicy({ permissionMode: "approval", sandbox: "workspace-write" }, sessionId);
      const policyStatus = this.runPolicyStatus(sessionId);
      await this.sendText(target, [
        "已切换 Codex 权限模式: approval",
        sessionId ? `作用范围: 当前会话 \`${sessionId}\`` : "作用范围: 默认策略（后续新会话）",
        "后续任务将使用 workspace-write sandbox。",
        policyStatus && !policyStatus.interactiveApprovals
          ? "注意：当前 Codex Adapter 不支持交互审批；真实生效的 approval_policy 仍是 never。"
          : "后续审批请求会交给当前 Adapter 处理。",
        policyStatus?.note ? `说明: ${policyStatus.note}` : undefined,
        this.routeWorkers.has(message.routeKey) ? "当前正在运行的任务不会被改写；需要立即生效请先 /stop。" : undefined,
      ].filter(Boolean).join("\n"));
      return;
    }
    if (rawMode === "full" || rawMode === "danger" || rawMode === "完全权限") {
      if (!isConfirmed(args.slice(1))) {
        await this.sendText(target, [
          "完全权限会跳过审批和沙箱，Codex 可以直接执行命令并修改文件，风险很高。",
          "确认切换请发送:",
          "/permission full confirm",
        ].join("\n"));
        return;
      }
      this.codex.setRunPolicy({ permissionMode: "full" }, sessionId);
      await this.sendText(target, [
        "已切换 Codex 权限模式: full",
        sessionId ? `作用范围: 当前会话 \`${sessionId}\`` : "作用范围: 默认策略（后续新会话）",
        "后续任务将跳过审批和沙箱。建议完成高权限任务后发送 /permission approval 切回安全沙箱模式。",
        this.routeWorkers.has(message.routeKey) ? "当前正在运行的任务不会被改写；需要立即生效请先 /stop。" : undefined,
      ].filter(Boolean).join("\n"));
      return;
    }
    await this.sendText(target, "未知权限模式。可用命令: /permission、/permission approval、/permission full confirm。");
  }

  private async sendText(target: ChannelTarget, text: string): Promise<void> {
    try {
      await this.deliverText(target, text);
    } catch (error) {
      this.logger.warn("channel text send failed", {
        channel: target.channelId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async deliverText(target: ChannelTarget, text: string): Promise<void> {
    await this.channels.sendText(target, text);
    this.transcript?.outbound(target, text);
  }

  private async sendApprovalTextUntilDelivered(routeKey: string, target: ChannelTarget, pending: PendingApproval): Promise<void> {
    const text = this.approvals.formatForChannel(pending);
    let failures = 0;
    while (this.isApprovalStillPending(routeKey, pending.approvalKey)) {
      try {
        await this.deliverText(target, text);
        return;
      } catch (error) {
        failures += 1;
        this.logger.warn("approval message send failed", {
          channel: target.channelId,
          approvalKey: pending.approvalKey,
          failures,
          retryInMs: this.approvalSendRetryDelayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (!this.isApprovalStillPending(routeKey, pending.approvalKey)) return;
      await sleep(this.approvalSendRetryDelayMs);
    }
  }

  private isApprovalStillPending(routeKey: string, approvalKey: string): boolean {
    const approval = this.approvals.get(approvalKey);
    return approval?.routeKey === routeKey && approval.status === "pending";
  }

  private async sendProgressText(routeKey: string, target: ChannelTarget, text: string): Promise<void> {
    const suppressedUntil = this.progressSendSuppressedUntil.get(routeKey) ?? 0;
    if (Date.now() < suppressedUntil) return;
    try {
      await this.deliverText(target, text);
      this.progressSendSuppressedUntil.delete(routeKey);
    } catch (error) {
      this.progressSendSuppressedUntil.set(routeKey, Date.now() + PROGRESS_SEND_FAILURE_COOLDOWN_MS);
      this.logger.warn("progress message send failed", {
        channel: target.channelId,
        error: error instanceof Error ? error.message : String(error),
        cooldownMs: PROGRESS_SEND_FAILURE_COOLDOWN_MS,
      });
    }
  }

  private async sendRequestedFiles(
    target: ChannelTarget,
    finalText: string,
    cwd: string,
  ): Promise<void> {
    const extraction = extractBridgeSendFileRefs(finalText, cwd, SEND_FILE_MAX_FILES);
    if (extraction.requestedCount === 0) return;

    const failed: string[] = [];
    for (const media of extraction.media) {
      const delivered = await this.trySendMedia(target, media);
      if (!delivered) failed.push(media.name ?? media.path ?? media.url ?? "unknown");
    }

    const notes = [
      extraction.invalidRefs.length > 0 ? `有 ${extraction.invalidRefs.length} 个文件路径无效或不存在，未发送。` : undefined,
      extraction.overflowCount > 0 ? `超过每轮 ${SEND_FILE_MAX_FILES} 个文件上限，已跳过 ${extraction.overflowCount} 个。` : undefined,
      failed.length > 0 ? `有 ${failed.length} 个文件发送失败: ${failed.join(", ")}` : undefined,
    ].filter(Boolean);
    if (notes.length > 0) {
      await this.sendText(target, ["文件发送结果", ...notes.map((note) => `- ${note}`)].join("\n"));
    }
  }

  private async trySendMedia(target: ChannelTarget, media: ChannelMedia): Promise<boolean> {
    const capabilities = this.channels.getCapabilities(target.channelId);
    if (!capabilities.media) {
      this.logger.warn("channel media send skipped", {
        channel: target.channelId,
        media: media.path ?? media.url ?? media.name,
        reason: "media unsupported",
      });
      return false;
    }
    try {
      await this.channels.sendMedia(target, media);
      this.transcript?.outboundMedia?.(target, media);
      return true;
    } catch (error) {
      this.logger.warn("channel media send failed", {
        channel: target.channelId,
        media: media.path ?? media.url ?? media.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async withTyping<T>(target: ChannelTarget, operation: () => Promise<T>): Promise<T> {
    const capabilities = this.channels.getCapabilities(target.channelId);
    if (!capabilities.typing) {
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
    const capabilities = this.channels.getCapabilities(target.channelId);
    if (!capabilities.typing) return;
    try {
      await this.channels.sendTyping(target, typing);
    } catch (error) {
      this.logger.warn("channel typing send failed", {
        channel: target.channelId,
        typing,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async statusText(message: ChannelMessage): Promise<string> {
    const routeKey = message.routeKey;
    const channelStatus = await this.channels.getStatus(message.channelId);
    const binding = this.state.getBinding(routeKey);
    const localSession = binding ? this.state.getSession(binding.sessionId) : undefined;
    const adapterStatus: CodexSessionStatus = binding
      ? await this.codex.getStatus(binding.sessionId)
      : { type: "unknown", detail: "no active session" };
    const sessionStatus: CodexSessionStatus = adapterStatus.type === "unknown" && localSession
      ? localSession.status
      : adapterStatus;
    const approvals = this.approvals.list(routeKey);
    const workerRunning = this.routeWorkers.has(routeKey);
    const policyStatus = this.runPolicyStatus(binding?.sessionId);
    const policy = policyStatus?.policy ?? this.codex.getRunPolicy?.(binding?.sessionId);
    const modelPolicy = this.codex.getModelPolicy?.(binding?.sessionId);
    const deliveryPolicy = this.deliveryPolicyFor(message);
    const goal = binding && this.codex.getGoal
      ? await this.codex.getGoal(binding.sessionId).catch(() => undefined)
      : undefined;
    return [
      "**Codex 状态**",
      `- Session: \`${binding?.sessionId ?? "none"}\``,
      `- State: \`${formatCodexStatus(sessionStatus)}\``,
      `- Model: ${formatModelInfo(sessionStatus.model)}`,
      ...formatContextUsageLines(sessionStatus.context),
      binding ? `- Cwd: \`${localSession?.session.cwd ?? "unknown"}\`` : undefined,
      "",
      "**Bridge**",
      `- Processing: \`${workerRunning ? "yes" : "no"}\``,
      `- Queue: \`${this.routeQueues.get(routeKey)?.length ?? 0}\``,
      `- Mode: \`${this.collaborationModeForRoute(routeKey, binding?.sessionId)}\``,
      goal !== undefined ? `- Goal: ${formatGoalSummary(goal)}` : undefined,
      `- Pending approvals: \`${approvals.length}\``,
      ...formatPendingApprovalStatus(approvals.at(-1)),
      this.progressStatusLine(routeKey, deliveryPolicy),
      modelPolicy ? `- Model override: ${formatModelPolicy(modelPolicy)}` : undefined,
      policy ? `- Permission: \`${formatRunPolicy(policy)}\`` : undefined,
      policyStatus && !policyStatus.interactiveApprovals ? `- Approval: \`${formatApprovalSupport(policyStatus)}\`` : undefined,
      workerRunning && binding ? "- Action: `/stop` 终止当前任务" : undefined,
      "",
      "**Channel**",
      `- Adapter: \`${channelStatus.channelId}\``,
      `- State: \`${channelStatus.state}\``,
      channelStatus.lastError ? `- Last error: ${channelStatus.lastError}` : undefined,
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
      "**当前通道身份**",
      `- Route: \`${message.routeKey}\``,
      `- Channel: \`${message.channelId}\``,
      `- Account: \`${message.accountId ?? "default"}\``,
      `- Conversation: \`${formatConversationContext(message.conversation.kind, message.conversation.id, message.conversation.displayName)}\``,
      `- Sender: \`${formatPeerContext(message.sender.id, message.sender.displayName)}\``,
    ].join("\n");
  }

  private async debugText(message: ChannelMessage): Promise<string> {
    const status = await this.statusText(message);
    const capabilities = this.channels.getCapabilities(message.channelId);
    const sessions = this.state.listSessions(message.routeKey);
    return [
      status,
      "",
      "Capabilities:",
      JSON.stringify(capabilities, null, 2),
      "",
      `Local sessions: ${sessions.length}`,
    ].join("\n");
  }

  private helpText(message?: ChannelMessage): string {
    const deliveryPolicy = this.deliveryPolicyFor(message);
    const commands: Array<[command: string, description: string]> = [
      ["/help", "查看命令"],
      ["/new", "创建新 Codex 会话"],
      ["/status", "查看状态、队列、审批和上下文 token 用量"],
      ["/sessions", "列出当前上下文会话"],
      ["/sessions all", "列出全部可发现 Codex 会话"],
      ["/resume <session>", "恢复并绑定已有会话"],
      ["/use <session>", "切换到已有会话"],
      ["/whoami", "查看当前通道身份"],
      ["/debug", "查看调试状态"],
      ["/plan [任务]", "进入计划模式，或用计划模式处理任务"],
      ["/code [任务]", "切回默认执行模式，或用默认模式处理任务"],
      ["/goal [目标]", "查看或设置当前会话的实验 Goal 长期目标"],
      ["/goal pause", "暂停 Goal：保留目标，但暂时不让 Codex 按它持续推进"],
      ["/goal resume", "恢复 Goal：继续按已暂停的目标推进"],
      ["/goal clear", "清除 Goal：退出当前会话的 Goal 追踪"],
      ["/progress [brief|detailed|silent]", "查看或设置当前上下文进度投递模式"],
      ["/sendfile <任务内容>", "让 Codex 本轮按内部协议声明最终要发送的文件"],
      ["/model [模型|编号] [effort]", "查看可用模型，或切换当前 Codex session 后续任务的模型和思考程度"],
      ["/permission [approval|full confirm]", "查看或切换当前绑定 Codex session 的权限模式"],
      ["/OK", "批准当前审批"],
      ["/P", "按当前会话批准审批，后续同类操作尽量不再询问"],
      ["/NO", "拒绝当前审批"],
      ["/stop", "终止当前正在处理的 Codex 任务"],
    ];
    const visibleCommands = [
      ...(deliveryPolicy.progressCommand === "disabled"
        ? commands.filter(([command]) => !command.startsWith("/progress"))
        : commands),
      ...deliveryPolicy.refreshCommands.map((command): [string, string] => [`/${command.command}`, command.description]),
    ];
    return [
      "**可用命令**",
      "",
      ...visibleCommands.flatMap(([command, description]) => [
        `\`\`\`text\n${command}\n\`\`\``,
        description,
        "",
      ]),
    ].join("\n").trimEnd();
  }

  private progressModeFor(routeKey: string): ProgressDeliveryMode {
    return this.routeProgressModes.get(routeKey) ?? this.defaultProgressMode;
  }

  private collaborationModeForRoute(routeKey: string, sessionId?: string): CodexCollaborationMode {
    return this.routeCollaborationModes.get(routeKey) ?? this.codex.getCollaborationMode?.(sessionId) ?? "default";
  }

  private setRouteCollaborationMode(routeKey: string, mode: CodexCollaborationMode): void {
    this.routeCollaborationModes.set(routeKey, mode);
    const binding = this.state.getBinding(routeKey);
    if (binding) this.codex.setCollaborationMode?.(mode, binding.sessionId);
  }

  private applyRouteCollaborationModeToSession(routeKey: string, sessionId: string): void {
    const mode = this.routeCollaborationModes.get(routeKey);
    if (mode) this.codex.setCollaborationMode?.(mode, sessionId);
  }

  private syncRouteCollaborationModeFromSession(routeKey: string, sessionId: string): CodexCollaborationMode {
    const mode = this.codex.getCollaborationMode?.(sessionId) ?? "default";
    if (mode === "default") {
      this.routeCollaborationModes.delete(routeKey);
    } else {
      this.routeCollaborationModes.set(routeKey, mode);
    }
    return mode;
  }

  private deliveryPolicyFor(message: ChannelMessage | undefined): ChannelDeliveryPolicy {
    return normalizeChannelDeliveryPolicy(message ? this.channels.getDeliveryPolicy(message) : DEFAULT_CHANNEL_DELIVERY_POLICY);
  }

  private refreshCommandFor(
    policy: ChannelDeliveryPolicy,
    commandName: string,
  ): ChannelRefreshCommandPolicy | undefined {
    const normalized = normalizeDeliveryCommandName(commandName);
    return policy.refreshCommands.find((command) => normalizeDeliveryCommandName(command.command) === normalized);
  }

  private shouldDeliverProgressWithPolicy(
    policy: ChannelDeliveryPolicy,
    routeKey: string,
    kind: CodexProgressKind | undefined,
  ): boolean {
    if (policy.progress === "suppress") return false;
    return this.shouldDeliverProgress(routeKey, kind);
  }

  private progressStatusLine(routeKey: string, policy: ChannelDeliveryPolicy): string {
    if (policy.progress === "suppress") {
      const label = policy.statusProgressLabel ?? "disabled";
      const detail = policy.statusProgressDescription ? ` (${policy.statusProgressDescription})` : "";
      return `- Progress: \`${label}\`${detail}`;
    }
    const suffix = policy.progress === "aggregate" ? " policy=`aggregate`" : "";
    return `- Progress: \`${this.progressModeFor(routeKey)}\`${suffix}`;
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
      "**进度投递**",
      `- 当前模式: \`${mode}\``,
      "- `brief`: 只发送计划、自言自语、搜索和文件变更摘要，不发送命令/工具细节。",
      "- `detailed`: 发送所有可见进度，包括命令和工具调用细节。",
      "- `silent`: 不发送进度文本，只发送开始、审批和最终回复。",
      "- 文件不会由进度模式自动发送；需要本轮允许发文件时使用 `/sendfile <任务内容>`。",
    ].join("\n");
  }

  private modelText(
    models: CodexModelOption[],
    policy: CodexModelPolicy,
    currentModel: CodexSessionModelInfo | undefined,
    sessionId: string | undefined,
    includeHidden: boolean,
  ): string {
    return [
      "**模型设置**",
      `- 作用范围: ${formatModelScope(sessionId)}`,
      `- 当前模型: ${formatModelInfo(currentModel)}`,
      `- 模型覆盖: ${formatModelPolicy(policy)}`,
      `- 列表来源: \`model/list${includeHidden ? " includeHidden=true" : ""}\``,
      "",
      "**可用模型**",
      ...(models.length > 0 ? models.map(formatModelOptionLine) : ["无可用模型。"]),
      "",
      "用法: `/model gpt-5.5 xhigh`、`/model 2 high`、`/model effort medium`、`/model default`。",
      "发送 `/model all` 可包含隐藏模型。",
    ].join("\n");
  }

  private permissionText(sessionId?: string): string {
    const policyStatus = this.runPolicyStatus(sessionId);
    const policy = policyStatus?.policy ?? this.codex.getRunPolicy?.(sessionId);
    return [
      "**权限模式**",
      `- 作用范围: ${sessionId ? `当前会话 \`${sessionId}\`` : "默认策略（后续新会话）"}`,
      `- 当前模式: \`${policy ? formatRunPolicy(policy) : "unknown"}\``,
      policyStatus ? `- 审批支持: \`${formatApprovalSupport(policyStatus)}\`` : undefined,
      "- `approval`: 使用 `workspace-write` sandbox；是否能在微信里弹审批取决于 Codex adapter。",
      "- `full`: 完全权限，跳过审批和沙箱，风险很高。",
      "- 切回安全沙箱模式: `/permission approval`",
      "- 切到完全权限: `/permission full confirm`",
      policyStatus?.note ? `- 说明: ${policyStatus.note}` : undefined,
    ].filter(Boolean).join("\n");
  }

  private runPolicyStatus(sessionId?: string): CodexRunPolicyStatus | undefined {
    return this.codex.getRunPolicyStatus?.(sessionId);
  }
}

function truncateForChannel(text: string, maxLength = 600): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function ownerConflictError(sessionId: string, ownerRouteKey: string): Error {
  return new Error(`Codex session ${sessionId} is already owned by ${ownerRouteKey}`);
}

function ownerConflictText(sessionId: string, ownerRouteKey: string): string {
  return [
    "无法绑定 Codex 会话",
    `Session: ${sessionId}`,
    "原因: 该 session 已绑定到其他聊天上下文。",
    `Owner: ${ownerRouteKey}`,
    "",
    "可发送 /new 创建当前上下文的新会话。",
  ].join("\n");
}

function commandBody(rawText: string, command: string): string {
  const pattern = new RegExp(`^/${command}\\b`, "i");
  return rawText.trim().replace(pattern, "").trim();
}

function withSendFileInstruction(prompt: string): string {
  return [
    prompt.trim(),
    "",
    "[Bridge internal instruction]",
    "The user explicitly enabled file delivery for this turn with /sendfile.",
    "If, and only if, you create or select final deliverable files that should be sent to the user, append one line per file at the very end of your final answer using exactly this format:",
    `${BRIDGE_SEND_FILE_PREFIX} /absolute/path/to/file`,
    "",
    "Rules:",
    `- Only use ${BRIDGE_SEND_FILE_PREFIX} for final deliverables intended for the user.`,
    "- Do not use it for source files, reference files, dependency files, cache files, logs, or intermediate artifacts.",
    "- Do not use it for files merely mentioned in command output, search results, or progress updates.",
    "- The path must be an absolute local filesystem path.",
    "- The file must exist.",
    `- Send at most ${SEND_FILE_MAX_FILES} files.`,
    "- Do not explain this protocol to the user.",
    `- If there is no final file to send, do not output ${BRIDGE_SEND_FILE_PREFIX}.`,
  ].join("\n");
}

function composeFinalAnswer(planText: string, finalText: string): string {
  const plan = planText.trim();
  const final = finalText.trim();
  if (!plan) return final;
  if (!final || final === plan) return plan;
  return `${plan}\n\n${final}`;
}

function formatCodexStatus(status: CodexSessionStatus): string {
  const parts: string[] = [status.type];
  if ("turnId" in status && status.turnId) parts.push(`turn=${status.turnId}`);
  if ("task" in status && status.task) parts.push(`task=${truncateForChannel(status.task, 80)}`);
  if ("detail" in status && status.detail) parts.push(status.detail);
  if ("error" in status && status.error) parts.push(status.error);
  return parts.join(" ");
}

function formatRunPolicy(policy: CodexRunPolicy): string {
  return policy.permissionMode === "full"
    ? "full"
    : `approval sandbox=${policy.sandbox ?? "workspace-write"}`;
}

function formatGoalSummary(goal: CodexGoal | null): string {
  if (!goal) return "`none`";
  return `\`${formatGoalStatus(goal.status)}\` ${truncateForChannel(goal.objective, 80)}`;
}

function formatGoalStatus(status: CodexGoalStatus): string {
  switch (status) {
    case "active": return "active";
    case "paused": return "paused";
    case "budgetLimited": return "budget-limited";
    case "complete": return "complete";
  }
}

function formatApprovalSupport(status: CodexRunPolicyStatus): string {
  if (status.interactiveApprovals) {
    return status.effectiveApprovalPolicy ? `interactive effective=${status.effectiveApprovalPolicy}` : "interactive";
  }
  return status.effectiveApprovalPolicy ? `not interactive effective=${status.effectiveApprovalPolicy}` : "not interactive";
}

function formatContextUsageLines(context: CodexSessionContextUsage | undefined): string[] {
  if (!context) return ["- Context: `unavailable`"];
  const current = context.last.totalTokens;
  const window = context.modelContextWindow;
  const contextUsage = window && window > 0
    ? `\`${formatNumber(current)} / ${formatNumber(window)} tokens\` (${formatPercent(current / window)}, remaining ${formatNumber(Math.max(window - current, 0))})`
    : `\`${formatNumber(current)} tokens\``;
  return [
    `- Context: ${contextUsage}`,
    `- Last turn tokens: input \`${formatNumber(context.last.inputTokens)}\`, cached \`${formatNumber(context.last.cachedInputTokens)}\`, output \`${formatNumber(context.last.outputTokens)}\`, reasoning output \`${formatNumber(context.last.reasoningOutputTokens)}\``,
    `- Session API usage: total \`${formatNumber(context.total.totalTokens)}\`, input \`${formatNumber(context.total.inputTokens)}\`, cached \`${formatNumber(context.total.cachedInputTokens)}\`, output \`${formatNumber(context.total.outputTokens)}\`, reasoning output \`${formatNumber(context.total.reasoningOutputTokens)}\``,
  ];
}

function formatModelInfo(model: CodexSessionModelInfo | undefined): string {
  if (!model?.model && !model?.provider && !model?.serviceTier && model?.reasoningEffort === undefined) return "`unknown`";
  const parts = [
    model.model ? `\`${model.model}\`` : undefined,
    model.provider ? `provider=\`${model.provider}\`` : undefined,
    model.serviceTier ? `tier=\`${model.serviceTier}\`` : undefined,
    model.reasoningEffort !== undefined ? `effort=\`${model.reasoningEffort ?? "default"}\`` : undefined,
  ].filter(Boolean);
  return parts.join(" ");
}

type ParsedModelCommand =
  | { type: "list" }
  | { type: "reset" }
  | { type: "effort"; effort: string }
  | { type: "set"; modelRef: string; effort?: string }
  | { type: "error"; message: string };

function parseModelCommandArgs(args: string[]): ParsedModelCommand {
  if (args.length === 0) return { type: "list" };
  const [first = "", second, third, ...rest] = args;
  if (isModelResetToken(first)) {
    return args.length === 1 ? { type: "reset" } : { type: "error", message: "清除模型覆盖请使用 `/model default`。" };
  }
  if (isEffortKeyword(first)) {
    if (!second) return { type: "error", message: "缺少思考程度。用法: `/model effort high`。" };
    if (third || rest.length > 0) return { type: "error", message: "思考程度命令只接受一个值，例如 `/model effort high`。" };
    return { type: "effort", effort: second };
  }
  const tokens = first.toLowerCase() === "model" && second ? [second, third, ...rest].filter((token): token is string => Boolean(token)) : args;
  const [modelRef, maybeEffortKeyword, maybeEffort, ...extra] = tokens;
  if (!modelRef) return { type: "list" };
  if (maybeEffortKeyword && isEffortKeyword(maybeEffortKeyword)) {
    if (!maybeEffort) return { type: "error", message: "缺少思考程度。用法: `/model <模型> effort high`。" };
    if (extra.length > 0) return { type: "error", message: `未知参数: ${extra.join(" ")}` };
    return { type: "set", modelRef, effort: maybeEffort };
  }
  if (maybeEffortKeyword && extra.length > 0) return { type: "error", message: `未知参数: ${[maybeEffortKeyword, maybeEffort, ...extra].filter(Boolean).join(" ")}` };
  return { type: "set", modelRef, ...(maybeEffortKeyword ? { effort: maybeEffortKeyword } : {}) };
}

function isModelAllToken(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "all" || normalized === "--all" || normalized === "hidden" || normalized === "--hidden";
}

function isModelListToken(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "list" || normalized === "ls" || normalized === "show";
}

function isModelResetToken(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "default" || normalized === "reset" || normalized === "clear";
}

function isEffortKeyword(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "effort" || normalized === "thinking" || normalized === "reasoning";
}

function parseReasoningEffort(value: string): CodexReasoningEffort | undefined {
  const normalized = value.trim().toLowerCase();
  return (CODEX_REASONING_EFFORTS as readonly string[]).includes(normalized)
    ? normalized as CodexReasoningEffort
    : undefined;
}

function invalidReasoningEffortText(value: string): string {
  return `未知思考程度: \`${value}\`\n可用值: ${CODEX_REASONING_EFFORTS.map((effort) => `\`${effort}\``).join(", ")}。`;
}

function modelSupportsEffort(model: CodexModelOption, effort: CodexReasoningEffort): boolean {
  const supported = supportedEfforts(model);
  return supported.length === 0 || supported.includes(effort);
}

function supportedEfforts(model: CodexModelOption): CodexReasoningEffort[] {
  const efforts = model.supportedReasoningEfforts.map((option) => option.reasoningEffort);
  if (model.defaultReasoningEffort && !efforts.includes(model.defaultReasoningEffort)) efforts.push(model.defaultReasoningEffort);
  return efforts;
}

function unsupportedReasoningEffortText(model: CodexModelOption, effort: CodexReasoningEffort): string {
  const supported = supportedEfforts(model);
  return [
    `模型 \`${model.model}\` 不支持思考程度 \`${effort}\`。`,
    `可用值: ${supported.length > 0 ? supported.map((value) => `\`${value}\``).join(", ") : "`default`"}。`,
  ].join("\n");
}

function resolveModelReference(
  reference: string,
  models: CodexModelOption[],
): { type: "ok"; model: CodexModelOption } | { type: "error"; message: string } {
  const index = Number(reference);
  if (Number.isInteger(index) && index >= 1 && index <= models.length) {
    return { type: "ok", model: models[index - 1] };
  }
  const normalized = normalizeModelReference(reference);
  const exact = models.filter((model) => [
    model.id,
    model.model,
    model.displayName,
  ].some((value) => normalizeModelReference(value) === normalized));
  if (exact.length > 0) return { type: "ok", model: exact[0] };
  const candidates = models.filter((model) => [
    model.id,
    model.model,
    model.displayName,
  ].some((value) => normalizeModelReference(value).includes(normalized)));
  return {
    type: "error",
    message: [
      `未找到模型: \`${reference}\``,
      candidates.length > 0 ? `相近模型: ${candidates.slice(0, 6).map(formatModelCandidate).join(", ")}` : undefined,
      "发送 `/model` 查看当前可用模型；如需隐藏模型，发送 `/model all`。",
    ].filter(Boolean).join("\n"),
  };
}

function currentModelOption(
  models: CodexModelOption[],
  policy: CodexModelPolicy,
  currentModel: CodexSessionModelInfo | undefined,
): CodexModelOption | undefined {
  const reference = policy.model ?? currentModel?.model;
  if (reference) {
    const resolved = resolveModelReference(reference, models);
    if (resolved.type === "ok") return resolved.model;
    return undefined;
  }
  return models.find((model) => model.isDefault) ?? models[0];
}

function formatModelOptionLine(model: CodexModelOption, index: number): string {
  const badges = [
    model.isDefault ? "default" : undefined,
    model.hidden ? "hidden" : undefined,
  ].filter(Boolean).join(", ");
  const id = model.id !== model.model ? ` id=\`${model.id}\`` : "";
  const efforts = supportedEfforts(model).map((effort) => `\`${effort}\``).join(", ") || "`default`";
  const defaultEffort = model.defaultReasoningEffort ? ` default=\`${model.defaultReasoningEffort}\`` : "";
  const suffix = badges ? ` (${badges})` : "";
  return `${index + 1}. \`${model.model}\`${id}${suffix} - ${model.displayName}; efforts: ${efforts}${defaultEffort}`;
}

function formatModelCandidate(model: CodexModelOption): string {
  return model.id === model.model ? `\`${model.model}\`` : `\`${model.model}\`/\`${model.id}\``;
}

function formatModelPolicy(policy: CodexModelPolicy): string {
  const parts = [
    policy.model ? `model=\`${policy.model}\`` : undefined,
    policy.reasoningEffort ? `effort=\`${policy.reasoningEffort}\`` : undefined,
    policy.serviceTier ? `tier=\`${policy.serviceTier}\`` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "`none`";
}

function formatModelScope(sessionId?: string): string {
  return sessionId ? `当前会话 \`${sessionId}\`` : "默认策略（后续新会话）";
}

function normalizeModelReference(value: string): string {
  return value.trim().toLowerCase();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const rest = wholeSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${rest}s`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

function goalErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/feature|experimental|features\.goals|not enabled|disabled|unknown method/i.test(message)) {
    return [
      "Goal 实验功能不可用或未启用。",
      "请先在 Codex 中启用 features.goals，例如在 Codex CLI 使用 /experimental，或在 config.toml 的 [features] 下设置 goals = true，然后重启 bridge。",
      `原始错误: ${message}`,
    ].join("\n");
  }
  return message;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatConversationContext(kind: string, id: string, displayName?: string): string {
  return displayName ? `${kind}:${id} (${displayName})` : `${kind}:${id}`;
}

function formatPeerContext(id: string, displayName?: string): string {
  return displayName ? `${displayName} (${id})` : id;
}

function isConfirmed(args: string[]): boolean {
  const normalized = args.join(" ").trim().toLowerCase();
  return normalized === "confirm" || normalized === "yes" || normalized === "确认" || normalized === "我确认";
}

function formatApprovalDecision(decision: ApprovalDecision): string {
  if (decision === "approve") return "已通过";
  if (decision === "approve-session") return "已按本会话通过";
  if (decision === "deny") return "已拒绝";
  return "已取消";
}

function formatPendingApprovalStatus(approval: PendingApproval | undefined): Array<string | undefined> {
  if (!approval) return [];
  return [
    "",
    "**Pending Approval**",
    `- Type: \`${approval.kind}\``,
    approval.cwd ? `- Cwd: \`${approval.cwd}\`` : undefined,
    approval.reason ? `- Reason: ${approval.reason}` : undefined,
    approval.command ? "```shell\n" + approval.command + "\n```" : undefined,
    "```text\n/OK\n```",
    "```text\n/P\n```",
    "```text\n/NO\n```",
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function parseProgressDeliveryMode(value: string): ProgressDeliveryMode | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "brief" || normalized === "normal") return "brief";
  if (normalized === "detailed" || normalized === "verbose" || normalized === "debug") return "detailed";
  if (normalized === "silent" || normalized === "quiet" || normalized === "off" || normalized === "none") return "silent";
  return undefined;
}
