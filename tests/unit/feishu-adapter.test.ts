import test from "node:test";
import assert from "node:assert/strict";
import { FeishuAdapter } from "../../src/channels/feishu/feishu-adapter.js";
import { DEFAULT_CHANNEL_DELIVERY_POLICY } from "../../src/protocol/delivery-policy.js";
import { FakeFeishuTransportFactory, sampleFeishuTextEvent } from "../helpers/feishu-fakes.js";

const credentials = {
  appId: "cli_1234567890abcdef",
  appSecret: "test-secret",
  accountId: "work",
};

test("FeishuAdapter reports login_required when credentials are missing", async () => {
  const adapter = new FeishuAdapter({ transportFactory: new FakeFeishuTransportFactory() });

  await adapter.start();
  const status = await adapter.getStatus();

  assert.equal(status.state, "login_required");
  assert.match(status.lastError ?? "", /FEISHU_APP_ID/);
  assert.equal(status.details?.appSecret, "未配置");
});

test("FeishuAdapter starts websocket and declares private text capabilities", async () => {
  const factory = new FakeFeishuTransportFactory();
  const adapter = new FeishuAdapter({ ...credentials, transportFactory: factory });

  await adapter.start();

  assert.equal((await adapter.getStatus()).state, "connected");
  assert.equal(factory.wsClient?.starts, 1);
  assert.deepEqual(adapter.getDeliveryPolicy(), DEFAULT_CHANNEL_DELIVERY_POLICY);
  assert.deepEqual(adapter.getCapabilities(), {
    text: true,
    media: false,
    typing: true,
    direct: true,
    group: false,
    thread: false,
    login: "token",
    messageUpdate: false,
    streamingHint: true,
  });
});

test("FeishuAdapter emits ChannelMessage for p2p text events and deduplicates message_id", async () => {
  const factory = new FakeFeishuTransportFactory();
  const adapter = new FeishuAdapter({ ...credentials, transportFactory: factory });
  const received: string[] = [];
  adapter.onMessage(async (message) => {
    received.push(message.text ?? "");
  });

  await adapter.start();
  await factory.dispatcher.emitReceive(sampleFeishuTextEvent({
    app_id: credentials.appId,
    message: {
      message_id: "om_once",
      chat_id: "oc_user",
      content: JSON.stringify({ text: "/help" }),
    },
  }));
  await factory.dispatcher.emitReceive(sampleFeishuTextEvent({
    app_id: credentials.appId,
    message: {
      message_id: "om_once",
      chat_id: "oc_user",
      content: JSON.stringify({ text: "/help" }),
    },
  }));

  assert.deepEqual(received, ["/help"]);
  const status = await adapter.getStatus();
  assert.equal(status.lastInboundAt !== undefined, true);
  assert.equal(status.details?.lastSkipReason, "duplicate_message");
});

test("FeishuAdapter sendText replies to source message first", async () => {
  const factory = new FakeFeishuTransportFactory();
  const adapter = new FeishuAdapter({ ...credentials, transportFactory: factory, connectOnStart: false });
  await adapter.start();

  const result = await adapter.sendText({
    channelId: "feishu",
    routeKey: "feishu:work:direct:oc_user",
    accountId: "work",
    conversation: { id: "oc_user", kind: "direct" },
    recipient: { id: "ou_user" },
    context: { sourceMessageId: "om_source" },
  }, "回复内容");

  assert.equal(result.messageId, "om_reply");
  assert.equal(factory.client.replyPayloads.length, 1);
  assert.equal(factory.client.replyPayloads[0].path.message_id, "om_source");
  assert.equal(factory.client.createPayloads.length, 0);
  assert.match(factory.client.sentTexts()[0], /回复内容/);
});

test("FeishuAdapter sendText falls back to chat_id create when reply fails", async () => {
  const factory = new FakeFeishuTransportFactory();
  factory.client.replyError = new Error("reply unavailable");
  const adapter = new FeishuAdapter({ ...credentials, transportFactory: factory, connectOnStart: false });
  await adapter.start();

  const result = await adapter.sendText({
    channelId: "feishu",
    routeKey: "feishu:work:direct:oc_user",
    accountId: "work",
    conversation: { id: "oc_user", kind: "direct" },
    recipient: { id: "ou_user" },
    context: { sourceMessageId: "om_source" },
  }, "回退发送");

  assert.equal(result.messageId, "om_create");
  assert.equal(factory.client.replyPayloads.length, 1);
  assert.equal(factory.client.createPayloads.length, 1);
  assert.equal(factory.client.createPayloads[0].params.receive_id_type, "chat_id");
  assert.equal(factory.client.createPayloads[0].data.receive_id, "oc_user");
  assert.match(factory.client.sentTexts().at(-1) ?? "", /回退发送/);
});

test("FeishuAdapter uses Typing reaction as typing indicator", async () => {
  const factory = new FakeFeishuTransportFactory();
  const adapter = new FeishuAdapter({ ...credentials, transportFactory: factory, connectOnStart: false });
  await adapter.start();
  const target = {
    channelId: "feishu",
    routeKey: "feishu:work:direct:oc_user",
    accountId: "work",
    conversation: { id: "oc_user", kind: "direct" as const },
    recipient: { id: "ou_user" },
    context: { sourceMessageId: "om_source" },
  };

  await adapter.sendTyping(target, true);
  await adapter.sendTyping(target, true);
  await adapter.sendTyping(target, false);

  assert.equal(factory.client.reactionCreatePayloads.length, 1);
  assert.equal(factory.client.reactionCreatePayloads[0].path.message_id, "om_source");
  assert.equal(factory.client.reactionCreatePayloads[0].data.reaction_type.emoji_type, "Typing");
  assert.deepEqual(factory.client.reactionDeletePayloads, [{
    path: {
      message_id: "om_source",
      reaction_id: "react_typing_1",
    },
  }]);
});

test("FeishuAdapter typing reaction failure does not degrade channel", async () => {
  const factory = new FakeFeishuTransportFactory();
  factory.client.reactionCreateError = new Error("reaction permission denied");
  const adapter = new FeishuAdapter({ ...credentials, transportFactory: factory, connectOnStart: false });
  await adapter.start();

  await adapter.sendTyping({
    channelId: "feishu",
    routeKey: "feishu:work:direct:oc_user",
    accountId: "work",
    conversation: { id: "oc_user", kind: "direct" },
    recipient: { id: "ou_user" },
    context: { sourceMessageId: "om_source" },
  }, true);

  const status = await adapter.getStatus();
  assert.equal(status.state, "connected");
  assert.equal(status.lastError, undefined);
  assert.match(String(status.details?.lastTypingError), /reaction permission denied/);
});
