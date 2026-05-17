import type { CodexRunPolicy, CodexSandboxMode } from "../codex-cli.js";

export function cloneRunPolicy(policy: CodexRunPolicy): CodexRunPolicy {
  return { ...policy };
}

export function approvalPolicyForRunPolicy(policy: CodexRunPolicy): "on-request" | "never" {
  return policy.permissionMode === "full" ? "never" : "on-request";
}

export function approvalsReviewerForRunPolicy(policy: CodexRunPolicy): "user" | null {
  return policy.permissionMode === "full" ? null : "user";
}

export function sandboxModeForRunPolicy(policy: CodexRunPolicy): CodexSandboxMode {
  return policy.permissionMode === "full" ? "danger-full-access" : policy.sandbox ?? "workspace-write";
}

export function sandboxPolicyForRunPolicy(policy: CodexRunPolicy, cwd: string): Record<string, unknown> {
  if (policy.permissionMode === "full") return { type: "dangerFullAccess" };
  const sandbox = policy.sandbox ?? "workspace-write";
  if (sandbox === "read-only") return { type: "readOnly", networkAccess: false };
  if (sandbox === "danger-full-access") return { type: "dangerFullAccess" };
  return {
    type: "workspaceWrite",
    writableRoots: [cwd],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}
