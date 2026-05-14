import test from "node:test";
import assert from "node:assert/strict";
import { Bridge } from "../../src/bridge/bridge.js";
import { MockChannelAdapter } from "../../src/channels/mock/mock-channel-adapter.js";
import { MockCodexAdapter } from "../../src/codex/mock-codex-adapter.js";
import type { CodexEvent } from "../../src/codex/types.js";
import type { TranscriptSink } from "../../src/logging/transcript.js";
import type { ChannelMedia, ChannelMessage, ChannelTarget } from "../../src/protocol/channel.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

class CapturingTranscriptSink implements TranscriptSink {
  readonly inboundEvents: Array<{ message: ChannelMessage; text: string }> = [];
  readonly outboundEvents: Array<{ target: ChannelTarget; text: string }> = [];
  readonly outboundMediaEvents: Array<{ target: ChannelTarget; media: ChannelMedia }> = [];

  inbound(message: ChannelMessage, text: string): void {
    this.inboundEvents.push({ message, text });
  }

  outbound(target: ChannelTarget, text: string): void {
    this.outboundEvents.push({ target, text });
  }

  outboundMedia(target: ChannelTarget, media: ChannelMedia): void {
    this.outboundMediaEvents.push({ target, media });
  }
}

class ProgressCodexAdapter extends MockCodexAdapter {
  override async *run(sessionId: string, _prompt: string): AsyncIterable<CodexEvent> {
    const turnId = `progress-turn-${Date.now()}`;
    yield { type: "turn.started", sessionId, turnId };
    yield { type: "assistant.progress", sessionId, turnId, kind: "reasoning", text: "我先列一个简短计划。" };
    yield { type: "assistant.progress", sessionId, turnId, kind: "command", text: "正在执行命令: npm test" };
    yield { type: "assistant.completed", sessionId, turnId, text: "完成" };
    yield { type: "turn.completed", sessionId, turnId };
  }
}

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
  await bridge.waitForIdle();
  await channel.emitText("/status");
  await channel.emitText("请触发审批 approval");
  await bridge.waitForIdle();

  const approvalMessage = channel.sentMessages.find((message) => message.text.includes("Codex 请求审批"));
  assert.ok(approvalMessage, "approval request should be sent to channel");
  const approvalKey = approvalMessage.text.match(/\[(a[0-9a-z]+)\]/)?.[1];
  assert.ok(approvalKey, "approval key should be present");

  await channel.emitText("/OK");
  await bridge.waitForIdle();
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

test("Bridge exposes all sessions command for channel users", async () => {
  const channel = new MockChannelAdapter();
  const codex = new MockCodexAdapter();
  const bridge = new Bridge({ channel, codex, cwd: process.cwd() });

  await bridge.start();
  await channel.emitText("/new", { conversationId: "main" });
  await channel.emitText("/new", { conversationId: "other" });
  await channel.emitText("/help", { conversationId: "main" });
  await channel.emitText("/sessions all", { conversationId: "main" });
  await channel.emitText("/all-sessions", { conversationId: "main" });
  await bridge.stop();

  assert.ok(channel.sentMessages.some((message) => message.text.includes("/sessions all - 列出全部可发现 Codex 会话")));
  const allSessionsMessages = channel.sentMessages.filter((message) => message.text.startsWith("全部可发现 Codex 会话"));
  assert.equal(allSessionsMessages.length, 2);
  assert.ok(allSessionsMessages.every((message) => message.text.includes("mock-codex-1")));
  assert.ok(allSessionsMessages.every((message) => message.text.includes("mock-codex-2")));
});

test("Bridge rejects latest approval with /NO without requiring an approval id", async () => {
  const channel = new MockChannelAdapter();
  const codex = new MockCodexAdapter();
  const bridge = new Bridge({ channel, codex, cwd: process.cwd() });

  await bridge.start();
  await channel.emitText("请触发审批 approval");
  await bridge.waitForIdle();
  const approvalMessage = channel.sentMessages.find((message) => message.text.includes("Codex 请求审批"));
  const approvalKey = approvalMessage?.text.match(/\[(a[0-9a-z]+)\]/)?.[1];
  assert.ok(approvalKey);

  await channel.emitText("/NO");
  await bridge.waitForIdle();
  await bridge.stop();

  assert.deepEqual(codex.resolvedApprovals, [{ approvalKey, decision: "deny" }]);
});

