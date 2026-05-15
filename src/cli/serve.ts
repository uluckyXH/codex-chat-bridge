import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { Bridge, type ProgressDeliveryMode, type UnboundRoutePolicy } from "../bridge/bridge.js";
import { LimitedTurnScheduler } from "../bridge/turn-scheduler.js";
import { WeixinAdapter } from "../channels/weixin/weixin-adapter.js";
import { displayWeixinQrCode } from "../channels/weixin/weixin-qr-display.js";
import { AppServerCodexAdapter } from "../codex/app-server-codex-adapter.js";
import { checkCodexCli, discoverCodexSessions, displayCodexSessionTitle, findCodexSessionById, type CodexPermissionMode, type CodexRunPolicy, type DiscoveredCodexSession } from "../codex/codex-cli.js";
import { ExecCodexAdapter } from "../codex/exec-codex-adapter.js";
import type { CodexAdapter } from "../codex/types.js";
import { resolveNewSessionWorkdir } from "../codex/workdir.js";
import { ConsoleLogger } from "../logging/logger.js";
import { ConsoleTranscriptSink } from "../logging/transcript.js";
import type { ChannelStatus } from "../protocol/channel.js";
import {
  firstRouteBindingChoiceToPolicy,
  formatChannelCapabilities,
  formatNoChannelGuide,
  formatServeHomeSummary,
  formatWeixinFirstRouteBindingPrompt,
  parseChannelAddChoice,
  parseFirstRouteBindingChoice,
  parseServeHomeChoice,
  type FirstRouteBindingChoice,
  type ServeChannelSummary,
} from "./serve-wizard.js";

export interface ServeStartupOptions {
  session?: string;
  permission?: CodexPermissionMode;
  codexAdapter?: RealCodexAdapterMode;
  yesDangerouslyFull?: boolean;
  cwd?: string;
  progressMode?: ProgressDeliveryMode;
  maxConcurrentTurns?: number;
  noInteractive?: boolean;
}

type RealCodexAdapterMode = "app-server" | "exec";

interface PreparedServeStartup {
  policy: CodexRunPolicy;
  adapterMode: RealCodexAdapterMode;
  cwd: string;
  progressMode?: ProgressDeliveryMode;
  maxConcurrentTurns?: number;
}

interface ServeChannelPlan {
  status: ChannelStatus;
  unboundRoutePolicy: UnboundRoutePolicy;
  initialSessionId?: string;
  firstRouteBindingChoice?: FirstRouteBindingChoice;
}

export async function runServe(options: ServeStartupOptions = {}): Promise<void> {
  const interactive = Boolean(stdin.isTTY && stdout.isTTY && !options.noInteractive);
  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : undefined;
  let startup: PreparedServeStartup | undefined;
  let plan: ServeChannelPlan | undefined;
  try {
    startup = await prepareCodexServeStartup(options, rl);
    plan = await prepareServeWeixinChannel(rl);
    if (!plan) return;
    if (interactive) {
      const shouldStart = await confirmServeHome(rl as Interface, startup, plan);
      if (!shouldStart) return;
    }
  } finally {
    rl?.close();
  }
  if (!startup || !plan) return;
  await startServeBridge(startup, plan, options);
}

async function prepareCodexServeStartup(options: ServeStartupOptions, rl?: Interface): Promise<PreparedServeStartup> {
  const status = await checkCodexCli();
  if (!status.available) {
    throw new Error(`Codex 不可用: ${status.error ?? "unknown error"}`);
  }
  console.log("");
  console.log("Codex 启动准备");
  console.log(`- CLI: ${status.version ?? status.codexBin}`);
  if (options.session && options.session !== "new") {
    console.log("提示：serve 不会把 --session 全局绑定到所有渠道；已有 session 请在首个 route 绑定方式中选择。");
  }
  const adapterMode = options.codexAdapter ?? "app-server";
  const cwd = await resolveStartupWorkdir(options, rl);
  const permissionMode = await resolvePermissionMode(options, rl);
  const maxConcurrentTurns = await resolveMaxConcurrentTurns(options, rl);
  const policy: CodexRunPolicy = {
    permissionMode,
    sandbox: permissionMode === "approval" ? "workspace-write" : undefined,
  };
  printServeStartupSelection({
    cwd,
    policy,
    adapterMode,
    progressMode: options.progressMode,
    maxConcurrentTurns,
  });
  return {
    policy,
    adapterMode,
    cwd,
    progressMode: options.progressMode,
    maxConcurrentTurns,
  };
}

