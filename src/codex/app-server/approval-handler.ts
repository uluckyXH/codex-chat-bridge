import type { ApprovalDecision, ApprovalKind, ApprovalRequest } from "../../approvals/types.js";
import { arrayValue, objectValue, stringValue } from "./value-parsers.js";

export function approvalKindForMethod(method: string): ApprovalKind | undefined {
  if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") return "command";
  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") return "file_change";
  if (method === "item/permissions/requestApproval") return "permissions";
  return undefined;
}

export function responseForApprovalDecision(method: string, params: Record<string, unknown>, decision: ApprovalDecision): Record<string, unknown> {
  if (method === "item/permissions/requestApproval") {
    const scope = decision === "approve-session" ? "session" : "turn";
    const permissions = decision === "approve" || decision === "approve-session" ? grantedPermissionsFromRequest(params) : {};
    return { permissions, scope };
  }
  if (method === "execCommandApproval" || method === "applyPatchApproval") {
    return { decision: legacyReviewDecision(decision) };
  }
  return { decision: appServerDecision(decision) };
}

export function riskyCommand(command: string): boolean {
  return /\b(rm|sudo|chmod|chown|mv|dd|mkfs|diskutil)\b/.test(command);
}

export function approvalFromServerRequest(
  method: string,
  requestId: string | number,
  params: Record<string, unknown>,
): ApprovalRequest | undefined {
  const kind = approvalKindForMethod(method);
  if (!kind) return undefined;
  const threadId = stringValue(params.threadId) ?? stringValue(params.conversationId) ?? "unknown-thread";
  const turnId = stringValue(params.turnId) ?? stringValue(params.callId) ?? "unknown-turn";
  const itemId = stringValue(params.itemId) ?? stringValue(params.callId) ?? String(requestId);
  const command = stringValue(params.command) ?? arrayValue(params.command).filter((part) => typeof part === "string").join(" ");
  const cwd = stringValue(params.cwd) ?? stringValue(params.grantRoot);
  const reason = stringValue(params.reason);
  return {
    kind,
    adapterApprovalId: String(requestId),
    sessionId: threadId,
    turnId,
    itemId,
    command,
    cwd,
    reason,
    risk: command && riskyCommand(command) ? "high" : undefined,
    availableDecisions: ["approve", "approve-session", "deny", "cancel"],
    raw: params,
  };
}

function appServerDecision(decision: ApprovalDecision): "accept" | "acceptForSession" | "decline" | "cancel" {
  if (decision === "approve") return "accept";
  if (decision === "approve-session") return "acceptForSession";
  if (decision === "deny") return "decline";
  return "cancel";
}

function legacyReviewDecision(decision: ApprovalDecision): "approved" | "approved_for_session" | "denied" | "abort" {
  if (decision === "approve") return "approved";
  if (decision === "approve-session") return "approved_for_session";
  if (decision === "deny") return "denied";
  return "abort";
}

function grantedPermissionsFromRequest(params: Record<string, unknown>): Record<string, unknown> {
  const requested = objectValue(params.permissions);
  const granted: Record<string, unknown> = {};
  if (requested.network !== undefined && requested.network !== null) granted.network = requested.network;
  if (requested.fileSystem !== undefined && requested.fileSystem !== null) granted.fileSystem = requested.fileSystem;
  return granted;
}
