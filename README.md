# Codex Chat Bridge

Codex Chat Bridge 是一个轻量的 Codex 聊天渠道中间件。它把聊天消息统一转换成中间件协议，再路由到对应的 Codex session，让用户可以在微信里创建会话、发送任务、处理审批、停止任务、查看状态和接收结果。

当前真实聊天渠道仅支持微信。Terminal 和 Mock 通道主要用于本地开发、调试和自动化测试；飞书、Telegram、Slack 等渠道还没有真实适配。

- English README: [README.en.md](README.en.md)
- 文档索引: [docs/README.md](docs/README.md)
- 开发规范: [docs/development-and-test.zh-CN.md](docs/development-and-test.zh-CN.md)
- 多渠道设计: [docs/multi-channel-design.zh-CN.md](docs/multi-channel-design.zh-CN.md)
- Agent 开发指南: [docs/agent-guide.zh-CN.md](docs/agent-guide.zh-CN.md)

## 使用场景

适合：

- 在手机微信里远程驱动本机 Codex。
- 让 Codex 执行代码任务时，把审批请求推送到微信里用 `/OK`、`/P`、`/NO` 处理。
- 用微信查看当前 Codex session、模型、token 用量、队列、权限和运行状态。
- 在终端保留完整运行期通讯日志，便于观察真实对话流。
- 后续扩展飞书、Telegram、Slack 等渠道时复用同一个 Bridge Core。

当前不适合：

- 把 Codex app-server 直接暴露到公网。
- 多人群聊生产使用。微信当前只按已验证私聊能力启用。
- 通过配置文件管理多渠道。当前没有配置文件入口，多渠道配置交互仍在设计中。
- 作为 OpenClaw 插件运行。本项目运行时不依赖 OpenClaw CLI、OpenClaw gateway、OpenClaw host runtime 或 OpenClaw channel runtime。

## 当前状态

已实现：

- 通用 `ChannelAdapter` 协议。
- Mock、Terminal、Weixin 三类渠道适配器。
- 默认 `codex app-server` 适配器，支持创建/恢复 Codex thread、启动 turn、中断 turn、token usage 状态和交互审批。
- `codex exec --json` 回退适配器。
- 微信二维码登录、终端二维码展示、备用登录链接、账号 token 本地保存、文本/图片/文件发送、`getupdates` 轮询。
- 微信侧命令：`/new`、`/resume`、`/status`、`/stop`、`/OK`、`/P`、`/NO`、`/permission`、`/plan`、`/code`、`/goal`、`/model`、`/sendfile` 等。
- 终端运行期 transcript，打印微信入站、Codex 出站、媒体发送和本地可见的阶段性进度。
- 核心多渠道内核：`ChannelRegistry`、`SessionBindings`、`TurnScheduler`。

当前边界：

- 真实聊天渠道目前仅支持微信。
- 微信当前按已验证私聊能力运行：`direct=true, group=false, thread=false`。
- 飞书/Telegram/Slack 等真实渠道未实现。
- 多渠道启动向导、渠道实例管理和本地运行状态持久化还未实现。

## 快速开始

### 1. 拉取完整源码

推荐直接拉取完整仓库源码，不要只复制单个文件或只下载构建产物。

```bash
git clone git@github.com:uluckyXH/codex-chat-bridge.git
cd codex-chat-bridge
```

如果不能使用 SSH，也可以用 HTTPS：

```bash
git clone https://github.com/uluckyXH/codex-chat-bridge.git
cd codex-chat-bridge
```

本地参考源码例如 `openclaw-weixin-npm/`、`references/openai-codex/`、`references/openclaw-lark/` 不随仓库提交。需要排查协议时按 [references/README.md](references/README.md) 说明单独拉取。

### 2. 安装依赖

要求：

- Node.js >= 22
- npm
- 本机可用的 Codex CLI

安装：

```bash
npm install
```

### 3. 构建和测试

```bash
npm run build
npm test
```

### 4. 启动微信 + Codex

```bash
npm run cli:weixin:codex
```

首次启动时，如果本地没有有效微信登录态，终端会显示二维码和备用登录链接。扫码登录成功后，中间件会启动微信长轮询，并把微信消息路由到 Codex。

运行期间保持终端不要关闭。终端会打印完整通讯日志，包括：

- 微信入站消息。
- 发回微信的 Codex 回复。
- 媒体发送记录。
- 微信策略不投递、但本地可见的 Codex 阶段性进度。

停止服务：

```text
Ctrl+C
```

## 技术架构

