import type { CodexSession, CodexSessionStatus } from "../codex/types.js";

export interface SessionBinding {
  routeKey: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSession {
  session: CodexSession;
  routeKey?: string;
  status: CodexSessionStatus;
  updatedAt: string;
  lastError?: string;
}

export class MemoryStateStore {
  private readonly bindings = new Map<string, SessionBinding>();
  private readonly sessions = new Map<string, StoredSession>();

  bindSession(routeKey: string, session: CodexSession): SessionBinding {
    const now = new Date().toISOString();
    const existing = this.bindings.get(routeKey);
    const binding: SessionBinding = {
      routeKey,
      sessionId: session.id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.bindings.set(routeKey, binding);
    this.sessions.set(session.id, {
      session,
      routeKey,
      status: { type: "idle" },
      updatedAt: now,
    });
    return binding;
  }

  getBinding(routeKey: string): SessionBinding | undefined {
    return this.bindings.get(routeKey);
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
    return routeKey ? sessions.filter((item) => item.routeKey === routeKey) : sessions;
  }
}
