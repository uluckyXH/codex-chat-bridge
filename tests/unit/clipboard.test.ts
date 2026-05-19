import test from "node:test";
import assert from "node:assert/strict";
import {
  clipboardCommandCandidates,
  writeClipboardText,
  type ClipboardCommand,
} from "../../src/runtime/clipboard.js";

test("clipboardCommandCandidates chooses platform clipboard commands", () => {
  assert.deepEqual(clipboardCommandCandidates("darwin"), [{ command: "pbcopy", args: [] }]);
  assert.deepEqual(clipboardCommandCandidates("win32"), [{ command: "clip", args: [] }]);
  assert.deepEqual(clipboardCommandCandidates("linux"), [
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
  ]);
});

test("writeClipboardText reports the first successful clipboard command", async () => {
  const attempts: Array<{ command: ClipboardCommand; text: string }> = [];
  const result = await writeClipboardText("login-link", {
    platform: "linux",
    runner: async (command, text) => {
      attempts.push({ command, text });
      return { ok: command.command === "xclip", message: command.command === "wl-copy" ? "missing" : undefined };
    },
  });

  assert.deepEqual(attempts.map((attempt) => attempt.command.command), ["wl-copy", "xclip"]);
  assert.deepEqual(attempts.map((attempt) => attempt.text), ["login-link", "login-link"]);
  assert.deepEqual(result, {
    ok: true,
    command: "xclip",
    message: "copied with xclip",
  });
});

test("writeClipboardText returns collected errors when no clipboard command works", async () => {
  const result = await writeClipboardText("login-link", {
    platform: "darwin",
    runner: async () => ({ ok: false, message: "not available" }),
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /pbcopy: not available/);
});
