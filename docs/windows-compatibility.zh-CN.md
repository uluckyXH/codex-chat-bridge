# Windows Codex 接入兼容性设计

本文档记录 Chat-Codex 在 Windows 环境下对接本机 Codex CLI 的底层兼容性设计、已知问题、修复策略和验收要求。主线是“如何可靠找到并启动 Codex”，不是把 TUI、渠道和业务功能全部做成按平台分叉的适配层。

其它 Windows 问题只有在影响 Codex 对接边界时才写入本文档，例如：Codex 可执行文件路径、Codex 工作目录、传给 Codex 的本地文件路径、Codex 子进程终止。微信/飞书业务逻辑、TUI 交互和媒体下载流程仍归各自设计文档负责。

## 1. 目标

- Windows 用户安装 Chat-Codex 后，应能稳定解析并启动本机 Codex CLI。
- Windows 兼容性问题应优先通过 Codex 接入边界的跨平台抽象修复，不在 Bridge Core、渠道 adapter 或命令业务流程中散落 `process.platform === "win32"` 分支。
- 与 Codex 子进程、Codex 可执行文件路径、Codex 工作目录、传给 Codex 的本地文件路径和子进程终止相关的行为必须有明确测试或人工验收记录。
- 发现 Windows 专属问题时，先判断是用户环境问题、Node.js/平台差异，还是 Chat-Codex 代码假设不成立。

## 2. 当前兼容性范围

第一阶段优先覆盖：

- npm 全局安装后的 Codex CLI 命令解析。
- `chat-codex` 检测 Codex CLI 是否可用。
- app-server 模式通过子进程启动 `codex app-server --listen stdio://`。
- exec 模式通过子进程启动 `codex exec ...`。
- `CHAT_CODEX_BIN` 覆盖 Codex CLI 路径并贯穿检测、app-server 和 exec。
- Chat-Codex 首页/TUI 展示当前平台、Codex CLI 是否找到、Codex CLI 版本、解析到的 Codex 可执行文件和来源。
- Codex 工作目录和传给 Codex 的本地文件路径能在 Windows 下正确表达。

以下内容不作为本文档第一阶段验收主线：

- TUI 页面交互。
- 微信/飞书渠道业务流程。
- 微信/飞书媒体下载本身。
- 状态持久化业务语义。

暂不承诺第一阶段完整覆盖：

- Windows Service / 后台守护运行。
- Git Bash、MSYS2、Cygwin 下的全部边界。
- 非 UTF-8 终端编码下的全部显示兼容。
- 通过企业安全软件拦截子进程或网络连接时的自动恢复。

## 3. 设计原则

- 不默认使用 `shell: true` 启动 Codex。Codex prompt、工作目录和命令参数都可能包含用户输入，走 shell 会引入额外转义和注入风险。
- `CHAT_CODEX_BIN` 只用于指定 Codex CLI 可执行文件，不是通用业务配置。它的作用是绕过 Windows PATH、PATHEXT、npm shim 或 nvm 目录解析差异。
- Codex 接入边界的路径处理统一使用 Node.js `path` API，不手写 `/` 分隔路径。
- 错误信息必须可诊断。涉及子进程启动失败时，应输出平台、尝试启动的可执行文件、PATH 相关提示和推荐修复方式。
- Windows 专属差异尽量集中在 Codex process resolver 这类底层边界模块，不进入 Bridge Core、渠道 adapter 或命令业务逻辑。

## 4. 已知问题：Windows 已安装 Codex CLI 但 Chat-Codex 报 `spawn codex ENOENT`

### 4.1 现象

用户环境：

- Windows
- Node.js `v22.22.0`
- Chat-Codex `0.1.1`
- Codex CLI `codex-cli 0.130.0`
- npm 全局 prefix: `D:\env\nvm\nodejs`

PowerShell 中验证：

```powershell
codex --version
where.exe codex
where.exe chat-codex
```

`codex --version` 可正常执行，`where.exe codex` 能找到：

```text
D:\env\nvm\nodejs\codex
D:\env\nvm\nodejs\codex.cmd
```

但 Node.js 直接执行：

```js
const { spawn } = require("node:child_process");
const p = spawn("codex", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
p.on("error", e => console.error("ERROR", e.code, e.message));
```

结果：

```text
ERROR ENOENT spawn codex ENOENT
```

Chat-Codex 因此启动时报：

```text
Codex 不可用: spawn codex ENOENT
```

### 4.2 初步判断

从现有信息看，这不是普通用户误操作。

PowerShell 能找到 `codex`，说明 Codex CLI 和 npm 全局 shim 大概率已安装；但 Node.js `spawn("codex")` 在 Windows 下没有可靠解析 npm 生成的无扩展 shim 或 `.cmd` shim，导致 Chat-Codex 当前“直接 spawn 裸命令名”的假设不成立。

