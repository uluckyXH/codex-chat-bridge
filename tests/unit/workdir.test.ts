import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkNewSessionWorkdir, normalizeWorkdir, resolveNewSessionWorkdir } from "../../src/codex/workdir.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codex-workdir-test-"));
}

test("normalizeWorkdir defaults to current directory and resolves relative input", () => {
  const root = tempDir();

  assert.equal(normalizeWorkdir(undefined, root), root);
  assert.equal(normalizeWorkdir("child", root), path.join(root, "child"));
});

test("resolveNewSessionWorkdir creates missing directory", () => {
  const root = tempDir();
  const target = path.join(root, "missing", "project");

  const resolved = resolveNewSessionWorkdir(target, root);

  assert.equal(resolved.cwd, target);
  assert.equal(resolved.created, true);
  assert.equal(fs.statSync(target).isDirectory(), true);
});

test("checkNewSessionWorkdir reports missing directories without creating them", () => {
  const root = tempDir();
  const target = path.join(root, "missing", "project");

  const checked = checkNewSessionWorkdir(target, root);

  assert.equal(checked.ok, false);
  assert.equal(checked.cwd, target);
  assert.equal(fs.existsSync(target), false);
});
