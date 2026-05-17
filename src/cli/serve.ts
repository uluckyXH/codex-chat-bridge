import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { WeixinAdapter } from "../channels/weixin/weixin-adapter.js";
import { ChannelActions } from "./actions/channel-actions.js";
import { LauncherActions } from "./actions/launcher-actions.js";
import type { PreparedServeStartup, ServeChannelPlan, ServeStartupOptions } from "./launcher-types.js";
import { startServeBridge } from "./serve/bridge-runtime.js";
import { runServeHomeLoop } from "./serve/home-loop.js";
import { questionWithReadline } from "./serve/prompts.js";
import { createInitialChannelPlan, prepareCodexServeStartup } from "./serve/startup.js";
import { runChatCodexTui } from "./tui/run-tui.js";

export async function runServe(options: ServeStartupOptions = {}): Promise<void> {
  const interactive = Boolean(stdin.isTTY && stdout.isTTY && !options.noInteractive);
  const useTui = Boolean(interactive && !options.noTui);
  const rl = interactive && !useTui ? createInterface({ input: stdin, output: stdout }) : undefined;
  let startup: PreparedServeStartup | undefined;
  let plan: ServeChannelPlan | undefined;
  const channelActions = new ChannelActions();
  try {
    startup = await prepareCodexServeStartup(options, rl, { quiet: useTui, allowUnavailableCodex: useTui });
    const setupChannel = new WeixinAdapter({
      pollOnStart: false,
      verifyCodeProvider: rl ? questionWithReadline(rl) : undefined,
    });
    await setupChannel.start();
    const setupStatus = await setupChannel.getStatus();
    channelActions.ensureLegacyWeixinAccountRegistered(setupStatus);
    plan = createInitialChannelPlan(setupStatus, options);
    if (useTui) {
      const result = await runChatCodexTui(new LauncherActions(startup, plan, channelActions));
      if (!result.start) return;
    } else if (interactive) {
      const shouldStart = await runServeHomeLoop(rl as Interface, startup, plan, channelActions);
      if (!shouldStart) return;
    } else if (channelActions.createRuntimeAdapters().length === 0) {
      throw new Error("未发现可启动的渠道。请先在交互式终端运行 chat-codex 添加微信账号或飞书机器人。");
    }
  } finally {
    rl?.close();
  }
  if (!startup || !plan) return;
  await startServeBridge(startup, plan, channelActions, { tui: useTui });
}
