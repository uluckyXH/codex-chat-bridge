import type { CodexProgressKind } from "../types.js";
import { arrayValue, objectValue, stringValue } from "./value-parsers.js";

export function messagePhaseValue(value: unknown): "commentary" | "final_answer" | undefined {
  return value === "commentary" || value === "final_answer" ? value : undefined;
}

export function progressFromThreadItem(item: Record<string, unknown>): { text: string; kind: CodexProgressKind } | undefined {
  const itemType = stringValue(item.type);
  if (itemType === "commandExecution") {
    const command = stringValue(item.command);
    const output = stringValue(item.aggregatedOutput);
    const status = stringValue(item.status);
    if (!command) return undefined;
    const label = status === "failed" ? "命令失败" : "命令完成";
    return { text: output ? `${label}: ${command}\n输出:\n${output.trim()}` : `${label}: ${command}`, kind: "command" };
  }
  if (itemType === "fileChange") {
    const changes = arrayValue(item.changes)
      .map((entry) => stringValue(objectValue(entry).path) ?? stringValue(objectValue(entry).absolutePath))
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");
    return changes ? { text: `文件变更完成: ${changes}`, kind: "file_change" } : undefined;
  }
  if (itemType === "mcpToolCall") {
    const tool = [stringValue(item.server), stringValue(item.tool)].filter(Boolean).join("/");
    return tool ? { text: `工具调用完成: ${tool}`, kind: "tool" } : undefined;
  }
  if (itemType === "webSearch") {
    const query = stringValue(item.query);
    return query ? { text: `搜索完成: ${query}`, kind: "search" } : undefined;
  }
  if (itemType === "imageView" || itemType === "imageGeneration") {
    const path = stringValue(item.path) ?? stringValue(item.savedPath) ?? stringValue(item.result);
    return path ? { text: `媒体生成完成: ${path}`, kind: "file_change" } : undefined;
  }
  return undefined;
}

export function textFromPlan(params: Record<string, unknown>): string | undefined {
  const plan = arrayValue(params.plan);
  const active = plan
    .map((entry) => {
      const object = objectValue(entry);
      return stringValue(object.step) ?? stringValue(object.text) ?? (typeof entry === "string" ? entry : undefined);
    })
    .filter(Boolean)
    .at(-1);
  return active;
}

export function shouldFlushProgressDraft(text: string): boolean {
  const normalized = text.trim();
  return normalized.length >= 400 || /[。！？.!?]\s*$/.test(normalized) || normalized.includes("\n");
}

export function appServerErrorMessage(params: Record<string, unknown>): string {
  return stringValue(objectValue(params.error).message)
    ?? stringValue(params.message)
    ?? "codex app-server error";
}

export function isTransientAppServerError(message: string): boolean {
  return /^Reconnecting\.\.\.\s+\d+\/\d+/i.test(message.trim());
}
