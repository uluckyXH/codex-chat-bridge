import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import type { ChannelMedia, ChannelMessage, ChannelTarget } from "../../protocol/channel.js";
import type { TranscriptSink } from "../../logging/transcript.js";
import type { Logger } from "../../logging/logger.js";
import type { CodexCliStatus, CodexRunPolicy } from "../../codex/codex-cli.js";
import { formatCodexCommandSource, formatCodexPlatform } from "../../codex/codex-process.js";
import { formatLocalClock } from "../../time/display-time.js";
import { Frame, KeyValue, Muted, Section, THEME } from "./ui-components.js";

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
  codexStatus?: CodexCliStatus;
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

  clear(): void {
    this.entries.splice(0, this.entries.length);
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

export function RuntimeLogView({ summary, store, interactive = true }: { summary: RuntimeLogSummary; store: RuntimeLogStore; interactive?: boolean }): React.JSX.Element {
  const [logs, setLogs] = useState<RuntimeLogEntry[]>(store.snapshot());
  const [scrollOffset, setScrollOffset] = useState(0);
  useEffect(() => store.subscribe(() => setLogs(store.snapshot())), [store]);
  // fixed: Frame(4) + "运行状态" section(3) + status line(1) + "服务" section(3) + 6 KeyValues(6) + "日志" section(3) + footer(2) = 22
  const { rows } = useWindowSize();
  const visibleCount = Math.max(5, rows - 22);
  useInput((input, key) => {
    const maxScroll = Math.max(0, logs.length - visibleCount);
    const pageKey = key as typeof key & { pageUp?: boolean; pageDown?: boolean; end?: boolean };
    if (key.upArrow) {
      setScrollOffset((value) => Math.min(maxScroll, value + 1));
      return;
    }
    if (key.downArrow) {
      setScrollOffset((value) => Math.max(0, value - 1));
      return;
    }
    if (pageKey.pageUp) {
      setScrollOffset((value) => Math.min(maxScroll, value + visibleCount));
      return;
    }
    if (pageKey.pageDown) {
      setScrollOffset((value) => Math.max(0, value - visibleCount));
      return;
    }
    if (pageKey.end) {
      setScrollOffset(0);
      return;
    }
    if (input === "c") {
      store.clear();
      setScrollOffset(0);
    }
  }, { isActive: interactive });
  useEffect(() => {
    setScrollOffset((value) => Math.min(value, Math.max(0, logs.length - visibleCount)));
  }, [logs.length]);
  const visibleLogs = useMemo(() => {
    const end = Math.max(0, logs.length - scrollOffset);
    return logs.slice(Math.max(0, end - visibleCount), end);
  }, [logs, scrollOffset]);
  return (
    <Box flexDirection="column">
      <Frame title={summary.title} subtitle="已启动  Ctrl+C 停止" borderColor={THEME.success}>
        <Section title="运行状态">
          <Text color={THEME.success} bold>▶ Chat Codex 已启动，正在等待微信 / 飞书消息。</Text>
        </Section>
        <Section title="服务">
          <KeyValue label="渠道" value={summary.channels.length ? summary.channels.join(", ") : "无"} />
          <KeyValue label="平台" value={formatCodexPlatform(summary.codexStatus)} />
          <KeyValue label="Codex CLI" value={formatRuntimeCodexStatus(summary.codexStatus)} />
          <KeyValue label="新聊天策略" value={summary.routePolicy} />
          <KeyValue label="默认权限" value={formatPolicy(summary.policy)} />
          <KeyValue label="工作目录" value={summary.cwd} />
        </Section>
        <Section title="日志">
          {visibleLogs.length ? visibleLogs.map((entry) => <RuntimeLogRow key={entry.id} entry={entry} />) : <Muted text="暂无消息。启动后在微信或飞书里发消息，日志会显示在这里。" />}
        </Section>
      </Frame>
      <Box marginTop={1} flexDirection="column">
        <Text color={THEME.muted}>等待微信 / 飞书消息。收到消息、回复、进度和媒体发送都会在这里追加。</Text>
        <Text color={THEME.muted}>↑↓ 滚动  PgUp/PgDn 翻页  End 最新  c 清屏  Ctrl+C 停止服务</Text>
      </Box>
    </Box>
  );
}

function formatRuntimeCodexStatus(status?: CodexCliStatus): string {
  if (!status) return "尚未检测";
  const state = status.available ? "已找到" : "不可用";
  const version = status.available ? status.version ?? "版本未知" : status.error ?? "unknown error";
  return `${state}，${version}，${status.codexBin}，${formatCodexCommandSource(status.codexBinSource)}`;
}

function RuntimeLogRow({ entry }: { entry: RuntimeLogEntry }): React.JSX.Element {
  const color = entry.kind === "error"
    ? THEME.danger
    : entry.kind === "inbound"
      ? THEME.inbound
      : entry.kind === "outbound"
        ? THEME.outbound
        : entry.kind === "progress"
          ? THEME.progressLog
          : entry.kind === "media"
            ? THEME.media
            : THEME.muted;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color}>{formatLocalClock(entry.time)}  {kindLabel(entry.kind)}  {entry.source}</Text>
      {(entry.message.trim() || "空消息").split(/\r?\n/).map((line, index) => <Text key={index} wrap="wrap">  {line}</Text>)}
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
  return message.sender.displayName ?? message.sender.id;
}

function formatConversation(target: ChannelTarget): string {
  return `${target.conversation.kind}:${target.conversation.id}`;
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