官方 Codex 源码也印证了这个方向：

- npm wrapper 在 Windows 下使用 `codex.exe`，不是只依赖裸 `codex`。
- Codex Rust 侧也有程序解析逻辑，明确处理 Windows `.cmd`、`.bat` 等扩展名问题。

### 4.3 影响范围

当前项目中所有直接启动 Codex 的位置都可能受影响：

- `checkCodexCli()` 检测 Codex CLI 是否可用。
- app-server 模式启动：
  - `codex app-server --listen stdio://`
- exec adapter 模式启动：
  - `codex exec ...`

因此修复不能只改启动前检测，否则检测通过后真实运行仍可能失败。

## 5. 修复方向

### 5.1 新增 Codex 子进程解析边界

建议新增一个小模块，例如：

```text
src/codex/codex-process.ts
```

职责：

- 读取用户传入或环境变量中的 Codex 可执行文件配置。
- 在 Windows 下解析 npm shim、`.cmd`、`.exe`、`.bat`、`.com`。
- 为 `checkCodexCli()`、app-server adapter、exec adapter 提供同一套启动入口或解析结果。
- 统一生成错误信息和诊断提示。

### 5.2 支持环境变量覆盖

新增环境变量：

```text
CHAT_CODEX_BIN
```

用途：

- 指定 Codex CLI 的可执行文件路径或命令名。
- Windows 用户可临时设置为：

```powershell
$env:CHAT_CODEX_BIN="D:\env\nvm\nodejs\codex.cmd"
chat-codex
```

或：

```powershell
setx CHAT_CODEX_BIN "D:\env\nvm\nodejs\codex.cmd"
```

设计要求：

- 如果用户显式配置了路径，优先使用该路径。
- 如果用户显式配置不可用，错误信息应指出使用的是 `CHAT_CODEX_BIN`。
- README 环境变量表需要补充该变量。

### 5.3 Windows 默认解析策略

推荐策略：

1. 如果 `codexBin` 是显式路径，直接使用。
2. 如果 `codexBin` 已带扩展名，直接使用。
3. 如果平台不是 Windows，保持现有行为，默认使用 `codex`。
4. 如果平台是 Windows 且 `codexBin` 是默认 `codex`：
   - 优先按 PATH + PATHEXT 查找实际文件。
   - 命中 `codex.cmd`、`codex.exe`、`codex.bat`、`codex.com` 任一可执行入口后，使用解析后的完整路径。
   - 查找失败时，回退到 `codex.cmd` 或 `codex`，并在错误提示里给出手动配置建议。
5. 如果 Windows 下解析到 npm 生成的 `codex.cmd`：
   - 优先解析 npm cmd shim 指向的 JS wrapper，并用当前 Node.js 进程启动 wrapper，避免把 Codex prompt 直接交给 shell 拼接。
   - 只有无法解析 npm shim 时，才在底层 spawn helper 内局部走 `cmd.exe /c` fallback。

不建议第一选择：

- 全局 `shell: true`。
- 要求用户必须改 PATH。
- 要求用户必须切换终端。

### 5.4 错误提示要求

Codex 不可用时，错误信息应至少包含：

- 当前平台：`process.platform`
- 尝试启动的命令或路径。
- 如果设置了 `CHAT_CODEX_BIN`，显示该配置来自环境变量。
- Windows 下建议执行：

```powershell
where.exe codex
codex --version
```

- Windows 下建议临时修复：

```powershell
$env:CHAT_CODEX_BIN="D:\env\nvm\nodejs\codex.cmd"
chat-codex
```

### 5.5 `CHAT_CODEX_BIN` 必须贯穿完整启动链路

这个问题不是只影响启动前检测。当前代码里 Codex 检测、app-server adapter 和 exec adapter 都各自默认使用裸 `codex`，如果只让 `checkCodexCli()` 支持环境变量，而真实运行仍然 `spawn("codex")`，Windows 用户仍会在进入真实会话时失败。

修复时必须保证同一个解析结果贯穿：

```text
环境变量/默认值 -> Codex bin resolver -> checkCodexCli()
环境变量/默认值 -> Codex bin resolver -> AppServerCodexAdapter -> AppServerRpcClient
环境变量/默认值 -> Codex bin resolver -> ExecCodexAdapter
```

验收标准：

- `CHAT_CODEX_BIN` 设置为 `D:\env\nvm\nodejs\codex.cmd` 时，检测阶段使用该路径。
- app-server 模式真实启动 `codex app-server --listen stdio://` 时使用同一路径。
- exec 模式真实启动 `codex exec ...` 时使用同一路径。
- TUI、非 TUI fallback、测试入口和 CLI 入口不能各自维护一套默认值。

### 5.6 Chat-Codex 首页和运行页展示要求

