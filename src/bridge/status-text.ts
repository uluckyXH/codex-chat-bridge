import type { ApprovalManager } from "../approvals/approval-manager.js";
import type { CodexRunPolicyStatus } from "../codex/codex-cli.js";
import { truncateDisplayText } from "../codex/codex-cli.js";
import type {
  CodexAdapter,
  CodexCollaborationMode,
  CodexModelOption,
  CodexModelPolicy,
  CodexProgressKind,
  CodexSessionModelInfo,
  CodexSessionStatus,
} from "../codex/types.js";
import type { ChannelRegistry } from "../channels/registry.js";
import type { ChannelMessage } from "../protocol/channel.js";
import type { ChannelDeliveryPolicy } from "../protocol/delivery-policy.js";
import type { MemoryStateStore } from "../state/memory-state-store.js";
import { formatLocalDateTime } from "../time/display-time.js";
import type { InitialRouteBinding, ProgressDeliveryMode } from "./bridge-types.js";
import {
  formatApprovalSupport,
  formatChannelStateForStatus,
  formatCodexStatus,
  formatCollaborationModeForStatus,
  formatContextUsageLines,
  formatConversationContext,
  formatGoalStatusLines,
  formatModelInfo,
  formatModelInfoForStatus,
  formatModelOptionLine,
  formatModelPolicy,
  formatModelPolicyForStatus,
  formatPeerContext,
  formatPendingApprovalStatus,
  formatProgressLabelForStatus,
  formatProgressModeForStatus,
  formatRunPolicy,
  formatRunPolicyForStatus,
  formatUnboundSessionForStatus,
} from "./formatters.js";

export interface BridgeStatusTextOptions {
  channels: ChannelRegistry;
  codex: CodexAdapter;
  state: MemoryStateStore;
  approvals: ApprovalManager;
  routeQueueLength(routeKey: string): number;
  deliveryPolicyFor(message: ChannelMessage | undefined): ChannelDeliveryPolicy;
  shouldConsumePendingInitialRouteBinding(message: ChannelMessage): boolean;
  pendingInitialRouteBinding(): InitialRouteBinding | undefined;
  isRouteBusy(routeKey: string): boolean;
  routeSteerPendingCount(routeKey: string): number;
  pendingMediaCount(routeKey: string): number;
  collaborationModeForRoute(routeKey: string, sessionId?: string): CodexCollaborationMode;
  progressModeFor(routeKey: string): ProgressDeliveryMode;
  runPolicyStatus(sessionId?: string): CodexRunPolicyStatus | undefined;
}

export class BridgeStatusText {
  private readonly channels: ChannelRegistry;
  private readonly codex: CodexAdapter;
  private readonly state: MemoryStateStore;
  private readonly approvals: ApprovalManager;
  private readonly routeQueueLength: BridgeStatusTextOptions["routeQueueLength"];
  private readonly deliveryPolicyFor: BridgeStatusTextOptions["deliveryPolicyFor"];
  private readonly shouldConsumePendingInitialRouteBinding: BridgeStatusTextOptions["shouldConsumePendingInitialRouteBinding"];
  private readonly pendingInitialRouteBinding: BridgeStatusTextOptions["pendingInitialRouteBinding"];
  private readonly isRouteBusy: BridgeStatusTextOptions["isRouteBusy"];
  private readonly routeSteerPendingCount: BridgeStatusTextOptions["routeSteerPendingCount"];
  private readonly pendingMediaCount: BridgeStatusTextOptions["pendingMediaCount"];
  private readonly collaborationModeForRoute: BridgeStatusTextOptions["collaborationModeForRoute"];
  private readonly progressModeFor: BridgeStatusTextOptions["progressModeFor"];
  private readonly runPolicyStatus: BridgeStatusTextOptions["runPolicyStatus"];

