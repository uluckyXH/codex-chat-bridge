import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { TerminalChannelAdapter } from "../../src/channels/terminal/terminal-channel-adapter.js";

class MemoryWritable extends Writable {
  readonly chunks: string[] = [];

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

test("TerminalChannelAdapter normalizes terminal input into ChannelMessage", async () => {
  const output = new MemoryWritable();
  const adapter = new TerminalChannelAdapter({
    output,
    accountId: "acct",
    senderId: "user-1",
    senderName: "User One",
    conversationId: "local-chat",
  });
  let observedRouteKey = "";

  adapter.onMessage(async (message) => {
    observedRouteKey = message.routeKey;
    assert.equal(message.text, "hello");
    assert.equal(message.channelId, "terminal");
    assert.equal(message.accountId, "acct");
    assert.equal(message.sender.id, "user-1");
    assert.equal(message.conversation.id, "local-chat");
  });

  const message = await adapter.emitText("hello");

  assert.equal(message.routeKey, "terminal:acct:direct:local-chat");
  assert.equal(observedRouteKey, message.routeKey);
  assert.equal((await adapter.getStatus()).lastInboundAt, message.timestamp);
});

test("TerminalChannelAdapter writes replies to output", async () => {
  const output = new MemoryWritable();
  const adapter = new TerminalChannelAdapter({ output });
  const result = await adapter.sendText({
    channelId: "terminal",
    routeKey: "terminal:local-terminal:direct:terminal",
    accountId: "local-terminal",
    conversation: { id: "terminal", kind: "direct" },
    recipient: { id: "terminal-user" },
  }, "reply text");

  assert.equal(result.channelId, "terminal");
  assert.match(output.text(), /\[Codex\]\nreply text/);
  assert.equal((await adapter.getStatus()).lastOutboundAt, result.deliveredAt);
});
