import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFeishuPostContent,
  feishuEventToChannelMessage,
  loadFeishuCredentialsFromEnv,
  maskFeishuSecret,
  missingFeishuCredentials,
  parseFeishuMessageContent,
  parseFeishuTextContent,
} from "../../src/channels/feishu/feishu-message.js";
import { sampleFeishuTextEvent } from "../helpers/feishu-fakes.js";

test("parseFeishuTextContent reads Feishu text JSON", () => {
  assert.equal(parseFeishuTextContent(JSON.stringify({ text: "/help" })), "/help");
  assert.equal(parseFeishuTextContent("普通文本"), "普通文本");
  assert.equal(parseFeishuTextContent(JSON.stringify({ notText: true })), undefined);
});

test("feishuEventToChannelMessage maps p2p text to ChannelMessage", () => {
  const now = Date.now();
  const result = feishuEventToChannelMessage(sampleFeishuTextEvent({
    message: {
      message_id: "om_message",
      create_time: String(now),
      chat_id: "oc_chat",
      content: JSON.stringify({ text: "ping" }),
    },
  }), {
    channelId: "feishu",
    accountId: "work",
    expectedAppId: "cli_1234567890abcdef",
    now,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.message.id, "om_message");
  assert.equal(result.message.text, "ping");
  assert.equal(result.message.channelId, "feishu");
  assert.equal(result.message.accountId, "work");
  assert.equal(result.message.routeKey, "feishu:work:direct:oc_chat");
  assert.deepEqual(result.message.sender, { id: "ou_user" });
  assert.deepEqual(result.message.conversation, {
    id: "oc_chat",
    kind: "direct",
    displayName: "飞书私聊",
  });
});

test("feishuEventToChannelMessage skips unsupported or unsafe events", () => {
  const baseOptions = {
    channelId: "feishu",
    accountId: "default",
    now: Date.now(),
  };

  assert.deepEqual(feishuEventToChannelMessage(sampleFeishuTextEvent({
    message: { chat_type: "group" },
  }), baseOptions), { ok: false, reason: "unsupported_chat_type" });

  assert.deepEqual(feishuEventToChannelMessage(sampleFeishuTextEvent({
    message: { message_type: "audio" },
  }), baseOptions), { ok: false, reason: "unsupported_message_type" });

  assert.deepEqual(feishuEventToChannelMessage(sampleFeishuTextEvent({
    sender: { sender_type: "bot" },
  }), baseOptions), { ok: false, reason: "bot_echo" });

  assert.deepEqual(feishuEventToChannelMessage(sampleFeishuTextEvent({
    sender: { sender_id: { open_id: "ou_bot" } },
  }), { ...baseOptions, botOpenId: "ou_bot" }), { ok: false, reason: "self_echo" });
});

test("feishuEventToChannelMessage maps image and file messages to attachments", () => {
  const imageResult = feishuEventToChannelMessage(sampleFeishuTextEvent({
    message: {
      message_id: "om_image",
      message_type: "image",
      content: JSON.stringify({ image_key: "img_v3_1" }),
    },
  }), {
    channelId: "feishu",
    accountId: "default",
    now: Date.now(),
  });
  assert.equal(imageResult.ok, true);
  if (imageResult.ok) {
    assert.equal(imageResult.message.text, undefined);
    assert.equal(imageResult.message.attachments?.[0]?.type, "image");
    assert.equal(imageResult.message.attachments?.[0]?.id, "img_v3_1");
  }

  const fileResult = feishuEventToChannelMessage(sampleFeishuTextEvent({
    message: {
      message_id: "om_file",
      message_type: "file",
      content: JSON.stringify({ file_key: "file_v3_1", file_name: "report.pdf", file_size: 12 }),
    },
  }), {
    channelId: "feishu",
    accountId: "default",
    now: Date.now(),
  });
  assert.equal(fileResult.ok, true);
  if (fileResult.ok) {
    assert.equal(fileResult.message.attachments?.[0]?.type, "file");
    assert.equal(fileResult.message.attachments?.[0]?.name, "report.pdf");
    assert.equal(fileResult.message.attachments?.[0]?.sizeBytes, 12);
  }
});

test("parseFeishuMessageContent extracts post text and images", () => {
  const parsed = parseFeishuMessageContent("post", JSON.stringify({
    content: [[
      { tag: "text", text: "看下这张图" },
      { tag: "img", image_key: "img_post_1" },
    ]],
  }));

  assert.equal(parsed.text, "看下这张图");
  assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0].type, "image");
  assert.equal(parsed.attachments[0].id, "img_post_1");
});

test("feishuEventToChannelMessage skips stale replayed messages", () => {
  const result = feishuEventToChannelMessage(sampleFeishuTextEvent({
    message: { create_time: String(Date.now() - 60_000) },
  }), {
    channelId: "feishu",
    accountId: "default",
    now: Date.now(),
    staleMessageMs: 1000,
  });

  assert.deepEqual(result, { ok: false, reason: "stale_message" });
});

test("Feishu credentials come from env without exposing secret values", () => {
  const credentials = loadFeishuCredentialsFromEnv({
    FEISHU_APP_ID: "cli_1234567890abcdef",
    FEISHU_APP_SECRET: "secret-value",
  } as NodeJS.ProcessEnv);

  assert.equal(credentials.appId, "cli_1234567890abcdef");
  assert.equal(credentials.appSecret, "secret-value");
  assert.deepEqual(missingFeishuCredentials(credentials), []);
  assert.equal(maskFeishuSecret(credentials.appSecret), "已配置");
});

test("buildFeishuPostContent wraps markdown text in Feishu post content", () => {
  const content = JSON.parse(buildFeishuPostContent("**状态**\n完成")) as {
    zh_cn: {
      content: Array<Array<{ tag: string; text: string }>>;
    };
  };

  assert.deepEqual(content.zh_cn.content, [[{ tag: "md", text: "**状态**\n完成" }]]);
});
