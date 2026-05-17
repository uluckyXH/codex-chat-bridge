import type { Interface } from "node:readline/promises";
import type { ChannelActions } from "../actions/channel-actions.js";
import type { PreparedServeStartup, ServeChannelPlan } from "../launcher-types.js";
import { formatServeHomeSummary, parseServeHomeChoice } from "../serve-wizard.js";
import { runChannelManagementLoop, printAllChannelStatuses } from "./channel-management.js";
import { configureWorkdir, runCodexSettingsLoop } from "./codex-settings.js";
import { runRouteBindingLoop } from "./route-binding-loop.js";
import { confirmStart } from "./start-confirmation.js";
import { codexSummary, routeSummary, toServeChannelSummary } from "./summary.js";

export async function runServeHomeLoop(
  rl: Interface,
  startup: PreparedServeStartup,
  plan: ServeChannelPlan,
  channelActions: ChannelActions,
): Promise<boolean> {
  for (;;) {
    const channelSummaries = await channelActions.listChannelSummaries();
    console.log("");
    console.log(formatServeHomeSummary({
      codex: codexSummary(startup),
      channels: channelSummaries.map(toServeChannelSummary),
      routes: routeSummary(plan),
    }));
    const defaultChoice = channelSummaries.length === 0 ? "1" : "6";
    const input = await rl.question(`请选择 [${defaultChoice}]: `);
    const choice = parseServeHomeChoice(input.trim() ? input : defaultChoice);
    if (choice === "exit") return false;
    if (choice === "manage_channels") {
      await runChannelManagementLoop(rl, startup, plan, channelActions);
      continue;
    }
    if (choice === "manage_routes") {
      await runRouteBindingLoop(rl, startup, plan);
      continue;
    }
    if (choice === "codex_settings") {
      await runCodexSettingsLoop(rl, startup);
      continue;
    }
    if (choice === "workdir_settings") {
      await configureWorkdir(rl, startup);
      continue;
    }
    if (choice === "status") {
      await printAllChannelStatuses(channelActions);
      continue;
    }
    if (await confirmStart(rl, startup, plan, channelActions)) return true;
  }
}
