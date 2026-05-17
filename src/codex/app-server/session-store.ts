import { discoverCodexSessions, displayCodexSessionTitle } from "../codex-cli.js";
import type { CodexSessionStatus, CodexSessionSummary } from "../types.js";
import type { AppServerSessionRecord } from "./types.js";

export class AppServerSessionStore {
  readonly records = new Map<string, AppServerSessionRecord>();
  readonly threadToSession = new Map<string, string>();

  get(sessionId: string): AppServerSessionRecord | undefined {
    return this.records.get(sessionId);
  }

  set(sessionId: string, record: AppServerSessionRecord): void {
    this.records.set(sessionId, record);
  }

  has(sessionId: string): boolean {
    return this.records.has(sessionId);
  }

  mapThread(threadId: string, sessionId: string): void {
    this.threadToSession.set(threadId, sessionId);
  }

  resolveThreadSession(threadId: string): string {
    return this.threadToSession.get(threadId) ?? threadId;
  }

  getStatus(sessionId: string): CodexSessionStatus {
    return this.records.get(sessionId)?.status ?? { type: "unknown", detail: "session not found" };
  }

  listSessions(routeKey: string | undefined, codexHome: string | undefined): CodexSessionSummary[] {
    const localSessions = [...this.records.values()].filter((record) => (routeKey ? record.routeKey === routeKey : true)).map((record) => ({
      id: record.session.id,
      routeKey: record.routeKey,
      title: record.session.title,
      cwd: record.session.cwd,
      status: record.status,
      updatedAt: record.updatedAt,
    }));
    if (routeKey) return localSessions;

    const seen = new Set(localSessions.map((session) => session.id));
    const discoveredSessions = discoverCodexSessions({ codexHome })
      .filter((session) => !seen.has(session.id))
      .map((session) => ({
        id: session.id,
        title: displayCodexSessionTitle(session),
        cwd: session.cwd,
        status: { type: "unknown" as const, detail: "history" },
        updatedAt: session.updatedAt ?? "",
      }));
    return [...localSessions, ...discoveredSessions];
  }
}
