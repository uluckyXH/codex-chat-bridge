import type { Interface } from "node:readline/promises";
import { FeishuAdapter } from "../../channels/feishu/feishu-adapter.js";
import { DEFAULT_FEISHU_ACCOUNT_ID, DEFAULT_FEISHU_DOMAIN, missingFeishuCredentials, normalizeFeishuCredentials } from "../../channels/feishu/feishu-message.js";
import type { FeishuCredentials } from "../../channels/feishu/feishu-types.js";
import { feishuChannelId, type ChannelActions } from "../actions/channel-actions.js";
import { askOptional, askRequired } from "./prompts.js";

export async function addFeishuBot(rl: Interface, channelActions: ChannelActions): Promise<void> {
  console.log("");
  console.log([
    "添加飞书机器人",
    "",
    "请手动输入这次要添加的 App ID / App Secret。",
    "账号标识必填，是本地名称，用来区分多个飞书机器人。",
    `飞书域默认 ${DEFAULT_FEISHU_DOMAIN}，普通用户可直接回车。`,
    "凭证会保存到本机用户状态目录的 credentials.local.json，不会写入 Git 跟踪文件。",
    "也可以在启动前通过 FEISHU_APP_ID / FEISHU_APP_SECRET 环境变量覆盖。",
    "输入 0 返回上一级。",
  ].join("\n"));
  const credentials = await askFeishuCredentials(rl);
  if (!credentials) return;
  const missing = missingFeishuCredentials(credentials);
  if (missing.length > 0) {
    console.log(`缺少飞书配置: ${missing.join(", ")}。请重新输入完整配置。`);
    return;
  }
  const adapter = new FeishuAdapter({
    ...credentials,
    id: feishuChannelId(credentials.accountId ?? DEFAULT_FEISHU_ACCOUNT_ID),
    connectOnStart: false,
    probeOnStart: true,
  });
  console.log("正在校验飞书机器人连通性...");
  await adapter.start();
  const status = await adapter.getStatus();
  if (status.state !== "connected") {
    console.log(status.lastError ?? "飞书机器人配置检查失败。");
    return;
  }
  const record = channelActions.registerFeishuBot(credentials, "state-local");
  console.log("");
  console.log([
    "飞书机器人已添加",
    `账号标识: ${record.defaultAccountId ?? DEFAULT_FEISHU_ACCOUNT_ID}`,
    `渠道实例: ${record.id}`,
    "凭证: 已保存到本机用户状态目录，重启后会自动读取。",
    "",
    "下一步: 启动服务后，让用户在飞书里私聊机器人。",
    "每个飞书私聊会按 chat_id 生成独立聊天绑定。",
  ].join("\n"));
}

export async function askFeishuCredentials(rl: Interface): Promise<FeishuCredentials | undefined> {
  const appId = await askRequired(rl, "请输入 FEISHU_APP_ID: ");
  if (!appId) return undefined;
  const appSecret = await askRequired(rl, "请输入 FEISHU_APP_SECRET（输入会显示在终端）: ");
  if (!appSecret) return undefined;
  const accountId = await askRequired(rl, "请输入账号标识（本地名称，必填）: ");
  if (!accountId) return undefined;
  const domain = await askOptional(rl, `飞书域 [${DEFAULT_FEISHU_DOMAIN}，普通用户直接回车]: `, DEFAULT_FEISHU_DOMAIN);
  return normalizeFeishuCredentials({ appId, appSecret, domain, accountId });
}
