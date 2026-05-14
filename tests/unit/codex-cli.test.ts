import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCodexRootArgs, discoverCodexSessions, displayCodexSessionTitle, findCodexSessionById, parseSessionIndexLine } from "../../src/codex/codex-cli.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codex-cli-test-"));
}

test("buildCodexRootArgs maps sandbox and full permission modes to Codex CLI flags", () => {
  assert.deepEqual(buildCodexRootArgs({ permissionMode: "approval", sandbox: "workspace-write" }), [
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

test("findCodexSessionById returns discovered session cwd", () => {
  const root = tempDir();
  const sessionDir = path.join(root, "sessions", "2026", "05", "14");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "rollout-thread-lookup.jsonl"), `${JSON.stringify({
    timestamp: "2026-05-14T01:00:00Z",
    type: "session_meta",
    payload: { id: "thread-lookup", cwd: "/tmp/lookup", timestamp: "2026-05-14T01:00:00Z" },
  })}\n`, "utf-8");

  const session = findCodexSessionById("thread-lookup", { codexHome: root });

  assert.equal(session?.id, "thread-lookup");
  assert.equal(session?.cwd, "/tmp/lookup");
});

test("discoverCodexSessions reads friendly titles from Codex sqlite state", (t) => {
  if (spawnSync("sqlite3", ["--version"], { stdio: "ignore" }).status !== 0) {
    t.skip("sqlite3 binary is not available");
    return;
  }
  const root = tempDir();
  const dbPath = path.join(root, "state_5.sqlite");
  const result = spawnSync("sqlite3", [dbPath, [
    "CREATE TABLE threads (",
    "id TEXT PRIMARY KEY,",
    "title TEXT NOT NULL,",
    "first_user_message TEXT NOT NULL,",
    "cwd TEXT NOT NULL,",
    "rollout_path TEXT NOT NULL,",
    "updated_at_ms INTEGER,",
    "updated_at INTEGER NOT NULL,",
    "archived INTEGER NOT NULL",
    ");",
    "INSERT INTO threads VALUES (",
    "'thread-sqlite',",
    "'友好标题',",
    "'第一条用户消息',",
    "'/tmp/sqlite-project',",
    "'/tmp/rollout.jsonl',",
    "1778716800000,",
    "1778716800,",
    "0",
    ");",
  ].join(" ")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);

  const session = discoverCodexSessions({ codexHome: root })[0];

  assert.equal(session.id, "thread-sqlite");
  assert.equal(displayCodexSessionTitle(session), "友好标题");
  assert.equal(session.preview, "第一条用户消息");
  assert.equal(session.cwd, "/tmp/sqlite-project");
});
