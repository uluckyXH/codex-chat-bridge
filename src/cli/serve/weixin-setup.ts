import type { Interface } from "node:readline/promises";
import { WeixinAdapter, type WeixinLoginStartResult } from "../../channels/weixin/weixin-adapter.js";
import { FileWeixinAccountStore } from "../../channels/weixin/weixin-account-store.js";
import { displayWeixinQrCode } from "../../channels/weixin/weixin-qr-display.js";
import { findCodexSessionById, formatCodexSessionTitleForDisplay } from "../../codex/codex-cli.js";
import type { ChannelLoginResult } from "../../protocol/channel.js";
import { BindingActions, formatOwnerRouteLabel, formatSessionActiveTime, type SessionChoices } from "../actions/binding-actions.js";
import type { ChannelActions } from "../actions/channel-actions.js";
import type { PreparedServeStartup } from "../launcher-types.js";
import { FileStateStore } from "../../state/file-state-store.js";
import { pendingBindingOwnerRouteKey } from "../../state/memory-state-store.js";
import type { ChannelInstanceRecord } from "../../state/persistent-state-types.js";
import { formatChannelCapabilities } from "../serve-wizard.js";
import { questionWithReadline } from "./prompts.js";
import { createBindingActions, shortSessionId } from "./route-binding-helpers.js";
import { isBackText, isManualSessionInputAction, isNewSessionAction, normalizeText } from "./shortcuts.js";

const WEIXIN_LOGIN_CHECK_TIMEOUT_MS = 15_000;