async function resolveStartupWorkdir(options: ServeStartupOptions, rl?: Interface): Promise<string> {
  const defaultCwd = process.cwd();
  let input = options.cwd;
  if (!input && rl) {
    console.log("");
    console.log(`新 Codex 会话默认工作目录: ${defaultCwd}`);
    input = await rl.question("请输入新会话工作目录 [默认当前目录]: ");
  }
  const resolved = resolveNewSessionWorkdir(input, defaultCwd);
  if (resolved.created) {
    console.log(`工作目录不存在，已创建: ${resolved.cwd}`);
  }
  console.log(`新 Codex 会话工作目录: ${resolved.cwd}`);
  return resolved.cwd;
}

async function resolvePermissionMode(options: ServeStartupOptions, rl?: Interface): Promise<CodexPermissionMode> {
  if (options.permission === "full" && !options.yesDangerouslyFull && !rl) {
    throw new Error("使用完全权限必须显式传入 --yes-dangerously-full");
  }
  if (options.permission === "full") {
    await confirmFullPermission(rl, Boolean(options.yesDangerouslyFull));
    return "full";
  }
  if (options.permission === "approval") return "approval";
  if (!rl) return "approval";
  console.log("");
  console.log("Codex 权限模式（作用于本次启动后的后续任务）");
  console.log("1. approval - 使用 workspace-write sandbox；app-server 可把审批推送到微信 /OK 或 /NO");
  console.log("2. full - 完全权限，跳过审批和沙箱，非常危险");
  const answer = (await rl.question("请选择权限模式 [1]: ")).trim();
  if (answer === "2" || answer.toLowerCase() === "full") {
    await confirmFullPermission(rl, false);
    return "full";
  }
  return "approval";
}

async function confirmFullPermission(rl: Interface | undefined, alreadyConfirmed: boolean): Promise<void> {
  const warning = "警告：完全权限会让 Codex 跳过审批和沙箱，能够直接执行命令并修改文件。只有在你完全信任当前任务时才继续。";
  console.log(warning);
  if (alreadyConfirmed) return;
  if (!rl) throw new Error("完全权限需要交互确认，或传入 --yes-dangerously-full");
  const answer = await rl.question("如确认继续，请输入 YES: ");
  if (answer.trim() !== "YES") {
    throw new Error("已取消完全权限启动");
  }
}

async function resolveMaxConcurrentTurns(options: ServeStartupOptions, rl?: Interface): Promise<number | undefined> {
  if (options.maxConcurrentTurns) return options.maxConcurrentTurns;
  if (!rl) return undefined;
  console.log("");
  console.log("全局并发 Codex turn 数量");
  console.log("- 留空表示不限制不同 route 并行");
  const answer = (await rl.question("请输入并发上限 [不限制]: ")).trim();
  if (!answer) return undefined;
  const parsed = Number.parseInt(answer, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("全局并发数量需要正整数，或留空表示不限制");
  }
  return parsed;
}

async function prepareServeWeixinChannel(rl?: Interface): Promise<ServeChannelPlan | undefined> {
  const channel = new WeixinAdapter({
    pollOnStart: false,
    verifyCodeProvider: rl ? questionWithReadline(rl) : undefined,
  });
  await channel.start();
  let status = await channel.getStatus();
  if (status.state === "connected") {
    console.log(`微信已登录: ${status.account ?? "default"}`);
    return {
      status,
      unboundRoutePolicy: "auto_new",
    };
  }
  if (!rl) {
    throw new Error("未发现可启动渠道。请先在交互式终端运行 npm run cli:serve 完成微信登录，或运行 npm run cli:weixin:login。");
  }
  for (;;) {
    console.log("");
    console.log(formatNoChannelGuide());
    const choice = parseChannelAddChoice(await rl.question("请选择 [1]: "));
    if (choice === "exit") return undefined;
    if (choice === "lark") {
      console.log("飞书渠道尚未实现，稍后适配。");
      continue;
    }
    console.log("");
    console.log("添加微信渠道");
    console.log(formatChannelCapabilities(channel.getCapabilities()));
    const started = await channel.startLogin();
    console.log(started.message);
    if (started.qrCodeText) {
      await displayWeixinQrCode(started.qrCodeText);
    }
    const loginResult = await channel.waitLogin(started.sessionKey);
    console.log(loginResult.message);
    if (loginResult.state !== "connected") {
      throw new Error(`微信登录未完成: ${loginResult.message}`);
    }
    status = await channel.getStatus();
    return resolveWeixinFirstRouteBinding(rl, status);
  }
}

