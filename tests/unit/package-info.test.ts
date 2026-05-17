import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CHAT_CODEX_DISPLAY_NAME,
  chatCodexTitle,
  chatCodexVersion,
  chatCodexVersionSummary,
  readChatCodexPackageInfo,
} from "../../src/runtime/package-info.js";

test("package info reads Chat-Codex package metadata", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };

  assert.equal(CHAT_CODEX_DISPLAY_NAME, "Chat-Codex");
  assert.deepEqual(readChatCodexPackageInfo(), {
    name: packageJson.name,
    version: packageJson.version,
  });
  assert.equal(chatCodexVersion(), packageJson.version);
  assert.equal(chatCodexTitle(), `Chat-Codex v${packageJson.version}`);
  assert.equal(chatCodexVersionSummary(), `Chat-Codex ${packageJson.version}\nNode.js ${process.version}`);
});
