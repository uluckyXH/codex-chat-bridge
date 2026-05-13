import test from "node:test";
import assert from "node:assert/strict";
import { Bridge } from "../../src/bridge/bridge.js";
import { MockChannelAdapter } from "../../src/channels/mock/mock-channel-adapter.js";
import { MockCodexAdapter } from "../../src/codex/mock-codex-adapter.js";

test("Bridge handles new session, prompt, status, and approval over mock channel", async () => {
  const channel = new MockChannelAdapter();
  const codex = new MockCodexAdapter();
  const bridge = new Bridge({ channel, codex, cwd: process.cwd() });

  await bridge.start();
  await channel.emitText("/new");
  await channel.emitText("/sessions");
  await channel.emitText("/whoami");
  await channel.emitText("/debug");
  await channel.emitText("/use mock-codex-1");
  await channel.emitText("你好");
  await channel.emitText("/status");
  await channel.emitText("请触发审批 approval");

  const approvalMessage = channel.sentMessages.find((message) => message.text.includes("Codex 请求审批"));
  assert.ok(approvalMessage, "approval request should be sent to channel");
  const approvalKey = approvalMessage.text.match(/\[(a[0-9a-z]+)\]/)?.[1];
  assert.ok(approvalKey, "approval key should be present");

  await channel.emitText(`/approve ${approvalKey}`);
  await bridge.stop();

  assert.ok(channel.sentMessages.some((message) => message.text.includes("已创建新 Codex 会话")));
  assert.ok(channel.sentMessages.some((message) => message.text.includes("当前上下文 Codex 会话")));
  assert.ok(channel.sentMessages.some((message) => message.text.includes("当前通道身份")));
  assert.ok(channel.sentMessages.some((message) => message.text.includes("Capabilities")));
  assert.ok(channel.sentMessages.some((message) => message.text.includes("已绑定 Codex 会话")));
  assert.ok(channel.sentMessages.some((message) => message.text.includes("Mock Codex 回复: 你好")));
  assert.ok(channel.sentMessages.some((message) => message.text.includes("Bridge: ok")));
  assert.deepEqual(codex.resolvedApprovals, [{ approvalKey, decision: "approve" }]);
});
