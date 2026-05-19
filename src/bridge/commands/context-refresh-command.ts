import type { ChannelMessage, ChannelTarget } from "../../protocol/channel.js";
import type { MemoryStateStore } from "../../state/memory-state-store.js";
import { normalizeContextRefreshMode } from "../../context-refresh/types.js";
import type { BridgeDelivery } from "../delivery.js";
import type { BridgeStatusText } from "../status-text.js";

export interface ContextRefreshCommandOptions {
  state: MemoryStateStore;
  delivery: BridgeDelivery;
  statusText: BridgeStatusText;
}

export async function handleContextRefreshCommand(
  options: ContextRefreshCommandOptions,
  message: ChannelMessage,
  target: ChannelTarget,
  rawMode: string | undefined,
): Promise<void> {
  if (!rawMode) {
    await options.delivery.sendText(target, options.statusText.contextRefreshText(message.routeKey));
    return;
  }
  const normalized = rawMode.trim().toLowerCase();
  if (normalized === "inherit" || normalized === "default" || normalized === "global" || normalized === "跟随" || normalized === "默认") {
    options.state.clearRouteContextRefreshPolicy(message.routeKey);
    await options.delivery.sendText(target, options.statusText.contextRefreshText(message.routeKey));
    return;
  }
  const mode = normalizeContextRefreshMode(normalized);
  if (!mode) {
    await options.delivery.sendText(target, "未知上下文刷新模式。可用值: off, detect, reload, inherit。");
    return;
  }
  options.state.setRouteContextRefreshPolicy(message.routeKey, { mode });
  await options.delivery.sendText(target, options.statusText.contextRefreshText(message.routeKey));
}
