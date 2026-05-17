import fs from "node:fs";
import path from "node:path";
import { FeishuAdapter } from "../../channels/feishu/feishu-adapter.js";
import {
  DEFAULT_FEISHU_ACCOUNT_ID,
  DEFAULT_FEISHU_DOMAIN,
  maskFeishuAppId,
  normalizeFeishuCredentials,
} from "../../channels/feishu/feishu-message.js";
import type { FeishuCredentials } from "../../channels/feishu/feishu-types.js";
import { WeixinAdapter } from "../../channels/weixin/weixin-adapter.js";
import { FileWeixinAccountStore, normalizeWeixinAccountId, type StoredWeixinAccount } from "../../channels/weixin/weixin-account-store.js";
import type { ChannelAdapter, ChannelCapabilities, ChannelStatus } from "../../protocol/channel.js";
import { ChannelConfigStore } from "../../state/channel-config-store.js";
import { FileStateStore, type RemoveChannelStateResult } from "../../state/file-state-store.js";
import type { ChannelInstanceRecord } from "../../state/persistent-state-types.js";
import { formatLocalDateTime, formatLocalShortDateTime } from "../../time/display-time.js";

export interface ChannelActionsOptions {
  cwd?: string;
  configStore?: ChannelConfigStore;
  env?: NodeJS.ProcessEnv;
}

export interface ManagedChannelSummary {
  record: ChannelInstanceRecord;
  status: ChannelStatus;
  capabilities: ChannelCapabilities;
}

export type RemoveChannelResult =
  | (RemoveChannelStateResult & {
    ok: true;
    channel: ChannelInstanceRecord;
    removedStateDir: boolean;
    message: string;
  })
  | { ok: false; reason: "not_found"; channelId: string; message: string };

export class ChannelActions {
  readonly configStore: ChannelConfigStore;
  private readonly env: NodeJS.ProcessEnv;
  private readonly feishuRuntimeCredentials = new Map<string, FeishuCredentials>();

  constructor(options: ChannelActionsOptions = {}) {
    this.env = options.env ?? process.env;
    this.configStore = options.configStore ?? new ChannelConfigStore({ cwd: options.cwd, env: this.env });
  }

  async listChannelSummaries(): Promise<ManagedChannelSummary[]> {
    const summaries: ManagedChannelSummary[] = [];
    for (const record of this.configStore.listChannelInstances()) {
      const adapter = this.createStatusAdapter(record);
      await adapter.start();
      summaries.push({
        record,
        status: await adapter.getStatus(),
        capabilities: adapter.getCapabilities(),
      });
    }
    return summaries;
  }

  listChannelInstances(): ChannelInstanceRecord[] {
    return this.configStore.listChannelInstances();
  }

  setChannelEnabled(id: string, enabled: boolean): ChannelInstanceRecord | undefined {
    return this.configStore.setChannelEnabled(id, enabled);
  }

  renameChannel(id: string, displayName?: string): ChannelInstanceRecord | undefined {
    return this.configStore.setChannelDisplayName(id, displayName);
  }

  removeChannel(id: string): RemoveChannelResult {
    const existing = this.configStore.listChannelInstances().find((channel) => channel.id === id);
    if (!existing) {
      return {
        ok: false,
        reason: "not_found",
        channelId: id,
        message: `没有找到这个渠道：${id}`,
      };
    }
    const state = new FileStateStore({ rootDir: this.configStore.bridgeDir });
    const stateResult = state.removeChannelState(id);
    const configResult = this.configStore.removeChannelInstance(id, { removeStateDir: true });
    const channel = configResult.channel ?? existing;
    const label = formatChannelRecordLabel(channel);
    return {
      ok: true,
      ...stateResult,
      channel,
      removedStateDir: configResult.removedStateDir,
      message: `已删除 ${label}：移除 ${stateResult.removedRoutes} 个聊天，释放 ${stateResult.releasedSessions} 个 session，移除 ${stateResult.removedPendingBindings} 个待生效绑定。`,
    };
  }

  registerWeixinAccount(account: StoredWeixinAccount): ChannelInstanceRecord {
    const accountId = normalizeWeixinAccountId(account.accountId);
    const id = weixinChannelId(accountId);
    const record = this.configStore.upsertChannelInstance({
      id,
      type: "weixin",
      enabled: true,
      accountId,
      credentialSource: "state",
      metadata: {
        accountId,
        userId: account.userId,
        savedAt: account.savedAt,
      },
    });
    const store = new FileWeixinAccountStore(this.configStore.resolveStateDir(record.stateDir));
    store.saveAccount({ ...account, accountId });
    return record;
  }