```text
微信用户
  |
  v
WeixinAdapter
  |
  | ChannelMessage / ChannelTarget
  v
ChannelRegistry
  |
  v
Bridge Core
  |-- Command Router
  |-- Route Queue
  |-- ApprovalManager
  |-- SessionBindings
  |-- TurnScheduler
  |
  v
CodexAdapter
  |-- AppServerCodexAdapter（默认）
  |-- ExecCodexAdapter（回退）
  |
  v
Codex CLI / Codex app-server
```

多渠道目标架构：

```text
Codex Adapter
      ^
      |
Bridge Core
      |
      +--> Channel Registry
              +--> WeixinAdapter
              +--> TerminalChannelAdapter
              +--> MockChannelAdapter
              +--> future Lark/Telegram/Slack adapters
```

核心边界：

- Codex 侧只通过 `CodexAdapter` 交互。
- 渠道侧只通过 `ChannelAdapter` 交互。
- Bridge Core 只负责通用路由、队列、session 绑定、审批、权限和 Codex turn 调度。
- 登录、平台 token、游标、群聊/thread 映射、限流、重试、typing、媒体上传等都属于具体渠道 adapter。
- 不同渠道的投递差异通过 `ChannelCapabilities` 和 `ChannelDeliveryPolicy` 表达，不在 Bridge Core 写平台分支。

统一 route key：

```text
<channelId>:<accountId>:<conversationKind>:<conversationId>
```

示例：

```text
weixin:wx-account-1:direct:user-123
lark-work:lark-bot-1:group:chat-456
lark-work:lark-bot-1:thread:thread-789
```

同一个 route 的普通消息永远串行处理；不同 route 可以并行运行不同 Codex session。一个 Codex session 只能属于一个 route。

## 项目结构

```text
.
├── README.md                         # 默认简体中文入口文档
├── README.en.md                      # 英文说明
├── package.json                      # npm scripts 和依赖
├── src/
│   ├── bridge/                       # Bridge Core、队列、调度
│   ├── channels/                     # 具体渠道适配器
│   │   ├── mock/
│   │   ├── terminal/
│   │   └── weixin/
│   ├── codex/                        # Codex adapter、CLI/app-server 接入
│   ├── commands/                     # 命令解析
│   ├── approvals/                    # 审批状态
│   ├── protocol/                     # 通用渠道协议
│   ├── state/                        # 状态和 session binding
│   └── logging/                      # 日志和 transcript
├── tests/
│   ├── unit/                         # 单元测试
│   └── integration/                  # 集成测试
├── docs/                             # 需求、设计、开发规范
├── reports/tests/                    # 中文测试报告
├── references/                       # 本地参考源码说明；源码本身不提交
└── state/                            # 本地运行态；不提交
```

## 命令使用说明

### npm scripts

| 命令 | 用途 | 说明 |
| --- | --- | --- |
| `npm run build` | 编译 TypeScript | 输出到 `dist/`，`dist/` 不提交 |
| `npm test` | 完整测试 | 先 build，再运行 unit + integration |
| `npm run test:unit` | 单元测试 | 验证协议、命令、状态、适配器等局部行为 |
| `npm run test:integration` | 集成测试 | 验证 Bridge、Codex adapter 和 channel adapter 协作 |
| `npm run cli:mock` | Mock 闭环演示 | 不需要真实 Codex 或微信 |
| `npm run cli:terminal:mock` | 终端通道 + MockCodex | 用终端模拟聊天渠道 |
| `npm run cli:terminal:codex` | 终端通道 + 真实 Codex | 用终端直接和真实 Codex 通信 |
| `npm run cli:weixin:status` | 查看微信登录状态 | 不启动长轮询 |
| `npm run cli:weixin:login` | 单独微信扫码登录 | 终端显示二维码和备用链接 |
| `npm run cli:weixin:codex` | 启动微信 + Codex | 当前主要真实使用入口 |

### 微信启动命令

查看登录态：

```bash
npm run cli:weixin:status
```

单独登录：

```bash
npm run cli:weixin:login
```

启动服务：

```bash
npm run cli:weixin:codex
```

恢复最近 Codex 会话：

```bash
npm run cli:weixin:codex -- --session last --permission approval
```

创建新 Codex 会话并指定工作目录：

```bash
npm run cli:weixin:codex -- --session new --cwd ./workspaces/demo --permission approval
```

使用非交互回退 adapter：

```bash
npm run cli:weixin:codex -- --codex-adapter exec
```

### 启动参数

