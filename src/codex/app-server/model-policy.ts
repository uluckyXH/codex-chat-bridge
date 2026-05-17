import type {
  CodexModelOption,
  CodexModelPolicy,
  CodexModelServiceTier,
  CodexReasoningEffort,
  CodexReasoningEffortOption,
  CodexSessionContextUsage,
  CodexSessionModelInfo,
  CodexSessionStatus,
} from "../types.js";
import { CODEX_REASONING_EFFORTS } from "../types.js";
import { arrayValue, numberValue, objectValue, stringValue } from "./value-parsers.js";

export function cloneModelPolicy(policy: CodexModelPolicy): CodexModelPolicy {
  return { ...policy };
}

export function withoutModelInfo(status: CodexSessionStatus): CodexSessionStatus {
  const { model: _model, ...rest } = status;
  return rest;
}

export function modelInfoWithPolicy(
  model: CodexSessionModelInfo | undefined,
  policy: CodexModelPolicy,
): CodexSessionModelInfo | undefined {
  if (!model && !policy.model && policy.serviceTier === undefined && !policy.reasoningEffort) return undefined;
  return {
    ...(model ?? {}),
    ...(policy.model ? { model: policy.model } : {}),
    ...(policy.serviceTier !== undefined ? { serviceTier: policy.serviceTier } : {}),
    ...(policy.reasoningEffort ? { reasoningEffort: policy.reasoningEffort } : {}),
  };
}

export function modelInfoFromResponse(
  response: Record<string, unknown>,
  thread: Record<string, unknown>,
): CodexSessionModelInfo | undefined {
  const model = stringValue(response.model);
  const provider = stringValue(response.modelProvider) ?? stringValue(thread.modelProvider);
  const serviceTier = stringValue(response.serviceTier) ?? null;
  const reasoningEffort = Object.prototype.hasOwnProperty.call(response, "reasoningEffort")
    ? stringValue(response.reasoningEffort) ?? null
    : undefined;
  if (!model && !provider && !serviceTier && reasoningEffort === undefined) return undefined;
  return {
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(serviceTier ? { serviceTier } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  };
}

export function modelsFromListResponse(response: Record<string, unknown>): CodexModelOption[] {
  return arrayValue(response.data)
    .map(modelOptionFromValue)
    .filter((model): model is CodexModelOption => Boolean(model));
}

function modelOptionFromValue(value: unknown): CodexModelOption | undefined {
  const object = objectValue(value);
  const id = stringValue(object.id);
  const model = stringValue(object.model);
  if (!id || !model) return undefined;
  const supportedReasoningEfforts = arrayValue(object.supportedReasoningEfforts ?? object.supported_reasoning_efforts)
    .map(reasoningEffortOptionFromValue)
    .filter((option): option is CodexReasoningEffortOption => Boolean(option));
  const defaultReasoningEffort = reasoningEffortValue(object.defaultReasoningEffort ?? object.default_reasoning_effort);
  if (defaultReasoningEffort && !supportedReasoningEfforts.some((option) => option.reasoningEffort === defaultReasoningEffort)) {
    supportedReasoningEfforts.push({ reasoningEffort: defaultReasoningEffort });
  }
  const serviceTiers = arrayValue(object.serviceTiers ?? object.service_tiers)
    .map(modelServiceTierFromValue)
    .filter((tier): tier is CodexModelServiceTier => Boolean(tier));
  return {
    id,
    model,
    displayName: stringValue(object.displayName ?? object.display_name) ?? model,
    ...(stringValue(object.description) ? { description: stringValue(object.description) } : {}),
    hidden: object.hidden === true,
    supportedReasoningEfforts,
    ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    ...(serviceTiers.length > 0 ? { serviceTiers } : {}),
    ...(typeof object.isDefault === "boolean" ? { isDefault: object.isDefault } : {}),
  };
}

function reasoningEffortOptionFromValue(value: unknown): CodexReasoningEffortOption | undefined {
  if (typeof value === "string") {
    const effort = reasoningEffortValue(value);
    return effort ? { reasoningEffort: effort } : undefined;
  }
  const object = objectValue(value);
  const reasoningEffort = reasoningEffortValue(object.reasoningEffort ?? object.reasoning_effort);
  if (!reasoningEffort) return undefined;
  return {
    reasoningEffort,
    ...(stringValue(object.description) ? { description: stringValue(object.description) } : {}),
  };
}

function modelServiceTierFromValue(value: unknown): CodexModelServiceTier | undefined {
  const object = objectValue(value);
  const id = stringValue(object.id);
  if (!id) return undefined;
  return {
    id,
    ...(stringValue(object.name) ? { name: stringValue(object.name) } : {}),
    ...(stringValue(object.description) ? { description: stringValue(object.description) } : {}),
  };
}

function reasoningEffortValue(value: unknown): CodexReasoningEffort | undefined {
  return typeof value === "string" && (CODEX_REASONING_EFFORTS as readonly string[]).includes(value)
    ? value as CodexReasoningEffort
    : undefined;
}

export function parseTokenUsage(value: Record<string, unknown>): CodexSessionContextUsage | undefined {
  const total = parseTokenUsageBreakdown(objectValue(value.total));
  const last = parseTokenUsageBreakdown(objectValue(value.last));
  if (!total || !last) return undefined;
  return {
    total,
    last,
    modelContextWindow: numberValue(value.modelContextWindow) ?? null,
  };
}

function parseTokenUsageBreakdown(value: Record<string, unknown>): CodexSessionContextUsage["total"] | undefined {
  const totalTokens = numberValue(value.totalTokens);
  const inputTokens = numberValue(value.inputTokens);
  const cachedInputTokens = numberValue(value.cachedInputTokens);
  const outputTokens = numberValue(value.outputTokens);
  const reasoningOutputTokens = numberValue(value.reasoningOutputTokens);
  if (
    totalTokens === undefined
    || inputTokens === undefined
    || cachedInputTokens === undefined
    || outputTokens === undefined
    || reasoningOutputTokens === undefined
  ) {
    return undefined;
  }
  return { totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens };
}
