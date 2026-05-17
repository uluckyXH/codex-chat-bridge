# 大型核心文件模块化拆分设计

## 背景

Bridge 拆分后，项目主代码中仍有两个超过 1000 行的核心业务文件：

```text
src/codex/app-server-codex-adapter.ts
src/cli/serve.ts
```

这两个文件都不是单纯的声明式数据或测试样例，而是承载了多组业务职责。继续在单文件内扩展会带来：

- 局部改动难以判断副作用。
- 协议、状态、交互、格式化和生命周期逻辑混在一起。
- 单测边界不清，测试失败后定位成本高。
- 新功能容易继续堆进入口文件，形成新的单体核心。

因此需要按开发规范继续拆分，同时保持现有全部功能、命令、TUI/CLI 交互和测试行为不变。

## 目标

1. 拆分 `src/codex/app-server-codex-adapter.ts`，让 Codex app-server 适配器按协议、会话、turn、审批、模型、权限、Goal、输入映射等职责组织。
2. 拆分 `src/cli/serve.ts`，让 `chat-codex` 启动入口按启动准备、渠道管理、微信配置、飞书配置、聊天绑定、Codex 设置和运行期启动等职责组织。
3. 保留现有对外入口和 import 路径，避免影响调用方。
4. 拆分过程不改变现有外部行为。
5. 每拆一个模块，都要有对应功能测试或在测试报告中明确现有测试覆盖路径。

## 非目标

- 不重写 Codex app-server 协议。
- 不改变 `CodexAdapter` 接口。
- 不改变 `chat-codex` 命令入口。
- 不改变 TUI/CLI 页面、快捷键和默认流程。
- 不改变微信/飞书配置语义。
- 不改变 session 工作目录、权限、模型、Goal、progress、sendfile、stop 等既有行为。
- 不顺手清理无关历史代码或无关 UI 文案。

## 拆分前旧文件备份策略

这次继续沿用 Bridge 拆分时的方式：**原版代码先不删，先改名保留为对照备份，然后创建新的同名入口文件开始拆分。**

### app-server 适配器备份

实施前先保留当前单体实现：

```text
src/codex/app-server-codex-adapter.monolith.snapshot.ts.bak
```

然后重新创建同名入口：

```text
src/codex/app-server-codex-adapter.ts
```

新的 `app-server-codex-adapter.ts` 只保留 `AppServerCodexAdapter` 对外入口和装配逻辑，具体能力逐步迁移到 `src/codex/app-server/` 下。

### serve 入口备份

实施前先保留当前单体实现：

```text
src/cli/serve.monolith.snapshot.ts.bak
```

然后重新创建同名入口：

```text
src/cli/serve.ts
```

新的 `serve.ts` 继续导出 `runServe`，只保留入口编排；普通 CLI 子流程、渠道配置、绑定设置和运行期启动逐步迁移到 `src/cli/serve/` 下。

### 备份校验

备份文件必须满足：

- 内容与拆分前原文件完全一致。
- 使用 `.ts.bak` 后缀，便于阅读但不进入 TypeScript 编译。
- 不作为运行时代码 import。
- 拆分期间用于对照迁移和 review。

建议在测试报告中记录校验命令：

```bash
git show HEAD:src/codex/app-server-codex-adapter.ts | cmp - src/codex/app-server-codex-adapter.monolith.snapshot.ts.bak
git show HEAD:src/cli/serve.ts | cmp - src/cli/serve.monolith.snapshot.ts.bak
```

如果拆分不是从 `HEAD` 开始，而是从当前工作区未提交状态开始，则测试报告必须写清楚备份来源，并使用等价方式确认备份与拆分前内容一致。

## 总体原则

### 行为优先

拆分是结构调整，不是功能重写。任何阶段都必须保持：

- `npm run chat-codex` 可启动。
- TUI 和普通 CLI 流程保持兼容。
- 微信账号添加、扫码登录、主聊天绑定保持兼容。
- 飞书机器人添加、凭证校验和私聊 route 发现保持兼容。
- session 绑定、权限、模型、Goal、progress、sendfile、stop 行为保持兼容。
- Codex app-server 的 session、turn、approval、steer、background goal 事件保持兼容。

### 入口保持薄而稳定

拆分完成后：

- `src/codex/app-server-codex-adapter.ts` 仍导出 `AppServerCodexAdapter`，但不直接承载大量协议解析细节。
- `src/cli/serve.ts` 仍导出 `runServe`，但不直接承载所有交互子流程。
- 对外 import 路径尽量不变，降低迁移风险。

