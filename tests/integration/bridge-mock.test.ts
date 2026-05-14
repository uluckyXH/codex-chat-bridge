import test from "node:test";
import assert from "node:assert/strict";
import { Bridge } from "../../src/bridge/bridge.js";
import { MockChannelAdapter } from "../../src/channels/mock/mock-channel-adapter.js";
import { MockCodexAdapter } from "../../src/codex/mock-codex-adapter.js";
import type { CodexAdapter, CodexEvent, CodexSession, CodexSessionStatus, CodexSessionSummary, StartSessionInput } from "../../src/codex/types.js";
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

class CancellableCodexAdapter implements CodexAdapter {
  private sequence = 0;
  private readonly sessions = new Map<string, CodexSession>();
  private status: CodexSessionStatus = { type: "idle" };
  private release?: () => void;
  cancelled = false;

  async startSession(input: StartSessionInput): Promise<CodexSession> {
    this.sequence += 1;
    const session: CodexSession = {
      id: `cancel-codex-${this.sequence}`,
      cwd: input.cwd,
      title: input.title,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async resumeSession(sessionId: string): Promise<CodexSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`missing session ${sessionId}`);
    return session;
  }

  async *run(sessionId: string, prompt: string): AsyncIterable<CodexEvent> {
    const turnId = "cancel-turn-1";
    this.status = { type: "running", turnId, task: prompt };
    yield { type: "turn.started", sessionId, turnId };
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
    this.status = { type: "idle" };
    yield { type: "turn.completed", sessionId, turnId };
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.status = { type: "idle" };
    this.release?.();
  }

  async getStatus(): Promise<CodexSessionStatus> {
    return this.status;
  }

  async listSessions(): Promise<CodexSessionSummary[]> {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      status: this.status,
      updatedAt: new Date().toISOString(),
    }));
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

test("Bridge rejects latest approval with /NO and an optional reason", async () => {
  const channel = new MockChannelAdapter();
  const codex = new MockCodexAdapter();
  const bridge = new Bridge({ channel, codex, cwd: process.cwd() });

  await bridge.start();
  await channel.emitText("请触发审批 approval");
  await bridge.waitForIdle();
  const approvalMessage = channel.sentMessages.find((message) => message.text.includes("Codex 请求审批"));
  const approvalKey = approvalMessage?.text.match(/\[(a[0-9a-z]+)\]/)?.[1];
  assert.ok(approvalKey);

  await channel.emitText("/NO 这个命令会删除文件");
  await bridge.waitForIdle();
  await bridge.stop();

  assert.deepEqual(codex.resolvedApprovals, [{ approvalKey, decision: "deny", reason: "这个命令会删除文件" }]);
  assert.ok(channel.sentMessages.some((message) => message.text.includes("理由: 这个命令会删除文件")));
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

test("Bridge sends typing state while Codex is running", async () => {
  const channel = new MockChannelAdapter({ typing: true });
  const codex = new ProgressCodexAdapter();
  const bridge = new Bridge({ channel, codex, cwd: process.cwd() });

  await bridge.start();
  await channel.emitText("跑一个需要 typing 的任务");
  await bridge.waitForIdle();
  await bridge.stop();

  assert.deepEqual(channel.sentTyping.map((event) => event.typing), [true, false]);
});

test("Bridge status reports running work and /stop cancels the current task", async () => {
  const channel = new MockChannelAdapter({ typing: true });
  const codex = new CancellableCodexAdapter();
  const bridge = new Bridge({ channel, codex, cwd: process.cwd() });

  await bridge.start();
  await channel.emitText("执行一个长任务");
  await waitFor(() => channel.sentMessages.some((message) => message.text.includes("Codex 开始处理")));
  await waitFor(() => channel.sentTyping.some((event) => event.typing));
  await waitFor(async () => (await codex.getStatus()).type === "running");

  await channel.emitText("/status");
  const statusMessage = channel.sentMessages.at(-1)?.text ?? "";
  assert.match(statusMessage, /Processing: yes/);
  assert.match(statusMessage, /Codex: running/);
  assert.match(statusMessage, /操作: \/stop/);

  await channel.emitText("/stop");
  await bridge.waitForIdle();
  await bridge.stop();

  assert.equal(codex.cancelled, true);
  assert.ok(channel.sentMessages.some((message) => message.text.includes("已请求停止当前 Codex 任务")));
  assert.deepEqual(channel.sentTyping.map((event) => event.typing), [true, false, false]);
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

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
}
