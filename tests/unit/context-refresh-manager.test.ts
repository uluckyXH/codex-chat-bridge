import test from "node:test";
import assert from "node:assert/strict";
import { SessionContextRefreshManager } from "../../src/bridge/context-refresh.js";
import { MockCodexAdapter } from "../../src/codex/mock-codex-adapter.js";
import type { CodexSessionContextFingerprint } from "../../src/codex/session-context-fingerprint.js";
import { MemoryStateStore } from "../../src/state/memory-state-store.js";

test("SessionContextRefreshManager skips checks when effective mode is off", async () => {
  const state = new MemoryStateStore();
  const codex = new MockCodexAdapter();
  const manager = new SessionContextRefreshManager({
    state,
    codex,
    defaultPolicy: { mode: "off" },
    readFingerprint: () => {
      throw new Error("should not read");
    },
  });

  const result = await manager.beforeRun({ routeKey: "route", sessionId: "session" });

  assert.equal(result.type, "skipped");
});

test("SessionContextRefreshManager records baseline when no previous snapshot exists", async () => {
  const state = new MemoryStateStore();
  const codex = new MockCodexAdapter();
  const fingerprint = fp(10, 100);
  const manager = new SessionContextRefreshManager({
    state,
    codex,
    defaultPolicy: { mode: "reload" },
    readFingerprint: () => fingerprint,
  });

  const result = await manager.beforeRun({ routeKey: "route", sessionId: "thread" });

  assert.equal(result.type, "no_snapshot");
  assert.equal(state.getSessionContextSnapshot("thread")?.fingerprint.rolloutSize, 100);
});

test("SessionContextRefreshManager detect mode reports external updates without reload", async () => {
  const state = new MemoryStateStore();
  const codex = new MockCodexAdapter();
  state.setSessionContextSnapshot({ sessionId: "thread", observedBy: "bind", fingerprint: fp(10, 100) });
  const manager = new SessionContextRefreshManager({
    state,
    codex,
    defaultPolicy: { mode: "detect" },
    readFingerprint: () => fp(20, 120),
  });

  const result = await manager.beforeRun({ routeKey: "route", sessionId: "thread" });

  assert.equal(result.type, "detect_only");
  assert.equal(codex.reloadedSessions.length, 0);
});

test("SessionContextRefreshManager reload mode reloads and updates snapshot", async () => {
  const state = new MemoryStateStore();
  const codex = new MockCodexAdapter();
  const session = await codex.startSession({ routeKey: "route", cwd: "/repo" });
  state.setSessionContextSnapshot({ sessionId: session.id, observedBy: "bind", fingerprint: fp(10, 100, session.id) });
  const manager = new SessionContextRefreshManager({
    state,
    codex,
    defaultPolicy: { mode: "reload" },
    readFingerprint: () => fp(20, 120, session.id),
  });

  const result = await manager.beforeRun({ routeKey: "route", sessionId: session.id });

  assert.equal(result.type, "reloaded");
  assert.deepEqual(codex.reloadedSessions, [session.id]);
  assert.equal(state.getSessionContextSnapshot(session.id)?.observedBy, "external-refresh");
  assert.equal(state.getSessionContextSnapshot(session.id)?.fingerprint.rolloutSize, 120);
});

test("SessionContextRefreshManager blocks send when reload fails after detecting update", async () => {
  const state = new MemoryStateStore();
  const codex = new MockCodexAdapter();
  state.setSessionContextSnapshot({ sessionId: "missing", observedBy: "bind", fingerprint: fp(10, 100, "missing") });
  const manager = new SessionContextRefreshManager({
    state,
    codex,
    defaultPolicy: { mode: "reload" },
    readFingerprint: () => fp(20, 120, "missing"),
  });

  const result = await manager.beforeRun({ routeKey: "route", sessionId: "missing" });

  assert.equal(result.type, "reload_failed");
  assert.match(result.type === "reload_failed" ? result.errorText : "", /没有发送|not found/);
});

function fp(updatedAtMs: number, rolloutSize: number, sessionId = "thread"): CodexSessionContextFingerprint {
  return {
    sessionId,
    detectedAt: "2026-05-18T00:00:00.000Z",
    source: "rollout",
    updatedAtMs,
    rolloutSize,
    rolloutMtimeMs: updatedAtMs,
  };
}
