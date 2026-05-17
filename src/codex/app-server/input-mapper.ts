import type { CodexPromptInput } from "../types.js";
import { normalizeCodexInput } from "../input.js";

export function appServerUserInput(input: CodexPromptInput): Array<Record<string, unknown>> {
  const normalized = normalizeCodexInput(input);
  const result: Array<Record<string, unknown>> = [];
  for (const item of normalized.items) {
    if (item.type === "text") {
      if (item.text) result.push({ type: "text", text: item.text, text_elements: [] });
    } else if (item.type === "localImage") {
      result.push({ type: "localImage", path: item.path });
    } else if (item.type === "localFile") {
      result.push({
        type: "text",
        text: localFileInputText(item),
        text_elements: [],
      });
    }
  }
  if (result.length === 0) {
    result.push({ type: "text", text: normalized.text, text_elements: [] });
  }
  return result;
}

export function localFileInputText(file: { path: string; name?: string; mimeType?: string }): string {
  return [
    "用户上传了文件：",
    `- ${file.name ? `${file.name}: ` : ""}${file.path}${file.mimeType ? ` (${file.mimeType})` : ""}`,
    "",
    "请根据用户要求读取这个文件。",
  ].join("\n");
}
