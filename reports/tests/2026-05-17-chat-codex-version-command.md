# Chat-Codex 版本命令验证

## 背景

Chat-Codex 已发布 npm 包，但 CLI 之前没有直接查看当前版本的命令。用户需要能在全局安装、开发运行和 TUI 中确认当前运行版本。

## 实现范围

- 新增 `src/runtime/package-info.ts`，统一从根 `package.json` 读取包名和版本。
- `chat-codex --version` 输出纯版本号。
- `chat-codex -v` 输出纯版本号。
- `chat-codex version` 输出 Chat-Codex 版本和 Node.js 版本。
- `chat-codex --help` 顶部显示 `Chat-Codex v当前版本`，并列出版本命令。
- TUI 首页、首次加载页、运行日志页标题显示 `Chat-Codex v当前版本`。
- README 中补充版本查看命令。

## 命令输出

```bash
node dist/src/cli.js --version
# 0.1.1

node dist/src/cli.js -v
# 0.1.1

node dist/src/cli.js version
# Chat-Codex 0.1.1
# Node.js v24.13.1
```

## 已执行验证

```bash
npm run build
node dist/src/cli.js --version
node dist/src/cli.js -v
node dist/src/cli.js version
node dist/src/cli.js --help
node --test dist/tests/unit/package-info.test.js dist/tests/unit/cli-entry.test.js dist/tests/unit/ink-tui.test.js
git diff --check
npm test
```

## 结果

- 构建通过。
- 版本命令输出正确。
- help 文案包含版本命令。
- TUI 相关测试通过，标题包含 `Chat-Codex v0.1.1`。
- `git diff --check` 通过。
- 全量 `npm test` 通过，`290 passed, 0 failed`。
