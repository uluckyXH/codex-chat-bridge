import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalManager } from "../../src/approvals/approval-manager.js";
import { BridgeDelivery } from "../../src/bridge/delivery.js";
import { SessionContextRefreshManager } from "../../src/bridge/context-refresh.js";
import { BridgeRouteQueue } from "../../src/bridge/route-queue.js";
import { BridgeSessionFlow } from "../../src/bridge/session-flow.js";
import { UnlimitedTurnScheduler } from "../../src/bridge/turn-scheduler.js";
import { MockCodexAdapter } from "../../src/codex/mock-codex-adapter.js";
import type { CodexEvent, CodexPromptInput } from "../../src/codex/types.js";
import type { CodexSessionContextFingerprint } from "../../src/codex/session-context-fingerprint.js";
import { codexInputPlainText } from "../../src/codex/input.js";
import { SilentLogger } from "../../src/logging/logger.js";
import type { ChannelRegistry } from "../../src/channels/registry.js";
import type { ChannelMessage, ChannelTarget } from "../../src/protocol/channel.js";
import { DEFAULT_CHANNEL_DELIVERY_POLICY } from "../../src/protocol/delivery-policy.js";
import { MemoryStateStore } from "../../src/state/memory-state-store.js";
import { SessionBindings } from "../../src/state/session-bindings.js";

test("BridgeRouteQueue forwards prompts and sends final replies", async () => {
  const fixture = routeQueueFixture();

  await fixture.queue.enqueuePrompt(message("route-a", "你好"), target("route-a"), "你好");
  await fixture.queue.waitForWorkers();

  assert.equal(fixture.codex.runs[0]?.prompt, "你好");
  assert.ok(fixture.sentTexts.some((text) => text.includes("Codex 正在处理这条消息。")));
  assert.ok(fixture.sentTexts.some((text) => text.includes("Mock Codex 回复: 你好")));
});

test("BridgeRouteQueue serializes same-route prompts and can clear queued work", async () => {
  const codex = new BlockingCodexAdapter();
  const fixture = routeQueueFixture({ codex });

  await fixture.queue.enqueuePrompt(message("route-a", "第一条"), target("route-a"), "第一条");
  await waitFor(() => codex.started);
  await fixture.queue.enqueuePrompt(message("route-a", "第二条"), target("route-a"), "第二条");

  assert.equal(fixture.queue.queueLength("route-a"), 1);
  assert.ok(fixture.sentTexts.some((text) => text.includes("已加入队列，前面还有 1 条消息。")));
  assert.equal(fixture.queue.clearQueued("route-a"), 1);

  codex.release();
  await fixture.queue.waitForWorkers();

  assert.deepEqual(codex.promptRuns, ["第一条"]);
});

test("BridgeRouteQueue reloads externally updated context before running prompt", async () => {
  const fixture = routeQueueFixture({ contextRefreshMode: "reload" });
  const session = await fixture.codex.startSession({ routeKey: "route-a", cwd: "/repo" });
  fixture.state.bindSession("route-a", session);
  fixture.state.setSessionContextSnapshot({ sessionId: session.id, observedBy: "bind", fingerprint: fp(session.id, 10, 100) });
  fixture.setFingerprint(fp(session.id, 20, 120));

  await fixture.queue.enqueuePrompt(message("route-a", "继续"), target("route-a"), "继续");
  await fixture.queue.waitForWorkers();

  assert.deepEqual(fixture.codex.reloadedSessions, [session.id]);
  assert.equal(fixture.codex.runs[0]?.prompt, "继续");
  assert.ok(fixture.sentTexts.some((text) => text.includes("已在发送前重新加载")));
});

test("BridgeRouteQueue keeps persisted snapshot for refresh check when auto-resuming", async () => {
  const codex = new MockCodexAdapter();
  const session = await codex.startSession({ routeKey: "route-a", cwd: "/repo" });
  const timestamp = "2026-05-18T00:00:00.000Z";
  const state = new MemoryStateStore(new SessionBindings({
    active: [{ routeKey: "route-a", sessionId: session.id, createdAt: timestamp, updatedAt: timestamp }],
    owners: [{ sessionId: session.id, ownerRouteKey: "route-a", claimedAt: timestamp, updatedAt: timestamp }],
  }));
  state.setSessionContextSnapshot({ sessionId: session.id, observedBy: "chat-codex-turn", fingerprint: fp(session.id, 10, 100) });
  const fixture = routeQueueFixture({ codex, state, contextRefreshMode: "reload" });
  fixture.setFingerprint(fp(session.id, 20, 120));

  await fixture.queue.enqueuePrompt(message("route-a", "继续"), target("route-a"), "继续");
  await fixture.queue.waitForWorkers();

  assert.deepEqual(fixture.codex.reloadedSessions, [session.id]);
  assert.equal(fixture.codex.runs[0]?.prompt, "继续");
  assert.ok(fixture.sentTexts.some((text) => text.includes("已在发送前重新加载")));
});

