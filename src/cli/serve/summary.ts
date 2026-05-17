import { WeixinAdapter } from "../../channels/weixin/weixin-adapter.js";
import type { CodexCliStatus } from "../../codex/codex-cli.js";
import { formatCodexCommandSource, formatCodexPlatform } from "../../codex/codex-process.js";
import type { ChannelStatus } from "../../protocol/channel.js";
import { FileStateStore } from "../../state/file-state-store.js";
import type { ManagedChannelSummary } from "../actions/channel-actions.js";
import type { PreparedServeStartup, ServeChannelPlan } from "../launcher-types.js";
import type { ServeChannelSummary, ServeRouteSummary } from "../serve-wizard.js";

export function codexSummary(startup: PreparedServeStartup) {
  return {
    adapterMode: startup.adapterMode,
    permissionMode: startup.policy.permissionMode,
    cwd: startup.cwd,
    progressMode: startup.progressMode,
    progressDisabled: true,
    maxConcurrentTurns: startup.maxConcurrentTurns,
  };
}

export function formatCodexStatusForCli(status?: CodexCliStatus): string {
  if (!status) return `平台 ${formatCodexPlatform()}，Codex CLI 尚未检测`;
  const state = status.available ? "已找到" : "不可用";
  const version = status.available ? status.version ?? "版本未知" : status.error ?? "unknown error";
  return [
    `平台 ${formatCodexPlatform(status)}`,
    `Codex CLI ${state}`,
    `版本 ${version}`,
    `路径 ${status.codexBin}`,
    `来源 ${formatCodexCommandSource(status.codexBinSource)}`,
  ].join("；");
}

export function routeSummary(plan: ServeChannelPlan): ServeRouteSummary {
  const state = new FileStateStore();
  const routes = state.listRoutes();
  return {
    known: routes.length,
    bound: routes.filter((route) => route.activeSessionId).length,
    pending: state.listPendingBindings().length,
    unboundPolicy: plan.unboundRoutePolicy,
    firstRouteBindingChoice: plan.firstRouteBindingChoice,
    initialSessionId: plan.initialSessionId,
    initialSessionTitle: plan.initialSessionTitle,
  };
}

export function toServeChannelSummary(channel: ManagedChannelSummary): ServeChannelSummary {
  return {
    id: channel.record.id,
    type: channel.record.type,
    enabled: channel.record.enabled,
    status: channel.status,
    capabilities: channel.capabilities,
  };
}

export function weixinChannelSummary(status: ChannelStatus): ServeChannelSummary {
  return {
    id: status.channelId,
    type: "weixin",
    enabled: true,
    status,
    capabilities: new WeixinAdapter({ pollOnStart: false }).getCapabilities(),
  };
}
