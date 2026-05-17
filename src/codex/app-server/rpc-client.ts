import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Interface as ReadlineInterface } from "node:readline";
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, PendingResponse } from "./types.js";

export interface AppServerRpcClientOptions {
  codexBin: string;
  requestTimeoutMs: number;
  onServerRequest: (request: JsonRpcRequest) => Promise<void> | void;
  onNotification: (notification: JsonRpcNotification) => void;
  onFatalError: (error: Error) => void;
}

export class AppServerRpcClient {
  private readonly codexBin: string;
  private readonly requestTimeoutMs: number;
  private readonly onServerRequest: (request: JsonRpcRequest) => Promise<void> | void;
  private readonly onNotification: (notification: JsonRpcNotification) => void;
  private readonly onFatalError: (error: Error) => void;
  private readonly pendingResponses = new Map<string, PendingResponse>();
  private requestSequence = 0;
  private child?: ChildProcess;
  private stdoutLines?: ReadlineInterface;
  private stderr = "";
  private initialized?: Promise<void>;
  private stopping = false;

  constructor(options: AppServerRpcClientOptions) {
    this.codexBin = options.codexBin;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.onServerRequest = options.onServerRequest;
    this.onNotification = options.onNotification;
    this.onFatalError = options.onFatalError;
  }

  start(): Promise<void> {
    this.initialized ??= this.startProcessAndInitialize();
    return this.initialized;
  }

  stop(): void {
    this.stopping = true;
    for (const pending of this.pendingResponses.values()) {
      pending.reject(new Error("codex app-server stopped"));
    }
    this.pendingResponses.clear();
    this.stdoutLines?.close();
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.child = undefined;
    this.initialized = undefined;
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    options: { timeoutMs?: number; onResult?: (value: unknown) => void } = {},
  ): Promise<T> {
    await this.ensureChildOpen();
    const id = `ccbridge-${++this.requestSequence}`;
    const message: JsonRpcRequest = { id, method, ...(params !== undefined ? { params } : {}) };
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<T>((resolve, reject) => {
      this.pendingResponses.set(id, {
        resolve: (value) => {
          if (timer) clearTimeout(timer);
          try {
            options.onResult?.(value);
            resolve(value as T);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        reject: (error) => {
          if (timer) clearTimeout(timer);
          reject(error);
        },
      });
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pendingResponses.delete(id);
          reject(new Error(`codex app-server request timed out: ${method}`));
        }, timeoutMs);
        timer.unref?.();
      }
    });
    try {
      this.writeMessage(message);
    } catch (error) {
      if (timer) clearTimeout(timer);
      this.pendingResponses.delete(id);
      throw error;
    }
    return promise;
  }

  writeMessage(message: unknown): void {
    if (!this.child?.stdin || this.child.stdin.destroyed) {
      throw new Error("codex app-server stdin is closed");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async startProcessAndInitialize(): Promise<void> {
    this.stopping = false;
    this.stderr = "";
    this.child = spawn(this.codexBin, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    this.child.on("error", (error) => this.handleProcessEnd(error));
    this.child.on("close", (code) => {
      this.handleProcessEnd(new Error(this.stderr.trim() || `codex app-server exited with code ${code}`));
    });
    if (!this.child.stdout || !this.child.stdin) throw new Error("failed to start codex app-server stdio");
    this.stdoutLines = createInterface({ input: this.child.stdout });
    void this.readLoop();
    await this.request("initialize", {
      clientInfo: {
        name: "codex-chat-bridge",
        title: "Codex Chat Bridge",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: [
          "command/exec/outputDelta",
          "item/reasoning/textDelta",
        ],
      },
    });
    this.writeMessage({ method: "initialized" });
  }

  private handleProcessEnd(error: Error): void {
    if (this.stopping) {
      this.pendingResponses.clear();
      this.initialized = undefined;
      this.child = undefined;
      return;
    }
    for (const pending of this.pendingResponses.values()) pending.reject(error);
    this.pendingResponses.clear();
    this.initialized = undefined;
    this.child = undefined;
    this.onFatalError(error);
  }

  private async ensureChildOpen(): Promise<void> {
    if (!this.child?.stdin || this.child.killed) {
      throw new Error("codex app-server is not running");
    }
  }

  private async readLoop(): Promise<void> {
    if (!this.stdoutLines) return;
    try {
      for await (const line of this.stdoutLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const message = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcRequest | JsonRpcNotification;
        void this.handleMessage(message);
      }
    } catch (error) {
      if (this.stopping) return;
      const message = error instanceof Error ? error.message : String(error);
      for (const pending of this.pendingResponses.values()) pending.reject(new Error(message));
      this.pendingResponses.clear();
    }
  }

  private async handleMessage(message: JsonRpcResponse | JsonRpcRequest | JsonRpcNotification): Promise<void> {
    if ("id" in message && "method" in message) {
      await this.onServerRequest(message);
      return;
    }
    if ("id" in message) {
      const pending = this.pendingResponses.get(String(message.id));
      if (!pending) return;
      this.pendingResponses.delete(String(message.id));
      if ("error" in message && message.error) {
        pending.reject(new Error(message.error.message ?? `JSON-RPC error ${message.error.code ?? ""}`.trim()));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if ("method" in message) {
      this.onNotification(message);
    }
  }
}
