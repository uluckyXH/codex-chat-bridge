import type { CodexPermissionMode } from "../codex/codex-cli.js";
import type { ProgressDeliveryMode } from "../bridge/bridge.js";
import type { ChannelCapabilities, ChannelStatus } from "../protocol/channel.js";

export type ServeHomeChoice =
  | "start"
  | "manage_channels"
  | "manage_routes"
  | "codex_settings"
  | "status"
  | "exit";

export type ChannelAddChoice = "weixin" | "lark" | "exit";

export type FirstRouteBindingChoice =
  | "auto_new"
  | "ask"
  | "bind_existing_first_route"
  | "new_first_route";

export type UnboundRoutePolicy = "auto_new" | "ask";

export interface ServeCodexSummary {
  adapterMode: "app-server" | "exec";
  permissionMode: CodexPermissionMode;
  progressMode?: ProgressDeliveryMode;
  maxConcurrentTurns?: number;
}

export interface ServeChannelSummary {
  id: string;
  type: string;
  enabled: boolean;
  status: ChannelStatus;
  capabilities?: ChannelCapabilities;
}

export interface ServeRouteSummary {
  known: number;
  bound: number;
  unboundPolicy: UnboundRoutePolicy;
}

export interface ServeHomeSummary {
  codex: ServeCodexSummary;
  channels: ServeChannelSummary[];
  routes: ServeRouteSummary;
}

export function parseServeHomeChoice(input: string | undefined): ServeHomeChoice {
  const normalized = normalizeChoice(input);
  if (!normalized || normalized === "1" || normalized === "start" || normalized === "s") return "start";
  if (normalized === "2" || normalized === "channel" || normalized === "channels") return "manage_channels";
  if (normalized === "3" || normalized === "route" || normalized === "routes") return "manage_routes";
  if (normalized === "4" || normalized === "codex" || normalized === "settings") return "codex_settings";
  if (normalized === "5" || normalized === "status") return "status";
  if (normalized === "0" || normalized === "q" || normalized === "quit" || normalized === "exit") return "exit";
  return "start";
}

export function parseChannelAddChoice(input: string | undefined): ChannelAddChoice {
  const normalized = normalizeChoice(input);
  if (!normalized || normalized === "1" || normalized === "weixin" || normalized === "wechat" || normalized === "微信") return "weixin";
  if (normalized === "2" || normalized === "lark" || normalized === "feishu" || normalized === "飞书") return "lark";
  if (normalized === "0" || normalized === "q" || normalized === "quit" || normalized === "exit") return "exit";
  return "weixin";
}

export function parseFirstRouteBindingChoice(input: string | undefined): FirstRouteBindingChoice {
  const normalized = normalizeChoice(input);
  if (!normalized || normalized === "1" || normalized === "auto" || normalized === "auto_new") return "auto_new";
  if (normalized === "2" || normalized === "ask") return "ask";
  if (normalized === "3" || normalized === "existing" || normalized === "bind_existing_first_route") return "bind_existing_first_route";
  if (normalized === "4" || normalized === "new" || normalized === "new_first_route") return "new_first_route";
  return "auto_new";
}

export function formatNoChannelGuide(): string {
  return [
    "未发现可启动渠道。",
    "",
    "请选择要添加的渠道：",
    "1. 微信",
    "2. 飞书（未实现，稍后适配）",
    "0. 退出",
  ].join("\n");
}

export function formatServeHomeSummary(summary: ServeHomeSummary): string {
  const lines = [
    "Codex Chat Bridge",
    "",
    "Codex:",
    `- Adapter: ${summary.codex.adapterMode}`,
    `- Permission: ${summary.codex.permissionMode}`,
    `- Progress: ${summary.codex.progressMode ?? "brief"}`,
    `- maxConcurrentTurns: ${summary.codex.maxConcurrentTurns ?? "unlimited"}`,
    "",
    "Channels:",
  ];
  if (summary.channels.length === 0) {
    lines.push("- none");
  } else {
    summary.channels.forEach((channel, index) => {
      const account = channel.status.account ? `  account=${channel.status.account}` : "";
      lines.push(`${index + 1}. ${channel.id}  type=${channel.type}  enabled=${channel.enabled}  state=${channel.status.state}${account}`);
    });
  }
  lines.push(
    "",
    "Routes:",
    `- Known: ${summary.routes.known}`,
    `- Bound: ${summary.routes.bound}`,
    `- Unbound policy: ${summary.routes.unboundPolicy}`,
    "",
    "操作:",
    "1. 启动服务",
    "2. 管理渠道",
    "3. 管理 route/session 绑定",
    "4. 修改 Codex 默认设置",
    "5. 查看状态详情",
    "0. 退出",
  );
  return lines.join("\n");
}

export function formatWeixinFirstRouteBindingPrompt(input: {
  channelId: string;
  account?: string;
  knownRoutes?: number;
}): string {
  return [
    `微信渠道 ${input.channelId} 已登录`,
    `- Account: ${input.account ?? "unknown"}`,
    `- 当前已知 route: ${input.knownRoutes ?? 0}`,
    "",
    "首个微信私聊 route 如何绑定 Codex session？",
    "1. 首条消息自动创建新 session（推荐单用户私有部署）",
    "2. 首条消息先询问 /new 或 /resume（推荐多用户/多聊天）",
    "3. 现在选择已有 session，绑定给第一个私聊 route",
    "4. 现在创建新 session，绑定给第一个私聊 route",
  ].join("\n");
}

export function formatChannelCapabilities(capabilities: ChannelCapabilities): string {
  return [
    "渠道能力:",
    `- direct: ${formatCapability(capabilities.direct)}`,
    `- group: ${formatCapability(capabilities.group)}`,
    `- thread: ${formatCapability(capabilities.thread)}`,
    `- typing: ${formatCapability(capabilities.typing)}`,
    `- media: ${formatCapability(capabilities.media)}`,
    `- login: ${capabilities.login}`,
  ].join("\n");
}

export function firstRouteBindingChoiceToPolicy(choice: FirstRouteBindingChoice): UnboundRoutePolicy {
  return choice === "auto_new" || choice === "new_first_route" ? "auto_new" : "ask";
}

function normalizeChoice(input: string | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

function formatCapability(value: boolean): string {
  return value ? "yes" : "no";
}
