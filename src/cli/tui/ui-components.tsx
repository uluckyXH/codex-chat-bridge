import React from "react";
import { Box, Text, useStdout, useWindowSize } from "ink";
import type { CodexRunPolicy } from "../../codex/codex-cli.js";
import type { SelectableSessionChoice, SessionDisplay } from "../actions/binding-actions.js";
import { formatSessionActiveTime } from "../actions/binding-actions.js";
import type { Flash, Screen } from "./types.js";

// ─── Theme ───────────────────────────────────────────────────────────────────

export const THEME = {
  brand:        "#FF8C00",  // 品牌主色：橙色，边框、标题
  gold:         "#FFD700",  // 金色：分区标题、活跃光标 ❯
  activeText:   "#FFA500",  // 活跃橙：选中列表项文字
  success:      "#52C41A",  // 绿色：已连接、成功
  warning:      "#FAAD14",  // 琥珀色：待配置、警告
  danger:       "#FF4D4F",  // 红色：错误、失败
  dangerBright: "#FF7875",  // 亮红：破坏性操作
  inbound:      "#69B1FF",  // 蓝色：入站消息日志
  outbound:     "#95DE64",  // 亮绿：出站消息日志
  progressLog:  "#FFD666",  // 亮黄：进度日志
  media:        "#36CFC9",  // 青色：媒体日志
  muted:        "#888888",  // 深灰：次要文字、快捷键提示
} as const;

const FIELD_WIDTH = 22;

// ─── Layout helpers ───────────────────────────────────────────────────────────

function useTermWidth(): number {
  const { stdout } = useStdout();
  return stdout.columns ?? 80;
}

// ─── Core components ──────────────────────────────────────────────────────────

export function Frame({
  title,
  subtitle,
  children,
  borderColor = THEME.brand,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  borderColor?: string;
}): React.JSX.Element {
  const termWidth = useTermWidth();
  const frameWidth = Math.max(60, termWidth - 2);
  return (
    <Box borderStyle="round" borderColor={borderColor} paddingX={1} flexDirection="column" width={frameWidth}>
      <Box justifyContent="space-between">
        <Text bold color={borderColor}>◈ {title}</Text>
        {subtitle ? <Text color={THEME.muted}>{subtitle}</Text> : null}
      </Box>
      <Box marginTop={1} flexDirection="column">{children}</Box>
    </Box>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  const termWidth = useTermWidth();
  const dividerWidth = Math.max(20, termWidth - 8);
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold color={THEME.gold}>{title}</Text>
      <Text color={THEME.muted}>{"─".repeat(dividerWidth)}</Text>
      {children}
    </Box>
  );
}

export function ListRow({
  active,
  left,
  right,
  tone,
}: {
  active: boolean;
  left: string;
  right?: string;
  tone?: "default" | "primary" | "success" | "warning" | "danger" | "muted";
}): React.JSX.Element {
  const termWidth = useTermWidth();
  // Reserve 4 for border+padding, 2 for cursor, dynamic right column
  const rightWidth = right?.includes("最近") ? 40 : 32;
  const leftWidth = Math.max(20, termWidth - rightWidth - 10);
  const textColor = active ? THEME.activeText : rowToneColor(tone);
  return (
    <Box>
      <Text color={THEME.gold} bold>{active ? "❯ " : "  "}</Text>
      <Text color={textColor} bold={active || tone === "primary" || tone === "success"}>
        {padRight(truncate(left, leftWidth - 2), leftWidth)}
      </Text>
      {right ? (
        <Text color={active ? THEME.muted : rowToneColor(tone) ?? THEME.muted}>
          {truncate(right, rightWidth)}
        </Text>
      ) : null}
    </Box>
  );
}

export function SessionRow({
  active,
  index,
  session,
}: {
  active: boolean;
  index: number;
  session: SelectableSessionChoice;
}): React.JSX.Element {
  return (
    <ListRow
      active={active}
      left={`${index + 1}. ${session.current ? "当前" : "可用"}   ${session.title ?? session.id}`}
      right={`${session.shortId}  最近 ${formatSessionActiveTime(session.updatedAt)}`}
    />
  );
}

