import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCodexRootArgs, discoverCodexSessions, parseSessionIndexLine } from "../../src/codex/codex-cli.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codex-cli-test-"));
}

test("buildCodexRootArgs maps approval and full permission modes to Codex CLI flags", () => {
  assert.deepEqual(buildCodexRootArgs({ permissionMode: "approval", sandbox: "workspace-write" }), [
    "--ask-for-approval",
    "on-request",
    "--sandbox",
    "workspace-write",
  ]);
  assert.deepEqual(buildCodexRootArgs({ permissionMode: "full" }), [
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
});

test("parseSessionIndexLine reads Codex session index records", () => {
  assert.deepEqual(parseSessionIndexLine(JSON.stringify({
    id: "thread-1",
    thread_name: "测试会话",
    updated_at: "2026-05-14T00:00:00Z",
  })), {
    id: "thread-1",
    threadName: "测试会话",
    updatedAt: "2026-05-14T00:00:00Z",
  });
  assert.equal(parseSessionIndexLine("not-json"), undefined);
});

test("discoverCodexSessions merges session index and rollout metadata", () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, "session_index.jsonl"), [
    JSON.stringify({ id: "thread-1", thread_name: "旧名称", updated_at: "2026-05-13T00:00:00Z" }),
    JSON.stringify({ id: "thread-2", thread_name: "只在索引", updated_at: "2026-05-12T00:00:00Z" }),
  ].join("\n"), "utf-8");
  const sessionDir = path.join(root, "sessions", "2026", "05", "14");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "rollout-thread-1.jsonl"), `${JSON.stringify({
    timestamp: "2026-05-14T00:00:00Z",
    type: "session_meta",
    payload: { id: "thread-1", cwd: "/tmp/project", timestamp: "2026-05-14T00:00:00Z" },
  })}\n`, "utf-8");

  const sessions = discoverCodexSessions({ codexHome: root });

  assert.equal(sessions[0].id, "thread-1");
  assert.equal(sessions[0].threadName, "旧名称");
  assert.equal(sessions[0].cwd, "/tmp/project");
  assert.equal(sessions[1].id, "thread-2");
});
