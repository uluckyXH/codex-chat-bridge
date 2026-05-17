import type { Interface } from "node:readline/promises";
import {
  discoverCodexSessions,
  findCodexSessionById,
  type CodexRunPolicy,
  type DiscoveredCodexSession,
} from "../../codex/codex-cli.js";
import { checkNewSessionWorkdir, resolveNewSessionWorkdir } from "../../codex/workdir.js";
import type { PreparedServeStartup, ServeChannelPlan } from "../launcher-types.js";
import {
  formatAdapterModeForUser,
  formatCodexSettingsMenu,
  formatFirstRouteBindingMenu,
  formatFirstRoutePresetForUser,
  formatMaxConcurrentTurnsForUser,
  formatWorkdirSettingsMenu,
  parseFirstRouteSetupChoice,
} from "../serve-wizard.js";
import { formatPolicyForCli, formatSessionChoice } from "./formatters.js";
import { isBackText, isManualSessionInputAction, normalizeText } from "./shortcuts.js";
import { routeSummary } from "./summary.js";
import { clearFirstRouteBinding, confirmFullPermission, setFirstRouteExisting, setFirstRouteNew } from "./startup.js";

export async function runCodexSettingsLoop(rl: Interface, startup: PreparedServeStartup): Promise<void> {
  for (;;) {
    console.log("");
    console.log(formatCodexSettingsMenu({
      ...routeIndependentCodexSummary(startup),
      cwd: startup.cwd,
    }));
    const answer = normalizeText(await rl.question("请选择 [0 返回]: "));
    if (!answer || answer === "0" || isBackText(answer)) return;
    if (answer === "2" || answer === "full") {
      try {
        await confirmFullPermission(rl, false);
      } catch (error) {
        console.log(error instanceof Error ? error.message : String(error));
        continue;
      }
      startup.policy = { permissionMode: "full" };
      console.log("已设置新 session 默认权限: 完全权限");
      continue;
    }
    startup.policy = { permissionMode: "approval", sandbox: "workspace-write" };
    console.log("已设置新 session 默认权限: 审批模式");
  }
}

export async function configureAdapterMode(rl: Interface, startup: PreparedServeStartup): Promise<void> {
  console.log("");
  console.log([
    "Codex 接入方式",
    `当前: ${formatAdapterModeForUser(startup.adapterMode)}`,
    "",
    "1. Codex app-server（推荐，支持微信审批）",
    "2. Codex exec（备用模式）",
    "0. 返回",
  ].join("\n"));
  const answer = normalizeText(await rl.question("请选择 [0 返回]: "));
  if (!answer || answer === "0" || isBackText(answer)) return;
  if (answer === "1" || answer === "app-server") {
    startup.adapterMode = "app-server";
    console.log("已设置 Codex 接入方式: app-server");
    return;
  }
  if (answer === "2" || answer === "exec") {
    startup.adapterMode = "exec";
    console.log("已设置 Codex 接入方式: exec");
    return;
  }
  console.log("未识别选择，保持原设置。");
}

export async function configurePermissionMode(rl: Interface, startup: PreparedServeStartup): Promise<void> {
  console.log("");
  console.log([
    "Codex 权限模式",
    `当前: ${formatPolicyForCli(startup.policy)}`,
    "",
    "1. 审批模式（workspace-write 沙箱，推荐）",
    "2. 完全权限（跳过审批和沙箱，高风险）",
    "0. 返回",
  ].join("\n"));
  const answer = normalizeText(await rl.question("请选择 [0 返回]: "));
  if (!answer || answer === "0" || isBackText(answer)) return;
  if (answer === "2" || answer === "full") {
    try {
      await confirmFullPermission(rl, false);
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
      return;
    }
    startup.policy = { permissionMode: "full" };
    console.log("已设置权限模式: 完全权限");
    return;
  }
  startup.policy = { permissionMode: "approval", sandbox: "workspace-write" };
  console.log("已设置权限模式: 审批模式");
}

export async function configureWorkdir(rl: Interface, startup: PreparedServeStartup): Promise<void> {
  for (;;) {
    console.log("");
    console.log(formatWorkdirSettingsMenu(startup.cwd));
    const answer = normalizeText(await rl.question("请选择 [0 返回]: "));
    if (!answer || answer === "0" || isBackText(answer)) return;
    if (answer === "1" || answer === "current" || answer === "当前" || answer === "cwd") {
      await setStartupWorkdirFromInput(rl, startup, undefined);
      continue;
    }
    if (answer === "2" || answer === "input" || answer === "manual" || answer === "path" || answer === "目录") {
      const input = (await rl.question("请输入目录路径 [0 返回]: ")).trim();
      if (!input || input === "0" || isBackText(input)) continue;
      await setStartupWorkdirFromInput(rl, startup, input);
      continue;
    }
    console.log("未识别选择，请重新输入。");
  }
}

