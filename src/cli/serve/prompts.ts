import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { isBackText } from "./shortcuts.js";

export async function askStdin(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

export async function askRequired(rl: Interface, prompt: string): Promise<string | undefined> {
  for (;;) {
    const answer = (await rl.question(prompt)).trim();
    if (isBackText(answer)) return undefined;
    if (answer) return answer;
    console.log("这里不能为空，请重新输入；输入 0 返回上一级。");
  }
}

export async function askOptional(rl: Interface, prompt: string, defaultValue: string): Promise<string> {
  const answer = (await rl.question(prompt)).trim();
  return answer || defaultValue;
}

export function questionWithReadline(rl: Interface): (prompt: string) => Promise<string> {
  return async (prompt: string) => (await rl.question(prompt)).trim();
}

export function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}