test("BridgeRouteQueue stops prompt when external update reload fails", async () => {
  const fixture = routeQueueFixture({ contextRefreshMode: "reload" });
  fixture.state.bindSession("route-a", {
    id: "missing-session",
    cwd: "/repo",
    createdAt: "2026-05-18T00:00:00.000Z",
  });
  fixture.state.setSessionContextSnapshot({ sessionId: "missing-session", observedBy: "bind", fingerprint: fp("missing-session", 10, 100) });
  fixture.setFingerprint(fp("missing-session", 20, 120));

  await fixture.queue.enqueuePrompt(message("route-a", "继续"), target("route-a"), "继续");
  await fixture.queue.waitForWorkers();

  assert.equal(fixture.codex.runs.length, 0);
  assert.ok(fixture.sentTexts.some((text) => text.includes("本条消息没有发送")));
});

function routeQueueFixture(options: { codex?: MockCodexAdapter; state?: MemoryStateStore; contextRefreshMode?: "off" | "detect" | "reload" } = {}) {
  const codex = options.codex ?? new MockCodexAdapter();
  const state = options.state ?? new MemoryStateStore();
  const approvals = new ApprovalManager();
  const sentTexts: string[] = [];
  const delivery = new BridgeDelivery({
    channels: {
      sendText: async (_target: ChannelTarget, text: string) => {
        sentTexts.push(text);
        return { channelId: "mock", messageId: `m-${sentTexts.length}`, deliveredAt: new Date().toISOString() };
      },
      getCapabilities: () => ({
        text: true,
        media: false,
        typing: false,
        direct: true,
        group: false,
        thread: false,
        login: "none" as const,
        messageUpdate: false,
        streamingHint: false,
      }),
    } as unknown as ChannelRegistry,
    approvals,
    logger: new SilentLogger(),
    approvalSendRetryDelayMs: 1,
  });
  const sessionFlow = new BridgeSessionFlow({
    codex,
    state,
    delivery,
    cwd: "/repo",
    unboundRoutePolicy: "auto_new",
    isRouteExecutionBusy: async () => false,
    applyStoredSessionRunPolicy: () => undefined,
    collaborationModeForRoute: () => "default",
    hasRouteCollaborationMode: () => false,
    applyRouteCollaborationModeToSession: () => undefined,
    syncRouteCollaborationModeFromSession: () => "default",
  });
  let currentFingerprint: CodexSessionContextFingerprint | undefined;
  const contextRefresh = options.contextRefreshMode
    ? new SessionContextRefreshManager({
        state,
        codex,
        defaultPolicy: { mode: options.contextRefreshMode },
        readFingerprint: () => currentFingerprint,
      })
    : undefined;
  const queue = new BridgeRouteQueue({
    codex,
    state,
    approvals,
    turnScheduler: new UnlimitedTurnScheduler(),
    delivery,
    sessionFlow,
    hasBackgroundTurnForRoute: () => false,
    currentCollaborationMode: () => undefined,
    deliveryPolicyFor: () => DEFAULT_CHANNEL_DELIVERY_POLICY,
    shouldDeliverProgressWithPolicy: () => true,
    contextRefresh,
  });
  return {
    codex,
    state,
    queue,
    sentTexts,
    setFingerprint: (fingerprint: CodexSessionContextFingerprint | undefined) => {
      currentFingerprint = fingerprint;
    },
  };
}

class BlockingCodexAdapter extends MockCodexAdapter {
  readonly promptRuns: string[] = [];
  started = false;
  private releaseCurrent: (() => void) | undefined;

  override async *run(sessionId: string, prompt: CodexPromptInput): AsyncIterable<CodexEvent> {
    const promptText = codexInputPlainText(prompt);
    this.promptRuns.push(promptText);
    const turnId = `blocking-${this.promptRuns.length}`;
    this.started = true;
    yield { type: "turn.started", sessionId, turnId };
    await new Promise<void>((resolve) => {
      this.releaseCurrent = resolve;
    });
    yield { type: "assistant.completed", sessionId, turnId, text: `完成: ${promptText}` };
    yield { type: "turn.completed", sessionId, turnId };
  }

  release(): void {
    this.releaseCurrent?.();
  }
}

function message(routeKey: string, text: string): ChannelMessage {
  return {
    id: `message-${routeKey}-${text}`,
    routeKey,
    channelId: "mock",
    sender: { id: "user" },
    conversation: { id: routeKey, kind: "direct" },
    text,
    timestamp: new Date().toISOString(),
  };
}

function target(routeKey: string): ChannelTarget {
  return {
    channelId: "mock",
    routeKey,
    conversation: { id: routeKey, kind: "direct" },
    recipient: { id: "user" },
  };
}

function fp(sessionId: string, updatedAtMs: number, rolloutSize: number): CodexSessionContextFingerprint {
  return {
    sessionId,
    detectedAt: "2026-05-18T00:00:00.000Z",
    source: "rollout",
    updatedAtMs,
    rolloutSize,
    rolloutMtimeMs: updatedAtMs,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
}
