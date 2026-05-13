import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../../src/commands/parser.js";

test("parseCommand parses slash commands", () => {
  assert.deepEqual(parseCommand("/approve a001"), {
    isCommand: true,
    name: "approve",
    args: ["a001"],
    raw: "/approve a001",
  });
});

test("parseCommand ignores normal text", () => {
  assert.deepEqual(parseCommand("hello codex"), {
    isCommand: false,
    args: [],
    raw: "hello codex",
  });
});