  registerFeishuBot(credentials: FeishuCredentials, credentialSource = "env"): ChannelInstanceRecord {
    const normalized = normalizeFeishuCredentials(credentials);
    const accountId = normalized.accountId ?? DEFAULT_FEISHU_ACCOUNT_ID;
    this.feishuRuntimeCredentials.set(accountId, normalized);
    const record = this.configStore.upsertChannelInstance({
      id: feishuChannelId(accountId),
      type: "feishu",
      enabled: true,
      accountId,
      credentialSource,
      metadata: {
        accountId,
        appId: maskFeishuAppId(normalized.appId),
        domain: normalized.domain ?? DEFAULT_FEISHU_DOMAIN,
      },
    });
    if (credentialSource === "state-local" || credentialSource === "interactive") {
      this.configStore.writeAccountCredentials(record, accountId, {
        appId: normalized.appId,
        appSecret: normalized.appSecret,
        domain: normalized.domain,
        verificationToken: normalized.verificationToken,
        encryptKey: normalized.encryptKey,
      });
    }
    return record;
  }

  ensureLegacyWeixinAccountRegistered(status: ChannelStatus): ChannelInstanceRecord | undefined {
    if (!status.account || status.state !== "connected") return undefined;
    const legacyStore = new FileWeixinAccountStore();
    const account = legacyStore.loadAccount(status.account);
    if (!account) return undefined;
    return this.registerWeixinAccount(account);
  }

  createRuntimeAdapters(): ChannelAdapter[] {
    return this.configStore.listChannelInstances()
      .filter((record) => record.enabled)
      .map((record) => this.createRuntimeAdapter(record));
  }

  createRuntimeAdapter(record: ChannelInstanceRecord): ChannelAdapter {
    if (record.type === "weixin") {
      return new WeixinAdapter({
        id: record.id,
        accountId: record.defaultAccountId,
        stateDir: this.configStore.resolveStateDir(record.stateDir),
      });
    }
    if (record.type === "feishu" || record.type === "lark") {
      const credentials = this.loadFeishuRuntimeCredentials(record);
      return new FeishuAdapter({
        ...credentials,
        id: record.id,
        accountId: record.defaultAccountId ?? credentials.accountId ?? DEFAULT_FEISHU_ACCOUNT_ID,
      });
    }
    throw new Error(`暂不支持的渠道类型: ${record.type}`);
  }

  createStatusAdapter(record: ChannelInstanceRecord): ChannelAdapter {
    if (record.type === "weixin") {
      return new WeixinAdapter({
        id: record.id,
        accountId: record.defaultAccountId,
        stateDir: this.configStore.resolveStateDir(record.stateDir),
        pollOnStart: false,
      });
    }
    if (record.type === "feishu" || record.type === "lark") {
      const credentials = this.loadFeishuRuntimeCredentials(record);
      return new FeishuAdapter({
        ...credentials,
        id: record.id,
        accountId: record.defaultAccountId ?? credentials.accountId ?? DEFAULT_FEISHU_ACCOUNT_ID,
        connectOnStart: false,
        probeOnStart: false,
      });
    }
    throw new Error(`暂不支持的渠道类型: ${record.type}`);
  }

  private loadFeishuRuntimeCredentials(record: ChannelInstanceRecord): FeishuCredentials {
    const accountId = record.defaultAccountId ?? DEFAULT_FEISHU_ACCOUNT_ID;
    return this.feishuRuntimeCredentials.get(accountId)
      ?? loadFeishuCredentialsFromLocalState(this.configStore, record, accountId)
      ?? loadFeishuCredentialsForAccount(accountId, this.env);
  }
}

export function weixinChannelId(accountId: string): string {
  return `weixin-${normalizeWeixinAccountId(accountId)}`;
}

export function feishuChannelId(accountId: string): string {
  return `feishu-${fileSafeId(accountId || DEFAULT_FEISHU_ACCOUNT_ID)}`;
}

