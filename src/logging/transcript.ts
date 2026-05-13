import type { Writable } from "node:stream";
import { stdout } from "node:process";
import type { ChannelMedia, ChannelMessage, ChannelTarget } from "../protocol/channel.js";

export interface TranscriptSink {
  inbound(message: ChannelMessage, text: string): void;
  outbound(target: ChannelTarget, text: string): void;
  outboundMedia?(target: ChannelTarget, media: ChannelMedia): void;
}

export class ConsoleTranscriptSink implements TranscriptSink {
  constructor(private readonly output: Writable = stdout) {}

  inbound(message: ChannelMessage, text: string): void {
    this.writeBlock([
      this.header("IN", message.channelId),
      `Route: ${message.routeKey}`,
      `From: ${message.sender.displayName ?? message.sender.id} (${message.sender.id})`,
      `Conversation: ${message.conversation.kind}:${message.conversation.id}`,
      text,
    ]);
  }

  outbound(target: ChannelTarget, text: string): void {
    this.writeBlock([
      this.header("OUT", target.channelId),
      `To: ${target.conversation.kind}:${target.conversation.id}`,
      text,
    ]);
  }

  outboundMedia(target: ChannelTarget, media: ChannelMedia): void {
    this.writeBlock([
      this.header("OUT", target.channelId),
      `To: ${target.conversation.kind}:${target.conversation.id}`,
      `Media: ${media.type} ${media.name ?? media.path ?? media.url ?? ""}`,
      media.path ? `Path: ${media.path}` : undefined,
      media.url ? `Url: ${media.url}` : undefined,
      media.mimeType ? `Mime: ${media.mimeType}` : undefined,
      media.sizeBytes !== undefined ? `Size: ${media.sizeBytes} bytes` : undefined,
      media.caption ? `Caption: ${media.caption}` : undefined,
    ]);
  }

  private header(direction: "IN" | "OUT", channelId: string): string {
    return `[${new Date().toISOString()}] [${channelId} ${direction}]`;
  }

  private writeBlock(lines: Array<string | undefined>): void {
    this.output.write(`\n${lines.filter((line): line is string => Boolean(line)).join("\n")}\n`);
  }
}
