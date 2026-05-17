import test from "node:test";
import assert from "node:assert/strict";
import type { CodexModelOption } from "../../src/codex/types.js";
import type { QueuedSteer, SessionChoice } from "../../src/bridge/bridge-types.js";
import {
  composeFinalAnswer,
  composeSteerBatchInput,
  formatApprovalKindForUser,
  formatGoalTimestamp,
  formatModelPolicy,
  formatRunPolicy,
  formatSessionChoiceLine,
  isRouteBusyMutationCommand,
  parseModelCommandArgs,
  parseProgressDeliveryMode,
  parseReasoningEffort,
  resolveModelReference,
  unsupportedReasoningEffortText,
} from "../../src/bridge/formatters.js";

test("bridge formatters parse progress and model command values", () => {
  assert.equal(parseProgressDeliveryMode("normal"), "brief");
  assert.equal(parseProgressDeliveryMode("verbose"), "detailed");
  assert.equal(parseProgressDeliveryMode("off"), "silent");
  assert.equal(parseProgressDeliveryMode("unknown"), undefined);

  assert.deepEqual(parseModelCommandArgs([]), { type: "list" });
  assert.deepEqual(parseModelCommandArgs(["default"]), { type: "reset" });
  assert.deepEqual(parseModelCommandArgs(["effort", "high"]), { type: "effort", effort: "high" });
  assert.deepEqual(parseModelCommandArgs(["gpt-5.5", "effort", "xhigh"]), { type: "set", modelRef: "gpt-5.5", effort: "xhigh" });
  assert.equal(parseReasoningEffort("xhigh"), "xhigh");
  assert.equal(parseReasoningEffort("impossible"), undefined);
});

test("bridge formatters keep route mutation guard semantics", () => {
  assert.equal(isRouteBusyMutationCommand("new", [], "/new"), true);
  assert.equal(isRouteBusyMutationCommand("permission", [], "/permission"), false);
  assert.equal(isRouteBusyMutationCommand("permission", ["full", "confirm"], "/permission full confirm"), true);
  assert.equal(isRouteBusyMutationCommand("goal", [], "/goal"), false);
  assert.equal(isRouteBusyMutationCommand("goal", ["ship"], "/goal ship"), true);
  assert.equal(isRouteBusyMutationCommand("progress", ["silent"], "/progress silent"), false);
});

test("bridge formatters preserve status labels and local goal time", () => {
  assert.equal(formatRunPolicy({ permissionMode: "approval", sandbox: "workspace-write" }), "approval sandbox=workspace-write");
  assert.equal(formatRunPolicy({ permissionMode: "full" }), "full");
  assert.equal(formatModelPolicy({ model: "gpt-5.5", reasoningEffort: "high" }), "model=`gpt-5.5` effort=`high`");
  assert.equal(formatApprovalKindForUser("command"), "命令执行");
  assert.equal(formatGoalTimestamp(1700000000, { timeZone: "Asia/Shanghai" }), "2023-11-15 06:13:20（Asia/Shanghai）");
  assert.equal(formatGoalTimestamp(1700000000, { timeZone: "UTC" }), "2023-11-14 22:13:20（UTC）");
  assert.equal(formatGoalTimestamp(0, { timeZone: "UTC" }), "未知");
});

test("bridge formatters render session choices and final answers", () => {
  const choice: SessionChoice = {
    id: "session-1",
    title: "一个很长很长很长很长很长很长很长很长很长很长的标题",
    cwd: "/Users/xiaohuang/project/chat-codex",
    status: { type: "idle" },
    updatedAt: "2026-05-17T00:00:00.000Z",
    current: true,
  };

  const line = formatSessionChoiceLine(choice, 0);
  assert.match(line, /^1\. `session-1`（当前）/);
  assert.match(line, /空闲/);
  assert.match(line, /目录: \/Users\/xiaohuang\/project\/chat-codex|目录: \.\.\//);
  assert.equal(composeFinalAnswer("计划", "结果"), "计划\n\n结果");
  assert.equal(composeFinalAnswer("", "结果"), "结果");
});

test("bridge formatters compose steer batches with structured items", () => {
  const batch: QueuedSteer[] = [
    {
      message: message("m1"),
      target: target(),
      input: "补充 A",
    },
    {
      message: message("m2"),
      target: target(),
      input: {
        text: "补充 B",
        items: [
          { type: "text", text: "补充 B" },
          { type: "localImage", path: "/tmp/image.png" },
        ],
      },
    },
  ];

  const input = composeSteerBatchInput(batch);
  assert.match(input.text, /用户补充消息 1:\n补充 A/);
  assert.match(input.text, /用户补充消息 2:\n补充 B/);
  assert.deepEqual(input.items.at(-1), { type: "localImage", path: "/tmp/image.png" });
});

test("bridge formatters resolve model references and unsupported efforts", () => {
  const models: CodexModelOption[] = [
    model("gpt-a", "GPT A", ["low", "medium"], "medium"),
    model("gpt-b", "GPT B", ["high"], "high"),
  ];

  assert.equal(resolveModelReference("2", models).type, "ok");
  assert.equal(resolveModelReference("gpt-b", models).type, "ok");
  const missing = resolveModelReference("missing", models);
  assert.equal(missing.type, "error");
  assert.match(missing.message, /未找到模型/);
  assert.match(unsupportedReasoningEffortText(models[0], "high"), /不支持思考程度/);
});

function model(
  id: string,
  displayName: string,
  efforts: Array<"low" | "medium" | "high" | "xhigh">,
  defaultReasoningEffort: "low" | "medium" | "high" | "xhigh",
): CodexModelOption {
  return {
    id,
    model: id,
    displayName,
    hidden: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort })),
    defaultReasoningEffort,
    serviceTiers: [],
  };
}

function message(id: string) {
  return {
    id,
    routeKey: "mock:default:direct:user",
    channelId: "mock",
    sender: { id: "user" },
    conversation: { id: "user", kind: "direct" as const },
    text: "",
    timestamp: new Date().toISOString(),
  };
}

function target() {
  return {
    channelId: "mock",
    routeKey: "mock:default:direct:user",
    conversation: { id: "user", kind: "direct" as const },
    recipient: { id: "user" },
  };
}