export function KeyValue({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <Text>
      <Text color={THEME.muted}>{padRight(truncate(label, FIELD_WIDTH), FIELD_WIDTH)}</Text>
      {"  "}
      <Text>{value}</Text>
    </Text>
  );
}

export function Footer({
  loading,
  flash,
  screen,
  context,
}: {
  loading: boolean;
  flash: Flash;
  screen: Screen["name"];
  context?: "firstRun" | "emptyChannels";
}): React.JSX.Element {
  const icon = flash.kind === "error" ? "✗ " : flash.kind === "success" ? "✓ " : "● ";
  const color = loading ? THEME.warning : flash.kind === "error" ? THEME.danger : flash.kind === "success" ? THEME.success : THEME.muted;
  const message = loading ? "⏳ 处理中..." : `${icon}${flash.message}`;
  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={color} bold={flash.kind !== "info" && !loading}>{message}</Text>
      <Text color={THEME.muted}>{footerHint(screen, context)}</Text>
    </Box>
  );
}

export function ConfirmBar({ message }: { message: string }): React.JSX.Element {
  return (
    <Box marginTop={1}>
      <Text color={THEME.warning} bold>⚠ {message}</Text>
    </Box>
  );
}

export function Muted({ text }: { text: string }): React.JSX.Element {
  return <Text color={THEME.muted}>{text}</Text>;
}

// ─── Format helpers ───────────────────────────────────────────────────────────

export function formatSession(session: SessionDisplay): string {
  return `${session.title ?? session.id} / ${session.shortId}`;
}

export function formatSessionWithActivity(session: SessionDisplay): string {
  return `${formatSession(session)}  最近 ${formatSessionActiveTime(session.updatedAt)}`;
}

export function formatPermission(policy: CodexRunPolicy): string {
  if (policy.permissionMode === "full") return "完全权限（跳过审批和沙箱，高风险）";
  return `审批模式（${policy.sandbox ?? "workspace-write"} 沙箱）`;
}

export function channelStatus(state: string): string {
  if (state === "connected") return "✓ 已连接";
  if (state === "login_required") return "⚠ 需要配置";
  if (state === "failed") return "✗ 异常";
  if (state === "stopped") return "— 已停止";
  return state;
}

