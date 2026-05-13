# 2026-05-14 微信常驻终端 Transcript 测试报告

## 测试目标

- 验证 Bridge 层支持运行期 transcript 输出。
- 验证 `weixin codex` 可在启动终端打印微信入站消息和发回微信的 Codex 回复。
- 验证 transcript 只做运行期终端展示，不新增对话内容持久化存储。
- 明确当前 `codex exec --json` 模式不支持另一个已打开 Codex CLI/Codex App 窗口实时同屏。

## 覆盖范围

- `src/bridge/bridge.ts`
- `src/cli.ts`
- `src/logging/transcript.ts`
- `tests/integration/bridge-mock.test.ts`
- `README.zh-CN.md`
- `README.en.md`
- `docs/requirements.zh-CN.md`
- `docs/technical-design.zh-CN.md`

## 自动化测试

新增用例：

- `Bridge emits transcript events for inbound channel text and outbound replies`

验证点：

- 普通通道消息进入 Bridge 后会触发 `TranscriptSink.inbound()`。
- Bridge 回复通道消息后会触发 `TranscriptSink.outbound()`。
- transcript 实现挂在 Bridge 层，不绑定 `WeixinAdapter` 内部结构，后续其他渠道可复用。

## 遗留说明

真实微信 transcript 需要在用户已扫码登录并发送微信消息后观察常驻终端输出。当前代码路径已覆盖到 Bridge 层，真实通道最终验证仍需要用户协助发送微信消息。
