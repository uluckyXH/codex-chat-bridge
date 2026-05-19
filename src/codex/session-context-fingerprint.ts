import { spawnSync as defaultSpawnSync, type SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CodexSessionContextFingerprintSource = "sqlite" | "rollout" | "session_index" | "unknown";

export interface CodexSessionContextFingerprint {
  sessionId: string;
  detectedAt: string;
  source: CodexSessionContextFingerprintSource;
  updatedAtMs?: number;
  rolloutPath?: string;
  rolloutMtimeMs?: number;
  rolloutSize?: number;
}

export interface ReadCodexSessionContextFingerprintOptions {
  codexHome?: string;
  env?: NodeJS.ProcessEnv;
  sqliteBin?: string;
  spawnSync?: typeof defaultSpawnSync;
  now?: () => Date;
}

export function resolveCodexHome(options: { codexHome?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return options.codexHome ?? options.env?.CODEX_HOME ?? process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

export function readCodexSessionContextFingerprint(
  sessionId: string,
  options: ReadCodexSessionContextFingerprintOptions = {},
): CodexSessionContextFingerprint | undefined {
  const codexHome = resolveCodexHome(options);
  const detectedAt = (options.now?.() ?? new Date()).toISOString();
  return readSqliteFingerprint(sessionId, codexHome, detectedAt, options)
    ?? readRolloutFingerprint(sessionId, codexHome, detectedAt)
    ?? readSessionIndexFingerprint(sessionId, codexHome, detectedAt);
}

export function fingerprintIsNewer(
  current: CodexSessionContextFingerprint,
  previous: CodexSessionContextFingerprint,
): boolean {
  const updatedAt = compareOptionalNumber(current.updatedAtMs, previous.updatedAtMs);
  if (updatedAt !== 0) return updatedAt > 0;
  const rolloutSize = compareOptionalNumber(current.rolloutSize, previous.rolloutSize);
  if (rolloutSize !== 0) return rolloutSize > 0;
  const rolloutMtime = compareOptionalNumber(current.rolloutMtimeMs, previous.rolloutMtimeMs);
  if (rolloutMtime !== 0) return rolloutMtime > 0;
  return false;
}

export function cloneCodexSessionContextFingerprint(
  fingerprint: CodexSessionContextFingerprint,
): CodexSessionContextFingerprint {
  return { ...fingerprint };
}

function readSqliteFingerprint(
  sessionId: string,
  codexHome: string,
  detectedAt: string,
  options: ReadCodexSessionContextFingerprintOptions,
): CodexSessionContextFingerprint | undefined {
  const dbPath = path.join(codexHome, "state_5.sqlite");
  try {
    if (!fs.existsSync(dbPath)) return undefined;
    const spawnSync = options.spawnSync ?? defaultSpawnSync;
    const result = spawnSync(options.sqliteBin ?? "sqlite3", [
      "-readonly",
      "-json",
      dbPath,
      [
        "SELECT id, rollout_path, updated_at_ms, updated_at",
        "FROM threads",
        `WHERE id = ${sqliteStringLiteral(sessionId)}`,
        "LIMIT 1",
      ].join(" "),
    ], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }) as SpawnSyncReturns<string>;
    if (result.status !== 0 || !result.stdout.trim()) return undefined;
    const rows = JSON.parse(result.stdout) as Array<{
      id?: unknown;
      rollout_path?: unknown;
      updated_at_ms?: unknown;
      updated_at?: unknown;
    }>;
    const row = rows.find((item) => item.id === sessionId);
    if (!row) return undefined;
    const rolloutPath = stringValue(row.rollout_path);
    const stat = rolloutPath ? statFile(resolveRolloutPath(codexHome, rolloutPath)) : undefined;
    return {
      sessionId,
      detectedAt,
      source: "sqlite",
      updatedAtMs: sqliteTimeToMs(row.updated_at_ms, row.updated_at),
      rolloutPath: stat?.filePath ?? (rolloutPath ? resolveRolloutPath(codexHome, rolloutPath) : undefined),
      rolloutMtimeMs: stat?.mtimeMs,
      rolloutSize: stat?.size,
    };
  } catch {
    return undefined;
  }
}

function readRolloutFingerprint(
  sessionId: string,
  codexHome: string,
  detectedAt: string,
): CodexSessionContextFingerprint | undefined {
  const rootDir = path.join(codexHome, "sessions");
  for (const filePath of listJsonlFiles(rootDir)) {
    const meta = readRolloutSessionMeta(filePath);
    if (meta?.sessionId !== sessionId) continue;
    const stat = statFile(filePath);
    if (!stat) continue;
    return {
      sessionId,
      detectedAt,
      source: "rollout",
      rolloutPath: filePath,
      rolloutMtimeMs: stat.mtimeMs,
      rolloutSize: stat.size,
    };
  }
  return undefined;
}

function readSessionIndexFingerprint(
  sessionId: string,
  codexHome: string,
  detectedAt: string,
): CodexSessionContextFingerprint | undefined {
  const filePath = path.join(codexHome, "session_index.jsonl");
  try {
    if (!fs.existsSync(filePath)) return undefined;
    let newest: CodexSessionContextFingerprint | undefined;
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parsed = parseSessionIndexLine(line);
      if (parsed?.sessionId !== sessionId) continue;
      const next: CodexSessionContextFingerprint = {
        sessionId,
        detectedAt,
        source: "session_index",
        updatedAtMs: parsed.updatedAtMs,
      };
      if (!newest || fingerprintIsNewer(next, newest)) newest = next;
    }
    return newest;
  } catch {
    return undefined;
  }
}

function parseSessionIndexLine(line: string): { sessionId: string; updatedAtMs?: number } | undefined {
  try {
    const parsed = JSON.parse(line) as { id?: unknown; updated_at?: unknown };
    const sessionId = stringValue(parsed.id);
    if (!sessionId) return undefined;
    return { sessionId, updatedAtMs: timeValueToMs(parsed.updated_at) };
  } catch {
    return undefined;
  }
}

function readRolloutSessionMeta(filePath: string): { sessionId: string } | undefined {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const firstLine = buffer.subarray(0, bytes).toString("utf8").split(/\r?\n/, 1)[0];
      const parsed = JSON.parse(firstLine) as {
        type?: unknown;
        payload?: { id?: unknown };
      };
      if (parsed.type !== "session_meta") return undefined;
      const sessionId = stringValue(parsed.payload?.id);
      return sessionId ? { sessionId } : undefined;
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
    if (!fs.existsSync(rootDir)) return results;
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
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

function statFile(filePath: string): { filePath: string; mtimeMs: number; size: number } | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return undefined;
    return { filePath, mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return undefined;
  }
}

function resolveRolloutPath(codexHome: string, rolloutPath: string): string {
  return path.isAbsolute(rolloutPath) ? rolloutPath : path.resolve(codexHome, rolloutPath);
}

function sqliteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqliteTimeToMs(updatedAtMs: unknown, updatedAt: unknown): number | undefined {
  return numberValue(updatedAtMs) ?? timeValueToMs(updatedAt);
}

function timeValueToMs(value: unknown): number | undefined {
  const numeric = numberValue(value);
  if (numeric !== undefined) return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  if (left === undefined || right === undefined) return 0;
  if (left > right) return 1;
  if (left < right) return -1;
  return 0;
}
