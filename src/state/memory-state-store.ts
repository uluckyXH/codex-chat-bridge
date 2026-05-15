import type { CodexSession, CodexSessionStatus } from "../codex/types.js";
import { SessionBindings, type ActivateSessionResult, type ClaimSessionResult, type SessionBinding, type SessionOwner } from "./session-bindings.js";

export interface StoredSession {
  session: CodexSession;
  routeKey?: string;
  ownerRouteKey?: string;
  status: CodexSessionStatus;
  updatedAt: string;
  lastError?: string;
}

export class MemoryStateStore {
  private readonly sessions = new Map<string, StoredSession>();

  constructor(readonly sessionBindings = new SessionBindings()) {}

  bindSession(routeKey: string, session: CodexSession): SessionBinding {
    const now = new Date().toISOString();
    const binding = this.sessionBindings.bindNewSession(routeKey, session);
    this.sessions.set(session.id, {
      session,
      routeKey,
      ownerRouteKey: routeKey,
      status: { type: "idle" },
      updatedAt: now,
    });
    return binding;
  }

  claimSessionOwner(routeKey: string, sessionId: string): ClaimSessionResult {
    return this.sessionBindings.claimSessionOwner(routeKey, sessionId);
  }

  activateOwnedSession(routeKey: string, session: CodexSession): ActivateSessionResult {
    const result = this.sessionBindings.activateOwnedSession(routeKey, session);
    if (!result.ok) return result;
    const existing = this.sessions.get(session.id);
    this.sessions.set(session.id, {
      session,
      routeKey,
      ownerRouteKey: routeKey,
      status: existing?.status ?? { type: "idle" },
      updatedAt: new Date().toISOString(),
      lastError: existing?.lastError,
    });
    return result;
  }

  rollbackSessionOwnerClaim(routeKey: string, sessionId: string): void {
    this.sessionBindings.rollbackClaim(routeKey, sessionId);
  }

  getBinding(routeKey: string): SessionBinding | undefined {
    return this.sessionBindings.getActive(routeKey);
  }

  getSessionOwner(sessionId: string): SessionOwner | undefined {
    return this.sessionBindings.getOwner(sessionId);
  }

  getSession(sessionId: string): StoredSession | undefined {
    return this.sessions.get(sessionId);
  }

  setSessionStatus(sessionId: string, status: CodexSessionStatus): void {
    const stored = this.sessions.get(sessionId);
    if (!stored) return;
    this.sessions.set(sessionId, {
      ...stored,
      status,
      updatedAt: new Date().toISOString(),
      lastError: status.type === "failed" ? status.error : stored.lastError,
    });
  }

  listSessions(routeKey?: string): StoredSession[] {
    const sessions = [...this.sessions.values()];
    if (!routeKey) return sessions;
    const owned = new Set(this.sessionBindings.listRouteSessions(routeKey));
    return sessions.filter((item) => owned.has(item.session.id) || item.ownerRouteKey === routeKey || item.routeKey === routeKey);
  }
}