test("Bridge emits transcript events for inbound channel text and outbound replies", async () => {
  const channel = new MockChannelAdapter();
  const codex = new MockCodexAdapter();
  const transcript = new CapturingTranscriptSink();
  const bridge = new Bridge({ channel, codex, cwd: process.cwd(), transcript });

  await bridge.start();
  await channel.emitText("你好，打印到终端");
  await bridge.waitForIdle();
  await bridge.stop();

  assert.equal(transcript.inboundEvents.length, 1);
  assert.equal(transcript.inboundEvents[0].text, "你好，打印到终端");
  assert.ok(transcript.outboundEvents.some((event) => event.text.includes("Codex 开始处理")));
  assert.ok(transcript.outboundEvents.some((event) => event.text === "Mock Codex 回复: 你好，打印到终端"));
});

test("Bridge forwards generated image refs as channel media and transcript media events", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-media-test-"));
  const imagePath = path.join(root, "screenshot.png");
  fs.writeFileSync(imagePath, "png");
  const channel = new MockChannelAdapter({ media: true });
  const codex = new MockCodexAdapter();
  const transcript = new CapturingTranscriptSink();
  const bridge = new Bridge({ channel, codex, cwd: root, transcript });

  await bridge.start();
  await channel.emitText(`请查看截图 ${imagePath}`);
  await bridge.waitForIdle();
  await bridge.stop();

  assert.equal(channel.sentMedia.length, 1);
  assert.equal(channel.sentMedia[0].media.path, imagePath);
  assert.equal(channel.sentMedia[0].media.mimeType, "image/png");
  assert.equal(transcript.outboundMediaEvents.length, 1);
  assert.equal(transcript.outboundMediaEvents[0].media.path, imagePath);
});

test("Bridge default progress mode suppresses command details but keeps reasoning progress", async () => {
  const channel = new MockChannelAdapter();
  const codex = new ProgressCodexAdapter();
  const bridge = new Bridge({ channel, codex, cwd: process.cwd() });

  await bridge.start();
  await channel.emitText("跑一个带进度的任务");
  await bridge.waitForIdle();
  await bridge.stop();

  assert.ok(channel.sentMessages.some((message) => message.text.includes("我先列一个简短计划")));
  assert.equal(channel.sentMessages.some((message) => message.text.includes("正在执行命令: npm test")), false);
});

test("Bridge progress command enables detailed progress for the current route", async () => {
  const channel = new MockChannelAdapter();
  const codex = new ProgressCodexAdapter();
  const bridge = new Bridge({ channel, codex, cwd: process.cwd() });

  await bridge.start();
  await channel.emitText("/progress detailed");
  await channel.emitText("跑一个带详细进度的任务");
  await bridge.waitForIdle();
  await bridge.stop();

  assert.ok(channel.sentMessages.some((message) => message.text.includes("当前进度投递模式: detailed")));
  assert.ok(channel.sentMessages.some((message) => message.text.includes("正在执行命令: npm test")));
});

test("Bridge queues normal prompts for the same route while keeping commands responsive", async () => {
  const channel = new MockChannelAdapter();
  const codex = new MockCodexAdapter();
  const bridge = new Bridge({ channel, codex, cwd: process.cwd() });

  await bridge.start();
  await channel.emitText("第一条");
  await channel.emitText("第二条");
  await channel.emitText("/status");
  await bridge.waitForIdle();
  await bridge.stop();

  assert.ok(channel.sentMessages.some((message) => message.text.includes("已加入队列")));
  assert.ok(channel.sentMessages.some((message) => message.text.includes("Queued messages")));
  const firstIndex = channel.sentMessages.findIndex((message) => message.text === "Mock Codex 回复: 第一条");
  const secondIndex = channel.sentMessages.findIndex((message) => message.text === "Mock Codex 回复: 第二条");
  assert.ok(firstIndex >= 0);
  assert.ok(secondIndex > firstIndex);
});

test("Bridge binds first route to initial session when provided", async () => {
  const channel = new MockChannelAdapter();
  const codex = new MockCodexAdapter();
  const initial = await codex.startSession({
    routeKey: "bootstrap",
    cwd: process.cwd(),
    title: "existing",
  });
  const bridge = new Bridge({
    channel,
    codex,
    cwd: process.cwd(),
    initialSessionId: initial.id,
  });

  await bridge.start();
  await channel.emitText("继续已有会话");
  await bridge.waitForIdle();
  await channel.emitText("/status");
  await bridge.stop();

  assert.ok(channel.sentMessages.some((message) => message.text.includes("Mock Codex 回复: 继续已有会话")));
  assert.ok(channel.sentMessages.some((message) => message.text.includes(`Session: ${initial.id}`)));
});
