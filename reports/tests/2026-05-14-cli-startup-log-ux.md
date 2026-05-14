# 2026-05-14 CLI 启动顺序与日志展示优化测试报告

## 测试目标

- 验证真实 Codex 启动流程改为先选择会话，再选择权限模式。
- 验证任务开始提示不再每次向微信重复发送 Session ID。
- 验证常驻终端 transcript 使用更直观的聊天记录样式。
- 验证 CLI logger 不再输出原始 JSON 行，改为短行日志并保留敏感字段脱敏。

## 覆盖范围

- `src/cli.ts`
- `src/bridge/bridge.ts`
- `src/logging/logger.ts`
- `src/logging/transcript.ts`
- `tests/integration/bridge-mock.test.ts`
- `tests/unit/transcript.test.ts`
- `README.zh-CN.md`
- `README.en.md`
- `docs/README.md`
- `docs/requirements.zh-CN.md`
- `docs/technical-design.zh-CN.md`

## 自动化测试

命令：

```bash
npm test
npm run cli:mock
git diff --check
```

结果：

```text
tests 55
pass 55
fail 0
cancelled 0
skipped 0
todo 0
```

新增或更新重点用例：

- `ConsoleTranscriptSink prints concise chat-style inbound and outbound records`
- `Bridge emits transcript events for inbound channel text and outbound replies`
- `Bridge status reports running work and /stop cancels the current task`

## 结果说明

- 交互启动顺序已调整为：检测 Codex -> 选择会话/工作目录 -> 选择权限模式 -> 打印启动摘要。
- 恢复历史会话后，本次启动选择的 `approval` 或 `full` 会用于后续 `codex exec` 参数；历史会话不再在交互顺序上“覆盖”用户刚选的权限感知。
- 微信任务开始提示改为短文本：`Codex 正在处理这条消息。` 和 `/status`、`/stop` 提示，不再重复刷 Session ID。
- 终端 transcript 默认展示为 `微信 <= ... | direct:...`、`微信 => ... | 进度` 这类短摘要，消息体缩进显示；完整 route/sender 仅保留给 verbose 模式。
- `ConsoleLogger` 输出改为 `[HH:mm:ss] LEVEL message key=value`，比 JSON 行更适合常驻 CLI 阅读。