async function resolveWeixinFirstRouteBinding(rl: Interface, status: ChannelStatus): Promise<ServeChannelPlan> {
  console.log("");
  console.log(formatWeixinFirstRouteBindingPrompt({
    channelId: status.channelId,
    account: status.account,
    knownRoutes: 0,
  }));
  const choice = parseFirstRouteBindingChoice(await rl.question("请选择 [1]: "));
  const plan: ServeChannelPlan = {
    status,
    unboundRoutePolicy: firstRouteBindingChoiceToPolicy(choice),
    firstRouteBindingChoice: choice,
  };
  if (choice === "bind_existing_first_route") {
    const selected = await selectExistingSessionForFirstRoute(rl);
    if (selected?.sessionId) {
      plan.initialSessionId = selected.sessionId;
    } else {
      plan.unboundRoutePolicy = "auto_new";
      console.log("未选择已有 session，已改为首条消息自动创建新 session。");
    }
  } else if (choice === "new_first_route") {
    console.log("当前版本会在第一个微信私聊 route 的首条普通消息到达时创建并绑定新 session。");
  }
  return plan;
}

async function selectExistingSessionForFirstRoute(rl: Interface): Promise<{ sessionId?: string; session?: DiscoveredCodexSession }> {
  const sessions = discoverCodexSessions({ limit: 10 });
  console.log("");
  console.log("选择已有 Codex session");
  if (sessions.length === 0) {
    const manual = (await rl.question("未发现历史 session。请输入 Session ID，或留空改为自动新建: ")).trim();
    if (!manual) return {};
    return {
      sessionId: manual,
      session: findCodexSessionById(manual),
    };
  }
  sessions.forEach((session, index) => {
    console.log(formatSessionChoice(index + 1, session));
  });
  const answer = (await rl.question("请选择会话编号，或输入 Session ID [0 自动新建]: ")).trim();
  if (!answer || answer === "0" || answer.toLowerCase() === "new") return {};
  const index = Number.parseInt(answer, 10);
  if (Number.isInteger(index) && index >= 1 && index <= sessions.length) {
    return { sessionId: sessions[index - 1].id, session: sessions[index - 1] };
  }
  return {
    sessionId: answer,
    session: sessions.find((session) => session.id === answer) ?? findCodexSessionById(answer),
  };
}

async function confirmServeHome(rl: Interface, startup: PreparedServeStartup, plan: ServeChannelPlan): Promise<boolean> {
  for (;;) {
    console.log("");
    console.log(formatServeHomeSummary({
      codex: {
        adapterMode: startup.adapterMode,
        permissionMode: startup.policy.permissionMode,
        progressMode: startup.progressMode,
        maxConcurrentTurns: startup.maxConcurrentTurns,
      },
      channels: [weixinChannelSummary(plan.status)],
      routes: {
        known: 0,
        bound: plan.initialSessionId ? 1 : 0,
        unboundPolicy: plan.unboundRoutePolicy,
      },
    }));
    const choice = parseServeHomeChoice(await rl.question("请选择 [1]: "));
    if (choice === "start") return true;
    if (choice === "exit") return false;
    if (choice === "status") {
      console.log(JSON.stringify(plan.status, null, 2));
      continue;
    }
    console.log("当前版本已实现微信登录、首个 route 绑定策略和启动服务；更完整的渠道/route 管理会在后续迭代补齐。");
  }
}

function weixinChannelSummary(status: ChannelStatus): ServeChannelSummary {
  return {
    id: status.channelId,
    type: "weixin",
    enabled: true,
    status,
    capabilities: new WeixinAdapter({ pollOnStart: false }).getCapabilities(),
  };
}

