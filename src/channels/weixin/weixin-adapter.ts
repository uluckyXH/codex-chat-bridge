import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelLoginResult,
  ChannelMessageHandler,
  ChannelStatus,
  ChannelTarget,
  SendOptions,
  SendResult,
} from "../../protocol/channel.js";

export interface WeixinAdapterOptions {
  sourceVersion?: string;
}

export class WeixinAdapter implements ChannelAdapter {
  readonly id = "weixin";
  readonly label = "Weixin Adapter";
  private handler?: ChannelMessageHandler;
  private status: ChannelStatus;

  constructor(private readonly options: WeixinAdapterOptions = {}) {
    this.status = {
      channelId: this.id,
      state: "login_required",
      details: {
        source: "@tencent-weixin/openclaw-weixin",
        sourceVersion: options.sourceVersion ?? "2.4.3",
        phase: "adapter-shell",
      },
    };
  }

  async start(): Promise<void> {
    this.status = {
      ...this.status,
      state: "login_required",
      lastError: undefined,
    };
  }

  async stop(): Promise<void> {
    this.status = { ...this.status, state: "stopped" };
  }

  async login(): Promise<ChannelLoginResult> {
    this.status = {
      ...this.status,
      state: "login_required",
      details: {
        ...this.status.details,
        login: "not implemented in phase 1",
      },
    };
    return {
      state: "login_required",
      message: "WeixinAdapter 登录将在第二阶段实现；当前阶段只提供通用协议壳和状态提示。",
    };
  }

  async getStatus(): Promise<ChannelStatus> {
    return this.status;
  }

  getCapabilities(): ChannelCapabilities {
    return {
      text: true,
      media: true,
      typing: true,
      direct: true,
      group: false,
      login: "qr",
      messageUpdate: false,
      streamingHint: true,
    };
  }

  onMessage(handler: ChannelMessageHandler): void {
    this.handler = handler;
  }

  async sendText(_target: ChannelTarget, _text: string, _options?: SendOptions): Promise<SendResult> {
    throw new Error("WeixinAdapter 尚未登录或第二阶段发送能力尚未实现");
  }

  hasMessageHandler(): boolean {
    return Boolean(this.handler);
  }
}
