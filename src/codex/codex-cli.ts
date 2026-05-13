import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodexPermissionMode = "approval" | "full";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexRunPolicy {
  permissionMode: CodexPermissionMode;
  sandbox?: CodexSandboxMode;
}

export interface CodexCliStatus {
  available: boolean;
  codexBin: string;
  version?: string;
  error?: string;
}

export interface DiscoveredCodexSession {
  id: string;
  threadName?: string;
  cwd?: string;
  updatedAt?: string;
  path?: string;
}

export interface DiscoverCodexSessionsOptions {
  codexHome?: string;
  limit?: number;
}

export function buildCodexRootArgs(policy: CodexRunPolicy): string[] {
  if (policy.permissionMode === "full") {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }
  return [
    "--ask-for-approval",
    "on-request",
    "--sandbox",
    policy.sandbox ?? "workspace-write",
  ];
}

export async function checkCodexCli(codexBin = "codex", timeoutMs = 5000): Promise<CodexCliStatus> {
  return new Promise((resolve) => {
    const child = spawn(codexBin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ available: false, codexBin, error: `codex --version timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ available: false, codexBin, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ available: true, codexBin, version: stdout.trim() || stderr.trim() });
      } else {
        resolve({ available: false, codexBin, error: stderr.trim() || stdout.trim() || `exit ${code}` });
      }
    });
  });
}

export function discoverCodexSessions(options: DiscoverCodexSessionsOptions = {}): DiscoveredCodexSession[] {
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const byId = new Map<string, DiscoveredCodexSession>();
  for (const session of readSessionIndex(path.join(codexHome, "session_index.jsonl"))) {
    byId.set(session.id, session);
  }
  for (const session of readSessionFiles(path.join(codexHome, "sessions"))) {
    byId.set(session.id, { ...byId.get(session.id), ...session });
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.updatedAt ?? "") - Date.parse(a.updatedAt ?? ""))
    .slice(0, options.limit);
}

export function findCodexSessionById(
  sessionId: string,
  options: Omit<DiscoverCodexSessionsOptions, "limit"> = {},
): DiscoveredCodexSession | undefined {
  return discoverCodexSessions(options).find((session) => session.id === sessionId);
}

export function parseSessionIndexLine(line: string): DiscoveredCodexSession | undefined {
  try {
    const parsed = JSON.parse(line) as { id?: string; thread_name?: string; updated_at?: string };
    if (!parsed.id) return undefined;
    return {
      id: parsed.id,
      threadName: parsed.thread_name,
      updatedAt: parsed.updated_at,
    };
  } catch {
    return undefined;
  }
}

function readSessionIndex(filePath: string): DiscoveredCodexSession[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, "utf-8")
      .split(/\r?\n/)
      .map(parseSessionIndexLine)
      .filter((session): session is DiscoveredCodexSession => Boolean(session));
  } catch {
    return [];
  }
}

function readSessionFiles(rootDir: string): DiscoveredCodexSession[] {
  const files = listJsonlFiles(rootDir);
  const sessions: DiscoveredCodexSession[] = [];
  for (const filePath of files) {
    const session = readSessionMeta(filePath);
    if (session) sessions.push(session);
  }
  return sessions;
}

function readSessionMeta(filePath: string): DiscoveredCodexSession | undefined {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const firstLine = buffer.subarray(0, bytes).toString("utf-8").split(/\r?\n/, 1)[0];
      const parsed = JSON.parse(firstLine) as {
        type?: string;
        timestamp?: string;
        payload?: { id?: string; cwd?: string; timestamp?: string };
      };
      if (parsed.type !== "session_meta" || !parsed.payload?.id) return undefined;
      return {
        id: parsed.payload.id,
        cwd: parsed.payload.cwd,
        updatedAt: parsed.timestamp ?? parsed.payload.timestamp,
        path: filePath,
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

function listJsonlFiles(rootDir: string): string[] {
  const results: string[] = [];
  try {
    if (!fs.existsSync(rootDir)) return [];
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        results.push(...listJsonlFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  } catch {
    return results;
  }
  return results;
}
