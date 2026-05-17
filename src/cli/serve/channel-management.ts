import type { Interface } from "node:readline/promises";
import { ChannelActions, formatChannelRecordLabel, formatFullDateTime, formatManagedChannelList, type ManagedChannelSummary } from "../actions/channel-actions.js";
import type { PreparedServeStartup, ServeChannelPlan } from "../launcher-types.js";
import { formatChannelStateForUser, formatChannelStatusDetails } from "../serve-wizard.js";
import { addFeishuBot } from "./feishu-setup.js";
import { isAddFeishuAction, isAddWeixinAction, isBackText, normalizeText } from "./shortcuts.js";
import { addWeixinAccount, configureWeixinPrimaryBinding } from "./weixin-setup.js";

export async function runChannelManagementLoop(
  rl: Interface,
  startup: PreparedServeStartup,
  _plan: ServeChannelPlan,
  channelActions: ChannelActions,
): Promise<void> {
  for (;;) {
    const channels = await channelActions.listChannelSummaries();
    console.log("");
    console.log(formatManagedChannelList(channels));
    const answer = normalizeText(await rl.question("请选择渠道编号 / 操作 [0 返回]: "));
    if (!answer || answer === "0" || isBackText(answer)) return;
    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= channels.length) {
      await manageConfiguredChannel(rl, startup, channelActions, channels[index - 1]);
      continue;
    }
    if (isAddWeixinAction(answer) || index === channels.length + 1) {
      const record = await addWeixinAccount(rl, channelActions);
      if (record) await configureWeixinPrimaryBinding(rl, startup, record);
      continue;
    }
    if (isAddFeishuAction(answer) || index === channels.length + 2) {
      await addFeishuBot(rl, channelActions);
      continue;
    }
    console.log("没有这个选项，请重新选择。");
  }
}

export async function printAllChannelStatuses(channelActions: ChannelActions): Promise<void> {
  const channels = await channelActions.listChannelSummaries();
  console.log("");
  if (channels.length === 0) {
    console.log("还没有配置渠道。请先进入“管理渠道”添加微信账号或飞书机器人。");
    return;
  }
  for (const channel of channels) {
    console.log(formatChannelStatusDetails(channel.status, channel.capabilities));
    console.log("");
  }
}

async function manageConfiguredChannel(
  rl: Interface,
  startup: PreparedServeStartup,
  channelActions: ChannelActions,
  channel: ManagedChannelSummary,
): Promise<void> {
  for (;;) {
    console.log("");
    console.log([
      "渠道详情",
      "",
      `类型: ${channel.record.type === "weixin" ? "微信" : "飞书"}`,
      `备注: ${channel.record.displayName ?? "未设置"}`,
      `账号标识: ${channel.status.account ?? channel.record.defaultAccountId ?? "default"}`,
      `实例: ${channel.record.id}`,
      `状态: ${formatChannelStateForUser(channel.status.state)}`,
      `启用: ${channel.record.enabled ? "是" : "否"}`,
      `添加时间: ${formatFullDateTime(channel.record.createdAt)}`,
      `更新时间: ${formatFullDateTime(channel.record.updatedAt)}`,
      channel.status.lastError ? `最近错误: ${channel.status.lastError}` : undefined,
      "",
      channel.record.type === "weixin" ? "1. 设置微信主聊天绑定" : "1. 查看说明",
      "2. 修改备注",
      `3. ${channel.record.enabled ? "停用" : "启用"}这个渠道（保留聊天绑定）`,
      "4. 删除这个渠道",
      "5. 状态详情",
      "0. 返回",
    ].filter(Boolean).join("\n"));
    const choice = normalizeText(await rl.question("请选择 [0 返回]: "));
    if (!choice || choice === "0" || isBackText(choice)) return;
    if (choice === "1") {
      if (channel.record.type === "weixin") {
        await configureWeixinPrimaryBinding(rl, startup, channel.record);
      } else {
        console.log("飞书机器人不做渠道级 session 绑定；请等用户私聊机器人后，到“聊天绑定”里按具体 chat_id 绑定。");
      }
      continue;
    }
    if (choice === "2") {
      await renameConfiguredChannel(rl, channelActions, channel);
      return;
    }
    if (choice === "3") {
      channelActions.setChannelEnabled(channel.record.id, !channel.record.enabled);
      console.log(channel.record.enabled ? "已停用渠道，原聊天绑定保持不变。" : "已启用渠道，原聊天绑定保持不变。");
      return;
    }
    if (choice === "4") {
      await removeConfiguredChannel(rl, channelActions, channel);
      return;
    }
    if (choice === "5") {
      console.log(formatChannelStatusDetails(channel.status, channel.capabilities));
      continue;
    }
    console.log("没有这个选项，请重新选择。");
  }
}

async function renameConfiguredChannel(
  rl: Interface,
  channelActions: ChannelActions,
  channel: ManagedChannelSummary,
): Promise<void> {
  console.log("");
  console.log([
    "修改渠道备注",
    "",
    `渠道: ${formatChannelRecordLabel(channel.record, channel.status)}`,
    "备注只影响展示，不改变渠道实例、账号标识或聊天绑定。",
  ].join("\n"));
  const answer = await rl.question("请输入新备注；直接回车清除备注；输入 0 取消: ");
  if (answer.trim() === "0" || isBackText(answer.trim())) {
    console.log("已取消修改备注。");
    return;
  }
  const updated = channelActions.renameChannel(channel.record.id, answer.trim() || undefined);
  console.log(updated ? `已更新渠道备注：${formatChannelRecordLabel(updated)}` : "这个渠道已经不存在。");
}

async function removeConfiguredChannel(
  rl: Interface,
  channelActions: ChannelActions,
  channel: ManagedChannelSummary,
): Promise<void> {
  console.log("");
  console.log([
    "删除渠道",
    "",
    `确认删除 ${formatChannelRecordLabel(channel.record, channel.status)}？`,
    "这会删除该渠道配置、本机渠道状态目录、已发现聊天记录、待生效绑定，并释放相关 session 占用。",
    "不会删除 Codex session 本体。",
  ].join("\n"));
  const answer = await rl.question("确认删除请输入 YES [其他输入取消]: ");
  if (answer.trim() !== "YES") {
    console.log("已取消删除渠道。");
    return;
  }
  const result = channelActions.removeChannel(channel.record.id);
  console.log(result.message);
}
