import { WeixinAdapter } from "../../channels/weixin/weixin-adapter.js";
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
