# 测试报告：第一阶段 Codex 与中间件 mock 通信

## 测试目标

验证第一阶段基础能力：

- TypeScript 项目可以构建。
- 通用 Channel Adapter 协议可以被 mock channel 和 WeixinAdapter 壳实现。
- Bridge Core 可以处理 `/new`、普通消息、`/status`。
- Approval Manager 可以创建审批并通过 `/approve` 处理。
- MockCodexAdapter 可以模拟 Codex 阶段性事件和审批请求。
- TerminalChannelAdapter 可以在本地终端模拟微信输入输出，并保持消息顺序。
- Bridge Core 可以处理 `/sessions`、`/use`、`/whoami`、`/debug` 等扩展命令。
- ExecCodexAdapter 可以解析 `codex exec --json` 的核心 JSONL 事件。
- Git 忽略规则不会误伤 `src/state/` 源码目录。
- CLI mock 流程可以在终端运行。

## 测试环境

- 日期：2026-05-14
- Node.js 版本：v24.13.1
- npm 版本：11.8.0
- Codex CLI 版本：0.130.0
- 操作系统：macOS
- 渠道：mock
- 微信真实通道：未测试，等待第二阶段 WeixinAdapter 登录实现后由用户协助登录补测。

## 执行命令

```bash
npm install
npm test
npm run cli:mock
printf '/new\n/sessions\n/whoami\n/debug\n/exit\n' | node dist/src/cli.js terminal mock
git status --short --ignored
```

## 测试步骤

1. 安装项目最小开发依赖。
2. 执行 `npm test`，运行 TypeScript 编译和 Node 内置测试。
3. 执行 `npm run cli:mock`，运行脚本化 mock 流程。
4. 执行终端通道管道命令，验证 `/new`、`/sessions`、`/whoami`、`/debug` 顺序输出。
5. 执行 `git status --short --ignored`，确认 `src/state/` 没有被忽略，运行产物和本地参考仓库仍被忽略。
6. 检查 mock 输出是否包含新建会话、普通回复、审批请求、审批确认和状态输出。

## 实际结果

`npm test` 结果：

```text
tests 13
pass 13
fail 0
duration_ms 77.122417
```

覆盖用例：

- `Bridge handles new session, prompt, status, and approval over mock channel`
- `WeixinAdapter shell implements channel contract and reports login_required`
- `ApprovalManager creates and resolves approvals`
- `ApprovalManager rejects wrong route decisions`
- `buildRouteKey normalizes channel routing identity`
- `buildRouteKey uses default account when missing`
- `parseCommand parses slash commands`
- `parseCommand ignores normal text`
- `parseExecJsonLine reads thread.started event`
- `parseExecJsonLine maps agent message completion`
- `parseExecJsonLine maps failed events and ignores malformed lines`
- `TerminalChannelAdapter normalizes terminal input into ChannelMessage`
- `TerminalChannelAdapter writes replies to output`

`npm run cli:mock` 关键输出：

```text
已创建新 Codex 会话
Session: mock-codex-1
Status: idle

Mock Codex 回复: 你好，Codex

Codex 请求审批 [a001]
类型: command
Command:
echo mock-approval

审批已处理 [a001]: approve

Bridge: ok
Channel: mock connected
Codex: idle
Session: mock-codex-1
Pending approvals: 0
```

终端通道管道测试关键输出：

```text
已创建新 Codex 会话
当前上下文 Codex 会话:
当前通道身份:
Bridge: ok
Capabilities:
Local sessions: 1
```

Git 状态检查关键结论：

```text
src/state/ 不再显示为 ignored
dist/、node_modules/、references/openai-codex/、openclaw-weixin-npm/extracted/ 仍被忽略
```

## 结论

通过。

第一阶段 mock/local 链路已具备基础闭环：中间件可以通过通用 channel 协议接收输入、路由到 Codex adapter、处理命令、生成审批请求、处理审批决策并输出状态。终端通道可用于微信未登录前的本地联调。

## 遗留问题

- 当前 Codex app-server adapter 尚未实现；ExecCodexAdapter 只完成 CLI JSONL 基础解析和进程调用入口，真实长会话、审批和取消仍需后续硬化。
- 当前 WeixinAdapter 只是通用协议壳，状态为 `login_required`，真实微信登录、收消息和发消息将在第二阶段实现。
- 真实微信通道测试需要用户在第二阶段协助登录后补测。
