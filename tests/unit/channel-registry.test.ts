import test from "node:test";
import assert from "node:assert/strict";
import { ChannelRegistry } from "../../src/channels/registry.js";
import { MockChannelAdapter } from "../../src/channels/mock/mock-channel-adapter.js";
import type { ChannelMessage, ChannelMessageHandler, ChannelTarget, ConversationKind } from "../../src/protocol/channel.js";
import { buildRouteKey } from "../../src/protocol/channel.js";
import type { ChannelDeliveryPolicy } from "../../src/protocol/delivery-policy.js";

class FailingStartChannelAdapter extends MockChannelAdapter {
  override async start(): Promise<void> {
    throw new Error("start failed");
  }
}

class PolicyChannelAdapter extends MockChannelAdapter {
  override getDeliveryPolicy(): ChannelDeliveryPolicy {
    return {
      taskStart: "suppress",
      progress: "suppress",
      progressCommand: "disabled",
      refreshCommands: [],
    };
  }
}

class ControlledChannelAdapter extends MockChannelAdapter {
  private testHandler?: ChannelMessageHandler;

  override onMessage(handler: ChannelMessageHandler): void {
    this.testHandler = handler;
    super.onMessage(handler);
  }

  async emitRaw(message: ChannelMessage): Promise<void> {
    if (!this.testHandler) throw new Error("handler is not registered");
    await this.testHandler(message);
  }
}

test("ChannelRegistry rejects duplicate channel ids", () => {
  assert.throws(
    () => new ChannelRegistry({
      channels: [
        new MockChannelAdapter({ id: "mock-a" }),
        new MockChannelAdapter({ id: "mock-a" }),
      ],
    }),
    /duplicate channel id: mock-a/,
  );
});

test("ChannelRegistry routes outbound text by target channel id", async () => {
  const a = new MockChannelAdapter({ id: "mock-a" });
  const b = new MockChannelAdapter({ id: "mock-b" });
  const registry = new ChannelRegistry({ channels: [a, b] });
  const target = targetFor("mock-b");

  await registry.sendText(target, "hello b");

  assert.equal(a.sentMessages.length, 0);
  assert.equal(b.sentMessages.length, 1);
  assert.equal(b.sentMessages[0].text, "hello b");
  assert.equal(b.sentMessages[0].target.channelId, "mock-b");
});

test("ChannelRegistry汇聚入站消息并拒绝 channelId 不匹配的消息", async () => {
  const a = new ControlledChannelAdapter({ id: "mock-a" });
  const registry = new ChannelRegistry({ channels: [a] });
  const messages: ChannelMessage[] = [];
  registry.onMessage(async (message) => {
    messages.push(message);
  });

  await a.emitText("正常消息");
  await a.emitRaw({
    ...messageFor("wrong-channel"),
    channelId: "wrong-channel",
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].channelId, "mock-a");
});

test("ChannelRegistry rejects unsupported conversation kinds", async () => {
  const channel = new ControlledChannelAdapter({ id: "limited", group: false, thread: false });
  const registry = new ChannelRegistry({ channels: [channel] });
  const messages: ChannelMessage[] = [];
  registry.onMessage(async (message) => {
    messages.push(message);
  });

  await channel.emitRaw(messageFor("limited", "direct", "user-1"));
  await channel.emitRaw(messageFor("limited", "group", "group-1"));
  await channel.emitRaw(messageFor("limited", "thread", "thread-1"));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].conversation.kind, "direct");
});

test("ChannelRegistry returns channel delivery policy and lifecycle failures", async () => {
  const ok = new PolicyChannelAdapter({ id: "mock-ok" });
  const failed = new FailingStartChannelAdapter({ id: "mock-failed" });
  const registry = new ChannelRegistry({ channels: [ok, failed] });

  const results = await registry.start();
  const policy = registry.getDeliveryPolicy(messageFor("mock-ok"));
  const status = await registry.getStatus();

  assert.equal(results.length, 2);
  assert.ok(results.some((result) => result.channelId === "mock-ok" && result.ok));
  assert.ok(results.some((result) => result.channelId === "mock-failed" && !result.ok));
  assert.equal(policy.progress, "suppress");
  assert.equal(status.channels.length, 2);
  assert.ok(status.failed.some((result) => result.channelId === "mock-failed"));
});

test("ChannelRegistry rejects missing target channels", async () => {
  const registry = new ChannelRegistry({ channels: [new MockChannelAdapter({ id: "mock-a" })] });

  await assert.rejects(
    () => registry.sendText(targetFor("missing"), "no route"),
    /channel not found: missing/,
  );
});

function targetFor(channelId: string, conversationKind: ConversationKind = "direct", conversationId = "user-1"): ChannelTarget {
  return {
    channelId,
    routeKey: buildRouteKey({
      channelId,
      accountId: "mock-account",
      conversationKind,
      conversationId,
    }),
    accountId: "mock-account",
    conversation: { id: conversationId, kind: conversationKind },
    recipient: { id: conversationKind === "direct" ? conversationId : "mock-user" },
  };
}

function messageFor(channelId: string, conversationKind: ConversationKind = "direct", conversationId?: string): ChannelMessage {
  const target = targetFor(channelId, conversationKind, conversationId ?? (conversationKind === "direct" ? "user-1" : `${conversationKind}-1`));
  return {
    id: `message-${channelId}`,
    routeKey: target.routeKey,
    channelId,
    accountId: target.accountId,
    sender: target.recipient,
    conversation: target.conversation,
    text: "hello",
    timestamp: new Date().toISOString(),
  };
}