export async function configureMaxConcurrentTurns(rl: Interface, startup: PreparedServeStartup): Promise<void> {
  console.log("");
  console.log(`当前并发上限: ${formatMaxConcurrentTurnsForUser(startup.maxConcurrentTurns)}`);
  const answer = (await rl.question("请输入正整数；留空表示不限制；输入 0 返回: ")).trim();
  if (answer === "0" || isBackText(answer)) return;
  if (!answer) {
    startup.maxConcurrentTurns = undefined;
    console.log("已设置并发上限: 不限制不同聊天并行");
    return;
  }
  const parsed = Number.parseInt(answer, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || !/^\d+$/.test(answer)) {
    console.log("并发上限需要正整数，或留空表示不限制。");
    return;
  }
  startup.maxConcurrentTurns = parsed;
  console.log(`已设置并发上限: ${formatMaxConcurrentTurnsForUser(startup.maxConcurrentTurns)}`);
}

export async function configureFirstRouteBinding(rl: Interface, plan: ServeChannelPlan): Promise<void> {
  console.log("");
  console.log(formatFirstRouteBindingMenu(routeSummary(plan)));
  const answer = await rl.question("请选择 [0 返回]: ");
  if (!answer.trim()) return;
  const choice = parseFirstRouteSetupChoice(answer);
  if (choice === "back") return;
  if (choice === "none") {
    clearFirstRouteBinding(plan);
    console.log("已取消首个微信私聊预设绑定。");
    return;
  }
  if (choice === "new_first_route") {
    setFirstRouteNew(plan);
    console.log("已设置：启动后第一个微信私聊创建新 session。");
    return;
  }
  const selected = await selectExistingSessionForFirstRoute(rl);
  if (!selected) return;
  setFirstRouteExisting(plan, selected.sessionId, selected.session);
  console.log(`已设置首个微信私聊绑定: ${formatFirstRoutePresetForUser(plan.firstRouteBindingChoice, plan.initialSessionId, plan.initialSessionTitle)}`);
}

async function setStartupWorkdirFromInput(rl: Interface, startup: PreparedServeStartup, input: string | undefined): Promise<void> {
  const checked = checkNewSessionWorkdir(input, process.cwd());
  if (checked.ok) {
    startup.cwd = checked.cwd;
    console.log(`已设置新 session 工作目录: ${startup.cwd}`);
    return;
  }
  if (checked.reason === "not_directory") {
    console.log(`工作目录设置失败: ${checked.message}`);
    return;
  }
  console.log(checked.message);
  const answer = normalizeText(await rl.question("是否创建并使用这个目录？[y/N]: "));
  if (answer !== "y" && answer !== "yes" && answer !== "是") {
    console.log("已取消工作目录设置。");
    return;
  }
  try {
    const resolved = resolveNewSessionWorkdir(checked.cwd, process.cwd());
    startup.cwd = resolved.cwd;
    console.log(`${resolved.created ? "已创建并设置" : "已设置"}新 session 工作目录: ${startup.cwd}`);
  } catch (error) {
    console.log(`工作目录设置失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function selectExistingSessionForFirstRoute(rl: Interface): Promise<{ sessionId: string; session?: DiscoveredCodexSession } | undefined> {
  const sessions = discoverCodexSessions({ limit: 15 });
  for (;;) {
    console.log("");
    console.log("选择已有 Codex session");
    if (sessions.length === 0) {
      console.log("未发现历史 session。可以粘贴本机存在的 Session ID，或输入 0 返回。");
    } else {
      sessions.forEach((session, index) => {
        console.log(formatSessionChoice(index + 1, session));
      });
    }
    console.log("");
    console.log("操作:");
    console.log("  m. 手动输入 Session ID");
    console.log("  0. 返回");
    const answer = (await rl.question("请选择 session 编号，或输入 m 手动输入 ID [0 返回]: ")).trim();
    if (!answer || answer === "0" || isBackText(answer)) return undefined;
    if (isManualSessionInputAction(answer)) {
      const manual = (await rl.question("请输入 Session ID [0 返回]: ")).trim();
      if (!manual || manual === "0" || isBackText(manual)) return undefined;
      const session = sessions.find((item) => item.id === manual) ?? findCodexSessionById(manual);
      if (session) return { sessionId: session.id, session };
      console.log("没有找到这个 session。请重新输入编号或有效 Session ID；输入 0 返回。");
      continue;
    }
    if (/^\d+$/.test(answer)) {
      const index = Number.parseInt(answer, 10);
      const session = sessions[index - 1];
      if (session) return { sessionId: session.id, session };
      console.log(`没有第 ${index} 项，请重新选择。`);
      continue;
    }
    const session = sessions.find((item) => item.id === answer) ?? findCodexSessionById(answer);
    if (session) return { sessionId: session.id, session };
    console.log("没有找到这个 session。请重新输入编号或有效 Session ID；输入 0 返回。");
  }
}

function routeIndependentCodexSummary(startup: PreparedServeStartup): {
  adapterMode: PreparedServeStartup["adapterMode"];
  permissionMode: CodexRunPolicy["permissionMode"];
  cwd: string;
  progressMode: PreparedServeStartup["progressMode"];
  progressDisabled: true;
  maxConcurrentTurns: PreparedServeStartup["maxConcurrentTurns"];
} {
  return {
    adapterMode: startup.adapterMode,
    permissionMode: startup.policy.permissionMode,
    cwd: startup.cwd,
    progressMode: startup.progressMode,
    progressDisabled: true,
    maxConcurrentTurns: startup.maxConcurrentTurns,
  };
}
