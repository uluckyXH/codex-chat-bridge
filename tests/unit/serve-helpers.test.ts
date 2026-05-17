import test from "node:test";
import assert from "node:assert/strict";
import type { Interface } from "node:readline/promises";
import { AppServerCodexAdapter } from "../../src/codex/app-server-codex-adapter.js";
import { ExecCodexAdapter } from "../../src/codex/exec-codex-adapter.js";
import { createRealCodexAdapter, startServeBridge } from "../../src/cli/serve/bridge-runtime.js";
import { formatPolicyForCli, formatSessionChoice } from "../../src/cli/serve/formatters.js";
import { askOptional, askRequired, questionWithReadline } from "../../src/cli/serve/prompts.js";
import { formatPersistedBindingList, resolveSessionIdFromChoiceInput, shortSessionId } from "../../src/cli/serve/route-binding-helpers.js";
import { confirmStart } from "../../src/cli/serve/start-confirmation.js";
import { isAddFeishuAction, isAddWeixinAction, isBackText, isManualSessionInputAction, isNewSessionAction, normalizeText } from "../../src/cli/serve/shortcuts.js";
import { clearFirstRouteBinding, confirmFullPermission, createInitialChannelPlan, setFirstRouteExisting, setFirstRouteNew } from "../../src/cli/serve/startup.js";
import { codexSummary, toServeChannelSummary } from "../../src/cli/serve/summary.js";

function fakeReadline(answers: string[]): Interface {
  return {
    question: async () => answers.shift() ?? "",
  } as unknown as Interface;
}

function fakeChannelSummary(state: "connected" | "login_required" = "connected") {
  return {
    record: {
      id: "feishu-default",
      type: "feishu",
      defaultAccountId: "default",
      enabled: true,
      stateDir: "/tmp/feishu-default",
      createdAt: "now",
      updatedAt: "now",
    },
    status: { channelId: "feishu-default", state },
    capabilities: {
      text: true,
      media: false,
      typing: true,
      direct: true,
      group: false,
      thread: false,
      login: "none",
      messageUpdate: false,
      streamingHint: false,
    },
  } as const;
}

test("serve shortcuts preserve CLI action aliases", () => {
  assert.equal(normalizeText(" 微信 "), "微信");
  assert.equal(isAddWeixinAction("w"), true);
  assert.equal(isAddWeixinAction("微信"), true);
  assert.equal(isAddFeishuAction("f"), true);
  assert.equal(isAddFeishuAction("lark"), true);
  assert.equal(isNewSessionAction("n"), true);
  assert.equal(isNewSessionAction("新建"), true);
  assert.equal(isManualSessionInputAction("m"), true);
  assert.equal(isManualSessionInputAction("id"), true);
  assert.equal(isBackText("0"), true);
  assert.equal(isBackText("quit"), true);
  assert.equal(isBackText("continue"), false);
});

test("serve prompt helpers trim input and honor back shortcuts", async () => {
  assert.equal(await askRequired(fakeReadline(["  value  "]), "prompt"), "value");
  assert.equal(await askRequired(fakeReadline(["0"]), "prompt"), undefined);
  assert.equal(await askOptional(fakeReadline([""]), "prompt", "default"), "default");
  assert.equal(await askOptional(fakeReadline(["  custom  "]), "prompt", "default"), "custom");
  const question = questionWithReadline(fakeReadline(["  answer  "]));
  assert.equal(await question("prompt"), "answer");
});

test("serve formatters keep session and permission display stable", () => {
  assert.equal(formatPolicyForCli({ permissionMode: "approval", sandbox: "workspace-write" }), "审批模式（workspace-write 沙箱，推荐）");
  assert.equal(formatPolicyForCli({ permissionMode: "full" }), "完全权限（跳过审批和沙箱，风险高）");
  const rendered = formatSessionChoice(2, {
    id: "session-123",
    threadName: "A very useful title",
    cwd: "/repo",
    updatedAt: "2026-05-17T00:00:00.000Z",
  });
  assert.match(rendered, /^2\. A very useful title/m);
  assert.match(rendered, /Session ID: session-123/);
  assert.match(rendered, /工作目录: \/repo/);
});