### 模块只拿必要依赖

避免把大文件替换成一个万能 `Context`。模块应通过小接口接收依赖：

- 需要发送 JSON-RPC 的模块只依赖 RPC client 接口。
- 需要操作 session 状态的模块只依赖 session store 接口。
- 需要询问用户输入的模块只依赖 prompt 接口。
- 需要渠道动作的模块只依赖 ChannelActions/LauncherActions 等现有 action 层。

## `app-server-codex-adapter.ts` 拆分设计

### 当前职责

`src/codex/app-server-codex-adapter.ts` 当前同时承担：

- 启动/停止 `codex app-server` 子进程。
- JSON-RPC 请求、响应、通知读写。
- pending response 和超时管理。
- session start/resume/list/status。
- turn run、event queue、early event、background turn。
- turn steer 和 interrupt/cancel。
- app-server approval request 解析与审批决策回写。
- run policy 到 approval/sandbox 参数映射。
- model policy、模型列表、模型信息解析。
- Goal API 调用和 Goal 状态解析。
- token usage、progress、plan/final answer 映射。
- `CodexPromptInput` 到 app-server `userInput` 映射，包含 `localImage`。

### 目标结构

建议最终结构：

```text
src/codex/
  app-server-codex-adapter.ts
  app-server-codex-adapter.monolith.snapshot.ts.bak
  app-server/
    rpc-client.ts
    types.ts
    session-store.ts
    turn-store.ts
    approval-handler.ts
    notification-mapper.ts
    run-policy.ts
    model-policy.ts
    goal-api.ts
    input-mapper.ts
    value-parsers.ts
```

### 模块职责

| 模块 | 职责 |
| --- | --- |
| `app-server-codex-adapter.ts` | 保留 `CodexAdapter` 实现、构造依赖和高层方法编排。 |
| `app-server/types.ts` | app-server JSON-RPC、session record、turn record、progress draft 等共享类型。 |
| `app-server/rpc-client.ts` | 子进程生命周期、stdin/stdout JSON-RPC、request id、pending response、超时、stderr。 |
| `app-server/session-store.ts` | session record、threadId 到 sessionId 映射、status/context/model 更新。 |
| `app-server/turn-store.ts` | turn queue、early events、closed turn、background turn 创建和关闭。 |
| `app-server/approval-handler.ts` | server request 转 `ApprovalRequest`，审批决策转 app-server response。 |
| `app-server/notification-mapper.ts` | app-server notification 和 thread item 转 `CodexEvent`。 |
| `app-server/run-policy.ts` | `CodexRunPolicy` 到 approval policy、reviewer、sandbox policy 的映射。 |
| `app-server/model-policy.ts` | model list response、model option、model info、reasoning effort、service tier 解析。 |
| `app-server/goal-api.ts` | get/set/pause/resume/clear Goal API 和响应解析。 |
| `app-server/input-mapper.ts` | `CodexPromptInput` 到 app-server `userInput`，包含文本、图片、本地文件说明。 |
| `app-server/value-parsers.ts` | `objectValue`、`stringValue`、`numberValue`、array 解析、时间转换等纯工具。 |

### app-server 分阶段计划

1. **阶段 A1：备份和类型/工具拆分**
   - 备份旧 `app-server-codex-adapter.ts`。
   - 新增 `app-server/types.ts` 和 `app-server/value-parsers.ts`。
   - 不改变运行逻辑。

2. **阶段 A2：拆 run policy、model policy、input mapper**
   - 迁移纯函数和协议 payload 构造。
   - 补单元测试覆盖 policy 映射、模型解析、输入映射。

3. **阶段 A3：拆 rpc-client**
   - 子进程、JSON-RPC request/response、read loop 进入 `rpc-client.ts`。
   - 适配器只调用 `request()`、`start()`、`stop()` 和 notification callback。
   - 重点测试请求超时、响应分发、stderr、stop 清理。

4. **阶段 A4：拆 session-store 和 turn-store**
   - 迁移 session 状态、thread 映射、turn queue、early events、background turn。
   - 重点测试 start/resume/list/status、run event 顺序、background goal continuation。

5. **阶段 A5：拆 approval 和 notification mapper**
   - 迁移审批 request/decision 和 notification -> `CodexEvent` 映射。
   - 重点测试 `/OK`、`/P`、`/NO`、plan/final answer、progress、token usage、localImage。

6. **阶段 A6：收口 adapter**
   - 主 adapter 文件只保留高层 `CodexAdapter` 方法。
   - 更新测试报告，确认旧能力全部覆盖。

