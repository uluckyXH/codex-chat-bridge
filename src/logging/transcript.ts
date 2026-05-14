import type { Writable } from "node:stream";
import { stdout } from "node:process";
import type { ChannelMedia, ChannelMessage, ChannelTarget } from "../protocol/channel.js";

export interface TranscriptSink {
  inbound(message: ChannelMessage, text: string): void;
  outbound(target: ChannelTarget, text: string): void;
  outboundMedia?(target: ChannelTarget, media: ChannelMedia): void;
}

export interface ConsoleTranscriptSinkOptions {
  output?: Writable;
  verbose?: boolean;
  maxTextLength?: number;
  now?: () => Date;
}

export class ConsoleTranscriptSink implements TranscriptSink {
  private readonly output: Writable;
  private readonly verbose: boolean;
  private readonly maxTextLength: number;
  private readonly now: () => Date;

  constructor(optionsOrOutput: Writable | ConsoleTranscriptSinkOptions = stdout) {
    if (isWritable(optionsOrOutput)) {
      this.output = optionsOrOutput;
      this.verbose = false;
      this.maxTextLength = 3000;
      this.now = () => new Date();
    } else {
      this.output = optionsOrOutput.output ?? stdout;
      this.verbose = optionsOrOutput.verbose ?? false;
      this.maxTextLength = optionsOrOutput.maxTextLength ?? 3000;
      this.now = optionsOrOutput.now ?? (() => new Date());
    }
  }

  inbound(message: ChannelMessage, text: string): void {
    this.writeBlock([
      this.header(channelLabel(message.channelId), "<=", displaySender(message), formatConversation(message.conversation.kind, message.conversation.id)),
      this.verbose ? `route: ${message.routeKey}` : undefined,
      this.verbose ? `sender: ${message.sender.id}` : undefined,
      ...this.bodyLines(text),
    ]);
  }

  outbound(target: ChannelTarget, text: string): void {
    this.writeBlock([
      this.header(channelLabel(target.channelId), "=>", formatConversation(target.conversation.kind, target.conversation.id), classifyOutbound(text)),
      this.verbose ? `route: ${target.routeKey}` : undefined,
      ...this.bodyLines(text),
    ]);
  }

  outboundMedia(target: ChannelTarget, media: ChannelMedia): void {
    const mediaName = media.name ?? media.path ?? media.url ?? "";
    this.writeBlock([
      this.header(channelLabel(target.channelId), "=>", formatConversation(target.conversation.kind, target.conversation.id), `媒体 ${media.type}`),
      this.verbose ? `route: ${target.routeKey}` : undefined,
      ...this.bodyLines([
        mediaName ? `文件: ${mediaName}` : undefined,
        media.path ? `路径: ${media.path}` : undefined,
        media.url ? `URL: ${media.url}` : undefined,
        media.mimeType ? `类型: ${media.mimeType}` : undefined,
        media.sizeBytes !== undefined ? `大小: ${media.sizeBytes} bytes` : undefined,
        media.caption ? `说明: ${media.caption}` : undefined,
      ].filter((line): line is string => Boolean(line)).join("\n")),
    ]);
  }

  private header(channel: string, direction: "<=" | "=>", subject: string, detail: string): string {
    return `[${formatClock(this.now())}] ${channel} ${direction} ${subject} | ${detail}`;
  }

  private writeBlock(lines: Array<string | undefined>): void {
    this.output.write(`\n${lines.filter((line): line is string => Boolean(line)).join("\n")}\n`);
  }

  private bodyLines(text: string): string[] {
    const normalized = truncateText(text.trim(), this.maxTextLength);
    if (!normalized) return [];
    return normalized.split(/\r?\n/).map((line) => `  ${line}`);
  }
}

function isWritable(value: Writable | ConsoleTranscriptSinkOptions): value is Writable {
  return typeof (value as Writable).write === "function";
}

function channelLabel(channelId: string): string {
  if (channelId === "weixin") return "微信";
  if (channelId === "terminal") return "终端";
  if (channelId === "mock") return "Mock";
  return channelId;
}

function displaySender(message: ChannelMessage): string {
  return shorten(message.sender.displayName ?? message.sender.id, 32);
}

function formatConversation(kind: string, id: string): string {
  return `${kind}:${shorten(id, 32)}`;
}

function classifyOutbound(text: string): string {
  if (text.startsWith("Codex 正在处理")) return "开始";
  if (text.startsWith("Codex 进度:")) return "进度";
  if (text.startsWith("Codex 请求审批")) return "审批";
  if (text.startsWith("审批已处理")) return "审批";
  if (text.startsWith("已加入队列")) return "队列";
  if (text.startsWith("Codex 执行失败")) return "错误";
  if (text.startsWith("已请求停止")) return "停止";
  if (text.startsWith("当前") || text.startsWith("可用命令:") || text.startsWith("Bridge:")) return "命令回复";
  return "回复";
}

function formatClock(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function shorten(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 12))}\n...已截断`;
}
