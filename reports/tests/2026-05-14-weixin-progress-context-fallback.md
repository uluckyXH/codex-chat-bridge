# 2026-05-14 微信进度发送 `ret=-2` 与 context token fallback 测试报告

## 背景

真实微信长任务中，进度消息连续出现 `sendmessage failed: ret=-2 errcode=0`，但同一时间发送 `/help` 命令回复可以成功。这个现象说明微信账号、基础发送和 Bridge 命令回复没有整体失效；更可疑的是长任务进度消息的发送形态。

对照 `openclaw-weixin` 本地源码：

- `context_token` 来自 `getupdates` 的单条入站消息。
- 发送时可以携带该 token，也允许缺失时直接发送。
- 我们此前把同一条用户消息的 `context_token` 用在整个 Codex turn 的所有 progress 上。长任务里这个 token 可能变旧或被微信侧拒绝。
- app-server commentary delta 较长时会提前 flush，导致同一句进度被拆成多条消息，进一步增加发送频率和失败概率。

## 本轮变更

- `WeixinAdapter` 在带 `context_token` 的 `sendmessage` 重试耗尽后，如果最后错误是 `ret=-2`，会去掉 `context_token` 再尝试发送一次。
- app-server progress draft 的提前 flush 阈值从 80 字提高到 400 字；仍保留句末标点和换行 flush，减少一句话被拆成两条微信进度。
- 保留原有发送串行、退避重试和 progress 失败冷却逻辑。

## 测试

执行命令：

```bash
npm run build
node --test --test-timeout=5000 dist/tests/integration/weixin-adapter-api.test.js dist/tests/unit/app-server-codex-adapter.test.js
```

结果：

- TypeScript build 通过。
- 微信 adapter + app-server 针对性测试 24 个通过。

## 覆盖点

- `ret=-2` 且带旧 `context_token` 时，会再发送一次不带 `context_token` 的请求。
- chunked commentary 会合并成一条 progress，不再因为 80 字阈值拆成两条。
