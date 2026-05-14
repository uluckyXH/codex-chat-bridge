# 2026-05-14 进度投递模式与微信出站可靠性测试报告

## 测试目标

- 验证默认进度投递模式不再把每条命令/工具细节都发到微信。
- 验证 `/progress detailed` 可以恢复详细进度投递，保留调试能力。
- 验证 CLI 支持 `--progress brief|detailed|silent` 默认模式配置。
- 验证微信 `sendmessage` 返回业务错误码时会被识别为发送失败。
- 验证微信出站消息通过串行队列和最小间隔发送，降低连续进度消息丢显或乱序概率。

## 覆盖范围

- `src/bridge/bridge.ts`
- `src/codex/types.ts`
- `src/codex/exec-codex-adapter.ts`
- `src/channels/weixin/weixin-api.ts`
- `src/channels/weixin/weixin-adapter.ts`
- `src/cli.ts`
- `tests/integration/bridge-mock.test.ts`
- `tests/integration/weixin-adapter-api.test.ts`
- `tests/unit/exec-codex-adapter.test.ts`

## 自动化测试

命令：

```bash
npm test
```

结果：

```text
tests 43
pass 43
fail 0
cancelled 0
```

新增重点用例：

- `Bridge default progress mode suppresses command details but keeps reasoning progress`
- `Bridge progress command enables detailed progress for the current route`
- `WeixinAdapter treats sendmessage errcode as delivery failure`
- `parseExecJsonLine maps exec progress items` 覆盖 progress kind 分类

## 结果说明

- 默认 `brief` 模式只发送计划、自言自语、搜索和文件变更摘要；命令开始/完成、MCP 工具调用等细节只在 `detailed` 模式发送。
- `/progress` 无参数会显示当前模式；`/progress detailed`、`/progress brief`、`/progress silent` 会设置当前微信上下文的模式。
- 媒体抽取仍会检查所有进度文本，即使命令详情未投递，命令输出中出现图片路径时仍可转发图片。
- 微信发送链路现在会检查 `ret/errcode`。如果服务端返回限流或其他业务错误，终端不会再记录为成功 OUT，通道状态会进入 `degraded` 并保存 `lastError`。
