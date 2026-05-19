import fs from "node:fs";
import path from "node:path";
import {
  LOCAL_STATE_SCHEMA_VERSION,
  type ChannelAccountCredentialsDocument,
  type BridgeConfigDocument,
  type ChannelAccountDocument,
  type ChannelInstanceDocument,
  type ChannelInstanceRecord,
} from "./persistent-state-types.js";
import { defaultBridgeStateDir, readJsonFile, writeJsonFileAtomic } from "./state-files.js";
import {
  DEFAULT_CONTEXT_REFRESH_POLICY,
  cloneContextRefreshPolicy,
  contextRefreshPolicyOrDefault,
  normalizeContextRefreshPolicy,
  type ContextRefreshPolicy,
} from "../context-refresh/types.js";

export interface UpsertChannelInstanceInput {
  id: string;
  type: string;
  enabled?: boolean;
  stateDir?: string;
  accountId?: string;
  displayName?: string;
  credentialSource?: string;
  metadata?: Record<string, unknown>;
}

export interface RemoveChannelConfigResult {
  ok: boolean;
  channel?: ChannelInstanceRecord;
  removedStateDir: boolean;
}

export interface ChannelConfigStoreOptions {
  bridgeDir?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export class ChannelConfigStore {
  readonly bridgeDir: string;
  readonly stateRootDir: string;
  private readonly configPath: string;

  constructor(options: ChannelConfigStoreOptions = {}) {
    this.bridgeDir = options.bridgeDir ?? defaultBridgeStateDir(options.cwd, options.env);
    this.stateRootDir = path.dirname(this.bridgeDir);
    this.configPath = path.join(this.bridgeDir, "config.json");
  }

  upsertChannelInstance(input: UpsertChannelInstanceInput): ChannelInstanceRecord {
    const now = new Date().toISOString();
    const config = this.readConfig();
    const existing = config.channels.find((channel) => channel.id === input.id);
    const stateDir = input.stateDir ?? existing?.stateDir ?? path.join("state", "channels", input.type, input.id);
    const record: ChannelInstanceRecord = {
      id: input.id,
      type: input.type,
      enabled: input.enabled ?? existing?.enabled ?? true,
      stateDir,
      defaultAccountId: input.accountId ?? existing?.defaultAccountId,
      displayName: normalizeDisplayName(input.displayName) ?? existing?.displayName,
      credentialSource: input.credentialSource ?? existing?.credentialSource,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    config.channels = [
      ...config.channels.filter((channel) => channel.id !== input.id),
      record,
    ].sort((left, right) => left.id.localeCompare(right.id));
    config.updatedAt = now;
    writeJsonFileAtomic(this.configPath, config);
    this.writeInstanceFiles(record, input.accountId, input.metadata);
    return record;
  }

  readConfig(): BridgeConfigDocument {
    const config = readJsonFile<BridgeConfigDocument>(this.configPath, {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      updatedAt: new Date(0).toISOString(),
      channels: [],
    });
    return {
      schemaVersion: config.schemaVersion ?? LOCAL_STATE_SCHEMA_VERSION,
      updatedAt: config.updatedAt ?? new Date(0).toISOString(),
      channels: Array.isArray(config.channels) ? config.channels : [],
      codexDefaults: normalizeCodexDefaults(config.codexDefaults),
    };
  }

  getContextRefreshDefaults(): ContextRefreshPolicy {
    return contextRefreshPolicyOrDefault(this.readConfig().codexDefaults?.independentMode?.contextRefresh);
  }

  setContextRefreshDefaults(policy: ContextRefreshPolicy): ContextRefreshPolicy {
    const normalized = normalizeContextRefreshPolicy(policy);
    if (!normalized) throw new Error("invalid context refresh policy");
    const config = this.readConfig();
    config.codexDefaults = {
      ...config.codexDefaults,
      independentMode: {
        ...config.codexDefaults?.independentMode,
        contextRefresh: normalized,
      },
    };
    config.updatedAt = new Date().toISOString();
    writeJsonFileAtomic(this.configPath, config);
    return cloneContextRefreshPolicy(normalized) ?? { ...DEFAULT_CONTEXT_REFRESH_POLICY };
  }

  listChannelInstances(): ChannelInstanceRecord[] {
    return [...this.readConfig().channels].sort((left, right) => left.id.localeCompare(right.id));
  }

  setChannelEnabled(id: string, enabled: boolean): ChannelInstanceRecord | undefined {
    const config = this.readConfig();
    const existing = config.channels.find((channel) => channel.id === id);
    if (!existing) return undefined;
    return this.upsertChannelInstance({
      id: existing.id,
      type: existing.type,
      enabled,
      stateDir: existing.stateDir,
      accountId: existing.defaultAccountId,
      displayName: existing.displayName,
      credentialSource: existing.credentialSource,
    });
  }

  setChannelDisplayName(id: string, displayName?: string): ChannelInstanceRecord | undefined {
    const config = this.readConfig();
    const existing = config.channels.find((channel) => channel.id === id);
    if (!existing) return undefined;
    const now = new Date().toISOString();
    const record: ChannelInstanceRecord = {
      ...existing,
      displayName: normalizeDisplayName(displayName),
      updatedAt: now,
    };
    config.channels = [
      ...config.channels.filter((channel) => channel.id !== id),
      record,
    ].sort((left, right) => left.id.localeCompare(right.id));
    config.updatedAt = now;
    writeJsonFileAtomic(this.configPath, config);
    this.writeInstanceFiles(record, undefined, undefined);
    return record;
  }

  removeChannelInstance(id: string, options: { removeStateDir?: boolean } = {}): RemoveChannelConfigResult {
    const config = this.readConfig();
    const existing = config.channels.find((channel) => channel.id === id);
    if (!existing) return { ok: false, removedStateDir: false };
    const now = new Date().toISOString();
    config.channels = config.channels.filter((channel) => channel.id !== id);
    config.updatedAt = now;
    writeJsonFileAtomic(this.configPath, config);

    let removedStateDir = false;
    if (options.removeStateDir ?? true) {
      const absoluteStateDir = this.resolveStateDir(existing.stateDir);
      if (fs.existsSync(absoluteStateDir)) {
        fs.rmSync(absoluteStateDir, { recursive: true, force: true });
        removedStateDir = true;
      }
    }
    return { ok: true, channel: existing, removedStateDir };
  }

  resolveStateDir(stateDir: string): string {
    return path.isAbsolute(stateDir) ? stateDir : path.resolve(this.stateRootDir, "..", stateDir);
  }

  writeAccountCredentials(record: ChannelInstanceRecord, accountId: string, credentials: Record<string, string | undefined>): void {
    const cleanCredentials = Object.fromEntries(
      Object.entries(credentials)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
        .map(([key, value]) => [key, value.trim()]),
    );
    const accountDir = this.accountDir(record, accountId);
    fs.mkdirSync(accountDir, { recursive: true });
    writeJsonFileAtomic(path.join(accountDir, "credentials.local.json"), {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      channelId: record.id,
      channelType: record.type,
      accountId,
      credentials: cleanCredentials,
      updatedAt: new Date().toISOString(),
    } satisfies ChannelAccountCredentialsDocument);
  }

  readAccountCredentials(record: ChannelInstanceRecord, accountId: string): Record<string, string> | undefined {
    const document = readJsonFile<ChannelAccountCredentialsDocument | undefined>(
      path.join(this.accountDir(record, accountId), "credentials.local.json"),
      undefined,
    );
    if (!document || document.channelId !== record.id || document.accountId !== accountId) return undefined;
    return Object.fromEntries(
      Object.entries(document.credentials ?? {})
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
        .map(([key, value]) => [key, value.trim()]),
    );
  }

  private writeInstanceFiles(record: ChannelInstanceRecord, accountId: string | undefined, metadata: Record<string, unknown> | undefined): void {
    const absoluteStateDir = this.resolveStateDir(record.stateDir);
    fs.mkdirSync(absoluteStateDir, { recursive: true });
    writeJsonFileAtomic(path.join(absoluteStateDir, "instance.json"), {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      ...record,
    } satisfies ChannelInstanceDocument);
    if (!accountId) return;
    const accountDir = path.join(absoluteStateDir, "accounts", accountId);
    fs.mkdirSync(accountDir, { recursive: true });
    writeJsonFileAtomic(path.join(accountDir, "account.json"), {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      channelId: record.id,
      channelType: record.type,
      accountId,
      credentialSource: record.credentialSource,
      metadata,
      updatedAt: record.updatedAt,
    } satisfies ChannelAccountDocument);
  }

  private accountDir(record: ChannelInstanceRecord, accountId: string): string {
    return path.join(this.resolveStateDir(record.stateDir), "accounts", accountId);
  }

}

function normalizeCodexDefaults(value: BridgeConfigDocument["codexDefaults"]): BridgeConfigDocument["codexDefaults"] {
  if (!value || typeof value !== "object") return value;
  const contextRefresh = normalizeContextRefreshPolicy(value.independentMode?.contextRefresh);
  return {
    ...value,
    independentMode: contextRefresh
      ? {
          ...value.independentMode,
          contextRefresh,
        }
      : value.independentMode,
  };
}

function normalizeDisplayName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