Chat-Codex 的启动前首页/TUI 必须把 Codex CLI 接入状态展示出来，让用户能直接判断底层对接是否正常。

至少展示：

- 平台：例如 `win32 x64`、`darwin arm64`。
- Codex CLI：`已找到` / `不可用`。
- Codex 版本：来自 `codex --version`。
- Codex 路径：resolver 最终使用的命令或完整路径。
- 来源：默认 PATH/PATHEXT 解析，或 `CHAT_CODEX_BIN` 覆盖。

如果 Codex 不可用，首页/TUI 应显示错误摘要，并在启动服务前阻断真实 Codex 运行。非 TUI fallback 也应输出同等信息，避免用户只能从异常堆栈里判断问题。

运行日志页启动后也应保留一条系统信息，说明当前使用的 Codex CLI 版本和路径，方便用户截图反馈 Windows 兼容性问题。

## 6. 与 Codex 对接相关的路径边界

媒体下载和渠道投递属于业务层，不在本文档展开。但媒体一旦要交给 Codex，就跨过了 Codex 接入边界，需要保证传入 Codex 的本地路径在 Windows 下是可用的。

当前入站图片/文件的默认保存目录已经是用户固定目录：

```text
Windows: %USERPROFILE%\.chat-codex\uploads
macOS/Linux: ~/.chat-codex/uploads
```

也就是统一放在用户的 `.chat-codex` 下，不跟启动目录绑定。只有显式设置 `CHAT_CODEX_UPLOAD_DIR` 时才会覆盖。

Codex 接入层只关心这些边界：

- attachment 的 `localPath` 必须是本机绝对路径。
- 传给 Codex app-server 的 `localImage.path` 必须保留原始绝对路径。
- Codex 输出 `BRIDGE_SEND_FILE:` 后，出站文件提取要能识别当前平台的绝对路径。

Windows 相关例子：

```text
%USERPROFILE%\.chat-codex\uploads
D:\chat-codex\uploads\shot.png
D:\Chat Codex\result file.pdf
```

不要求在本文档里重新验收微信/飞书下载流程。下载失败、CDN、鉴权、文件大小、消息格式等问题仍回到 `inbound-media-design.zh-CN.md` 和各渠道 adapter 设计处理。

## 7. 测试要求

修复该问题时至少补充以下测试：

- 非 Windows 默认仍解析为 `codex`。
- Windows 默认 `codex` 能解析为带扩展名的 npm shim。
- `CHAT_CODEX_BIN` 优先级高于默认值。
- `checkCodexCli()` 使用统一解析逻辑。
- app-server adapter 和 exec adapter 不再各自裸 `spawn("codex")`。
- Codex 不可用时，错误信息包含 Windows 诊断提示。
- TUI 首页或 dashboard 能展示平台、Codex CLI 状态、版本、路径和来源。
- 如果修改到 Codex 本地文件路径传递，则补充 `BRIDGE_SEND_FILE:` 或 `localImage.path` 的 Windows 路径测试。

如果本机不是 Windows，必须用可注入 platform/env/PATH 的单元测试覆盖解析逻辑，并在测试报告里标明真实 Windows 需要用户或 CI 补测。

推荐执行：

```bash
npm run build
npm test
git diff --check
```

修复完成后新增中文测试报告：

```text
reports/tests/YYYY-MM-DD-windows-codex-bin-resolution.md
```

## 8. 后续 Windows 接入边界清单

后续发现或实现 Windows 兼容性内容时，只把影响 Codex 底层接入边界的问题补充到这里。

### 8.1 子进程和命令解析

- Codex CLI 路径解析。
- npm/pnpm/bun 全局 shim 解析。
- `PATH`、`Path`、`PATHEXT` 兼容。
- 子进程信号、终止和 `/stop` 行为。

### 8.2 Codex 路径边界

- Codex session 工作目录。
- 传给 Codex 的图片路径。
- Codex 产物文件路径。
- 带空格路径、中文路径、盘符路径。

### 8.3 非本文档主线

- TUI 终端显示问题回到 TUI 设计文档。
- 微信/飞书消息、登录、网络和媒体下载问题回到对应渠道文档。
- 状态持久化目录问题回到本地状态持久化文档。

## 9. 结论

当前 `spawn codex ENOENT` 问题应作为 Chat-Codex 的 Windows 兼容性 bug 处理。用户能在 PowerShell 中执行 `codex --version`，但 Chat-Codex 内部 Node.js `spawn("codex")` 失败，说明中间件不应继续依赖裸命令名解析。

优先落地方案是：新增统一 Codex 子进程解析模块，支持 `CHAT_CODEX_BIN` 覆盖，并在 Windows 下解析 `.cmd`、`.exe` 等可执行入口。这样可以同时修复检测、app-server 模式和 exec 模式，避免后续继续出现同类问题。
