import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  CodexAdapter,
  CodexEvent,
  CodexSession,
  CodexSessionStatus,
  CodexSessionSummary,
  StartSessionInput,
} from "./types.js";
import { buildCodexRootArgs, type CodexRunPolicy } from "./codex-cli.js";

export interface ExecCodexAdapterOptions {
  codexBin?: string;
  runPolicy?: CodexRunPolicy;
}

interface ExecSessionRecord {
  session: CodexSession;
  routeKey?: string;
  status: CodexSessionStatus;
  actualThreadId?: string;
  updatedAt: string;
}

export class ExecCodexAdapter implements CodexAdapter {
  private readonly codexBin: string;
  private readonly runPolicy: CodexRunPolicy;
  private readonly sessions = new Map<string, ExecSessionRecord>();

  constructor(options: ExecCodexAdapterOptions = {}) {
    this.codexBin = options.codexBin ?? "codex";
    this.runPolicy = options.runPolicy ?? { permissionMode: "approval", sandbox: "workspace-write" };
  }

  async startSession(input: StartSessionInput): Promise<CodexSession> {
    const session: CodexSession = {
      id: `exec-local-${Date.now()}`,
      cwd: input.cwd,
      title: input.title,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, {
      session,
      routeKey: input.routeKey,
      status: { type: "idle" },
      updatedAt: session.createdAt,
    });
    return session;
  }

  async resumeSession(sessionId: string): Promise<CodexSession> {
    const stored = this.sessions.get(sessionId);
    if (stored) return stored.session;
    const now = new Date().toISOString();
    const session: CodexSession = {
      id: sessionId,
      cwd: process.cwd(),
      title: `codex:${sessionId}`,
      createdAt: now,
    };
    this.sessions.set(session.id, {
      session,
      status: { type: "idle" },
      actualThreadId: sessionId,
      updatedAt: now,
    });
    return session;
  }

  async *run(sessionId: string, prompt: string): AsyncIterable<CodexEvent> {
    const stored = this.sessions.get(sessionId);
    if (!stored) throw new Error(`exec session not found locally: ${sessionId}`);
    const session = stored.session;
    const turnId = `exec-turn-${Date.now()}`;
    stored.status = { type: "running", turnId };
    stored.updatedAt = new Date().toISOString();
    yield { type: "turn.started", sessionId, turnId };

    const args = this.buildArgs(stored, prompt);
    const child = spawn(this.codexBin, args, {
      cwd: session.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let finalText = "";
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const lines = createInterface({ input: child.stdout });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const parsed = parseExecJsonLine(line, sessionId, turnId);
      if (parsed?.threadId) {
        stored.actualThreadId = parsed.threadId;
        stored.updatedAt = new Date().toISOString();
      }
      const event = parsed?.event;
      if (!event) continue;
      if (event.type === "assistant.completed") finalText = event.text;
      if (event.type === "turn.failed") stored.status = { type: "failed", error: event.error };
      yield event;
    }

    const code = await new Promise<number | null>((resolve) => {
      child.on("close", resolve);
    });
    if (code === 0) {
      stored.status = { type: "idle" };
      stored.updatedAt = new Date().toISOString();
      yield { type: "turn.completed", sessionId, turnId };
    } else {
      const error = stderr || `codex exec exited with code ${code}`;
      stored.status = { type: "failed", error };
      stored.updatedAt = new Date().toISOString();
      yield { type: "turn.failed", sessionId, turnId, error };
    }
    void finalText;
  }

  async getStatus(sessionId: string): Promise<CodexSessionStatus> {
    return this.sessions.get(sessionId)?.status ?? { type: "unknown", detail: "session not found" };
  }

  async listSessions(routeKey?: string): Promise<CodexSessionSummary[]> {
    return [...this.sessions.values()].filter((record) => (routeKey ? record.routeKey === routeKey : true)).map((record) => ({
      id: record.session.id,
      routeKey: record.routeKey,
      title: record.session.title,
      status: record.status,
      updatedAt: record.updatedAt,
    }));
  }

  private buildArgs(stored: ExecSessionRecord, prompt: string): string[] {
    const rootArgs = buildCodexRootArgs(this.runPolicy);
    if (stored.actualThreadId) {
      return [...rootArgs, "exec", "resume", "--json", "--skip-git-repo-check", "--all", stored.actualThreadId, prompt];
    }
    return [...rootArgs, "exec", "--json", "--cd", stored.session.cwd, "--skip-git-repo-check", prompt];
  }
}

export interface ParsedExecJsonLine {
  threadId?: string;
  event?: CodexEvent;
}

export function parseExecJsonLine(line: string, sessionId: string, turnId: string): ParsedExecJsonLine | undefined {
  try {
    const parsed = JSON.parse(line) as {
      type?: string;
      thread_id?: string;
      item?: { type?: string; text?: string };
      error?: { message?: string };
      message?: string;
    };
    if (parsed.type === "thread.started" && parsed.thread_id) {
      return { threadId: parsed.thread_id };
    }
    if (parsed.type === "item.completed" && parsed.item?.type === "agent_message" && parsed.item.text) {
      return { event: { type: "assistant.completed", sessionId, turnId, text: parsed.item.text } };
    }
    if (parsed.type === "turn.failed") {
      return { event: { type: "turn.failed", sessionId, turnId, error: parsed.error?.message ?? "codex turn failed" } };
    }
    if (parsed.type === "error") {
      return { event: { type: "turn.failed", sessionId, turnId, error: parsed.message ?? "codex exec error" } };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
