# 测试报告：Windows Codex CLI 解析与启动链路

## 测试目标

验证 Chat-Codex 新增的 Codex CLI 底层解析能力：

- 支持 `CHAT_CODEX_BIN` 覆盖 Codex CLI 路径。
- Windows 下按 `PATH` / `PATHEXT` 解析 `codex.cmd` 等 npm shim。
- `checkCodexCli()`、app-server adapter、exec adapter 使用同一套解析结果。
- TUI 首页和运行页展示平台、Codex CLI 状态、版本、路径和来源。

## 测试环境

- 日期：2026-05-17
- 分支/提交：main / 2e26a3c
- Node.js 版本：v24.14.0
- 操作系统：macOS Darwin arm64
- Codex 版本：本机真实 Windows Codex 待用户补测；本轮使用 fake Codex 和可注入 platform/env 单元测试覆盖解析逻辑。
- 渠道：mock / TUI unit

## 执行命令

```bash
npm run build
node --test dist/tests/unit/codex-process.test.js dist/tests/unit/codex-cli.test.js dist/tests/unit/ink-tui.test.js dist/tests/unit/launcher-actions.test.js dist/tests/unit/serve-helpers.test.js dist/tests/unit/app-server-codex-adapter.test.js dist/tests/unit/exec-codex-adapter.test.js
npm test
git diff --check
```

## 测试步骤

1. 通过 `codex-process.test` 验证非 Windows 默认解析、`CHAT_CODEX_BIN` 覆盖、Windows `Path` / `PATHEXT` 查找 `codex.cmd`、显式无扩展路径补 `.cmd`、npm cmd shim 解析和 Windows 诊断错误。
2. 通过 `codex-cli.test` 验证 `checkCodexCli()` 使用 fake Codex 返回版本，并保留解析来源、请求路径和最终路径。
3. 通过 app-server / exec adapter 单测验证构造器兼容 `codexBin`，并使用统一解析后的 command 启动子进程。
4. 通过 TUI 单测验证首页和运行页显示 Codex CLI 版本、平台和路径。
5. 运行完整测试集确认现有 Bridge、微信、飞书、媒体、审批、goal、plan、TUI 等能力未回归。

## 实际结果

- `npm run build`：通过。
- 关键单测：66 tests passed。
- `npm test`：298 tests passed。
- `git diff --check`：通过。

新增/覆盖的关键测试：

- `resolveCodexCommand keeps non-Windows default lightweight`
- `resolveCodexCommand honors CHAT_CODEX_BIN override`
- `resolveCodexCommand resolves Windows npm cmd shim through PATH and PATHEXT`
- `resolveCodexCommand resolves Windows explicit path without extension`
- `parseNpmCmdShimTarget extracts npm-generated JS wrapper target`
- `formatCodexUnavailableError includes Windows diagnostics`
- `checkCodexCli reports version and resolved command metadata`
- `Ink TUI renders dashboard and navigates to core pages`
- `Runtime TUI renders startup summary and transcript logs`
- `LauncherActions blocks startup when Codex CLI is unavailable`

## 结论

通过。当前代码已具备 Windows Codex CLI 解析的底层适配能力，并把解析结果贯穿到检测、app-server 和 exec 启动链路。

## 遗留问题

- 真实 Windows 环境还需要用户补测：
  - `where.exe codex`
  - `codex --version`
  - `chat-codex` TUI 首页是否显示正确平台、版本和路径
  - 不设置 `CHAT_CODEX_BIN` 时是否能自动解析 npm 全局 `codex.cmd`
  - 设置 `CHAT_CODEX_BIN=D:\env\nvm\nodejs\codex.cmd` 后是否能启动 app-server 模式
