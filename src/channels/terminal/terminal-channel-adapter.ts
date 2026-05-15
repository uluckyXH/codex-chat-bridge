import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelLoginResult,
  ChannelMessage,
  ChannelMessageHandler,
  ChannelStatus,
  ChannelTarget,
  SendOptions,
  SendResult,
} from "../../protocol/channel.js";
import { buildRouteKey } from "../../protocol/channel.js";

export interface TerminalChannelAdapterOptions {
  input?: Readable;
  output?: Writable;
  accountId?: string;
  senderId?: string;
  senderName?: string;
  conversationId?: string;
  prompt?: string;
  exitCommands?: string[];
}

export class TerminalChannelAdapter implements ChannelAdapter {
  readonly id = "terminal";
  readonly label = "Terminal Channel";
  private readonly input: Readable;
  private readonly output: Writable;
  private readonly accountId: string;
  private readonly senderId: string;
  private readonly senderName: string;
  private readonly conversationId: string;
  private readonly prompt: string;
  private readonly interactive: boolean;
  private readonly exitCommands: Set<string>;
  private handler?: ChannelMessageHandler;
  private readline?: Interface;
  private inboundSequence = 0;
  private outboundSequence = 0;
  private closeResolver?: () => void;
  private readonly closed: Promise<void>;
  private lineQueue: Promise<void> = Promise.resolve();
  private status: ChannelStatus = { channelId: this.id, state: "stopped" };

  constructor(options: TerminalChannelAdapterOptions = {}) {
    this.input = options.input ?? stdin;
    this.output = options.output ?? stdout;
    this.accountId = options.accountId ?? "local-terminal";
    this.senderId = options.senderId ?? "terminal-user";
    this.senderName = options.senderName ?? "Terminal User";
    this.conversationId = options.conversationId ?? "terminal";
    this.prompt = options.prompt ?? "wechat> ";
    this.interactive = Boolean((this.output as Writable & { isTTY?: boolean }).isTTY);
    this.exitCommands = new Set(options.exitCommands ?? ["/exit", "/quit"]);
    this.closed = new Promise((resolve) => {
      this.closeResolver = resolve;
    });
  }

  async start(): Promise<void> {
    if (this.readline) return;
    this.status = { ...this.status, state: "connected", account: this.accountId };
    this.readline = createInterface({
      input: this.input,
      output: this.output,
      prompt: this.prompt,
      terminal: this.interactive,
    });
    this.readline.on("line", (line) => {
      this.lineQueue = this.lineQueue.then(() => this.handleLine(line)).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.status = { ...this.status, state: "degraded", lastError: message };
        this.output.write(`\n[Bridge Error]\n${message}\n\n`);
      });
    });
    this.readline.on("close", () => {
      void this.lineQueue.finally(() => {
        this.status = { ...this.status, state: "stopped" };
        this.closeResolver?.();
      });
    });
    this.output.write("本地终端通道已启动。输入 /help 查看命令，输入 /exit 退出。\n");
    if (this.interactive) this.readline.prompt();
  }

  async stop(): Promise<void> {
    if (!this.readline) {
      this.status = { ...this.status, state: "stopped" };
      this.closeResolver?.();
      return;
    }
    const readline = this.readline;
    this.readline = undefined;
    readline.close();
  }

  async waitUntilClosed(): Promise<void> {
    await this.closed;
  }

  async login(): Promise<ChannelLoginResult> {
    this.status = { ...this.status, state: "connected", account: this.accountId };
    return { state: "connected", message: "terminal channel does not require login" };
  }

  async getStatus(): Promise<ChannelStatus> {
    return this.status;
  }

  getCapabilities(): ChannelCapabilities {
    return {
      text: true,
      media: false,
      typing: false,
      direct: true,
      group: false,
      thread: false,
      login: "none",
      messageUpdate: false,
      streamingHint: false,
    };
  }

  onMessage(handler: ChannelMessageHandler): void {
    this.handler = handler;
  }

  async sendText(target: ChannelTarget, text: string, options?: SendOptions): Promise<SendResult> {
    this.outboundSequence += 1;
    const result: SendResult = {
      channelId: this.id,
      messageId: `terminal-out-${this.outboundSequence}`,
      deliveredAt: new Date().toISOString(),
    };
    this.status = { ...this.status, lastOutboundAt: result.deliveredAt };
    this.output.write(`\n[Codex]\n${text}\n\n`);
    if (this.interactive) this.readline?.prompt();
    void target;
    void options;
    return result;
  }

  async emitText(text: string): Promise<ChannelMessage> {
    if (!this.handler) throw new Error("terminal channel handler is not registered");
    this.inboundSequence += 1;
    const timestamp = new Date().toISOString();
    const routeKey = buildRouteKey({
      channelId: this.id,
      accountId: this.accountId,
      conversationKind: "direct",
      conversationId: this.conversationId,
    });
    const message: ChannelMessage = {
      id: `terminal-in-${this.inboundSequence}`,
      routeKey,
      channelId: this.id,
      accountId: this.accountId,
      sender: { id: this.senderId, displayName: this.senderName },
      conversation: { id: this.conversationId, kind: "direct", displayName: "Local Terminal" },
      text,
      timestamp,
    };
    this.status = { ...this.status, lastInboundAt: timestamp };
    await this.handler(message);
    return message;
  }

  private async handleLine(line: string): Promise<void> {
    const text = line.trim();
    if (!text) {
      if (this.interactive) this.readline?.prompt();
      return;
    }
    if (this.exitCommands.has(text)) {
      await this.stop();
      return;
    }
    this.readline?.pause();
    try {
      await this.emitText(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = { ...this.status, state: "degraded", lastError: message };
      this.output.write(`\n[Bridge Error]\n${message}\n\n`);
    } finally {
      this.readline?.resume();
      if (this.interactive) this.readline?.prompt();
    }
  }
}