| 参数 | 可选值 | 说明 |
| --- | --- | --- |
| `--session` | `new` / `last` / `<sessionId>` | 启动后绑定新会话、最近会话或指定 Codex session |
| `--cwd` / `--workdir` | 目录路径 | 只用于新会话；目录不存在会自动创建 |
| `--codex-adapter` / `--adapter` | `app-server` / `exec` | 默认 `app-server`；`exec` 是非交互回退 |
| `--permission` | `approval` / `full` | 默认 `approval`；`full` 跳过审批和沙箱 |
| `--yes-dangerously-full` | 无 | 非交互确认 `full` 权限，高风险 |
| `--progress` / `--progress-mode` | `brief` / `detailed` / `silent` | 设置非微信渠道默认进度投递模式；微信禁用阶段性 progress |

## 微信内命令

这些命令从微信里发送。命令消息不会进入普通 prompt 队列，会立即处理。

| 命令 | 用途 | 详细说明 |
| --- | --- | --- |
| `/help` | 查看命令 | 返回当前渠道可用命令。微信渠道会隐藏不可用的 `/progress`。 |
| `/new` | 创建会话 | 为当前微信私聊 route 创建新的 Codex session，并设为 active session。 |
| `/resume <session>` | 恢复会话 | 恢复指定 Codex session，并绑定到当前 route。若该 session 已属于其他 route，会拒绝。 |
| `/use <session>` | 切换会话 | 与 `/resume` 类似，用于切换当前 route 的 active session。 |
| `/sessions` | 当前 route 会话列表 | 只展示当前 route 拥有或绑定过的 session。 |
| `/sessions all` | 全部可发现会话 | 展示本机可发现 Codex 历史 session ID；后续多渠道管理中会收紧敏感信息展示。 |
| `/status` | 状态查看 | 展示 session、模型、上下文 token、累计 token、队列、审批、权限、进度策略和渠道状态。 |
| `/whoami` | 当前身份 | 展示当前 channel、route、sender 和 conversation 信息。 |
| `/debug` | 调试状态 | 展示 capability、delivery policy、本地 session 数等调试信息。 |
| `/stop` | 停止当前任务 | 停止当前 route 正在运行的 Codex turn，并清理当前 route 后续普通 prompt 队列。 |
| `/OK` | 批准审批 | 批准当前 route 最新 pending approval。 |
| `/P` | 持久批准 | 按当前 Codex session 批准审批，后续同类操作尽量不再询问，取决于 Codex 支持情况。 |
| `/NO` | 拒绝审批 | 拒绝当前 route 最新 pending approval。 |
| `/permission` | 查看权限 | 不带参数时查看当前 session 权限模式。 |
| `/permission approval` | 切回审批模式 | 后续 turn 使用审批沙箱。 |
| `/permission full confirm` | 切到完全权限 | 跳过审批和沙箱，必须显式带 `confirm`。 |
| `/plan` | 进入计划模式 | 切换当前 route 后续任务到 Plan mode。 |
| `/plan <任务>` | 计划模式处理任务 | 先切到 Plan mode，再把任务交给 Codex。执行后不会自动退出 Plan mode。 |
| `/code` | 切回执行模式 | 切回默认执行模式。 |
| `/code <任务>` | 执行模式处理任务 | 先切回默认执行模式，再把任务交给 Codex。 |
| `/goal` | 查看 Goal | 查看当前 Codex thread 的实验 Goal 状态。 |
| `/goal <目标>` | 设置 Goal | 设置当前 thread 长期目标；需要 Codex 启用 `features.goals`。 |
| `/goal pause` | 暂停 Goal | 保留目标，但暂时不让 Codex 按它推进。 |
| `/goal resume` | 恢复 Goal | 恢复已暂停的目标追踪。 |
| `/goal clear` | 清除 Goal | 退出当前 session 的 Goal 追踪。 |
| `/model` | 查看模型 | 从 Codex app-server 获取当前真实可用模型列表。 |
| `/model all` | 查看隐藏模型 | 模型列表包含隐藏项。 |
| `/model <模型或编号> [effort]` | 切换模型 | 例如 `/model gpt-5.5 xhigh` 或 `/model 2 high`。 |
| `/model effort <effort>` | 只切换思考程度 | 在已有模型上下文下修改 reasoning effort。 |
| `/model default` | 清除覆盖 | 清除当前 session 的模型覆盖设置。 |
| `/sendfile <任务>` | 发送文件任务 | 允许 Codex 本轮在最终回复声明文件并由 Bridge 发送。普通消息不会自动发文件。 |
| `/progress [brief\|detailed\|silent]` | 进度投递 | 非微信渠道可用；微信渠道会拒绝，因为微信 progress 已通过投递策略禁用。 |
| `/fff` | 微信静默刷新 | 微信专用 refresh 命令，不回复、不入队、不转发给 Codex。 |

