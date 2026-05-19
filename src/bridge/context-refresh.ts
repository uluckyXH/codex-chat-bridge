import type { Logger } from "../logging/logger.js";
import { SilentLogger } from "../logging/logger.js";
import type { MemoryStateStore } from "../state/memory-state-store.js";
import type { SessionContextSnapshotObservedBy } from "../state/persistent-state-types.js";
import type { CodexAdapter } from "../codex/types.js";
import {
  cloneCodexSessionContextFingerprint,
  fingerprintIsNewer,
  readCodexSessionContextFingerprint,
  type CodexSessionContextFingerprint,
} from "../codex/session-context-fingerprint.js";
import {
  DEFAULT_CONTEXT_REFRESH_POLICY,
  cloneContextRefreshPolicy,
  contextRefreshPolicyOrDefault,
  formatContextRefreshEffectivePolicyForUser,
  formatContextRefreshModeForUser,
  type ContextRefreshEffectivePolicy,
  type ContextRefreshPolicy,
} from "../context-refresh/types.js";

export type SessionContextRefreshBeforeRunResult =
  | { type: "skipped"; effective: ContextRefreshEffectivePolicy }
  | { type: "no_snapshot"; effective: ContextRefreshEffectivePolicy; current: CodexSessionContextFingerprint }
  | { type: "not_updated"; effective: ContextRefreshEffectivePolicy; current: CodexSessionContextFingerprint }
  | { type: "detect_only"; effective: ContextRefreshEffectivePolicy; current: CodexSessionContextFingerprint; previous: CodexSessionContextFingerprint; notice: string }
  | { type: "reloaded"; effective: ContextRefreshEffectivePolicy; current: CodexSessionContextFingerprint; previous: CodexSessionContextFingerprint; notice: string }
  | { type: "reload_failed"; effective: ContextRefreshEffectivePolicy; current: CodexSessionContextFingerprint; previous: CodexSessionContextFingerprint; errorText: string }
  | { type: "read_failed"; effective: ContextRefreshEffectivePolicy };

export interface SessionContextRefreshManagerOptions {
  state: MemoryStateStore;
  codex: CodexAdapter;
  defaultPolicy?: ContextRefreshPolicy;
  readFingerprint?: (sessionId: string) => CodexSessionContextFingerprint | undefined | Promise<CodexSessionContextFingerprint | undefined>;
  logger?: Logger;
}

export interface BeforeRunContextRefreshInput {
  routeKey: string;
  sessionId: string;
}

export class SessionContextRefreshManager {
  private readonly state: MemoryStateStore;
  private readonly codex: CodexAdapter;
  private readonly defaultPolicy: ContextRefreshPolicy;
  private readonly hasConfiguredDefaultPolicy: boolean;
  private readonly readFingerprint: NonNullable<SessionContextRefreshManagerOptions["readFingerprint"]>;
  private readonly logger: Logger;

  constructor(options: SessionContextRefreshManagerOptions) {
    this.state = options.state;
    this.codex = options.codex;
    this.defaultPolicy = contextRefreshPolicyOrDefault(options.defaultPolicy);
    this.hasConfiguredDefaultPolicy = Boolean(options.defaultPolicy);
    this.readFingerprint = options.readFingerprint ?? ((sessionId) => readCodexSessionContextFingerprint(sessionId));
    this.logger = options.logger ?? new SilentLogger();
  }

  effectivePolicy(routeKey: string): ContextRefreshEffectivePolicy {
    const routePolicy = this.state.getRouteContextRefreshPolicy(routeKey);
    if (routePolicy) return { policy: routePolicy, source: "route" };
    if (this.hasConfiguredDefaultPolicy || this.defaultPolicy.mode !== DEFAULT_CONTEXT_REFRESH_POLICY.mode) {
      return { policy: cloneContextRefreshPolicy(this.defaultPolicy) ?? { ...DEFAULT_CONTEXT_REFRESH_POLICY }, source: "global" };
    }
    return { policy: { ...DEFAULT_CONTEXT_REFRESH_POLICY }, source: "builtin" };
  }