## `serve.ts` 拆分设计

### 当前职责

`src/cli/serve.ts` 当前同时承担：

- `runServe` 主入口。
- 判断 TUI/普通 CLI/非交互模式。
- Codex CLI 检查、权限确认、工作目录解析。
- 初始 channel plan 和 first route binding。
- 普通 CLI 首页循环。
- 渠道管理、微信添加、飞书添加、渠道备注、删除。
- 微信扫码登录和主聊天 pending binding。
- 飞书凭证输入和连通性检查。
- 聊天 route/session 绑定、解绑、切换、新建 session。
- Codex 设置、权限、adapter mode、工作目录、并发设置。
- Bridge runtime 创建、channel adapter 创建、Codex adapter 创建。
- runtime log TUI、transcript、shutdown signal。
- 普通 CLI prompt、格式化和输入 shortcut 工具。

### 目标结构

建议最终结构：

```text
src/cli/
  serve.ts
  serve.monolith.snapshot.ts.bak
  serve/
    startup.ts
    home-loop.ts
    channel-management.ts
    weixin-setup.ts
    feishu-setup.ts
    route-binding-loop.ts
    codex-settings.ts
    bridge-runtime.ts
    prompts.ts
    formatters.ts
    shortcuts.ts
```

### 模块职责

| 模块 | 职责 |
| --- | --- |
| `serve.ts` | 保留 `runServe`，选择 TUI/CLI/非交互路径并调用子模块。 |
| `serve/startup.ts` | Codex CLI 检查、启动工作目录、权限确认、初始 `PreparedServeStartup` 和 `ServeChannelPlan`。 |
| `serve/home-loop.ts` | 普通 CLI 首页循环和主菜单选择分发。 |
| `serve/channel-management.ts` | 渠道列表、渠道详情、备注、删除、启用/禁用入口。 |
| `serve/weixin-setup.ts` | 添加微信账号、扫码登录、等待确认、微信主聊天 pending binding。 |
| `serve/feishu-setup.ts` | 飞书账号标识、App ID/Secret 输入、domain 默认值、连通性检查。 |
| `serve/route-binding-loop.ts` | 聊天绑定列表、详情、切换 session、新建 session、解绑、权限设置。 |
| `serve/codex-settings.ts` | adapter mode、默认权限、新 session 工作目录、并发数、未绑定 route 策略、首个 route binding。 |
| `serve/bridge-runtime.ts` | 创建 runtime adapters、Codex adapter、Bridge、runtime log TUI 和 shutdown。 |
| `serve/prompts.ts` | `askRequired`、`askOptional`、readline question、确认输入。 |
| `serve/formatters.ts` | serve 专用小格式化函数，例如 session choice、policy 文案、runtime summary。 |
| `serve/shortcuts.ts` | `w/f/n/m/back` 等普通 CLI shortcut 解析。 |

### serve 分阶段计划

1. **阶段 S1：备份和 prompts/shortcuts/formatters 拆分**
   - 备份旧 `serve.ts`。
   - 迁移纯工具函数，风险最低。
   - 补或复用 `serve wizard`、TUI 单测。

2. **阶段 S2：拆 startup 和 codex-settings**
   - 迁移 Codex 检查、工作目录、权限、adapter mode、并发、首个 route binding。
   - 重点测试工作目录仍取启动 cwd，权限确认和 full 模式安全提示保持不变。

3. **阶段 S3：拆 channel-management、weixin-setup、feishu-setup**
   - 迁移渠道管理和新增渠道流程。
   - 重点测试微信扫码返回流程、pending binding、飞书手动凭证和连通性检查。

4. **阶段 S4：拆 route-binding-loop**
   - 迁移聊天绑定、解绑、切换、新建 session、权限设置。
   - 重点测试 session owner 独占、不可选 session、活跃时间展示。

5. **阶段 S5：拆 bridge-runtime**
   - 迁移 Bridge 创建、adapter 创建、runtime log TUI、shutdown signal。
   - 重点测试服务启动、Ctrl+C 停止、日志 TUI、单实例锁后续接入点。

6. **阶段 S6：收口 serve.ts**
   - `serve.ts` 只保留入口编排。
   - 更新测试报告，确认 TUI/CLI/非交互路径均覆盖。

## 逐模块测试要求

每拆分一个模块，都必须同步完成该模块功能验证。不能只依赖最后一次全量测试兜底。

每个模块拆分提交必须满足：

