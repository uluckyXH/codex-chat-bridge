import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ResolvedWorkdir {
  cwd: string;
  created: boolean;
}

export type CheckedWorkdir =
  | { ok: true; cwd: string }
  | { ok: false; cwd: string; reason: "missing" | "not_directory"; message: string };

export function normalizeWorkdir(input: string | undefined, baseCwd = process.cwd()): string {
  const value = input?.trim() ? input.trim() : baseCwd;
  const expanded = expandHome(value);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(baseCwd, expanded);
}

export function checkNewSessionWorkdir(input: string | undefined, baseCwd = process.cwd()): CheckedWorkdir {
  const cwd = normalizeWorkdir(input, baseCwd);
  if (!fs.existsSync(cwd)) {
    return { ok: false, cwd, reason: "missing", message: `工作目录不存在: ${cwd}` };
  }
  const stat = fs.statSync(cwd);
  if (!stat.isDirectory()) {
    return { ok: false, cwd, reason: "not_directory", message: `工作目录不是目录: ${cwd}` };
  }
  return { ok: true, cwd };
}

export function resolveNewSessionWorkdir(input: string | undefined, baseCwd = process.cwd()): ResolvedWorkdir {
  const checked = checkNewSessionWorkdir(input, baseCwd);
  if (checked.ok) {
    return { cwd: checked.cwd, created: false };
  }
  if (checked.reason === "not_directory") {
    throw new Error(checked.message);
  }
  fs.mkdirSync(checked.cwd, { recursive: true });
  return { cwd: checked.cwd, created: true };
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}
