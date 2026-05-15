# 测试报告：Plan/Code 协作模式

## 测试目标

验证 `/plan` 和 `/code` 可以在 Bridge 中切换当前上下文的 Codex collaboration mode，并确认 app-server adapter 通过 `turn/start.collaborationMode` 使用 true Plan mode。验证微信 progress disabled 时仍能收到 Plan mode 的最终计划内容。

## 测试环境

- 日期：2026-05-15
- 分支/提交：main / f2a485a
- Node.js 版本：v24.14.0
- 操作系统：Darwin Mac 25.4.0 arm64
- Codex 版本：本地 fake app-server + MockCodexAdapter
- 渠道：mock / weixin-like mock

## 执行命令

```bash
npm run build
node --test dist/tests/integration/bridge-mock.test.js
node --test dist/tests/unit/app-server-codex-adapter.test.js
npm test
git diff --check
```

## 测试步骤

1. 通过 Mock channel 发送 `/plan`、普通消息、`/code`、`/code <任务>` 和隐藏别名 `/default <任务>`。
2. 验证 `/plan <任务>` 执行后不会自动退出，后续普通消息仍使用 plan mode。
3. 构造运行中的 turn，再排队普通消息、切换 `/plan`、继续排队普通消息，验证队列项保留入队时的 mode 快照。
4. 通过 fake app-server 检查 `turn/start` 收到的 `collaborationMode` payload。
5. 在 weixin-like delivery policy 下验证 progress 被抑制，但 Plan mode final plan 仍投递。

## 实际结果

- `/help` 显示 `/plan [任务]` 和 `/code [任务]`，不显示隐藏别名 `/default`。
- `/status` 显示当前 `Mode: plan` 或 `Mode: default`。
- `/plan` 持续生效；`/code` 切回默认执行模式；两者带任务时会先切模式再入队。
- 队列中的旧普通消息不会被之后的 `/plan` 改写 mode。
- app-server adapter 发送 `collaborationMode.mode=plan`，`settings.model=fake`，`settings.reasoning_effort=medium`，`settings.developer_instructions=null`。
- 微信策略下不发送 task-start 和 `Codex 进度:`，但发送 Plan mode 最终计划正文。
- `npm test` 通过，合计 106 个测试通过。
- `git diff --check` 通过。

## 结论

通过。

## 遗留问题

- 真实微信通道未在本轮扫码实测；当前覆盖 mock 与 weixin-like policy。
