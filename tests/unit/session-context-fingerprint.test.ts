import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fingerprintIsNewer,
  readCodexSessionContextFingerprint,
  resolveCodexHome,
  type CodexSessionContextFingerprint,
} from "../../src/codex/session-context-fingerprint.js";

test("readCodexSessionContextFingerprint reads sqlite metadata and rollout stat without a shell", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
  const rolloutPath = path.join(codexHome, "sessions", "rollout-thread-sqlite.jsonl");
  fs.mkdirSync(path.dirname(rolloutPath), { recursive: true });
  fs.writeFileSync(rolloutPath, `${JSON.stringify({ type: "session_meta", payload: { id: "thread-sqlite" } })}\n`);
  fs.writeFileSync(path.join(codexHome, "state_5.sqlite"), "");
  const calls: Array<{ command: string; args: readonly string[] }> = [];

  const fingerprint = readCodexSessionContextFingerprint("thread-sqlite", {
    codexHome,
    now: () => new Date("2026-05-18T00:00:00.000Z"),
    spawnSync: ((command: string, args: readonly string[]) => {
      calls.push({ command, args });
      return {
        status: 0,
        stdout: JSON.stringify([{
          id: "thread-sqlite",
          rollout_path: rolloutPath,
          updated_at_ms: 1779062400123,
        }]),
        stderr: "",
      };
    }) as typeof import("node:child_process").spawnSync,
  });

  assert.equal(fingerprint?.source, "sqlite");
  assert.equal(fingerprint?.updatedAtMs, 1779062400123);
  assert.equal(fingerprint?.rolloutPath, rolloutPath);
  assert.equal(calls[0]?.command, "sqlite3");
  assert.deepEqual(calls[0]?.args.slice(0, 3), ["-readonly", "-json", path.join(codexHome, "state_5.sqlite")]);
});

test("readCodexSessionContextFingerprint falls back to rollout files and session index", () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
  const sessionDir = path.join(codexHome, "sessions", "2026", "05", "18");
  fs.mkdirSync(sessionDir, { recursive: true });
  const rolloutPath = path.join(sessionDir, "rollout-thread-rollout.jsonl");
  fs.writeFileSync(rolloutPath, [
    JSON.stringify({ type: "session_meta", payload: { id: "thread-rollout" } }),
    JSON.stringify({ type: "event", payload: { text: "hello" } }),
    "",
  ].join("\n"));

  const rollout = readCodexSessionContextFingerprint("thread-rollout", { codexHome });
  assert.equal(rollout?.source, "rollout");
  assert.equal(rollout?.rolloutPath, rolloutPath);
  assert.ok((rollout?.rolloutSize ?? 0) > 0);

  fs.writeFileSync(path.join(codexHome, "session_index.jsonl"), `${JSON.stringify({
    id: "thread-index",
    updated_at: "2026-05-18T01:02:03.000Z",
  })}\n`);
  const index = readCodexSessionContextFingerprint("thread-index", { codexHome });
  assert.equal(index?.source, "session_index");
  assert.equal(index?.updatedAtMs, Date.parse("2026-05-18T01:02:03.000Z"));
});

test("fingerprintIsNewer compares updated time before rollout size and mtime", () => {
  const previous: CodexSessionContextFingerprint = {
    sessionId: "thread",
    detectedAt: "2026-05-18T00:00:00.000Z",
    source: "sqlite",
    updatedAtMs: 2000,
    rolloutSize: 100,
    rolloutMtimeMs: 1000,
  };
  assert.equal(fingerprintIsNewer({ ...previous, updatedAtMs: 3000, rolloutSize: 50 }, previous), true);
  assert.equal(fingerprintIsNewer({ ...previous, updatedAtMs: 1000, rolloutSize: 200 }, previous), false);
  assert.equal(fingerprintIsNewer({ ...previous, rolloutSize: 101 }, previous), true);
  assert.equal(fingerprintIsNewer({ ...previous, rolloutMtimeMs: 1001 }, { ...previous, rolloutSize: 100 }), true);
});

test("resolveCodexHome supports CODEX_HOME override", () => {
  assert.equal(resolveCodexHome({ env: { CODEX_HOME: path.join("tmp", "codex") } }), path.join("tmp", "codex"));
});
