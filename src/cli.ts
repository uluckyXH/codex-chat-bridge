#!/usr/bin/env node
import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { Bridge } from "./bridge/bridge.js";
import { MockChannelAdapter } from "./channels/mock/mock-channel-adapter.js";
import { TerminalChannelAdapter } from "./channels/terminal/terminal-channel-adapter.js";
import { WeixinAdapter } from "./channels/weixin/weixin-adapter.js";
import { checkCodexCli, discoverCodexSessions, type CodexPermissionMode, type CodexRunPolicy, type DiscoveredCodexSession } from "./codex/codex-cli.js";
import { ExecCodexAdapter } from "./codex/exec-codex-adapter.js";
import { MockCodexAdapter } from "./codex/mock-codex-adapter.js";
import { ConsoleLogger } from "./logging/logger.js";

interface StartupOptions {
  session?: string;
  permission?: CodexPermissionMode;
  yesDangerouslyFull?: boolean;
}

async function main(argv: string[]): Promise<void> {
  const [area, command, ...rest] = argv;
  if (!area || area === "help" || area === "--help" || area === "-h") {
    printHelp();
    return;
  }

  if (area === "codex" && command === "test") {
    await runMockCodexFlow();
    return;
  }

  if (area === "terminal" && (command === "mock" || command === "codex")) {
    await runTerminalBridge(command, parseStartupOptions(rest));
    return;
  }

  if (area === "weixin" && command === "status") {
    const adapter = new WeixinAdapter();
    console.log(JSON.stringify(await adapter.getStatus(), null, 2));
    return;
  }

  if (area === "weixin" && command === "login") {
    const adapter = new WeixinAdapter({ verifyCodeProvider: askStdin });
    const started = await adapter.startLogin();
    console.log(started.message);
    if (started.qrCodeText) {
      console.log(started.qrCodeText);
    }
    const result = await adapter.waitLogin(started.sessionKey);
    console.log(result.message);
    return;
  }

  if (area === "start" || area === "mock") {
    await runTerminalBridge("mock", parseStartupOptions(rest));
    return;
  }

  throw new Error(`未知命令: ${argv.join(" ")}`);
}

async function askStdin(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

async function runMockCodexFlow(): Promise<void> {
  const channel = new MockChannelAdapter();
  const codex = new MockCodexAdapter();
  const bridge = new Bridge({
    channel,
    codex,
    logger: new ConsoleLogger(false),
    cwd: process.cwd(),
  });

  await bridge.start();
  await channel.emitText("/new");
  await channel.emitText("你好，Codex");
  await channel.emitText("请触发审批 approval");
  const approvalText = channel.sentMessages.find((message) => message.text.includes("Codex 请求审批"))?.text;
  const approvalKey = approvalText?.match(/\[(a[0-9a-z]+)\]/)?.[1];
  if (approvalKey) {
    await channel.emitText(`/approve ${approvalKey}`);
  }
  await channel.emitText("/status");
  await bridge.stop();

  for (const [index, message] of channel.sentMessages.entries()) {
    console.log(`--- mock outbound ${index + 1} ---`);
    console.log(message.text);
  }
}

function parseStartupOptions(args: string[]): StartupOptions {
  const options: StartupOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--session") {
      options.session = args[++index];
    } else if (arg === "--permission") {
      const value = args[++index];
      if (value !== "approval" && value !== "full") {
        throw new Error("--permission 只能是 approval 或 full");
      }
      options.permission = value;
    } else if (arg === "--yes-dangerously-full") {
      options.yesDangerouslyFull = true;
    } else {
      throw new Error(`未知启动参数: ${arg}`);
    }
  }
  return options;
}

