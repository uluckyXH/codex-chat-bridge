import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ResolvedWorkdir {
  cwd: string;
  created: boolean;
}

export function normalizeWorkdir(input: string | undefined, baseCwd = process.cwd()): string {
  const value = input?.trim() ? input.trim() : baseCwd;
  const expanded = expandHome(value);
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(baseCwd, expanded);
}

export function resolveNewSessionWorkdir(input: string | undefined, baseCwd = process.cwd()): ResolvedWorkdir {
  const cwd = normalizeWorkdir(input, baseCwd);
  if (fs.existsSync(cwd)) {
    const stat = fs.statSync(cwd);
    if (!stat.isDirectory()) {
      throw new Error(`工作目录不是目录: ${cwd}`);
    }
    return { cwd, created: false };
  }
  fs.mkdirSync(cwd, { recursive: true });
  return { cwd, created: true };
}

function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}