  constructor(options: BridgeStatusTextOptions) {
    this.channels = options.channels;
    this.codex = options.codex;
    this.state = options.state;
    this.approvals = options.approvals;
    this.routeQueueLength = options.routeQueueLength;
    this.deliveryPolicyFor = options.deliveryPolicyFor;
    this.shouldConsumePendingInitialRouteBinding = options.shouldConsumePendingInitialRouteBinding;
    this.pendingInitialRouteBinding = options.pendingInitialRouteBinding;
    this.isRouteBusy = options.isRouteBusy;
    this.routeSteerPendingCount = options.routeSteerPendingCount;
    this.pendingMediaCount = options.pendingMediaCount;
    this.collaborationModeForRoute = options.collaborationModeForRoute;
    this.progressModeFor = options.progressModeFor;
    this.runPolicyStatus = options.runPolicyStatus;
  }

  async statusText(message: ChannelMessage): Promise<string> {
    const routeKey = message.routeKey;
    const channelStatus = await this.channels.getStatus(message.channelId);
    const binding = this.state.getBinding(routeKey);
    const pendingInitialBinding = !binding
      ? this.state.getPendingBindingForMessage(message)?.binding
        ?? (this.shouldConsumePendingInitialRouteBinding(message) ? this.pendingInitialRouteBinding() : undefined)
      : undefined;
    const localSession = binding ? this.state.getSession(binding.sessionId) : undefined;
    const adapterStatus: CodexSessionStatus = binding
      ? await this.codex.getStatus(binding.sessionId)
      : { type: "unknown", detail: "no active session" };
    const sessionStatus: CodexSessionStatus = adapterStatus.type === "unknown" && localSession
      ? localSession.status
      : adapterStatus;
    const approvals = this.approvals.list(routeKey);
    const workerRunning = this.isRouteBusy(routeKey);
    const policyStatus = this.runPolicyStatus(binding?.sessionId);
    const policy = policyStatus?.policy ?? this.codex.getRunPolicy?.(binding?.sessionId);
    const modelPolicy = this.codex.getModelPolicy?.(binding?.sessionId);
    const deliveryPolicy = this.deliveryPolicyFor(message);
    const goal = binding && this.codex.getGoal
      ? await this.codex.getGoal(binding.sessionId).catch(() => undefined)
      : undefined;
    return [
      "**Codex 状态**",
      "",
      "**会话**",
      `- 当前会话: ${binding ? `\`${binding.sessionId}\`` : formatUnboundSessionForStatus(pendingInitialBinding)}`,
      `- 运行状态: ${formatCodexStatus(sessionStatus)}`,
      `- 当前模型: ${formatModelInfoForStatus(sessionStatus.model)}`,
      ...formatContextUsageLines(sessionStatus.context),
      binding ? `- 工作目录: \`${localSession?.session.cwd ?? "未知"}\`` : undefined,
      "",
      "**运行**",
      `- 处理状态: ${workerRunning ? "正在处理" : "空闲"}`,
      `- 排队消息: \`${this.routeQueueLength(routeKey)}\``,
      `- 待投递补充消息: \`${this.routeSteerPendingCount(routeKey)}\``,
      `- 待处理图片: \`${this.pendingMediaCount(routeKey)}\``,
      `- 协作模式: ${formatCollaborationModeForStatus(this.collaborationModeForRoute(routeKey, binding?.sessionId))}`,
      ...formatGoalStatusLines(goal),
      `- 待审批: \`${approvals.length}\``,
      ...formatPendingApprovalStatus(approvals.at(-1)),
      this.progressStatusLine(routeKey, deliveryPolicy),
      modelPolicy ? `- 模型覆盖: ${formatModelPolicyForStatus(modelPolicy)}` : undefined,
      policy ? `- 权限模式: ${formatRunPolicyForStatus(policy)}` : undefined,
      policyStatus && !policyStatus.interactiveApprovals ? `- 审批入口: ${formatApprovalSupport(policyStatus)}` : undefined,
      workerRunning && binding ? "- 可用操作: 发送 `/stop` 终止当前任务" : undefined,
      "",
      "**渠道**",
      `- 渠道: \`${channelStatus.channelId}\``,
      `- 连接状态: ${formatChannelStateForStatus(channelStatus.state)}`,
      channelStatus.lastError ? `- 最近错误: ${channelStatus.lastError}` : undefined,
    ].filter(Boolean).join("\n");
  }

  async sessionsText(routeKey?: string): Promise<string> {
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
      lines.push("无。发送 /new 创建新会话，或 /resume 进入会话选择。");
    }
    return lines.join("\n");
  }

  whoamiText(message: ChannelMessage): string {
    return [
      "**当前通道身份**",
      `- Route: \`${message.routeKey}\``,
      `- Channel: \`${message.channelId}\``,
      `- Account: \`${message.accountId ?? "default"}\``,
      `- Conversation: \`${formatConversationContext(message.conversation.kind, message.conversation.id, message.conversation.displayName)}\``,
      `- Sender: \`${formatPeerContext(message.sender.id, message.sender.displayName)}\``,
    ].join("\n");
  }

  async debugText(message: ChannelMessage): Promise<string> {
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

  helpText(message?: ChannelMessage): string {
    const deliveryPolicy = this.deliveryPolicyFor(message);
    const commands: Array<[command: string, description: string]> = [
      ["/help", "查看命令"],
      ["/new", "创建新 Codex 会话"],
      ["/status", "查看状态、队列、审批和上下文 token 用量"],
      ["/sessions", "列出当前上下文会话"],
      ["/sessions all", "列出全部可发现 Codex 会话"],
      ["/resume [session|编号]", "恢复并绑定已有会话；不带参数时进入编号选择"],
      ["/use [session|编号]", "切换到已有会话；不带参数时进入编号选择"],
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

  progressModeText(routeKey: string): string {
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

  modelText(
    models: CodexModelOption[],
    policy: CodexModelPolicy,
    currentModel: CodexSessionModelInfo | undefined,
    sessionId: string | undefined,
    includeHidden: boolean,
  ): string {
    return [
      "**模型设置**",
      `- 作用范围: ${sessionId ? `当前会话 \`${sessionId}\`` : "默认策略（后续新会话）"}`,
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

  permissionText(sessionId?: string): string {
    const policyStatus = this.runPolicyStatus(sessionId);
    const policy = policyStatus?.policy ?? this.codex.getRunPolicy?.(sessionId);
    return [
      "**权限模式**",
      `- 作用范围: ${sessionId ? `当前会话 \`${sessionId}\`` : "默认策略（后续新会话）"}`,
      `- 当前模式: \`${policy ? formatRunPolicy(policy) : "unknown"}\``,
      policyStatus ? `- 审批支持: ${formatApprovalSupport(policyStatus)}` : undefined,
      "- `approval`: 使用 `workspace-write` sandbox；是否能在微信里弹审批取决于 Codex adapter。",
      "- `full`: 完全权限，跳过审批和沙箱，风险很高。",
      "- 切回安全沙箱模式: `/permission approval`",
      "- 切到完全权限: `/permission full confirm`",
      policyStatus?.note ? `- 说明: ${policyStatus.note}` : undefined,
    ].filter(Boolean).join("\n");
  }

  shouldDeliverProgress(routeKey: string, kind: CodexProgressKind | undefined): boolean {
    const mode = this.progressModeFor(routeKey);
    if (mode === "silent") return false;
    if (mode === "detailed") return true;
    return kind === "reasoning" || kind === "todo" || kind === "search" || kind === "file_change" || kind === "other";
  }

  progressStatusLine(routeKey: string, policy: ChannelDeliveryPolicy): string {
    if (policy.progress === "suppress") {
      const label = policy.statusProgressLabel ?? "disabled";
      const detail = policy.statusProgressDescription ? `（${policy.statusProgressDescription}）` : "";
      return `- 进度投递: ${formatProgressLabelForStatus(label)}${detail}`;
    }
    const suffix = policy.progress === "aggregate" ? "（渠道聚合）" : "";
    return `- 进度投递: ${formatProgressModeForStatus(this.progressModeFor(routeKey))}${suffix}`;
  }

  private formatSessionLine(id: string, status: string, updatedAt: string, cwd?: string, title?: string): string {
    const parts = [`- ${id}`, status];
    if (updatedAt) parts.push(formatLocalDateTime(updatedAt));
    if (title) parts.push(truncateDisplayText(title));
    if (cwd) parts.push(`cwd=${cwd}`);
    return parts.join(" ");
  }
}
