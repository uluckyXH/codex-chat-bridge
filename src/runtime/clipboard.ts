import { spawn } from "node:child_process";

export interface ClipboardCommand {
  command: string;
  args: string[];
}

export interface ClipboardWriteResult {
  ok: boolean;
  command?: string;
  message: string;
}

export type ClipboardCommandRunner = (
  command: ClipboardCommand,
  text: string,
) => Promise<{ ok: boolean; message?: string }>;

export interface ClipboardWriteOptions {
  platform?: NodeJS.Platform;
  runner?: ClipboardCommandRunner;
}

export function clipboardCommandCandidates(platform: NodeJS.Platform = process.platform): ClipboardCommand[] {
  if (platform === "darwin") return [{ command: "pbcopy", args: [] }];
  if (platform === "win32") return [{ command: "clip", args: [] }];
  return [
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
  ];
}

export async function writeClipboardText(
  text: string,
  options: ClipboardWriteOptions = {},
): Promise<ClipboardWriteResult> {
  const commands = clipboardCommandCandidates(options.platform);
  const runner = options.runner ?? runClipboardCommand;
  const errors: string[] = [];
  for (const command of commands) {
    const result = await runner(command, text);
    if (result.ok) {
      return { ok: true, command: command.command, message: `copied with ${command.command}` };
    }
    if (result.message) errors.push(`${command.command}: ${result.message}`);
  }
  return {
    ok: false,
    message: errors.length > 0
      ? errors.join("; ")
      : "未找到可用的剪贴板命令。",
  };
}

async function runClipboardCommand(
  command: ClipboardCommand,
  text: string,
): Promise<{ ok: boolean; message?: string }> {
  return await new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (result: { ok: boolean; message?: string }): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({ ok: false, message: error.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish({ ok: true });
        return;
      }
      finish({ ok: false, message: stderr.trim() || `exit ${code}` });
    });
    child.stdin.end(text);
  });
}
