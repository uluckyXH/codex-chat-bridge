import type { ApprovalDecision } from "../approvals/types.js";
import type {
  CodexAdapter,
  CodexEvent,
  CodexRunPolicy,
  CodexRunPolicyStatus,
  CodexSession,
  CodexSessionStatus,
  CodexSessionSummary,
  StartSessionInput,
} from "./types.js";

export class MockCodexAdapter implements CodexAdapter {
  private sequence = 0;
  private runPolicy: CodexRunPolicy = { permissionMode: "approval", sandbox: "workspace-write" };
  private readonly sessions = new Map<string, { session: CodexSession; routeKey: string; status: CodexSessionStatus }>();
  readonly resolvedApprovals: Array<{ approvalKey: string; decision: ApprovalDecision; reason?: string }> = [];

  async startSession(input: StartSessionInput): Promise<CodexSession> {
    this.sequence += 1;
    const session: CodexSession = {
      id: `mock-codex-${this.sequence}`,
      cwd: input.cwd,
      title: input.title,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, { session, routeKey: input.routeKey, status: { type: "idle" } });
    return session;
  }

  async resumeSession(sessionId: string): Promise<CodexSession> {
    const stored = this.sessions.get(sessionId);
    if (!stored) throw new Error(`mock session not found: ${sessionId}`);
    return stored.session;
  }

  async *run(sessionId: string, prompt: string): AsyncIterable<CodexEvent> {
    const stored = this.sessions.get(sessionId);
    if (!stored) throw new Error(`mock session not found: ${sessionId}`);
    const turnId = `turn-${Date.now()}`;
    stored.status = { type: "running", turnId };
    yield { type: "turn.started", sessionId, turnId };
    if (prompt.includes("审批") || prompt.includes("approval")) {
      stored.status = { type: "waiting_approval", detail: "mock approval" };
      yield {
        type: "approval.requested",
        sessionId,
        turnId,
        approval: {
          kind: "command",
          sessionId,
          turnId,
          itemId: `item-${turnId}`,
          command: "echo mock-approval",
          cwd: stored.session.cwd,
          reason: "mock approval requested by prompt",
          risk: "low",
          availableDecisions: ["approve", "approve-session", "deny", "cancel"],
        },
      };
    }
    const text = `Mock Codex 回复: ${prompt}`;
    yield { type: "assistant.delta", sessionId, turnId, text };
    yield { type: "assistant.completed", sessionId, turnId, text };
    stored.status = { type: "idle" };
    yield { type: "turn.completed", sessionId, turnId };
  }

  async cancel(sessionId: string): Promise<void> {
    const stored = this.sessions.get(sessionId);
    if (stored) stored.status = { type: "idle" };
  }

  async getStatus(sessionId: string): Promise<CodexSessionStatus> {
    return this.sessions.get(sessionId)?.status ?? { type: "unknown", detail: "session not found" };
  }

  async listSessions(routeKey?: string): Promise<CodexSessionSummary[]> {
    return [...this.sessions.values()]
      .filter((stored) => (routeKey ? stored.routeKey === routeKey : true))
      .map((stored) => ({
        id: stored.session.id,
        routeKey: stored.routeKey,
        title: stored.session.title,
        cwd: stored.session.cwd,
        status: stored.status,
        updatedAt: new Date().toISOString(),
      }));
  }

  async resolveApproval(approvalKey: string, decision: ApprovalDecision, reason?: string): Promise<void> {
    this.resolvedApprovals.push({
      approvalKey,
      decision,
      ...(reason ? { reason } : {}),
    });
  }

  getRunPolicy(): CodexRunPolicy {
    return { ...this.runPolicy };
  }

  setRunPolicy(policy: CodexRunPolicy): void {
    this.runPolicy = { ...policy };
  }

  getRunPolicyStatus(): CodexRunPolicyStatus {
    return {
      policy: this.getRunPolicy(),
      interactiveApprovals: true,
      effectiveApprovalPolicy: this.runPolicy.permissionMode === "full" ? "never" : "on-request",
    };
  }
}
