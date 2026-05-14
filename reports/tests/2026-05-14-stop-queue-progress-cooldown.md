# 2026-05-14 `/stop` 队列清理和进度发送冷却测试报告

## 变更目的

修复真实微信长跑中两个容易造成“卡住”体感的问题：

- `/stop` 只停止当前 Codex turn，但此前排队的普通消息会在停止后继续启动新 turn。
- 微信 `sendmessage ret=-2` 连续出现时，进度消息仍持续尝试发送，导致日志刷屏并加重微信侧发送失败。

## 覆盖内容

- `/stop` 会清空当前 route 的普通 prompt 队列，并在回复中说明清空条数。
- 进度消息发送失败后，当前 route 进入 60 秒进度发送冷却；最终回复、命令回复和审批消息仍继续尝试发送。
- 新增 Bridge 集成测试覆盖 `/stop` 清空排队消息。
- 新增 Bridge 集成测试覆盖进度发送失败后不会继续逐条打微信发送接口。

## 执行命令

```bash
npm run build
node --test --test-timeout=5000 dist/tests/integration/bridge-mock.test.js
npm test
git diff --check
```

## 结果

- TypeScript build 通过。
- Bridge mock 针对性集成测试 18 个通过。
- 全量测试 80 个通过。
- `git diff --check` 通过。
