import fs from "node:fs";
import { fileURLToPath } from "node:url";

export interface ChatCodexPackageInfo {
  name: string;
  version: string;
}

export const CHAT_CODEX_DISPLAY_NAME = "Chat-Codex";

let cachedPackageInfo: ChatCodexPackageInfo | undefined;

export function readChatCodexPackageInfo(): ChatCodexPackageInfo {
  if (cachedPackageInfo) return cachedPackageInfo;
  cachedPackageInfo = readPackageJson() ?? { name: "chat-codex", version: "0.0.0" };
  return cachedPackageInfo;
}

export function chatCodexVersion(): string {
  return readChatCodexPackageInfo().version;
}

export function chatCodexTitle(): string {
  return `${CHAT_CODEX_DISPLAY_NAME} v${chatCodexVersion()}`;
}

export function chatCodexVersionSummary(): string {
  return [
    `${CHAT_CODEX_DISPLAY_NAME} ${chatCodexVersion()}`,
    `Node.js ${process.version}`,
  ].join("\n");
}

function readPackageJson(): ChatCodexPackageInfo | undefined {
  try {
    const packageJsonPath = fileURLToPath(new URL("../../../package.json", import.meta.url));
    const raw = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "chat-codex";
    const version = typeof raw.version === "string" && raw.version.trim() ? raw.version.trim() : "0.0.0";
    return { name, version };
  } catch {
    return undefined;
  }
}
