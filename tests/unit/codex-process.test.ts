import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  CHAT_CODEX_BIN_ENV,
  formatCodexCommandSource,
  formatCodexUnavailableError,
  parseNpmCmdShimTarget,
  resolveCodexCommand,
} from "../../src/codex/codex-process.js";

test("resolveCodexCommand keeps non-Windows default lightweight", () => {
  const resolved = resolveCodexCommand({ platform: "darwin", arch: "arm64", env: {} });

  assert.equal(resolved.command, "codex");
  assert.equal(resolved.requested, "codex");
  assert.equal(resolved.source, "default");
  assert.equal(resolved.platform, "darwin");
  assert.equal(resolved.arch, "arm64");
});

test("resolveCodexCommand honors CHAT_CODEX_BIN override", () => {
  const resolved = resolveCodexCommand({
    platform: "darwin",
    arch: "arm64",
    env: { [CHAT_CODEX_BIN_ENV]: "/opt/codex/bin/codex" },
  });

  assert.equal(resolved.command, "/opt/codex/bin/codex");
  assert.equal(resolved.source, "env");
  assert.equal(formatCodexCommandSource(resolved.source), CHAT_CODEX_BIN_ENV);
});

test("resolveCodexCommand resolves Windows npm cmd shim through PATH and PATHEXT", () => {
  const binDir = "D:\\env\\nvm\\nodejs";
  const cmdPath = path.win32.join(binDir, "codex.cmd");
  const files = new Set([cmdPath.toLowerCase()]);
  const resolved = resolveCodexCommand({
    platform: "win32",
    arch: "x64",
    cwd: "C:\\work",
    env: {
      Path: binDir,
      PATHEXT: ".EXE;.CMD",
    },
    fileExists: (filePath) => files.has(path.win32.normalize(filePath).toLowerCase()),
  });

  assert.equal(resolved.command, cmdPath);
  assert.equal(resolved.source, "path");
  assert.equal(resolved.pathResolved, true);
  assert.equal(resolved.shim, "cmd");
});

test("resolveCodexCommand resolves Windows explicit path without extension", () => {
  const cmdPath = "D:\\tools\\codex.cmd";
  const resolved = resolveCodexCommand({
    codexBin: "D:\\tools\\codex",
    platform: "win32",
    arch: "x64",
    env: {},
    fileExists: (filePath) => path.win32.normalize(filePath).toLowerCase() === cmdPath.toLowerCase(),
  });

  assert.equal(resolved.command, cmdPath);
  assert.equal(resolved.source, "explicit");
  assert.equal(resolved.shim, "cmd");
});

test("parseNpmCmdShimTarget extracts npm-generated JS wrapper target", () => {
  const commandPath = "D:\\env\\nvm\\nodejs\\codex.cmd";
  const content = [
    "@ECHO off",
    "SETLOCAL",
    "SET dp0=%~dp0",
    "endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js\" %*",
  ].join("\n");

  assert.equal(
    parseNpmCmdShimTarget(commandPath, content),
    "D:\\env\\nvm\\nodejs\\node_modules\\@openai\\codex\\bin\\codex.js",
  );
});

test("formatCodexUnavailableError includes Windows diagnostics", () => {
  const resolved = resolveCodexCommand({
    platform: "win32",
    arch: "x64",
    env: { [CHAT_CODEX_BIN_ENV]: "D:\\env\\nvm\\nodejs\\codex.cmd" },
  });

  const message = formatCodexUnavailableError(resolved, "spawn failed");
  assert.match(message, /平台: win32 x64/);
  assert.match(message, /where\.exe codex/);
  assert.match(message, new RegExp(CHAT_CODEX_BIN_ENV));
});