## 文件发送

普通回复里的本地路径、Markdown 图片和 `file://` 不会自动发送文件，只会当文本展示。

需要让 Codex 本轮生成并发送文件时，发送：

```text
/sendfile <任务内容>
```

Bridge 只解析 Codex 最终回复末尾的内部协议行：

```text
BRIDGE_SEND_FILE: /absolute/path/to/file
```

每轮最多发送 3 个文件。协议行不会展示给微信用户。

## 配置说明

当前没有配置文件入口。

现阶段配置来自：

- CLI 启动参数，例如 `--session`、`--cwd`、`--permission`、`--codex-adapter`。
- 微信本地登录态，默认保存在 `state/weixin/`。
- Codex 自身历史 session 和本地配置。

`state/weixin/` 已被 `.gitignore` 忽略，不会提交。要重新登录微信，可以停止中间件后删除 `state/weixin/`，再运行：

```bash
npm run cli:weixin:login
```

多渠道配置交互、本地运行状态持久化和渠道实例管理见 [docs/multi-channel-design.zh-CN.md](docs/multi-channel-design.zh-CN.md)，尚未作为 CLI 功能落地。

## 测试和测试报告

运行完整测试：

```bash
npm test
```

运行格式检查：

```bash
git diff --check
```

项目要求每次功能开发或真实通道修复都留下中文测试报告：

- 测试报告目录: [reports/tests/](reports/tests/)
- 测试报告规范: [docs/development-and-test.zh-CN.md](docs/development-and-test.zh-CN.md)
- 本次 README 标准化报告: [reports/tests/2026-05-15-readme-open-source-standardization.md](reports/tests/2026-05-15-readme-open-source-standardization.md)

## 文档索引

- [docs/README.md](docs/README.md)：文档索引和推荐阅读顺序。
- [docs/requirements.zh-CN.md](docs/requirements.zh-CN.md)：需求、边界和命令要求。
- [docs/technical-design.zh-CN.md](docs/technical-design.zh-CN.md)：技术设计和架构说明。
- [docs/channel-delivery-policy.zh-CN.md](docs/channel-delivery-policy.zh-CN.md)：渠道投递策略。
- [docs/multi-channel-design.zh-CN.md](docs/multi-channel-design.zh-CN.md)：多渠道、route/session 绑定、并发和配置交互设计。
- [docs/development-and-test.zh-CN.md](docs/development-and-test.zh-CN.md)：开发与测试规范。
- [docs/git-management.zh-CN.md](docs/git-management.zh-CN.md)：Git 管理规范。
- [docs/agent-guide.zh-CN.md](docs/agent-guide.zh-CN.md)：Agent 开发指南。
- [references/README.md](references/README.md)：本地参考源码获取方式。

## 开发规范

开发前先读：

1. [docs/README.md](docs/README.md)
2. [docs/development-and-test.zh-CN.md](docs/development-and-test.zh-CN.md)
3. [docs/git-management.zh-CN.md](docs/git-management.zh-CN.md)
4. [docs/multi-channel-design.zh-CN.md](docs/multi-channel-design.zh-CN.md)

提交前至少检查：

```bash
git status --short --ignored
npm test
```

不要提交：

- `node_modules/`
- `dist/`
- `state/`
- token、cookie、日志、`.env`
- `openclaw-weixin-npm/`
- `references/` 下除 `README.md` 外的本地参考源码

## 安全说明

- `full` 权限会跳过审批和沙箱，风险很高。
- 微信登录 token 保存在本地 `state/weixin/`，不要提交或共享。
- Codex app-server 不应直接暴露到公网；需要远程使用时应通过 localhost、SSH 转发、VPN 或受控网络。
- 多渠道模式下，一个 Codex session 只能属于一个 route，避免审批、文件和上下文串线。

## 路线图

- 多渠道 CLI 启动向导和渠道实例管理。
- 本地运行状态持久化。
- 飞书私聊、群聊和 thread adapter。
- RouteRuntime 拆分，继续降低 Bridge Core 文件复杂度。
- 更完整的多渠道 transcript 和管理状态视图。

## 许可证

本项目使用 [MIT License](LICENSE)。

作者：小黄 and Codex
