import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ExecCodexAdapter, parseExecJsonLine } from "../../src/codex/exec-codex-adapter.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "exec-codex-test-"));
}

function writeSessionMeta(codexHome: string, id: string, cwd: string): void {
  const sessionDir = path.join(codexHome, "sessions", "2026", "05", "14");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, `rollout-${id}.jsonl`), `${JSON.stringify({
    timestamp: "2026-05-14T02:00:00Z",
    type: "session_meta",
    payload: { id, cwd, timestamp: "2026-05-14T02:00:00Z" },
  })}\n`, "utf-8");
}

test("parseExecJsonLine reads thread.started event", () => {
  const parsed = parseExecJsonLine(
    JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
    "local-session",
    "turn-1",
  );

  assert.deepEqual(parsed, { threadId: "thread-123" });
});

test("parseExecJsonLine maps agent message completion", () => {
  const parsed = parseExecJsonLine(
    JSON.stringify({ type: "item.completed", item: { id: "item-1", type: "agent_message", text: "done" } }),
    "local-session",
    "turn-1",
  );

  assert.deepEqual(parsed?.event, {
    type: "assistant.completed",
    sessionId: "local-session",
    turnId: "turn-1",
    text: "done",
  });
});

test("parseExecJsonLine maps failed events and ignores malformed lines", () => {
  assert.deepEqual(parseExecJsonLine(
    JSON.stringify({ type: "turn.failed", error: { message: "boom" } }),
    "local-session",
    "turn-1",
  )?.event, {
    type: "turn.failed",
    sessionId: "local-session",
    turnId: "turn-1",
    error: "boom",
  });

  assert.equal(parseExecJsonLine("not-json", "local-session", "turn-1"), undefined);
});

test("ExecCodexAdapter resumes discovered sessions with original cwd", async () => {
  const codexHome = tempDir();
  const cwd = path.join(codexHome, "project");
  fs.mkdirSync(cwd, { recursive: true });
  writeSessionMeta(codexHome, "thread-resume", cwd);
  const adapter = new ExecCodexAdapter({ codexHome });

  const session = await adapter.resumeSession("thread-resume");

  assert.equal(session.id, "thread-resume");
  assert.equal(session.cwd, cwd);
});

test("ExecCodexAdapter lists discovered Codex sessions when route is not scoped", async () => {
  const codexHome = tempDir();
  const cwd = path.join(codexHome, "project");
  writeSessionMeta(codexHome, "thread-history", cwd);
  const adapter = new ExecCodexAdapter({ codexHome });

  const sessions = await adapter.listSessions();

  assert.equal(sessions.some((session) => session.id === "thread-history" && session.cwd === cwd), true);
});
