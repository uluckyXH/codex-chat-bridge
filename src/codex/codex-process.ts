import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const CHAT_CODEX_BIN_ENV = "CHAT_CODEX_BIN";

export type CodexBinSource = "default" | "env" | "explicit" | "path";
export type CodexWindowsShim = "cmd" | "bat";

export interface CodexCommandResolution {
  command: string;
  requested: string;
  source: CodexBinSource;
  platform: string;
  arch: string;
  pathResolved: boolean;
  shim?: CodexWindowsShim;
}

export interface ResolveCodexCommandOptions {
  codexBin?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string;
  arch?: string;
  cwd?: string;
  fileExists?: (filePath: string) => boolean;
}

export function resolveCodexCommand(options: ResolveCodexCommandOptions = {}): CodexCommandResolution {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const envCodexBin = env[CHAT_CODEX_BIN_ENV]?.trim();
  const requested = (options.codexBin?.trim() || envCodexBin || "codex").trim();
  const source: CodexBinSource = options.codexBin?.trim()
    ? "explicit"
    : envCodexBin
      ? "env"
      : "default";
  const fileExists = options.fileExists ?? fs.existsSync;
  if (platform !== "win32") {
    return {
      command: requested,
      requested,
      source,
      platform,
      arch,
      pathResolved: false,
    };
  }
  return resolveWindowsCodexCommand({
    requested,
    source,
    env,
    platform,
    arch,
    cwd: options.cwd ?? process.cwd(),
    fileExists,
  });
}

export function spawnCodex(
  resolution: CodexCommandResolution | string,
  args: string[],
  options: SpawnOptions = {},
): ChildProcess {
  const command = typeof resolution === "string" ? resolveCodexCommand({ codexBin: resolution }) : resolution;
  if (command.platform === "win32" && command.shim) {
    const npmShimTarget = command.shim === "cmd" ? resolveNpmCmdShimTarget(command.command) : undefined;
    if (npmShimTarget) {
      return spawn(process.execPath, [npmShimTarget, ...args], options);
    }
    return spawnWindowsCommandShim(command, args, options);
  }
  return spawn(command.command, args, options);
}

export function formatCodexCommandSource(source: CodexBinSource): string {
  if (source === "env") return CHAT_CODEX_BIN_ENV;
  if (source === "path") return "PATH/PATHEXT";
  if (source === "explicit") return "显式参数";
  return "默认 codex";
}

export function formatCodexPlatform(status: { platform?: string; arch?: string } = {}): string {
  return `${status.platform ?? process.platform} ${status.arch ?? process.arch}`;
}

export function formatCodexCommandForDisplay(command: CodexCommandResolution | undefined): string {
  return command?.command ?? "codex";
}

export function formatCodexUnavailableError(command: CodexCommandResolution, error: string): string {
  const lines = [
    error,
    `平台: ${formatCodexPlatform(command)}`,
    `Codex CLI: ${command.command}`,
    `来源: ${formatCodexCommandSource(command.source)}`,
  ];
  if (command.platform === "win32") {
    lines.push(
      "Windows 排查: 请执行 where.exe codex 和 codex --version。",
      `如 PowerShell 可用但 Chat-Codex 不可用，可设置 ${CHAT_CODEX_BIN_ENV}=D:\\env\\nvm\\nodejs\\codex.cmd 后重试。`,
    );
  }
  return lines.join("\n");
}

