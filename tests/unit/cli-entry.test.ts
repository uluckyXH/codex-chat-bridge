import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

test("package exposes chat-codex as the main startup command", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    name?: string;
    bin?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.name, "chat-codex");
  assert.equal(packageJson.bin?.["chat-codex"], "dist/src/cli.js");
  assert.equal(packageJson.bin?.["codex-wechat-bridge"], undefined);
  assert.equal(packageJson.scripts?.["chat-codex"], "npm run build && node dist/src/cli.js");
  assert.equal(packageJson.scripts?.["cli:chat-codex"], "npm run build && node dist/src/cli.js");
  assert.equal(packageJson.scripts?.codex, undefined);
  assert.equal(packageJson.scripts?.["cli:codex"], undefined);
  assert.equal(packageJson.scripts?.["cli:mock"], "npm run build && node dist/src/cli.js test");
  assert.equal(packageJson.scripts?.["cli:serve"], undefined);
  assert.equal(packageJson.scripts?.["cli:weixin:codex"], undefined);
  assert.equal(packageJson.scripts?.["cli:weixin:codex:direct"], undefined);
  assert.equal(packageJson.scripts?.["cli:feishu:status"], "npm run build && node dist/src/cli.js feishu status");
  assert.equal(packageJson.scripts?.["cli:feishu:codex"], undefined);
});

test("CLI help documents the chat-codex main entry", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    version?: string;
  };
  const help = execFileSync(process.execPath, ["dist/src/cli.js", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.match(help, new RegExp(`Chat-Codex v${escapeRegExp(packageJson.version ?? "")}`));
  assert.match(help, /chat-codex\s+启动统一交互入口/);
  assert.match(help, /chat-codex version\s+查看 Chat-Codex 和 Node\.js 版本/);
  assert.match(help, /-v, --version\s+输出版本号/);
  assert.doesNotMatch(help, /codex-wechat-bridge codex/);
});

test("CLI version commands print package version", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    version?: string;
  };
  const version = packageJson.version ?? "";

  const longVersion = execFileSync(process.execPath, ["dist/src/cli.js", "--version"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  const shortVersion = execFileSync(process.execPath, ["dist/src/cli.js", "-v"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  const detail = execFileSync(process.execPath, ["dist/src/cli.js", "version"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(longVersion, version);
  assert.equal(shortVersion, version);
  assert.match(detail, new RegExp(`Chat-Codex ${escapeRegExp(version)}`));
  assert.match(detail, new RegExp(`Node\\.js ${escapeRegExp(process.version)}`));
});

test("CLI help does not expose single-channel Codex startup entries", () => {
  const help = execFileSync(process.execPath, ["dist/src/cli.js", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.doesNotMatch(help, /weixin codex/);
  assert.doesNotMatch(help, /weixin codex-direct/);
  assert.doesNotMatch(help, /feishu codex/);
  assert.doesNotMatch(help, /chat-codex serve/);
  assert.doesNotMatch(help, /旧版微信直连入口/);
  assert.doesNotMatch(help, /weixin codex\s+启动真实微信通道 \+ Codex app-server/);
});

test("CLI help documents Feishu private-chat entry", () => {
  const help = execFileSync(process.execPath, ["dist/src/cli.js", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.match(help, /feishu status\s+查看飞书配置和连接状态/);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
