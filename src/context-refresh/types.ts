export const CONTEXT_REFRESH_MODES = ["off", "detect", "reload"] as const;

export type ContextRefreshMode = typeof CONTEXT_REFRESH_MODES[number];

export interface ContextRefreshPolicy {
  mode: ContextRefreshMode;
}

export type ContextRefreshPolicySource = "route" | "global" | "builtin";

export interface ContextRefreshEffectivePolicy {
  policy: ContextRefreshPolicy;
  source: ContextRefreshPolicySource;
}

export const DEFAULT_CONTEXT_REFRESH_POLICY: ContextRefreshPolicy = { mode: "off" };

export function normalizeContextRefreshMode(value: unknown): ContextRefreshMode | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "off" || normalized === "关闭" || normalized === "disabled") return "off";
  if (normalized === "detect" || normalized === "检测" || normalized === "notify") return "detect";
  if (normalized === "reload" || normalized === "on" || normalized === "刷新" || normalized === "开启") return "reload";
  return undefined;
}

export function normalizeContextRefreshPolicy(value: unknown): ContextRefreshPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const mode = normalizeContextRefreshMode((value as { mode?: unknown }).mode);
  return mode ? { mode } : undefined;
}

export function cloneContextRefreshPolicy(policy: ContextRefreshPolicy | undefined): ContextRefreshPolicy | undefined {
  return policy ? { mode: policy.mode } : undefined;
}

export function contextRefreshPolicyOrDefault(policy: ContextRefreshPolicy | undefined): ContextRefreshPolicy {
  return cloneContextRefreshPolicy(policy) ?? { ...DEFAULT_CONTEXT_REFRESH_POLICY };
}

export function formatContextRefreshModeForUser(mode: ContextRefreshMode): string {
  switch (mode) {
    case "off":
      return "关闭";
    case "detect":
      return "检测提醒";
    case "reload":
      return "检测并刷新";
  }
}

export function formatContextRefreshSourceForUser(source: ContextRefreshPolicySource): string {
  switch (source) {
    case "route":
      return "当前聊天";
    case "global":
      return "全局默认";
    case "builtin":
      return "内置默认";
  }
}

export function formatContextRefreshEffectivePolicyForUser(effective: ContextRefreshEffectivePolicy): string {
  return `${formatContextRefreshModeForUser(effective.policy.mode)}（${formatContextRefreshSourceForUser(effective.source)}）`;
}