export function statusColor(state: string): string {
  if (state === "connected") return THEME.success;
  if (state === "login_required") return THEME.warning;
  if (state === "failed") return THEME.danger;
  if (state === "stopped") return THEME.muted;
  return THEME.brand;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowToneColor(tone: "default" | "primary" | "success" | "warning" | "danger" | "muted" = "default"): string | undefined {
  if (tone === "primary") return THEME.brand;
  if (tone === "success") return THEME.success;
  if (tone === "warning") return THEME.warning;
  if (tone === "danger") return THEME.dangerBright;
  if (tone === "muted") return THEME.muted;
  return undefined;
}

export function truncate(value: string, width: number): string {
  if (displayWidth(value) <= width) return value;
  return `${sliceToWidth(value, Math.max(0, width - 1))}…`;
}

export function padRight(value: string, width: number): string {
  const length = displayWidth(value);
  return length >= width ? value : `${value}${" ".repeat(width - length)}`;
}

function footerHint(screen: Screen["name"], context?: "firstRun" | "emptyChannels"): string {
  if (context === "firstRun") return "↑↓ 选择  Enter 执行  1/w 微信  2/f 飞书  3/p 权限  4/d 工作目录  0/q 退出";
  if (context === "emptyChannels") return "↑↓ 选择  Enter 执行  1/w 微信  2/f 飞书  Esc/q 返回";
  if (screen === "home") return "↑↓ 选择  Enter 执行  w 微信  f 飞书  c 渠道  b 绑定  t 配对  p 权限  d 目录  q 退出";
  if (screen === "channels") return "↑↓ 选择  Enter 执行  w 微信  f 飞书  e 启停  Esc 返回";
  if (screen === "channelRename") return "输入后 Enter 保存；留空清除备注  Esc 返回";
  if (screen === "bindings") return "↑↓ 选择  Enter 详情  n 新建  m 手动绑定  u 解绑  p 权限  Esc 返回";
  if (screen === "pairing") return "↑↓ 选择  Enter 详情  m 手动信任  r 撤销信任  u 撤销并解绑  Esc 返回";
  if (screen === "pairingDetail") return "↑↓ 选择  Enter 执行  m 手动信任  r 撤销信任  u 撤销并解绑  Esc 返回";
  if (screen === "addWeixin") return "Enter 获取/检查二维码  Esc 返回";
  if (screen === "addFeishu") return "输入后 Enter 下一步  Secret 不回显  Esc 返回";
  if (screen === "sessionSelect") return "↑↓ 选择  Enter 绑定  数字直选  n 新建  m 手动输入  Esc 返回";
  if (screen === "permission") return "↑↓ 选择  Enter 保存  完全权限需确认  Esc 返回";
  if (screen === "workdir") return "↑↓ 选择  Enter 保存  1/d 当前目录  2/m 输入路径  Esc 返回";
  if (screen === "workdirInput") return "输入后 Enter 保存  Esc 返回";
  if (screen === "startConfirm") return "Enter 启动服务  Esc / q 返回";
  return "↑↓ 选择  Enter 执行  Esc 返回  q 返回";
}

function displayWidth(value: string): number {
  let width = 0;
  for (const char of Array.from(value)) {
    width += charWidth(char);
  }
  return width;
}

function sliceToWidth(value: string, maxWidth: number): string {
  let width = 0;
  let result = "";
  for (const char of Array.from(value)) {
    const nextWidth = charWidth(char);
    if (width + nextWidth > maxWidth) break;
    result += char;
    width += nextWidth;
  }
  return result;
}

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (isCombining(code)) return 0;
  return isFullwidth(code) ? 2 : 1;
}

function isCombining(code: number): boolean {
  return (code >= 0x0300 && code <= 0x036f)
    || (code >= 0x1ab0 && code <= 0x1aff)
    || (code >= 0x1dc0 && code <= 0x1dff)
    || (code >= 0x20d0 && code <= 0x20ff)
    || (code >= 0xfe00 && code <= 0xfe0f);
}

function isFullwidth(code: number): boolean {
  return code >= 0x1100 && (
    code <= 0x115f
    || code === 0x2329
    || code === 0x232a
    || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1f64f)
    || (code >= 0x1f900 && code <= 0x1f9ff)
  );
}

// ─── Height adaptation ────────────────────────────────────────────────────────

/** Returns the number of rows available for a list section, given how many rows
 *  are consumed by fixed chrome (Frame border, Section headers, Footer, etc.). */
export function useViewportRows(fixedRows: number): number {
  const { rows } = useWindowSize();
  return Math.max(3, rows - fixedRows);
}

export interface VisibleWindow<T> {
  slice: T[];
  startIndex: number;
  above: number;
  below: number;
}

/** Compute the visible slice of `items` centred around `selected`, capped at `maxVisible`. */
export function visibleWindow<T>(items: T[], selected: number, maxVisible: number): VisibleWindow<T> {
  if (items.length <= maxVisible) {
    return { slice: items, startIndex: 0, above: 0, below: 0 };
  }
  let start = Math.max(0, selected - Math.floor(maxVisible / 2));
  start = Math.min(start, items.length - maxVisible);
  const slice = items.slice(start, start + maxVisible);
  return { slice, startIndex: start, above: start, below: items.length - (start + maxVisible) };
}

export function ScrollHint({ above, below }: { above: number; below: number }): React.JSX.Element | null {
  if (above === 0 && below === 0) return null;
  return (
    <Box flexDirection="column">
      {above > 0 ? <Text color={THEME.muted}>  ↑ 还有 {above} 项</Text> : null}
      {below > 0 ? <Text color={THEME.muted}>  ↓ 还有 {below} 项</Text> : null}
    </Box>
  );
}
