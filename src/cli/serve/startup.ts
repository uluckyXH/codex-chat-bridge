import type { Interface } from "node:readline/promises";
import { checkCodexCli, discoverCodexSessions, findCodexSessionById, formatCodexSessionTitleForDisplay, type CodexRunPolicy, type DiscoveredCodexSession } from "../../codex/codex-cli.js";
import { formatCodexCommandSource, formatCodexPlatform } from "../../codex/codex-process.js";
import { resolveNewSessionWorkdir } from "../../codex/workdir.js";
import type { ChannelStatus } from "../../protocol/channel.js";
import type { PreparedServeStartup, ServeChannelPlan, ServeStartupOptions } from "../launcher-types.js";

export async function prepareCodexServeStartup(
  options: ServeStartupOptions,
  rl?: Interface,
  display: { quiet?: boolean; allowUnavailableCodex?: boolean } = {},
): Promise<PreparedServeStartup> {
  const status = await checkCodexCli();
  if (!status.available && !display.allowUnavailableCodex) {
    throw new Error(`Codex 不可用: ${status.error ?? "unknown error"}`);
  }
  if (!display.quiet) {
    console.log("");
    console.log(status.available ? "Codex 已就绪" : "Codex 不可用");
    console.log(`- 平台: ${formatCodexPlatform(status)}`);
    console.log(`- CLI: ${status.available ? status.version ?? status.codexBin : status.error ?? "unknown error"}`);
    console.log(`- 路径: ${status.codexBin}`);
    console.log(`- 来源: ${formatCodexCommandSource(status.codexBinSource)}`);
  }

  const adapterMode = options.codexAdapter ?? "app-server";
  const cwd = await resolveStartupWorkdir(options, display);
  const permissionMode = options.permission ?? "approval";
  if (permissionMode === "full") {
    await confirmFullPermission(rl, Boolean(options.yesDangerouslyFull));
  }
  const policy: CodexRunPolicy = {
    permissionMode,
    sandbox: permissionMode === "approval" ? "workspace-write" : undefined,
  };
  return {
    policy,
    adapterMode,
    cwd,
    codexStatus: status,
    progressMode: options.progressMode,
    maxConcurrentTurns: options.maxConcurrentTurns,
  };
}

export function createInitialChannelPlan(_status: ChannelStatus, options: ServeStartupOptions): ServeChannelPlan {
  const plan: ServeChannelPlan = {
    unboundRoutePolicy: "auto_new",
  };
  if (!options.session) return plan;
  if (options.session === "new") {
    setFirstRouteNew(plan);
    return plan;
  }
  const session = options.session === "last"
    ? discoverCodexSessions({ limit: 1 })[0]
    : findCodexSessionById(options.session);
  if (!session) {
    throw new Error(`未找到 --session 指定的 Codex session: ${options.session}`);
  }
  setFirstRouteExisting(plan, session.id, session);
  return plan;
}

export function setFirstRouteExisting(plan: ServeChannelPlan, sessionId: string, session?: DiscoveredCodexSession): void {
  plan.firstRouteBindingChoice = "bind_existing_first_route";
  plan.initialRouteBinding = { type: "existing", sessionId };
  plan.initialSessionId = sessionId;
  plan.initialSessionTitle = session ? formatCodexSessionTitleForDisplay(session) : undefined;
}

export function setFirstRouteNew(plan: ServeChannelPlan): void {
  plan.firstRouteBindingChoice = "new_first_route";
  plan.initialRouteBinding = { type: "new" };
  plan.initialSessionId = undefined;
  plan.initialSessionTitle = undefined;
}

export function clearFirstRouteBinding(plan: ServeChannelPlan): void {
  plan.firstRouteBindingChoice = undefined;
  plan.initialRouteBinding = undefined;
  plan.initialSessionId = undefined;
  plan.initialSessionTitle = undefined;
}

async function resolveStartupWorkdir(options: ServeStartupOptions, display: { quiet?: boolean } = {}): Promise<string> {
  const resolved = resolveNewSessionWorkdir(options.cwd, process.cwd());
  if (resolved.created && !display.quiet) {
    console.log(`工作目录不存在，已创建: ${resolved.cwd}`);
  }
  return resolved.cwd;
}

export async function confirmFullPermission(rl: Interface | undefined, alreadyConfirmed: boolean): Promise<void> {
  const warning = "警告：完全权限会让 Codex 跳过审批和沙箱，能够直接执行命令并修改文件。只有在你完全信任当前任务时才继续。";
  console.log(warning);
  if (alreadyConfirmed) return;
  if (!rl) throw new Error("完全权限需要交互确认，或传入 --yes-dangerously-full");
  const answer = await rl.question("如确认继续，请输入 YES: ");
  if (answer.trim() !== "YES") {
    throw new Error("已取消完全权限启动");
  }
}
