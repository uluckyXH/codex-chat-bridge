# Windows Codex CLI 排障指南

本文档面向 Windows 用户。它只处理 Chat-Codex 找不到或无法启动本机 Codex CLI 的问题，不涉及微信、飞书、TUI 交互或业务命令。

## 1. 先确认前置条件

Chat-Codex 需要本机安装 Codex CLI。只安装 Codex 桌面 App 不等于已经安装 CLI。

先在 PowerShell 中执行：

```powershell
codex --version
where.exe codex
```

正常情况下，`codex --version` 应输出 Codex CLI 版本，例如：

```text
codex-cli 0.130.0
```

`where.exe codex` 应能看到类似路径：

```text
D:\env\nvm\nodejs\codex
D:\env\nvm\nodejs\codex.cmd
```

如果 PowerShell 自己也无法运行 `codex --version`，请先按 Codex 官方安装指引安装或修复 Codex CLI。

## 2. 看 Chat-Codex 首页

启动：

```powershell
chat-codex
```

Chat-Codex 首页会显示 Codex CLI 接入状态：

- 平台：例如 `win32 x64`。
- 状态：`已找到` 或 `不可用`。
- 版本：来自 `codex --version`。
- 路径：Chat-Codex 实际准备用来启动的 Codex CLI 路径。
- 来源：默认 `codex`、`PATH/PATHEXT`，或 `CHAT_CODEX_BIN`。

如果这里显示 `不可用`，先看错误文本里的路径和来源。

## 3. PowerShell 能运行，但 Chat-Codex 报 `spawn codex ENOENT`

这通常是 Windows 下 Node.js 子进程解析 npm shim 的差异导致的。PowerShell 能找到 `codex`，不代表 Node.js 的 `spawn("codex")` 一定能用同样规则找到 `codex.cmd`。

先执行：

```powershell
where.exe codex
```

找到 `codex.cmd` 后，临时指定给 Chat-Codex：

```powershell
$env:CHAT_CODEX_BIN="D:\env\nvm\nodejs\codex.cmd"
chat-codex
```

如果这样能启动，说明问题就在 Codex CLI 路径解析。可以持久保存：

```powershell
setx CHAT_CODEX_BIN "D:\env\nvm\nodejs\codex.cmd"
```

重新打开一个新的 PowerShell 后再执行：

```powershell
chat-codex
```

## 4. 如果 `where.exe codex` 有多个结果

优先选择带 `.cmd` 或 `.exe` 的路径。

例如：

```text
D:\env\nvm\nodejs\codex
D:\env\nvm\nodejs\codex.cmd
```

推荐使用：

```powershell
$env:CHAT_CODEX_BIN="D:\env\nvm\nodejs\codex.cmd"
```

如果有多个 Node.js / nvm 目录，确认 `codex --version` 输出的是你实际希望使用的 Codex 版本。

## 5. 常见检查命令

```powershell
node --version
npm --version
codex --version
where.exe codex
where.exe chat-codex
echo $env:CHAT_CODEX_BIN
```

如果需要清除持久配置：

```powershell
[Environment]::SetEnvironmentVariable("CHAT_CODEX_BIN", $null, "User")
```

然后重新打开 PowerShell。

## 6. 反馈问题时请提供

- Windows 版本。
- Node.js 版本：`node --version`。
- Chat-Codex 版本：`chat-codex --version`。
- Codex CLI 版本：`codex --version`。
- `where.exe codex` 输出。
- `where.exe chat-codex` 输出。
- Chat-Codex 首页显示的平台、状态、版本、路径和来源。
- 是否设置了 `CHAT_CODEX_BIN`。

不要粘贴真实 token、cookie、App Secret 或其它密钥。
