import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { ChannelMedia, ChannelMessage, ChannelTarget } from "../../protocol/channel.js";
import type { TranscriptSink } from "../../logging/transcript.js";
import type { Logger } from "../../logging/logger.js";
import type { CodexRunPolicy } from "../../codex/codex-cli.js";
import { Frame, KeyValue, Muted, Section, truncate } from "./ui-components.js";

export type RuntimeLogKind = "system" | "inbound" | "outbound" | "progress" | "media" | "error";

export interface RuntimeLogEntry {
  id: number;
  time: Date;
  kind: RuntimeLogKind;
  source: string;
  message: string;
}

export interface RuntimeLogSummary {
  title: string;
  channels: string[];
  cwd: string;
  policy: CodexRunPolicy;
  routePolicy: string;
}

export class RuntimeLogStore {
  private readonly listeners = new Set<() => void>();
  private readonly entries: RuntimeLogEntry[] = [];
  private nextId = 1;

  add(kind: RuntimeLogKind, source: string, message: string): void {
    this.entries.push({
      id: this.nextId,
      time: new Date(),
      kind,
      source,
      message,
    });
    this.nextId += 1;
    if (this.entries.length > 300) this.entries.splice(0, this.entries.length - 300);
    for (const listener of this.listeners) listener();
  }

  snapshot(): RuntimeLogEntry[] {
    return [...this.entries];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class RuntimeTuiTranscriptSink implements TranscriptSink {
  constructor(private readonly store: RuntimeLogStore) {}

  inbound(message: ChannelMessage, text: string): void {
    this.store.add("inbound", `${channelLabel(message.channelId)} <= ${displaySender(message)}`, text);
  }

  outbound(target: ChannelTarget, text: string): void {
    this.store.add("outbound", `${channelLabel(target.channelId)} => ${formatConversation(target)}`, text);
  }

  localProgress(target: ChannelTarget, text: string): void {
    this.store.add("progress", `${channelLabel(target.channelId)} -- ${formatConversation(target)}`, text);
  }

  outboundMedia(target: ChannelTarget, media: ChannelMedia): void {
    const mediaName = media.name ?? media.path ?? media.url ?? "未命名媒体";
    this.store.add("media", `${channelLabel(target.channelId)} => ${formatConversation(target)}`, `${media.type}: ${mediaName}`);
  }
}

export class RuntimeTuiLogger implements Logger {
  constructor(private readonly store: RuntimeLogStore) {}

  info(message: string, meta?: Record<string, unknown>): void {
    this.store.add("system", "INFO", formatLogMessage(message, meta));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.store.add("progress", "WARN", formatLogMessage(message, meta));
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.store.add("error", "ERROR", formatLogMessage(message, meta));
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.store.add("system", "DEBUG", formatLogMessage(message, meta));
  }
}

export function RuntimeLogView({ summary, store }: { summary: RuntimeLogSummary; store: RuntimeLogStore }): React.JSX.Element {
  const { exit } = useApp();
  const [logs, setLogs] = useState<RuntimeLogEntry[]>(store.snapshot());
  useEffect(() => store.subscribe(() => setLogs(store.snapshot())), [store]);
  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
  });
  const visibleLogs = useMemo(() => logs.slice(-12), [logs]);
  return (
    <Box flexDirection="column">
      <Frame title={summary.title} subtitle="运行中  q/Esc 退出">
        <Section title="服务">
          <KeyValue label="渠道" value={summary.channels.length ? summary.channels.join(", ") : "无"} />
          <KeyValue label="新聊天策略" value={summary.routePolicy} />
          <KeyValue label="默认权限" value={formatPolicy(summary.policy)} />
          <KeyValue label="工作目录" value={summary.cwd} />
        </Section>
        <Section title="日志">
          {visibleLogs.length ? visibleLogs.map((entry) => <RuntimeLogRow key={entry.id} entry={entry} />) : <Muted text="暂无消息。启动后在微信或飞书里发消息，日志会显示在这里。" />}
        </Section>
      </Frame>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">等待微信 / 飞书消息。收到消息、回复、进度和媒体发送都会在这里追加。</Text>
        <Text color="gray">q/Esc 停止服务并退出。</Text>
      </Box>
    </Box>
  );
}

function RuntimeLogRow({ entry }: { entry: RuntimeLogEntry }): React.JSX.Element {
  const color = entry.kind === "error"
    ? "red"
    : entry.kind === "inbound"
      ? "cyan"
      : entry.kind === "outbound"
        ? "green"
        : entry.kind === "progress"
          ? "yellow"
          : "gray";
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color}>{formatClock(entry.time)}  {kindLabel(entry.kind)}  {truncate(entry.source, 48)}</Text>
      {truncate(entry.message.trim() || "空消息", 84).split(/\r?\n/).map((line, index) => <Text key={index}>  {line}</Text>)}
    </Box>
  );
}

function kindLabel(kind: RuntimeLogKind): string {
  if (kind === "system") return "系统";
  if (kind === "inbound") return "收到";
  if (kind === "outbound") return "发送";
  if (kind === "progress") return "进度";
  if (kind === "media") return "媒体";
  return "错误";
}

function channelLabel(channelId: string): string {
  if (channelId.startsWith("weixin")) return "微信";
  if (channelId.startsWith("feishu")) return "飞书";
  return channelId;
}

function displaySender(message: ChannelMessage): string {
  return truncate(message.sender.displayName ?? message.sender.id, 32);
}

function formatConversation(target: ChannelTarget): string {
  return `${target.conversation.kind}:${truncate(target.conversation.id, 28)}`;
}

function formatClock(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function formatPolicy(policy: CodexRunPolicy): string {
  if (policy.permissionMode === "full") return "完全权限";
  return `审批模式（${policy.sandbox ?? "workspace-write"} 沙箱）`;
}

function formatLogMessage(message: string, meta?: Record<string, unknown>): string {
  if (!meta) return message;
  return `${message} ${Object.entries(redact(meta)).map(([key, value]) => `${key}=${formatMetaValue(value)}`).join(" ")}`;
}

function redact(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = /token|cookie|secret|password|authorization/i.test(key) ? "[redacted]" : item;
  }
  return result;
}

function formatMetaValue(value: unknown): string {
  if (typeof value === "string") return value.includes(" ") ? JSON.stringify(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return JSON.stringify(value);
}
