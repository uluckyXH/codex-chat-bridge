import React from "react";
import { Box, Text } from "ink";
import type { CodexRunPolicy } from "../../codex/codex-cli.js";
import type { SelectableSessionChoice, SessionDisplay } from "../actions/binding-actions.js";
import type { Flash, Screen } from "./types.js";

const FIELD_WIDTH = 22;

export function Frame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" width={92}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">{title}</Text>
        {subtitle ? <Text color="gray">{subtitle}</Text> : null}
      </Box>
      <Box marginTop={1} flexDirection="column">{children}</Box>
    </Box>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold>{title}</Text>
      {children}
    </Box>
  );
}

export function ListRow({ active, left, right }: { active: boolean; left: string; right?: string }): React.JSX.Element {
  return (
    <Box>
      <Text color={active ? "cyan" : undefined}>{active ? "> " : "  "}{padRight(truncate(left, 52), 54)}</Text>
      {right ? <Text color={active ? "cyan" : undefined}>{truncate(right, 32)}</Text> : null}
    </Box>
  );
}

export function SessionRow({ active, index, session }: { active: boolean; index: number; session: SelectableSessionChoice }): React.JSX.Element {
  return <ListRow active={active} left={`${index + 1}. ${session.current ? "当前" : "可用"}   ${session.title ?? session.id}`} right={session.shortId} />;
}

export function KeyValue({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <Text>{padRight(truncate(label, FIELD_WIDTH), FIELD_WIDTH)}  {truncate(value, 66)}</Text>;
}

export function Footer({ loading, flash, screen, context }: { loading: boolean; flash: Flash; screen: Screen["name"]; context?: "firstRun" | "emptyChannels" }): React.JSX.Element {
  const color = flash.kind === "error" ? "red" : flash.kind === "success" ? "green" : "gray";
  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={loading ? "yellow" : color}>{loading ? "处理中..." : flash.message}</Text>
      <Text color="gray">{footerHint(screen, context)}</Text>
    </Box>
  );
}

export function ConfirmBar({ message }: { message: string }): React.JSX.Element {
  return <Box marginTop={1}><Text color="yellow">{message}</Text></Box>;
}

export function Muted({ text }: { text: string }): React.JSX.Element {
  return <Text color="gray">{text}</Text>;
}

export function formatSession(session: SessionDisplay): string {
  return `${session.title ?? session.id} / ${session.shortId}`;
}

export function formatPermission(policy: CodexRunPolicy): string {
  if (policy.permissionMode === "full") return "完全权限（跳过审批和沙箱，高风险）";
  return `审批模式（${policy.sandbox ?? "workspace-write"} 沙箱）`;
}

export function channelStatus(state: string): string {
  if (state === "connected") return "已连接";
  if (state === "login_required") return "需要配置";
  if (state === "failed") return "异常";
  if (state === "stopped") return "已停止";
  return state;
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
  if (context === "firstRun") return "↑↓ 选择  Enter 执行  1/w 微信  2/f 飞书  3/p 权限  0/q 退出";
  if (context === "emptyChannels") return "↑↓ 选择  Enter 执行  1/w 微信  2/f 飞书  Esc/q 返回";
  if (screen === "home") return "↑↓ 选择  Enter 执行  w 微信  f 飞书  c 渠道  b 绑定  p 权限  q 退出";
  if (screen === "channels") return "↑↓ 选择  Enter 详情  w 添加微信  f 添加飞书  e 启停  Esc 返回";
  if (screen === "bindings") return "↑↓ 选择  Enter 详情  n 新建  m 手动绑定  u 解绑  p 权限  Esc 返回";
  if (screen === "addWeixin") return "Enter 获取/检查二维码  Esc 返回";
  if (screen === "addFeishu") return "输入后 Enter 下一步  Secret 不回显  Esc 返回";
  if (screen === "sessionSelect") return "↑↓ 选择  Enter 绑定  数字直选  n 新建  m 手动输入  Esc 返回";
  if (screen === "permission") return "↑↓ 选择  Enter 保存  完全权限需确认  Esc 返回";
  if (screen === "startConfirm") return "Enter 启动服务  Esc 返回  q 返回";
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