  async beforeRun(input: BeforeRunContextRefreshInput): Promise<SessionContextRefreshBeforeRunResult> {
    const effective = this.effectivePolicy(input.routeKey);
    if (effective.policy.mode === "off") return { type: "skipped", effective };
    const current = await this.safeReadFingerprint(input.sessionId);
    if (!current) return { type: "read_failed", effective };
    const snapshot = this.state.getSessionContextSnapshot(input.sessionId);
    if (!snapshot) {
      this.state.setSessionContextSnapshot({
        sessionId: input.sessionId,
        fingerprint: current,
        observedBy: "resume",
      });
      return { type: "no_snapshot", effective, current };
    }
    if (!fingerprintIsNewer(current, snapshot.fingerprint)) {
      return { type: "not_updated", effective, current };
    }
    const previous = cloneCodexSessionContextFingerprint(snapshot.fingerprint);
    if (effective.policy.mode === "detect") {
      return {
        type: "detect_only",
        effective,
        current,
        previous,
        notice: [
          "检测到本机 Codex session 上下文已更新。",
          "当前上下文刷新模式是检测提醒，本条消息会继续发送；如需发送前自动重载，可切到 reload。",
        ].join("\n"),
      };
    }
    try {
      const reloaded = this.codex.reloadSession
        ? await this.codex.reloadSession(input.sessionId)
        : { session: await this.codex.resumeSession(input.sessionId), reloadedAt: new Date().toISOString() };
      this.state.setSessionContextSnapshot({
        sessionId: reloaded.session.id,
        fingerprint: current,
        observedBy: "external-refresh",
      });
      return {
        type: "reloaded",
        effective,
        current,
        previous,
        notice: [
          "检测到本机 Codex session 上下文已更新，已在发送前重新加载。",
          `Session: \`${reloaded.session.id}\``,
        ].join("\n"),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("session context reload failed", {
        routeKey: input.routeKey,
        sessionId: input.sessionId,
        error: message,
      });
      return {
        type: "reload_failed",
        effective,
        current,
        previous,
        errorText: [
          "检测到本机 Codex session 上下文已更新，但发送前重新加载失败。",
          "为避免把消息投递到旧上下文，本条消息没有发送。",
          `错误: ${message}`,
        ].join("\n"),
      };
    }
  }

  async recordAfterRun(sessionId: string): Promise<void> {
    await this.recordSnapshot(sessionId, "chat-codex-turn");
  }

  async recordSnapshot(sessionId: string, observedBy: SessionContextSnapshotObservedBy): Promise<void> {
    const fingerprint = await this.safeReadFingerprint(sessionId);
    if (!fingerprint) return;
    this.state.setSessionContextSnapshot({
      sessionId,
      fingerprint,
      observedBy,
    });
  }

  formatEffectivePolicy(routeKey: string): string {
    return formatContextRefreshEffectivePolicyForUser(this.effectivePolicy(routeKey));
  }

  contextRefreshText(routeKey: string): string {
    const effective = this.effectivePolicy(routeKey);
    return [
      "**上下文刷新**",
      `- 当前模式: ${formatContextRefreshEffectivePolicyForUser(effective)}`,
      "- `off`: 发送前不检测本机 Codex 历史是否被外部更新。",
      "- `detect`: 发送前检测，发现更新时只提醒，不重载。",
      "- `reload`: 发送前检测，发现更新时先重新加载当前 session，再发送。",
      "",
      "用法:",
      "- `/context-refresh` 查看当前聊天设置。",
      "- `/context-refresh reload` 当前聊天开启发送前检测并刷新。",
      "- `/context-refresh detect` 当前聊天只检测提醒。",
      "- `/context-refresh off` 当前聊天关闭。",
      "- `/context-refresh inherit` 当前聊天跟随全局默认。",
      "",
      `全局默认当前为: ${formatContextRefreshModeForUser(this.defaultPolicy.mode)}。`,
    ].join("\n");
  }

  private async safeReadFingerprint(sessionId: string): Promise<CodexSessionContextFingerprint | undefined> {
    try {
      return await this.readFingerprint(sessionId);
    } catch (error) {
      this.logger.warn("session context fingerprint read failed", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
