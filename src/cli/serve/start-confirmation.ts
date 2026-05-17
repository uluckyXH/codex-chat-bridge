import type { Interface } from "node:readline/promises";
import type { ChannelActions } from "../actions/channel-actions.js";
import type { PreparedServeStartup, ServeChannelPlan } from "../launcher-types.js";
import { formatChannelStateForUser, formatStartConfirmation } from "../serve-wizard.js";
import { normalizeText } from "./shortcuts.js";
import { codexSummary, routeSummary, toServeChannelSummary } from "./summary.js";

export async function confirmStart(
  rl: Interface,
  startup: PreparedServeStartup,
  plan: ServeChannelPlan,
  channelActions: ChannelActions,
): Promise<boolean> {
  const channels = await channelActions.listChannelSummaries();
  const enabled = channels.filter((channel) => channel.record.enabled);
  if (enabled.length === 0) {
    console.log("");
    console.log("还没有启用的渠道。请先进入“管理渠道”添加或启用微信账号、飞书机器人。");
    return false;
  }
  const unavailable = enabled.filter((channel) => channel.status.state !== "connected");
  if (unavailable.length > 0) {
    console.log("");
    console.log("以下渠道还不能启动，请先处理配置或停用：");
    for (const channel of unavailable) {
      console.log(`- ${channel.record.type === "weixin" ? "微信" : "飞书"} / ${channel.status.account ?? channel.record.defaultAccountId ?? channel.record.id}: ${formatChannelStateForUser(channel.status.state)}${channel.status.lastError ? `，${channel.status.lastError}` : ""}`);
    }
    return false;
  }
  console.log("");
  console.log(formatStartConfirmation({
    codex: {
      ...codexSummary(startup),
      cwd: startup.cwd,
    },
    channels: enabled.map(toServeChannelSummary),
    routes: routeSummary(plan),
  }));
  const answer = normalizeText(await rl.question("请选择 [1]: "));
  return !answer || answer === "1" || answer === "start" || answer === "启动";
}
