import type { CodexRunPolicy, DiscoveredCodexSession } from "../../codex/codex-cli.js";
import { formatCodexSessionTitleForDisplay } from "../../codex/codex-cli.js";
import { formatSessionActiveTime } from "../actions/binding-actions.js";
import type { PreparedServeStartup } from "../launcher-types.js";
import { formatPermissionModeForUser } from "../serve-wizard.js";
import { formatCodexStatusForCli } from "./summary.js";

export function printRuntimeSummary(
  title: string,
  startup: PreparedServeStartup,
  display: { progressDisabled?: boolean } = {},
): void {
  console.log("");
  console.log(`${title}已启动`);
  console.log("- 会话: 按微信聊天分别绑定；首条消息按策略处理");
  console.log(`- Codex CLI: ${formatCodexStatusForCli(startup.codexStatus)}`);
  console.log(`- 工作目录: ${startup.cwd}`);
  console.log(`- 新 session 默认权限: ${formatPolicyForCli(startup.policy)}`);
  console.log("- 退出: Ctrl+C");
}

export function formatSessionChoice(index: number, session: DiscoveredCodexSession): string {
  const title = formatCodexSessionTitleForDisplay(session);
  const parts = [`${index}. ${title ?? session.id}`];
  parts.push(`   Session ID: ${session.id}`);
  parts.push(`   最近活跃: ${formatSessionActiveTime(session.updatedAt, "full")}`);
  if (session.cwd) parts.push(`   工作目录: ${session.cwd}`);
  return parts.join("\n");
}

export function formatPolicyForCli(policy: CodexRunPolicy): string {
  if (policy.permissionMode === "full") return formatPermissionModeForUser(policy.permissionMode);
  return `审批模式（${policy.sandbox ?? "workspace-write"} 沙箱，推荐）`;
}
