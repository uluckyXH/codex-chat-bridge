# 测试报告：Chat Codex 工作目录配置

## 测试目标

验证 `chat-codex` 的新 session 默认工作目录在 Prompt CLI 和 Ink TUI 中都能展示和修改，并保持“默认使用启动目录、本次进程内生效、不持久化固定目录”的语义。

## 测试环境

- 日期：2026-05-16
- 分支：main
- 操作系统：macOS
- Node.js：项目要求 Node.js >= 22

## 覆盖范围

1. 首页 summary 展示新 session 工作目录。
2. Prompt CLI 首页新增“工作目录”入口，启动默认项顺延为 `6. 启动服务`。
3. Prompt CLI 工作目录页支持使用当前终端目录、手动输入路径、缺失目录二次确认创建。
4. Ink TUI 首页新增工作目录行和默认配置展示。
5. Ink TUI 工作目录页支持使用当前终端目录和手动输入路径。
6. 工作目录变更只影响以后新建 session；已有 session cwd 不修改。
7. 缺失目录检查不会在确认前自动创建。
8. 设计文档同步为当前阶段不持久化固定默认工作目录。

## 执行命令

```bash
npm run build
node --test dist/tests/unit/serve-wizard.test.js dist/tests/unit/ink-tui.test.js dist/tests/unit/workdir.test.js
npm test
git diff --check
```

## 实际结果

- `npm run build` 通过。
- 相关单测通过：15 passed，0 failed。
- `npm test` 通过：192 passed，0 failed。
- `git diff --check` 通过。

## 结论

通过。

## 备注

- 本次没有持久化“固定默认工作目录”。下次在另一个项目目录运行 `chat-codex` 时，默认仍取新的 `process.cwd()`。
- 如果后续要支持固定默认工作目录，应作为高级选项，并明确提示会覆盖“在哪个目录启动就在哪个目录创建新 session”的默认行为。