test("serve startup helpers preserve initial binding plan semantics", async () => {
  const emptyPlan = createInitialChannelPlan({ channelId: "weixin-default", state: "connected" }, {});
  assert.equal(emptyPlan.unboundRoutePolicy, "auto_new");
  assert.equal(emptyPlan.initialRouteBinding, undefined);

  const newPlan = createInitialChannelPlan({ channelId: "weixin-default", state: "connected" }, { session: "new" });
  assert.deepEqual(newPlan.initialRouteBinding, { type: "new" });
  assert.equal(newPlan.firstRouteBindingChoice, "new_first_route");

  setFirstRouteExisting(newPlan, "session-1", { id: "session-1", threadName: "Title", updatedAt: "2026-05-17T00:00:00.000Z" });
  assert.deepEqual(newPlan.initialRouteBinding, { type: "existing", sessionId: "session-1" });
  assert.equal(newPlan.initialSessionTitle, "Title");
  setFirstRouteNew(newPlan);
  assert.deepEqual(newPlan.initialRouteBinding, { type: "new" });
  clearFirstRouteBinding(newPlan);
  assert.equal(newPlan.initialRouteBinding, undefined);

  await assert.rejects(() => confirmFullPermission(fakeReadline(["NO"]), false), /已取消完全权限启动/);
  await assert.doesNotReject(() => confirmFullPermission(fakeReadline(["YES"]), false));
});

test("serve summary helpers map startup and channel records", () => {
  assert.deepEqual(codexSummary({
    adapterMode: "app-server",
    policy: { permissionMode: "approval", sandbox: "workspace-write" },
    cwd: "/repo",
    progressMode: "brief",
    maxConcurrentTurns: 2,
  }), {
    adapterMode: "app-server",
    permissionMode: "approval",
    cwd: "/repo",
    progressMode: "brief",
    progressDisabled: true,
    maxConcurrentTurns: 2,
  });
  assert.deepEqual(toServeChannelSummary(fakeChannelSummary()), {
    id: "feishu-default",
    type: "feishu",
    enabled: true,
    status: { channelId: "feishu-default", state: "connected" },
    capabilities: {
      text: true,
      media: false,
      typing: true,
      direct: true,
      group: false,
      thread: false,
      login: "none",
      messageUpdate: false,
      streamingHint: false,
    },
  });
});

test("serve route binding helpers preserve selection and list formatting", async () => {
  assert.equal(shortSessionId("1234567890"), "12345678");
  assert.equal(shortSessionId("1234"), "1234");
  assert.equal(await resolveSessionIdFromChoiceInput(fakeReadline([]), "1", {
    selectable: [{ id: "session-1", shortId: "session-", updatedAt: "2026-05-17T00:00:00.000Z", current: false }],
    unavailable: [],
  }), "session-1");
  assert.equal(await resolveSessionIdFromChoiceInput(fakeReadline(["manual-session"]), "m", {
    selectable: [],
    unavailable: [],
  }), "manual-session");
  assert.match(formatPersistedBindingList([{
    route: {
      routeKey: "route-1",
      channelId: "feishu-default",
      accountId: "default",
      conversationKind: "direct",
      conversationId: "chat-1",
      createdAt: "now",
      updatedAt: "now",
    },
    label: "飞书 / default / Alice",
    activeSession: {
      id: "session-1",
      shortId: "session-",
      title: "Title",
      updatedAt: "2026-05-17T00:00:00.000Z",
    },
    permission: { permissionMode: "approval", sandbox: "workspace-write" },
  }]), /飞书 \/ default \/ Alice\s+Title \/ session-/);
});

test("serve start confirmation and runtime adapter helpers stay compatible", async () => {
  const startup = {
    adapterMode: "app-server" as const,
    policy: { permissionMode: "approval" as const, sandbox: "workspace-write" as const },
    cwd: "/repo",
  };
  const plan = { unboundRoutePolicy: "auto_new" as const };
  assert.equal(await confirmStart(fakeReadline([""]), startup, plan, {
    listChannelSummaries: async () => [],
  } as never), false);
  assert.equal(await confirmStart(fakeReadline([""]), startup, plan, {
    listChannelSummaries: async () => [fakeChannelSummary()],
  } as never), true);
  assert.equal(await confirmStart(fakeReadline([""]), startup, plan, {
    listChannelSummaries: async () => [fakeChannelSummary("login_required")],
  } as never), false);
  assert.equal(createRealCodexAdapter(startup) instanceof AppServerCodexAdapter, true);
  assert.equal(createRealCodexAdapter({ ...startup, adapterMode: "exec" }) instanceof ExecCodexAdapter, true);
  await assert.rejects(() => startServeBridge(startup, plan, {
    createRuntimeAdapters: () => [],
  } as never), /未发现可启动的渠道/);
});
