> LINUX DO 讨论：[https://linux.do/t/topic/2183744](https://linux.do/t/topic/2183744)

# Codex Chat Bridge

Codex Chat Bridge 是一个轻量的 Codex 聊天渠道中间件。它把聊天消息统一转换成中间件协议，再路由到对应的 Codex session，让用户可以在微信或飞书私聊里创建会话、发送任务、处理审批、停止任务、查看状态和接收结果。

当前真实聊天渠道支持微信和飞书私聊。Terminal 和 Mock 通道主要用于本地开发、调试和自动化测试。本项目目前只明确做微信和飞书。

- English README: [README.en.md](README.en.md)
- 文档索引: [docs/README.md](docs/README.md)
- 开发规范: [docs/development-and-test.zh-CN.md](docs/development-and-test.zh-CN.md)
- 多渠道设计: [docs/multi-channel-design.zh-CN.md](docs/multi-channel-design.zh-CN.md)
- 本地持久化设计: [docs/local-state-persistence.zh-CN.md](docs/local-state-persistence.zh-CN.md)
- Agent 开发指南: [docs/agent-guide.zh-CN.md](docs/agent-guide.zh-CN.md)

## 使用场景

适合：

- 在手机微信或飞书私聊里远程驱动本机 Codex。
- 让 Codex 执行代码任务时，把审批请求推送到聊天端，用 `/OK`、`/P`、`/NO` 处理。
- 在聊天端查看当前 Codex session、模型、token 用量、队列、权限和运行状态。
- 在终端保留完整运行期通讯日志，便于观察真实对话流。
- 飞书私聊复用同一个 Bridge Core，先支持文本收发和默认进度投递。

当前不适合：

- 把 Codex app-server 直接暴露到公网。
- 多人群聊生产使用。微信当前只按已验证私聊能力启用；飞书当前只启用私聊文本。
- 手工编辑多渠道状态文件。日常应通过 `npm run chat-codex` 进入交互式管理。
- 作为 OpenClaw 插件运行。本项目运行时不依赖 OpenClaw CLI、OpenClaw gateway、OpenClaw host runtime 或 OpenClaw channel runtime。

## 当前状态

已实现：

- 通用 `ChannelAdapter` 协议。
- Mock、Terminal、Weixin、Feishu 四类渠道适配器。
- 默认 `codex app-server` 适配器，支持创建/恢复 Codex thread、启动 turn、中断 turn、token usage 状态和交互审批。
- `codex exec --json` 回退适配器。
- 微信二维码登录、终端二维码展示、备用登录链接、账号 token 本地保存、文本/图片/文件发送、`getupdates` 轮询。
- 飞书私聊文本收发、WebSocket 事件接收、消息去重、默认进度投递，以及基于 `Typing` reaction 的处理中提示。
- 聊天侧命令：`/new`、`/resume`、`/status`、`/stop`、`/OK`、`/P`、`/NO`、`/permission`、`/plan`、`/code`、`/goal`、`/model`、`/sendfile` 等。微信和飞书私聊复用同一套 Bridge 命令。
- 终端运行期 transcript，打印微信入站、Codex 出站、媒体发送和本地可见的阶段性进度。
- 核心多渠道内核：`ChannelRegistry`、`SessionBindings`、`TurnScheduler`。

当前边界：

- 真实聊天渠道目前支持微信和飞书私聊文本。
- 微信当前按已验证私聊能力运行：`direct=true, group=false, thread=false`。
- 飞书当前按已验证私聊文本能力运行：`direct=true, group=false, thread=false`；已接入统一 Bridge 命令、默认进度投递和处理中提示，媒体、卡片聚合和群聊 thread 仍在后续适配范围。
- 已提供统一启动入口 `npm run chat-codex`：可管理多个微信账号和多个飞书机器人，启动所有已启用渠道；不再暴露微信/飞书单渠道 Codex 启动入口。
- 本地文件持久化第一阶段已落地：真实微信/飞书启动会使用 `state/bridge/routes.json`、`state/bridge/session-owners.json`、`state/bridge/session-policies.json`、`state/bridge/pending-bindings.json` 恢复聊天绑定、session 占用、session 权限和待生效微信主聊天绑定。
- 当前主要在 macOS 上完整开发和验证；Windows 理论上支持，但请先自行完整验证后再用于正式场景。

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
- macOS 已完整验证；Windows 请先自行验证 `npm test`、微信登录、`chat-codex`、文件路径和 Ctrl+C 停止行为。

安装：

```bash
npm install
```

### 3. 构建和测试

```bash
npm run build
npm test
```

### 4. 启动 Chat Codex

推荐使用主入口：

```bash
npm run chat-codex
```

这个入口会进入统一启动交互，用于检查 Codex、管理渠道、管理聊天绑定、设置权限并启动服务。微信账号添加后会引导绑定主聊天 session；飞书机器人添加后不会选择 session，等真实私聊产生 `chat_id` 后再到“聊天绑定”里绑定。

后续作为 npm 包安装后，对外可执行命令是：

```bash
chat-codex
```

入口选择建议：

- 日常使用微信和飞书：优先 `npm run chat-codex`。
- 只想检查某个渠道状态：使用 `npm run cli:weixin:status` 或 `npm run cli:feishu:status`。
- 本地开发和测试：使用 Terminal 或 Mock 入口，避免依赖真实聊天平台。

### 5. 配置微信账号

```bash
npm run chat-codex
```

进入统一启动交互后，在“管理渠道”里添加或管理微信账号；微信扫码成功后会引导选择这个微信主聊天使用的 Codex session，最后回到首页选择“启动服务”才会真正开始工作。

首次启动时，如果本地没有有效微信登录态，终端会显示二维码和备用登录链接。扫码登录成功后，如果真实微信私聊 route 还没出现，CLI 会保存一个待生效绑定；收到第一条微信私聊后再落到真实 route。

运行期间保持终端不要关闭。终端会打印完整通讯日志，包括：

- 微信入站消息。
- 发回微信的 Codex 回复。
- 媒体发送记录。
- 微信策略不投递、但本地可见的 Codex 阶段性进度。

停止服务：

```text
Ctrl+C
```

### 6. 配置飞书机器人

飞书第一阶段使用自建应用的 App ID / App Secret，通过 WebSocket 长连接接收私聊文本消息。

飞书开发者后台需要完成：

- 创建自建应用并启用机器人能力。
- 开启事件订阅，连接方式使用 WebSocket。
- 订阅接收消息事件 `im.message.receive_v1`。
- 把应用发布或安装到目标飞书租户，并确保当前用户可以和机器人私聊。

`npm run cli:feishu:status` 只能验证 App ID / App Secret 是否可用，以及机器人身份是否能查询成功；它不能证明事件订阅已经生效。真正的端到端验证需要在 `npm run chat-codex` 里添加飞书机器人并启动服务，再在飞书里给机器人发送私聊文本。

推荐把真实密钥放在本机忽略目录，例如 `secrets/feishu.local.md`，再在启动前导出环境变量：

```bash
export FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
export FEISHU_APP_SECRET=your-secret
export FEISHU_DOMAIN=feishu
export FEISHU_ACCOUNT_ID=default
```

`secrets/` 已加入 `.gitignore`，不要把真实 secret 写进 README、测试报告或提交内容。

查看配置状态：

```bash
npm run cli:feishu:status
```

添加飞书机器人并启动服务：

```bash
npm run chat-codex
```

统一交互里的“添加飞书机器人”会直接提示手动输入 App ID / App Secret；输入值会保存到本机 `state/channels/feishu/<channelId>/accounts/<accountId>/credentials.local.json`，重启后自动读取。`state/` 已被 `.gitignore` 忽略，不会写入 Git 跟踪文件；环境变量 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 仍可作为覆盖或手动运行来源。

飞书出站消息优先使用 `im.message.reply`，也就是基于用户刚发来的消息做上下文回复；如果 reply 因平台限制或上下文失效失败，会回退到 `im.message.create`，直接向当前 `chat_id` 发送一条新消息。这样做的目的是优先保留对话上下文，同时避免最终回复因为 reply 失败而丢失。

## 技术架构

```text
聊天用户
  |
  v
WeixinAdapter / FeishuAdapter
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
              +--> FeishuAdapter
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
feishu:default:direct:oc_xxx
feishu:work:group:chat-456
feishu:work:thread:thread-789
```

其中微信和飞书当前实际启用的是 `direct` 私聊 route；`group`、`thread` 是统一协议预留形态，等后续渠道能力验证后再开放。

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
│   │   ├── feishu/
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
| `npm run chat-codex` | 主启动入口 | TTY 下进入 Ink TUI；管理微信账号、飞书机器人和聊天绑定，并启动所有已启用渠道 |
| `npm run cli:chat-codex` | 主启动入口别名 | 与 `npm run chat-codex` 相同 |
| `npm run cli:mock` | Mock 闭环演示 | 不需要真实 Codex 或微信 |
| `npm run cli:terminal:mock` | 终端通道 + MockCodex | 用终端模拟聊天渠道 |
| `npm run cli:terminal:codex` | 终端通道 + 真实 Codex | 用终端直接和真实 Codex 通信 |
| `npm run cli:weixin:status` | 查看微信登录状态 | 不启动长轮询 |
| `npm run cli:weixin:login` | 单独微信扫码登录 | 终端显示二维码和备用链接 |
| `npm run cli:feishu:status` | 查看飞书配置状态 | 检查 App ID / App Secret，并查询机器人身份；不验证事件订阅 |

### 主启动命令

```bash
npm run chat-codex
```

`npm run chat-codex` 是面向日常使用的主入口；`npm run cli:chat-codex` 是同等别名。TTY 环境下默认进入 Ink TUI，包含 Codex 检查、渠道账号管理、聊天绑定管理、权限设置、工作目录设置和启动确认。需要回到普通 prompt 交互时可加 `-- --no-tui`。

微信和飞书不再暴露单渠道 Codex 启动入口。统一入口会从本地配置读取所有已启用的微信账号和飞书机器人，并在启动服务时一起启动。

### 微信辅助命令

查看登录态：

```bash
npm run cli:weixin:status
```

单独登录：

```bash
npm run cli:weixin:login
```

这两个命令只做微信状态检查或单独扫码登录，不启动 Codex 服务。真实使用请运行 `npm run chat-codex`，进入“管理渠道”添加微信账号，配置微信主聊天绑定后回到首页选择“启动服务”。旧版微信单渠道 Codex 入口和旧版直连入口已移除。

### 飞书配置和状态命令

飞书没有微信式扫码登录，本地需要提供自建应用机器人凭证：

```bash
export FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
export FEISHU_APP_SECRET=your-secret
export FEISHU_DOMAIN=feishu
export FEISHU_ACCOUNT_ID=default
```

推荐把真实值只放在本机 `secrets/feishu.local.md`，启动前手动导出；`secrets/` 不提交。

查看状态：

```bash
npm run cli:feishu:status
```

这个命令只验证 App ID / App Secret 和机器人身份，不启动 WebSocket 事件接收。真实使用请运行 `npm run chat-codex`，进入“管理渠道”添加飞书机器人，配置完成后回到首页选择“启动服务”。飞书私聊 routeKey 形如 `feishu:<accountId>:direct:<chat_id>`。Bridge 命令和微信共用一套实现；飞书默认允许 `/progress brief|detailed|silent`，并会投递默认简洁进度。

处理 Codex 任务期间，飞书 adapter 会在用户原消息上添加 `Typing` 表情作为“正在处理”的视觉提示；任务完成、失败或停止后会尽量移除该表情。这个能力来自飞书 reaction API，不是平台原生输入状态。

飞书真实接入的判断标准：

- `cli:feishu:status` 成功：只说明凭证可用、机器人身份可查询。
- `chat-codex` 启动服务成功：说明本机 WebSocket 长连接已建立。
- 用户在飞书私聊发消息后 Bridge 收到入站并回复：才说明事件订阅、机器人权限、私聊能力和 Bridge 路由全部打通。

出站文本优先走 `im.message.reply`，用于回复具体入站消息；如果 reply 失败，则回退到 `im.message.create`，向同一个 `chat_id` 发送普通新消息。进度消息和没有入站上下文的主动消息更依赖 `create` 语义，普通问答的最终回复优先保持 reply 语义。

### 启动参数

| 参数 | 可选值 | 说明 |
| --- | --- | --- |
| `--session` | `new` / `last` / `<sessionId>` | 作为首个私聊 route 预设；不会把 session 全局绑定到整个渠道账号 |
| `--cwd` / `--workdir` | 目录路径 | 只用于新会话；目录不存在会自动创建 |
| `--codex-adapter` / `--adapter` | `app-server` / `exec` | 默认 `app-server`；`exec` 是非交互回退 |
| `--permission` | `approval` / `full` | 默认 `approval`；`full` 跳过审批和沙箱 |
| `--yes-dangerously-full` | 无 | 非交互确认 `full` 权限，高风险 |
| `--progress` / `--progress-mode` | `brief` / `detailed` / `silent` | 设置非微信渠道默认进度投递模式；微信禁用阶段性进度投递 |

## 聊天内命令

这些命令从微信或飞书私聊里发送。命令消息不会进入普通 prompt 队列，会立即处理。

| 命令 | 用途 | 详细说明 |
| --- | --- | --- |
| `/help` | 查看命令 | 返回当前渠道可用命令。微信渠道会隐藏不可用的 `/progress`；飞书私聊会显示 `/progress`。 |
| `/new` | 创建会话 | 为当前聊天 route 创建新的 Codex session，并设为 active session。 |
| `/resume [session\|编号]` | 恢复会话 | 不带参数时进入会话选择，直接回复数字即可绑定；也可传 session ID 或编号。若该 session 已属于其他 route，会拒绝。 |
| `/use [session\|编号]` | 切换会话 | 与 `/resume` 类似，用于切换当前 route 的 active session；ID 输错时会展示可选列表，不再直接抛底层错误。 |
| `/sessions` | 当前 route 会话列表 | 只展示当前 route 拥有或绑定过的 session。 |
| `/sessions all` | 全部可发现会话 | 展示本机可发现 Codex 历史 session ID；长标题会自动省略，后续多渠道管理中会收紧敏感信息展示。 |
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
| `/progress [brief\|detailed\|silent]` | 进度投递 | 非微信渠道可用；微信渠道会拒绝，因为微信进度投递已通过渠道策略禁用。 |
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

每轮最多发送 3 个文件。协议行不会展示给聊天用户。微信当前支持图片/文件发送；飞书第一阶段只支持文本，媒体发送会在后续适配。

## 配置说明

当前没有需要手工编辑并提交到仓库的配置文件入口。

现阶段配置来自：

- CLI 启动参数，例如 `--session`、`--cwd`、`--permission`、`--codex-adapter`。
- 微信本地登录态，默认保存在 `state/weixin/`。
- 飞书环境变量：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_DOMAIN`、`FEISHU_ACCOUNT_ID`。
- 中间件本地状态，默认保存在 `state/bridge/`，用于恢复渠道实例、聊天绑定、session owner、session 权限和待生效绑定。
- Codex 自身历史 session 和本地配置。

`state/weixin/` 已被 `.gitignore` 忽略，不会提交。要重新登录微信，可以停止中间件后删除 `state/weixin/`，再运行：

```bash
npm run cli:weixin:login
```

飞书真实密钥建议放在本机忽略目录：

```text
secrets/feishu.local.md
```

该文件可以记录本地导出命令或变量名，但不要加入 Git。例如只在本机写：

```bash
export FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
export FEISHU_APP_SECRET=your-secret
export FEISHU_DOMAIN=feishu
export FEISHU_ACCOUNT_ID=default
```

仓库文档和测试报告只能写变量名、路径和示例占位值，不能写真实 `FEISHU_APP_SECRET`。

多渠道配置交互见 [docs/cli-core-interaction-design.zh-CN.md](docs/cli-core-interaction-design.zh-CN.md)，本地文件持久化见 [docs/local-state-persistence.zh-CN.md](docs/local-state-persistence.zh-CN.md)。

轻量多渠道启动向导：

```bash
npm run chat-codex
npm run cli:chat-codex
```

当前主入口会读取本地渠道实例配置，启动所有已启用的微信账号和飞书机器人。配置阶段不会启动微信长轮询或飞书 WebSocket；只有回到首页选择“启动服务”后才进入常驻服务。

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
- [docs/local-state-persistence.zh-CN.md](docs/local-state-persistence.zh-CN.md)：本地文件持久化、渠道账号目录和 session owner 约束。
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
- `secrets/`
- token、cookie、日志、`.env`
- `openclaw-weixin-npm/`
- `references/` 下除 `README.md` 外的本地参考源码

## 安全说明

- `full` 权限会跳过审批和沙箱，风险很高。
- 微信登录 token 保存在本地 `state/weixin/`，不要提交或共享。
- 飞书 App Secret 可以放在本机环境变量、`secrets/`，或交互添加后写入被 Git 忽略的 `state/channels/feishu/.../credentials.local.json`；不要写入 Git 跟踪文件。
- Codex app-server 不应直接暴露到公网；需要远程使用时应通过 localhost、SSH 转发、VPN 或受控网络。
- 多渠道模式下，一个 Codex session 只能属于一个 route，避免审批、文件和上下文串线。

## 路线图

- TUI 运行期状态页继续增强，例如最近 transcript、任务队列和审批状态面板。
- 本地文件持久化的 schema 迁移、损坏恢复和 CLI 清理工具。
- 飞书群聊、thread、媒体和卡片聚合。
- RouteRuntime 拆分，继续降低 Bridge Core 文件复杂度。
- 更完整的多渠道 transcript 和管理状态视图。

## 许可证

本项目使用 [MIT License](LICENSE)。

作者：小黄 and Codex