async function runTerminalBridge(mode: "mock" | "codex", options: StartupOptions = {}): Promise<void> {
  const channel = new TerminalChannelAdapter();
  const startup = mode === "codex" ? await prepareCodexStartup(options) : { policy: undefined, sessionId: undefined };
  const codex = mode === "codex" ? new ExecCodexAdapter({ runPolicy: startup.policy }) : new MockCodexAdapter();
  const bridge = new Bridge({
    channel,
    codex,
    logger: new ConsoleLogger(false),
    cwd: process.cwd(),
  });

  await bridge.start();
  if (mode === "codex") {
    if (startup.sessionId) {
      await channel.emitText(`/resume ${startup.sessionId}`);
    } else {
      await channel.emitText("/new");
    }
  }
  await channel.waitUntilClosed();
  await bridge.stop();
}

async function prepareCodexStartup(options: StartupOptions): Promise<{ policy: CodexRunPolicy; sessionId?: string }> {
  const status = await checkCodexCli();
  if (!status.available) {
    throw new Error(`Codex 不可用: ${status.error ?? "unknown error"}`);
  }
  console.log(`Codex 可用: ${status.version ?? status.codexBin}`);
  const interactive = Boolean(stdin.isTTY && stdout.isTTY);
  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : undefined;
  try {
    const permissionMode = await resolvePermissionMode(options, rl);
    const policy: CodexRunPolicy = {
      permissionMode,
      sandbox: permissionMode === "approval" ? "workspace-write" : undefined,
    };
    const sessions = discoverCodexSessions({ limit: 10 });
    const sessionId = await resolveSessionChoice(options, rl, sessions);
    return { policy, sessionId };
  } finally {
    rl?.close();
  }
}

async function resolvePermissionMode(options: StartupOptions, rl?: Interface): Promise<CodexPermissionMode> {
  if (options.permission === "full" && !options.yesDangerouslyFull && !rl) {
    throw new Error("使用完全权限必须显式传入 --yes-dangerously-full");
  }
  if (options.permission === "full") {
    await confirmFullPermission(rl, Boolean(options.yesDangerouslyFull));
    return "full";
  }
  if (options.permission === "approval") return "approval";
  if (!rl) return "approval";
  console.log("Codex 权限模式:");
  console.log("1. approval - 需要审批，sandbox=workspace-write");
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

async function resolveSessionChoice(
  options: StartupOptions,
  rl: Interface | undefined,
  sessions: DiscoveredCodexSession[],
): Promise<string | undefined> {
  if (options.session && options.session !== "new") {
    if (options.session === "last") return sessions[0]?.id;
    return options.session;
  }
  if (options.session === "new" || !rl) return undefined;
  console.log("Codex 会话:");
  console.log("0. 创建新的会话记录");
  sessions.forEach((session, index) => {
    const name = session.threadName ? ` ${session.threadName}` : "";
    const cwd = session.cwd ? ` ${session.cwd}` : "";
    const updated = session.updatedAt ? ` ${session.updatedAt}` : "";
    console.log(`${index + 1}. ${session.id}${name}${updated}${cwd}`);
  });
  const answer = (await rl.question("请选择会话 [0]: ")).trim();
  if (!answer || answer === "0" || answer.toLowerCase() === "new") return undefined;
  const index = Number.parseInt(answer, 10);
  if (Number.isInteger(index) && index >= 1 && index <= sessions.length) {
    return sessions[index - 1].id;
  }
  return answer;
}

function printHelp(): void {
  console.log([
    "Codex Weixin Middleware",
    "",
    "Commands:",
    "  codex-wechat-bridge codex test     运行本地 mock Codex/Channel 流程",
    "  codex-wechat-bridge terminal mock  启动本地终端通道 + MockCodex",
    "  codex-wechat-bridge terminal codex 启动本地终端通道 + codex exec",
    "    --session new|last|<id>          选择新会话或已有 Codex 会话",
    "    --permission approval|full       设置审批模式或完全权限",
    "    --yes-dangerously-full           非交互确认完全权限",
    "  codex-wechat-bridge weixin status  查看 WeixinAdapter 当前状态",
    "  codex-wechat-bridge weixin login   显示第二阶段登录提示",
    "  codex-wechat-bridge start          当前等同 terminal mock",
  ].join("\n"));
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
