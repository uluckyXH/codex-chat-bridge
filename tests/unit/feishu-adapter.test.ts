import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("FeishuAdapter starts websocket and declares private media capabilities", async () => {
  const factory = new FakeFeishuTransportFactory();
  const adapter = new FeishuAdapter({ ...credentials, transportFactory: factory });

  await adapter.start();

  assert.equal((await adapter.getStatus()).state, "connected");
  assert.equal(factory.wsClient?.starts, 1);
  assert.deepEqual(adapter.getDeliveryPolicy(), DEFAULT_CHANNEL_DELIVERY_POLICY);
  assert.deepEqual(adapter.getCapabilities(), {
    text: true,
    media: true,
    receiveMedia: true,
    typing: true,
    direct: true,
    group: false,
    thread: false,
    login: "token",
    messageUpdate: false,
    streamingHint: true,
  });
});

test("FeishuAdapter downloads inbound image resources before emitting ChannelMessage", async () => {
  const factory = new FakeFeishuTransportFactory();
  const uploadRoot = tempDir("codex-feishu-upload-");
  const adapter = new FeishuAdapter({ ...credentials, transportFactory: factory, inboundMediaRootDir: uploadRoot });
  const received: Array<{ localPath?: string; downloadState?: string }> = [];
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  factory.client.resourceBuffers.set("img_in_1", imageBytes);
  factory.client.resourceHeaders.set("img_in_1", { "content-type": "image/png" });
  adapter.onMessage(async (message) => {
    const attachment = message.attachments?.[0];
    received.push({
      localPath: attachment?.localPath,
      downloadState: attachment?.downloadState,
    });
  });

  await adapter.start();
  await factory.dispatcher.emitReceive(sampleFeishuTextEvent({
    app_id: credentials.appId,
    message: {
      message_id: "om_img",
      chat_id: "oc_user",
      message_type: "image",
      content: JSON.stringify({ image_key: "img_in_1" }),
    },
  }));

  assert.equal(factory.client.messageResourceGetPayloads.length, 1);
  assert.deepEqual(factory.client.messageResourceGetPayloads[0], {
    params: { type: "image" },
    path: { message_id: "om_img", file_key: "img_in_1" },
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].downloadState, "available");
  assert.ok(received[0].localPath?.startsWith(uploadRoot));
  assert.deepEqual(fs.readFileSync(received[0].localPath ?? ""), imageBytes);
});

test("FeishuAdapter downloads inbound file resources before emitting ChannelMessage", async () => {
  const factory = new FakeFeishuTransportFactory();
  const uploadRoot = tempDir("codex-feishu-upload-");
  const adapter = new FeishuAdapter({ ...credentials, transportFactory: factory, inboundMediaRootDir: uploadRoot });
  const fileBytes = Buffer.from("report");
  factory.client.resourceBuffers.set("file_in_1", fileBytes);
  factory.client.resourceHeaders.set("file_in_1", { "content-type": "application/pdf" });
  let localPath = "";
  let downloadState = "";
  adapter.onMessage(async (message) => {
    const attachment = message.attachments?.[0];
    localPath = attachment?.localPath ?? "";
    downloadState = attachment?.downloadState ?? "";
  });

  await adapter.start();
  await factory.dispatcher.emitReceive(sampleFeishuTextEvent({
    app_id: credentials.appId,
    message: {
      message_id: "om_file",
      chat_id: "oc_user",
      message_type: "file",
      content: JSON.stringify({ file_key: "file_in_1", file_name: "report.pdf", file_size: fileBytes.length }),
    },
  }));

  assert.deepEqual(factory.client.messageResourceGetPayloads[0], {
    params: { type: "file" },
    path: { message_id: "om_file", file_key: "file_in_1" },
  });
  assert.equal(downloadState, "available");
  assert.ok(localPath.startsWith(uploadRoot));
  assert.deepEqual(fs.readFileSync(localPath), fileBytes);
});

test("FeishuAdapter marks inbound resource download failures on attachment", async () => {
  const factory = new FakeFeishuTransportFactory();
  factory.client.messageResourceError = new Error("resource denied");
  const adapter = new FeishuAdapter({ ...credentials, transportFactory: factory, inboundMediaRootDir: tempDir("codex-feishu-upload-") });
  let downloadState = "";
  let error = "";
  adapter.onMessage(async (message) => {
    downloadState = message.attachments?.[0]?.downloadState ?? "";
    error = message.attachments?.[0]?.error ?? "";
  });

  await adapter.start();
  await factory.dispatcher.emitReceive(sampleFeishuTextEvent({
    app_id: credentials.appId,
    message: {
      message_id: "om_img_failed",
      message_type: "image",
      content: JSON.stringify({ image_key: "img_failed" }),
    },
  }));

  assert.equal(downloadState, "failed");
  assert.match(error, /resource denied/);
});

test("FeishuAdapter uploads and sends image and file media", async () => {
  const factory = new FakeFeishuTransportFactory();
  const adapter = new FeishuAdapter({ ...credentials, transportFactory: factory, connectOnStart: false });
  const dir = tempDir("codex-feishu-send-");
  const imagePath = path.join(dir, "shot.png");
  const filePath = path.join(dir, "report.pdf");
  fs.writeFileSync(imagePath, Buffer.from([1, 2, 3]));
  fs.writeFileSync(filePath, Buffer.from("pdf"));
  await adapter.start();
  const target = {
    channelId: "feishu",
    routeKey: "feishu:work:direct:oc_user",
    accountId: "work",
    conversation: { id: "oc_user", kind: "direct" as const },
    recipient: { id: "ou_user" },
    context: { sourceMessageId: "om_source" },
  };

  await adapter.sendMedia(target, { type: "image", path: imagePath, name: "shot.png", caption: "截图" });
  await adapter.sendMedia(target, { type: "file", path: filePath, name: "report.pdf", mimeType: "application/pdf" });

  assert.equal(factory.client.imageCreatePayloads.length, 1);
  assert.deepEqual(factory.client.imageCreatePayloads[0].data.image, Buffer.from([1, 2, 3]));
  assert.equal(factory.client.fileCreatePayloads.length, 1);
  assert.equal(factory.client.fileCreatePayloads[0].data.file_type, "pdf");
  assert.equal(factory.client.fileCreatePayloads[0].data.file_name, "report.pdf");
  const msgTypes = factory.client.replyPayloads.map((payload) => payload.data.msg_type);
  assert.deepEqual(msgTypes, ["post", "image", "file"]);
  assert.deepEqual(factory.client.replyPayloads.map((payload) => JSON.parse(payload.data.content)), [
    { zh_cn: { content: [[{ tag: "md", text: "截图" }]] } },
    { image_key: "img_upload" },
    { file_key: "file_upload" },
  ]);
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

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

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
