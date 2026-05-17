import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LauncherActions } from "../../src/cli/actions/launcher-actions.js";
import { ChannelActions } from "../../src/cli/actions/channel-actions.js";
import { resolveCodexCommand } from "../../src/codex/codex-process.js";
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
