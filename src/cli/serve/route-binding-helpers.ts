import type { Interface } from "node:readline/promises";
import { FileStateStore } from "../../state/file-state-store.js";
import { BindingActions, formatRunPolicyForUser, formatSessionActiveTime, type BindingSummary, type SessionChoices } from "../actions/binding-actions.js";
import type { PreparedServeStartup } from "../launcher-types.js";
import { isBackText, isManualSessionInputAction } from "./shortcuts.js";

export function createBindingActions(startup: PreparedServeStartup): BindingActions {
  return new BindingActions(new FileStateStore(), { cwd: startup.cwd });
}

export function formatPersistedBindingList(bindings: BindingSummary[]): string {
  return [
    "聊天绑定",
    "",
    ...bindings.map((binding, index) => {
      const session = binding.activeSession
        ? `${binding.activeSession.title ?? binding.activeSession.id} / ${binding.activeSession.shortId}，最近活跃 ${formatSessionActiveTime(binding.activeSession.updatedAt)}`
        : "未绑定";
      const permission = binding.permission ? `，${formatRunPolicyForUser(binding.permission)}` : "";
      return `${index + 1}. ${binding.label}    ${session}${permission}`;
    }),
    "0. 返回",
  ].join("\n");
}

export async function resolveSessionIdFromChoiceInput(
  rl: Interface,
  answer: string,
  choices: SessionChoices,
): Promise<string | undefined> {
  if (isManualSessionInputAction(answer)) {
    const manual = (await rl.question("请输入 Session ID [0 返回]: ")).trim();
    if (!manual || manual === "0" || isBackText(manual)) return undefined;
    return manual;
  }
  if (/^\d+$/.test(answer)) {
    const index = Number.parseInt(answer, 10);
    if (index >= 1 && index <= choices.selectable.length) {
      return choices.selectable[index - 1].id;
    }
    console.log(`没有第 ${index} 项，请重新选择。`);
    return undefined;
  }
  return answer;
}

export function shortSessionId(sessionId: string): string {
  return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8);
}
