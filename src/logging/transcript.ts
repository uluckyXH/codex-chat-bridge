import type { Writable } from "node:stream";
import { stdout } from "node:process";
import type { ChannelMessage, ChannelTarget } from "../protocol/channel.js";

export interface TranscriptSink {
  inbound(message: ChannelMessage, text: string): void;
  outbound(target: ChannelTarget, text: string): void;
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

  private header(direction: "IN" | "OUT", channelId: string): string {
    return `[${new Date().toISOString()}] [${channelId} ${direction}]`;
  }

  private writeBlock(lines: string[]): void {
    this.output.write(`\n${lines.join("\n")}\n`);
  }
}
