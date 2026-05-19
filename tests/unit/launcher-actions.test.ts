import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LauncherActions } from "../../src/cli/actions/launcher-actions.js";
import { ChannelActions } from "../../src/cli/actions/channel-actions.js";
import { resolveCodexCommand } from "../../src/codex/codex-process.js";
import { FileStateStore } from "../../src/state/file-state-store.js";
import { ChannelConfigStore } from "../../src/state/channel-config-store.js";

test("LauncherActions requires a Feishu account label before probing credentials", async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-launcher-actions-"));
  const actions = new LauncherActions(
    {
      adapterMode: "app-server",
      cwd: baseDir,
      policy: { permissionMode: "approval", sandbox: "workspace-write" },
    },
    { unboundRoutePolicy: "auto_new" },
    new ChannelActions({
      configStore: new ChannelConfigStore({ bridgeDir: path.join(baseDir, "state", "bridge") }),
      env: {},
    }),
  );

  const result = await actions.addFeishuBot({ appId: "cli_test", appSecret: "secret" });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_credentials");
  assert.match(result.message, /账号标识不能为空/);
});

test("LauncherActions blocks startup when Codex CLI is unavailable", () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-launcher-actions-"));
  const actions = new LauncherActions(
    {
      adapterMode: "app-server",
      cwd: baseDir,
      policy: { permissionMode: "approval", sandbox: "workspace-write" },
      codexStatus: {
        available: false,
        codexBin: "codex",
        requestedCodexBin: "codex",
        codexBinSource: "default",
        platform: "win32",
        arch: "x64",
        command: resolveCodexCommand({ platform: "win32", arch: "x64", env: {} }),
        error: "spawn codex ENOENT",
      },
    },
    { unboundRoutePolicy: "auto_new" },
    new ChannelActions({
      configStore: new ChannelConfigStore({ bridgeDir: path.join(baseDir, "state", "bridge") }),
      env: {},
    }),
  );

  const validation = actions.validateStart([]);

  assert.equal(validation.ok, false);
  assert.equal(validation.reason, "codex_unavailable");
  assert.match(validation.message, /Codex CLI 不可用/);
});

test("LauncherActions manages route trust and optional session unbind", async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-launcher-actions-"));
  const bridgeDir = path.join(baseDir, "state", "bridge");
  const store = new FileStateStore({ rootDir: bridgeDir });
  const routeKey = "feishu-default:default:direct:oc_pairing";
  store.recordRouteMessage({
    id: "message-1",
    routeKey,
    channelId: "feishu-default",
    accountId: "default",
    sender: { id: "ou_pairing", displayName: "张三" },
    conversation: { id: "oc_pairing", kind: "direct", displayName: "张三" },
    text: "hello",
    timestamp: "2026-05-18T00:00:00.000Z",
  });
  store.bindSession(routeKey, {
    id: "session-pairing",
    cwd: baseDir,
    title: "pairing test",
    createdAt: "2026-05-18T00:00:00.000Z",
  });
  const actions = new LauncherActions(
    {
      adapterMode: "app-server",
      cwd: baseDir,
      policy: { permissionMode: "approval", sandbox: "workspace-write" },
    },
    { unboundRoutePolicy: "auto_new" },
    new ChannelActions({
      configStore: new ChannelConfigStore({ bridgeDir }),
      env: {},
    }),
  );

  let dashboard = await actions.getDashboard();
  assert.equal(dashboard.pairing.pending, 1);
  assert.equal(dashboard.pairing.trusted, 0);
  assert.equal(dashboard.bindings[0]?.trusted, false);

  const trusted = actions.trustRouteManually(routeKey);
  assert.equal(trusted.ok, true);
  assert.equal(trusted.route.trusted, true);
  assert.equal(trusted.route.trustedRecord?.trustMethod, "manual");

  dashboard = await actions.getDashboard();
  assert.equal(dashboard.pairing.pending, 0);
  assert.equal(dashboard.pairing.trusted, 1);
  assert.equal(dashboard.bindings[0]?.trusted, true);

  const revoked = actions.revokeRouteTrust(routeKey, { unbindSession: true });
  assert.equal(revoked.ok, true);
  assert.match(revoked.message, /解绑 session/);

  const reloaded = new FileStateStore({ rootDir: bridgeDir });
  assert.equal(reloaded.isRouteTrusted(routeKey), false);
  assert.equal(reloaded.getBinding(routeKey), undefined);
  assert.equal(reloaded.listRoutes()[0]?.activeSessionId, undefined);
});

test("LauncherActions lists the same recent sessions for Weixin primary and route binding", () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-launcher-actions-"));
  const bridgeDir = path.join(baseDir, "state", "bridge");
  const codexHome = path.join(baseDir, "codex-home");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "session_index.jsonl"), Array.from({ length: 30 }, (_, index) => {
    const day = String(30 - index).padStart(2, "0");
    const id = `session-${String(index + 1).padStart(2, "0")}`;
    return JSON.stringify({
      id,
      thread_name: `Session ${index + 1}`,
      updated_at: `2026-05-${day}T00:00:00.000Z`,
    });
  }).join("\n"));
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    const configStore = new ChannelConfigStore({ bridgeDir });
    const channel = configStore.upsertChannelInstance({
      id: "weixin-wx-main",
      type: "weixin",
      accountId: "wx-main",
    });
    const actions = new LauncherActions(
      {
        adapterMode: "app-server",
        cwd: baseDir,
        policy: { permissionMode: "approval", sandbox: "workspace-write" },
      },
      { unboundRoutePolicy: "auto_new" },
      new ChannelActions({
        configStore,
        env: {},
      }),
    );

    const weixinChoices = actions.listWeixinPrimaryChoices(channel);
    const routeChoices = actions.listSessionChoices("weixin-wx-main:wx-main:direct:route");

    assert.ok(weixinChoices);
    assert.equal(weixinChoices.selectable.length, 30);
    assert.deepEqual(
      weixinChoices.selectable.map((session) => session.id),
      routeChoices.selectable.map((session) => session.id),
    );
  } finally {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});
