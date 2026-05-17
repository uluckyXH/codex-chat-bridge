import type { CodexGoal, CodexGoalStatus } from "../types.js";
import { numberValue, objectValueOrNull, stringValue } from "./value-parsers.js";

export function goalFromSetResponse(response: Record<string, unknown>): CodexGoal {
  const goal = objectValueOrNull(response.goal);
  if (!goal) throw new Error("codex app-server 未返回 Goal。");
  return goalFromResponse(goal);
}

export function goalFromResponse(value: Record<string, unknown>): CodexGoal {
  return {
    threadId: stringValue(value.threadId) ?? stringValue(value.thread_id) ?? "unknown-thread",
    objective: stringValue(value.objective) ?? "",
    status: goalStatusValue(value.status),
    tokenBudget: numberValue(value.tokenBudget ?? value.token_budget) ?? null,
    tokensUsed: numberValue(value.tokensUsed ?? value.tokens_used) ?? 0,
    timeUsedSeconds: numberValue(value.timeUsedSeconds ?? value.time_used_seconds) ?? 0,
    createdAt: numberValue(value.createdAt ?? value.created_at) ?? 0,
    updatedAt: numberValue(value.updatedAt ?? value.updated_at) ?? 0,
  };
}

export function goalStatusValue(value: unknown): CodexGoalStatus {
  if (value === "active" || value === "paused" || value === "budgetLimited" || value === "complete") {
    return value;
  }
  return "active";
}