export async function addWeixinAccount(rl: Interface, channelActions: ChannelActions): Promise<ChannelInstanceRecord | undefined> {
  const channel = new WeixinAdapter({
    pollOnStart: false,
    verifyCodeProvider: questionWithReadline(rl),
  });
  console.log("");
  console.log("添加微信账号");
  console.log(formatChannelCapabilities(channel.getCapabilities()));
  try {
    const started = await channel.startLogin();
    console.log(started.message);
    if (started.qrCodeText) {
      await displayWeixinQrCode(started.qrCodeText);
    }
    const loginResult = await waitWeixinLoginFromQrMenu(rl, channel, started);
    if (!loginResult) {
      console.log("已返回管理渠道，未添加微信账号。");
      return undefined;
    }
    const status = await channel.getStatus();
    if (loginResult.state !== "connected") {
      console.log("微信登录未完成，可以稍后重新进入“管理渠道”重试。");
      return undefined;
    }
    const accountId = status.account;
    if (!accountId) {
      console.log("微信登录完成但没有拿到账号标识，暂不能添加到渠道列表。");
      return undefined;
    }
    const account = new FileWeixinAccountStore().loadAccount(accountId);
    if (!account) {
      console.log("微信登录态保存异常，暂不能添加到渠道列表。");
      return undefined;
    }
    const record = channelActions.registerWeixinAccount(account);
    console.log("");
    console.log([
      "微信账号已添加",
      `账号: ${account.accountId}`,
      `渠道实例: ${record.id}`,
      "",
      "下一步: 请选择这个微信主聊天绑定哪个 Codex session。",
    ].join("\n"));
    return record;
  } catch (error) {
    console.log(`微信登录失败: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function waitWeixinLoginFromQrMenu(
  rl: Interface,
  channel: WeixinAdapter,
  started: WeixinLoginStartResult,
): Promise<ChannelLoginResult | undefined> {
  for (;;) {
    console.log("");
    console.log([
      "微信扫码登录",
      "",
      "扫码并在手机上确认后，按回车检查登录结果。",
      "不想登录就输入 0 返回管理渠道。",
    ].join("\n"));
    const answer = normalizeText(await rl.question("请选择 [回车检查 / 0 返回]: "));
    if (answer === "0" || isBackText(answer)) return undefined;
    if (answer && answer !== "c" && answer !== "check" && answer !== "检查") {
      console.log("没有这个选项。按回车检查登录结果，或输入 0 返回。");
      continue;
    }
    const result = await channel.waitLogin(started.sessionKey, WEIXIN_LOGIN_CHECK_TIMEOUT_MS);
    console.log(result.message);
    if (result.state === "connected" || result.state === "failed") return result;
    if (!result.message.includes("超时")) return result;
    console.log("还没有检测到扫码确认。可以继续按回车检查，或输入 0 返回。");
  }
}

export async function configureWeixinPrimaryBinding(
  rl: Interface,
  startup: PreparedServeStartup,
  channel: ChannelInstanceRecord,
): Promise<void> {
  const accountId = channel.defaultAccountId;
  if (!accountId) {
    console.log("这个微信渠道缺少账号标识，不能设置主聊天绑定。");
    return;
  }
  const state = new FileStateStore();
  const pendingId = weixinPrimaryPendingId(channel.id, accountId);
  const pendingOwner = pendingBindingOwnerRouteKey(pendingId);
  for (;;) {
    const choices = new BindingActions(state, { cwd: startup.cwd, sessionLimit: 15 }).listSessionChoices(pendingOwner);
    console.log("");
    const lines = [
      "微信主聊天绑定",
      "",
      `账号: ${accountId}`,
      `渠道实例: ${channel.id}`,
      "",
      "请选择这个微信主聊天使用哪个 Codex session：",
      "",
      ...(choices.selectable.length > 0
        ? choices.selectable.map((session, index) => `  ${index + 1}. ${session.title ?? session.id}    ${session.shortId}    最近 ${formatSessionActiveTime(session.updatedAt)}`)
        : ["  暂无可选历史 session"]),
      "",
      "操作:",
      "  n. 新建 Codex session",
      "  m. 手动输入 Session ID",
      "  0. 暂不绑定，首条消息自动创建",
    ];
    if (choices.unavailable.length > 0) {
      lines.push("", "不可选（已绑定其他聊天）:");
      for (const session of choices.unavailable) {
        lines.push(`  已绑定到 ${session.ownerLabel}    ${session.title ?? session.id}    ${session.shortId}    最近 ${formatSessionActiveTime(session.updatedAt)}`);
      }
    }
    console.log(lines.join("\n"));
    const answer = (await rl.question("请选择 session 编号 / 操作 [0]: ")).trim();
    if (!answer || answer === "0" || isBackText(answer)) {
      state.clearPendingBindingForMessage(pendingProbeMessage(channel.id, accountId));
      console.log("已设置：暂不绑定，首条消息自动创建。");
      return;
    }
    if (isNewSessionAction(answer)) {
      state.setPendingBinding({
        id: pendingId,
        channelId: channel.id,
        accountId,
        conversationKind: "direct",
        label: `微信 / ${accountId} / 主聊天`,
        binding: { type: "new" },
      });
      console.log("已设置：收到第一条微信私聊后创建新 session。");
      return;
    }
    const sessionId = await resolveWeixinPrimarySessionId(rl, answer, choices);
    if (!sessionId) continue;
    const session = findCodexSessionById(sessionId);
    if (!session) {
      console.log("没有找到这个 session。请重新输入编号或有效 Session ID；输入 0 返回。");
      continue;
    }
    const owner = state.getSessionOwner(session.id);
    if (owner && owner.ownerRouteKey !== pendingOwner) {
      console.log(`无法预留这个 session：${session.id} 已绑定到 ${formatOwnerRouteLabel(state, owner.ownerRouteKey)}。请先到“聊天绑定”里解绑原聊天，或选择其他 session。`);
      continue;
    }
    state.setPendingBinding({
      id: pendingId,
      channelId: channel.id,
      accountId,
      conversationKind: "direct",
      label: `微信 / ${accountId} / 主聊天`,
      binding: { type: "existing", sessionId: session.id },
    });
    console.log([
      "已设置微信主聊天绑定",
      `聊天: 微信 / ${accountId} / 主聊天`,
      `待绑定 session: ${formatCodexSessionTitleForDisplay(session) ?? session.id} / ${shortSessionId(session.id)}`,
      `最近活跃: ${formatSessionActiveTime(session.updatedAt, "full")}`,
      "说明: 收到第一条微信私聊后生效。",
    ].join("\n"));
    return;
  }
}

async function resolveWeixinPrimarySessionId(
  rl: Interface,
  answer: string,
  choices: SessionChoices,
): Promise<string | undefined> {
  if (isManualSessionInputAction(answer)) {
    const manual = (await rl.question("请输入 Session ID [0 返回]: ")).trim();
    if (!manual || manual === "0" || isBackText(manual)) return undefined;
    return manual;
  }
  if (/^\d+$/.test(answer)) {
    const index = Number.parseInt(answer, 10);
    if (index >= 1 && index <= choices.selectable.length) return choices.selectable[index - 1].id;
    console.log(`没有第 ${index} 项，请重新选择。`);
    return undefined;
  }
  return answer;
}

function weixinPrimaryPendingId(channelId: string, accountId: string): string {
  return `weixin-primary-${channelId}-${accountId}`;
}

function pendingProbeMessage(channelId: string, accountId: string) {
  return {
    id: "pending-probe",
    routeKey: `${channelId}:${accountId}:direct:pending-probe`,
    channelId,
    accountId,
    sender: { id: "pending-probe" },
    conversation: { id: "pending-probe", kind: "direct" as const },
    text: "",
    timestamp: new Date().toISOString(),
  };
}