export function formatManagedChannelList(channels: ManagedChannelSummary[]): string {
  const lines = ["管理渠道", ""];
  if (channels.length === 0) {
    lines.push("已配置渠道: 暂无");
  } else {
    lines.push("已配置渠道");
    channels.forEach((channel, index) => {
      lines.push(`${index + 1}. ${formatManagedChannelLabel(channel)}    ${channel.record.enabled ? "已启用" : "已停用"}    ${formatChannelState(channel.status.state)}    添加 ${formatShortDateTime(channel.record.createdAt)}`);
      lines.push(`   实例: ${channel.record.id}`);
      if (channel.status.lastError) lines.push(`   最近错误: ${channel.status.lastError}`);
    });
  }
  const nextIndex = channels.length + 1;
  lines.push(
    "",
    "操作",
    `${nextIndex}. 添加微信账号`,
    `${nextIndex + 1}. 添加飞书机器人`,
    "w. 添加微信账号",
    "f. 添加飞书机器人",
    "0. 返回",
  );
  return lines.join("\n");
}

export function formatManagedChannelLabel(channel: ManagedChannelSummary): string {
  return `${formatChannelType(channel.record.type)} / ${channelDisplayName(channel.record, channel.status)}`;
}

export function formatChannelRecordLabel(record: ChannelInstanceRecord, status?: ChannelStatus): string {
  return `${formatChannelType(record.type)} / ${channelDisplayName(record, status)}`;
}

export function channelDisplayName(record: ChannelInstanceRecord, status?: ChannelStatus): string {
  return record.displayName ?? status?.account ?? record.defaultAccountId ?? record.id;
}

export function formatShortDateTime(iso: string | undefined): string {
  return formatLocalShortDateTime(iso);
}

export function formatFullDateTime(iso: string | undefined): string {
  return formatLocalDateTime(iso);
}

export function loadFeishuCredentialsForAccount(accountId: string | undefined, env: NodeJS.ProcessEnv = process.env): FeishuCredentials {
  const normalizedAccount = accountId || env.FEISHU_ACCOUNT_ID || env.LARK_ACCOUNT_ID || DEFAULT_FEISHU_ACCOUNT_ID;
  const scoped = envPrefix(normalizedAccount);
  return normalizeFeishuCredentials({
    appId: firstNonEmpty(env[`FEISHU_${scoped}_APP_ID`], env[`LARK_${scoped}_APP_ID`], env.FEISHU_APP_ID, env.LARK_APP_ID),
    appSecret: firstNonEmpty(env[`FEISHU_${scoped}_APP_SECRET`], env[`LARK_${scoped}_APP_SECRET`], env.FEISHU_APP_SECRET, env.LARK_APP_SECRET),
    domain: firstNonEmpty(env[`FEISHU_${scoped}_DOMAIN`], env[`LARK_${scoped}_DOMAIN`], env.FEISHU_DOMAIN, env.LARK_DOMAIN, DEFAULT_FEISHU_DOMAIN),
    accountId: normalizedAccount,
    verificationToken: firstNonEmpty(env[`FEISHU_${scoped}_VERIFICATION_TOKEN`], env.FEISHU_VERIFICATION_TOKEN, env.LARK_VERIFICATION_TOKEN),
    encryptKey: firstNonEmpty(env[`FEISHU_${scoped}_ENCRYPT_KEY`], env.FEISHU_ENCRYPT_KEY, env.LARK_ENCRYPT_KEY),
  });
}

function loadFeishuCredentialsFromLocalState(
  configStore: ChannelConfigStore,
  record: ChannelInstanceRecord,
  accountId: string,
): FeishuCredentials | undefined {
  const credentials = configStore.readAccountCredentials(record, accountId);
  if (!credentials) return undefined;
  return normalizeFeishuCredentials({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    domain: credentials.domain,
    accountId,
    verificationToken: credentials.verificationToken,
    encryptKey: credentials.encryptKey,
  });
}

export function copyFileIfExists(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function formatChannelType(type: string): string {
  if (type === "weixin") return "微信";
  if (type === "feishu" || type === "lark") return "飞书";
  return type;
}

function formatChannelState(state: string): string {
  if (state === "connected") return "已连接";
  if (state === "login_required") return "需要配置";
  if (state === "failed") return "异常";
  if (state === "stopped") return "已停止";
  return state;
}

function fileSafeId(value: string): string {
  return value.trim().replace(/[@.]/g, "-").replace(/[^A-Za-z0-9_-]/g, "-") || "default";
}

function envPrefix(value: string): string {
  return fileSafeId(value).replace(/-/g, "_").toUpperCase();
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)?.trim();
}