- 有该模块对应的定向测试，或在测试报告中明确说明由哪些现有测试覆盖。
- 该模块涉及的核心行为至少被一条测试路径覆盖。
- `npm run build` 通过。
- 相关单测或集成测试通过。
- 中文测试报告写明：拆了哪个模块、覆盖了哪些行为、运行了哪些命令、结果如何。

建议测试关注点：

| 模块范围 | 必测行为 |
| --- | --- |
| app-server rpc | 子进程启动、JSON-RPC request/response、超时、stop 清理、stderr 错误。 |
| app-server session | start/resume/list/status、cwd、model/context、routeKey。 |
| app-server turn | run event 顺序、final answer、progress、plan、steer、cancel、background turn。 |
| app-server approval | app-server request 转 approval、`/OK`、`/P`、`/NO`、旧版 review decision。 |
| app-server policy | permission/full、sandbox、approval reviewer、模型切换、reasoning effort。 |
| app-server goal | get/set/pause/resume/clear、Goal 时间和状态。 |
| app-server input | 普通文本、结构化文本、本地图片、文件说明、localImage。 |
| serve startup | Codex 检查、cwd、权限确认、初始 session plan。 |
| serve channel | 微信添加、扫码返回、飞书添加、备注、删除、状态展示。 |
| serve binding | route 列表、绑定/解绑/切换、新建 session、owner 冲突。 |
| serve settings | 默认权限、新 session 工作目录、并发、未绑定策略。 |
| serve runtime | Bridge 启动、runtime log TUI、Ctrl+C 停止、无渠道错误。 |

## 建议验证命令

基础验证：

```bash
npm run build
npm test
git diff --check
git diff --cached --check
```

app-server 定向验证：

```bash
node --test dist/tests/unit/app-server-codex-adapter.test.js
node --test dist/tests/integration/bridge-mock.test.js --test-name-pattern "AppServerCodexAdapter|Goal|approval|steer|model|permission|localImage"
```

serve/TUI 定向验证：

```bash
node --test dist/tests/unit/serve-wizard.test.js dist/tests/unit/ink-tui.test.js dist/tests/unit/launcher-actions.test.js
node --test dist/tests/integration/bridge-persistence.test.js
```

真实人工验证：

```bash
npm run chat-codex
```

人工重点看：

- 首次启动无渠道引导。
- 微信添加账号和扫码登录返回。
- 微信主聊天 pending binding。
- 飞书添加机器人和凭证连通性检查。
- 聊天绑定、解绑、切换 session。
- 启动服务和运行日志 TUI。
- `/status`、`/model`、`/permission`、`/goal`、`/sendfile`、`/stop`。

## 风险和约束

### 风险：拆 adapter 时协议状态丢失

`AppServerCodexAdapter` 同时维护 pending responses、turn queues、early events、closed turns、thread/session 映射和 pending approvals。拆分时不能让多个模块重复维护同一份状态。

处理方式：

- 明确状态所有者。
- 其他模块通过小接口访问。
- turn lifecycle 的打开、推送、关闭必须集中在一个 store 中。

### 风险：拆 serve 时 TUI/CLI 行为分叉

`serve.ts` 同时支持 TUI、普通 CLI 和非交互启动。拆分时不能只测 TUI，导致普通 CLI 退化。

处理方式：

- 普通 CLI 菜单解析继续由 `serve-wizard` 和相关单测覆盖。
- TUI 继续通过 `ink-tui` 和 `launcher-actions` 覆盖。
- 非交互无渠道错误、runtime 创建和 shutdown 也要保留测试路径。

### 风险：备份文件被误编译或误发布

`.ts.bak` 不应被 `tsconfig.json` 编译，也不应被运行时代码 import。

处理方式：

- 备份文件只用于对照。
- 不在源码中 import `.bak`。
- 提交前跑 `npm run build`。

## 完成标准

拆分完成后应满足：

- 不以“入口文件低于 1000 行”作为最终完成标准；最终完成标准是入口变薄、模块边界清楚、行为和测试覆盖对齐。
- 两个原始单体文件都有 `.monolith.snapshot.ts.bak` 对照备份。
- `app-server-codex-adapter.ts` 和 `serve.ts` 均成为薄入口。
- app-server 协议、session、turn、approval、policy、model、goal、input mapper 边界清楚。
- serve 启动、渠道、绑定、设置、runtime 边界清楚。
- 每个新模块都有定向测试或测试报告中的明确覆盖说明。
- `npm test` 通过。
- `git diff --check` 通过。
- 新增中文测试报告记录拆分范围和验证结果。