async function startServeBridge(startup: PreparedServeStartup, plan: ServeChannelPlan, options: ServeStartupOptions): Promise<void> {
  const channel = new WeixinAdapter({ verifyCodeProvider: askStdin });
  const codex = createRealCodexAdapter(startup);
  const bridge = new Bridge({
    channel,
    codex,
    logger: new ConsoleLogger(false),
    transcript: new ConsoleTranscriptSink(),
    cwd: startup.cwd,
    initialSessionId: plan.initialSessionId,
    unboundRoutePolicy: plan.unboundRoutePolicy,
    progressMode: options.progressMode,
    turnScheduler: startup.maxConcurrentTurns ? new LimitedTurnScheduler(startup.maxConcurrentTurns) : undefined,
  });

  await bridge.start();
  printRuntimeSummary("多渠道 Codex 中间件", startup, options.progressMode, { progressDisabled: true });
  console.log(`- 渠道: weixin state=${plan.status.state}${plan.status.account ? ` account=${plan.status.account}` : ""}`);
  console.log(`- 未绑定 route 策略: ${plan.unboundRoutePolicy}`);
  if (plan.firstRouteBindingChoice) console.log(`- 首个微信私聊绑定方式: ${plan.firstRouteBindingChoice}`);
  await waitForShutdownSignal();
  await bridge.stop();
}

async function askStdin(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

function questionWithReadline(rl: Interface): (prompt: string) => Promise<string> {
  return async (prompt: string) => (await rl.question(prompt)).trim();
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

function printServeStartupSelection(params: {
  cwd: string;
  policy: CodexRunPolicy;
  adapterMode: RealCodexAdapterMode;
  progressMode?: ProgressDeliveryMode;
  maxConcurrentTurns?: number;
}): void {
  console.log("");
  console.log("多渠道启动默认项");
  console.log(`- 新会话工作目录: ${params.cwd}`);
  console.log(`- Codex Adapter: ${formatAdapterForCli(params.adapterMode)}`);
  console.log(`- 权限: ${formatPolicyForCli(params.policy)}`);
  console.log(`- 进度: ${formatProgressForCli(params.progressMode)}`);
  console.log(`- maxConcurrentTurns: ${params.maxConcurrentTurns ?? "unlimited"}`);
}

function printRuntimeSummary(
  title: string,
  startup: PreparedServeStartup,
  progressMode?: ProgressDeliveryMode,
  display: { progressDisabled?: boolean } = {},
): void {
  console.log("");
  console.log(`${title}已启动`);
  console.log("- 会话: 按 route 绑定；首条消息按策略处理");
  console.log(`- 工作目录: ${startup.cwd}`);
  console.log(`- Codex Adapter: ${formatAdapterForCli(startup.adapterMode)}`);
  console.log(`- 权限: ${formatPolicyForCli(startup.policy)}`);
  console.log(`- 进度: ${formatProgressForCli(progressMode, display.progressDisabled)}`);
  console.log(`- maxConcurrentTurns: ${startup.maxConcurrentTurns ?? "unlimited"}`);
  console.log("- 退出: Ctrl+C");
}

function formatSessionChoice(index: number, session: DiscoveredCodexSession): string {
  const title = displayCodexSessionTitle(session);
  const parts = [`${index}. ${title ?? session.id}`];
  parts.push(`   id: ${session.id}`);
  if (session.updatedAt) parts.push(`   updated: ${session.updatedAt}`);
  if (session.cwd) parts.push(`   cwd: ${session.cwd}`);
  return parts.join("\n");
}

function formatPolicyForCli(policy: CodexRunPolicy): string {
  if (policy.permissionMode === "full") {
    return "full（跳过审批和沙箱）";
  }
  return `approval（sandbox=${policy.sandbox ?? "workspace-write"}）`;
}

function formatAdapterForCli(adapterMode: RealCodexAdapterMode): string {
  if (adapterMode === "app-server") return "app-server（支持微信交互审批）";
  return "exec（非交互；不支持微信审批，仅作为回退）";
}

function formatProgressForCli(progressMode: ProgressDeliveryMode | undefined, disabled?: boolean): string {
  return disabled ? "disabled（微信渠道不投递）" : progressMode ?? "brief";
}

function createRealCodexAdapter(startup: PreparedServeStartup): CodexAdapter {
  const runPolicy = startup.policy;
  if (startup.adapterMode === "exec") {
    return new ExecCodexAdapter({ runPolicy });
  }
  return new AppServerCodexAdapter({ runPolicy });
}
