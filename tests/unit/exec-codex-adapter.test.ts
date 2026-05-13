import test from "node:test";
import assert from "node:assert/strict";
import { parseExecJsonLine } from "../../src/codex/exec-codex-adapter.js";

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