export function parseNpmCmdShimTarget(commandPath: string, content: string): string | undefined {
  const match = content.match(/"?%_prog%"?\s+"([^"]+?\.js)"/i)
    ?? content.match(/\bnode(?:\.exe)?"?\s+"([^"]+?\.js)"/i);
  const rawTarget = match?.[1];
  if (!rawTarget) return undefined;
  const dir = path.win32.dirname(commandPath);
  return path.win32.normalize(rawTarget
    .replace(/%dp0%\\/gi, `${dir}\\`)
    .replace(/%dp0%/gi, `${dir}\\`));
}

interface WindowsResolveOptions {
  requested: string;
  source: CodexBinSource;
  env: NodeJS.ProcessEnv;
  platform: string;
  arch: string;
  cwd: string;
  fileExists: (filePath: string) => boolean;
}

function resolveWindowsCodexCommand(options: WindowsResolveOptions): CodexCommandResolution {
  const requested = options.requested;
  const hasPath = hasWindowsPathSeparator(requested) || path.win32.isAbsolute(requested);
  const extensions = windowsExecutableExtensions(options.env);
  const resolved = hasPath
    ? findWindowsExecutableCandidate(requested, extensions, options.fileExists)
    : findWindowsExecutableOnPath(requested, options.env, options.cwd, extensions, options.fileExists);
  const command = resolved ?? requested;
  const source = resolved && !hasPath && options.source === "default" ? "path" : options.source;
  return {
    command,
    requested,
    source,
    platform: options.platform,
    arch: options.arch,
    pathResolved: Boolean(resolved),
    shim: windowsShimKind(command),
  };
}

function findWindowsExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  extensions: string[],
  fileExists: (filePath: string) => boolean,
): string | undefined {
  const pathValue = windowsEnvValue(env, "PATH") ?? "";
  const dirs = [cwd, ...pathValue.split(";")].map((item) => item.trim()).filter(Boolean);
  for (const dir of dirs) {
    const candidate = findWindowsExecutableCandidate(path.win32.join(dir, command), extensions, fileExists);
    if (candidate) return candidate;
  }
  return undefined;
}

function findWindowsExecutableCandidate(
  basePath: string,
  extensions: string[],
  fileExists: (filePath: string) => boolean,
): string | undefined {
  if (path.win32.extname(basePath)) return fileExists(basePath) ? basePath : undefined;
  for (const ext of extensions) {
    const candidate = `${basePath}${ext}`;
    if (fileExists(candidate)) return candidate;
  }
  return fileExists(basePath) ? basePath : undefined;
}

function windowsExecutableExtensions(env: NodeJS.ProcessEnv): string[] {
  const raw = windowsEnvValue(env, "PATHEXT") || ".COM;.EXE;.BAT;.CMD";
  const normalized = raw
    .split(";")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => item.startsWith(".") ? item : `.${item}`);
  for (const ext of [".exe", ".cmd", ".bat", ".com"]) {
    if (!normalized.includes(ext)) normalized.push(ext);
  }
  return normalized;
}

function windowsEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const direct = env[key];
  if (direct !== undefined) return direct;
  const found = Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase());
  return found ? env[found] : undefined;
}

function windowsShimKind(command: string): CodexWindowsShim | undefined {
  const ext = path.win32.extname(command).toLowerCase();
  if (ext === ".cmd") return "cmd";
  if (ext === ".bat") return "bat";
  return undefined;
}

function hasWindowsPathSeparator(value: string): boolean {
  return value.includes("\\") || value.includes("/");
}

function resolveNpmCmdShimTarget(commandPath: string): string | undefined {
  try {
    const target = parseNpmCmdShimTarget(commandPath, fs.readFileSync(commandPath, "utf8"));
    if (!target || !fs.existsSync(target)) return undefined;
    return target;
  } catch {
    return undefined;
  }
}

function spawnWindowsCommandShim(
  command: CodexCommandResolution,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  const env = options.env as NodeJS.ProcessEnv | undefined;
  const comspec = windowsEnvValue(env ?? process.env, "ComSpec") ?? "cmd.exe";
  const commandLine = [command.command, ...args].map(quoteForCmd).join(" ");
  return spawn(comspec, ["/d", "/s", "/c", commandLine], options);
}

function quoteForCmd(value: string): string {
  if (!value) return "\"\"";
  return `"${value.replace(/(["^&|<>()%!])/g, "^$1")}"`;
}
