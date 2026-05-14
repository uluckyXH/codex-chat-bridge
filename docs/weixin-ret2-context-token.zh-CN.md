# 微信 `sendmessage ret=-2` 与 `context_token` 问题说明

本文档记录真实微信通道里出现的一个高频问题：Codex 长任务期间，微信 `sendmessage` 偶发或连续返回 `ret=-2 errcode=0`；但用户发送 `/help`、`/status` 等短命令时，又能正常收到回复。

结论先说清楚：这通常不是微信登录整体失效，也不是 Codex 本身不工作。更可能是长任务期间复用旧 `context_token`、连续发送进度消息、消息过长或微信侧临时拒收共同导致的发送失败。

## 大白话版本

微信这条链路里有两个容易混淆的 token：

- `bot_token`：账号登录凭证。它像“这台机器人还登录着微信吗”。
- `context_token`：某一条用户消息带来的回复上下文。它像“你这次回复是接着哪条微信消息说的”。

`/help` 能收到回复，说明 `bot_token` 基本没坏，微信账号还在线，最基础的收发通道也通。

真正容易出问题的是长任务：

1. 用户发一条问题。
2. 微信把这条消息和一个 `context_token` 一起给中间件。
3. 中间件把问题交给 Codex。
4. Codex 可能跑很久，期间会产生开始提示、阶段性进度、审批提示、最终回复、媒体消息。
5. 这些消息原本都会尽量复用第一条用户消息带来的 `context_token`。
6. 时间久了、消息多了、或者微信后端认为这个上下文不适合继续回复时，`sendmessage` 就可能返回 `ret=-2`。
7. 用户再发 `/help` 时，这是新的微信消息，会带来新的上下文，所以 `/help` 又能正常回。

所以它的体感就是：“刚才 Codex 卡住不回，怎么我发 `/help` 又好了？”
答案是：微信账号没死，旧回复上下文可能不好用了。

## 专业版本

`context_token` 是微信 `getupdates` 对单条入站消息下发的上下文引用。发送回复时，客户端可以把它放入 `sendmessage` 请求体的 `msg.context_token` 字段，以便微信侧把机器人回复关联到对应会话上下文。

当前没有发现可用的主动刷新 `context_token` API。中间件只能在收到新的微信入站消息时拿到新的 `context_token`。

真实现象说明：

- `getupdates` 仍能收到 `/help`，说明长轮询链路未整体断开。
- `/help` 回复可达，说明 `bot_token`、基础 `sendmessage`、目标用户 ID 等核心参数并未整体失效。
- 长任务进度发送出现 `ret=-2`，更像是某次带上下文的出站消息被微信后端临时拒收。

需要谨慎的是，`ret=-2` 不是一个足够明确的错误语义。它不能被简单等同于“context token 已过期”。结合当前现象，更合理的判断是：

- 旧 `context_token` 是高风险因素。
- 高频 progress 是高风险因素。
- 长文本或多段连续出站是高风险因素。
- 微信服务端临时波动或限流也可能参与其中。

因此正确策略不是“刷新 context token”，因为目前没有刷新接口；正确策略是减少对旧 token 的依赖，并降低出站消息压力。

## 现有缓解策略

当前代码已经做了几类防护：

- 微信出站消息串行排队，避免并发打 `sendmessage`。
- 默认发送间隔为 `1200ms`。
- `sendmessage` 有超时和退避重试。
- `ret=-1`、`ret=-2` 被视为可重试临时错误。
- progress 发送失败后，会对当前 route 进入短暂冷却，避免持续刷失败请求。
- 如果带 `context_token` 的 `sendmessage` 在正常重试后仍因 `ret=-2` 失败，会再尝试一次不带 `context_token` 的发送。
- app-server commentary/progress 分片阈值已提高，减少一句话被拆成多条微信消息。

这些策略的目标是：不要因为微信某次临时拒收就让整个 Codex turn 崩掉，也不要继续用同一个高风险上下文疯狂重试。

## 建议的下一步策略

### 主动过期 `context_token`

建议给 `context_token` 增加接收时间，例如 `contextTokenReceivedAt`。

发送微信消息时按消息类型判断：

- `/help`、`/status`、审批提示、审批结果：短消息且需要及时送达，可以优先带 token。
- 长任务 progress：如果 token 年龄超过 `60s` 或 `120s`，主动省略 token。
- final reply：如果任务持续时间较长，也可以主动省略 token，或在带 token 失败后快速 fallback。

这样做的目的不是“证明 token 一定过期”，而是工程上降低旧上下文导致 `ret=-2` 的概率。

### 合并 progress

建议 Bridge 层按 route 缓冲 progress：

- 每 `5-10s` 合并发送一次 progress。
- final reply、approval、stop 等重要消息仍立即发送。
- `brief` 模式下进一步减少中间消息。

这可以同时降低 `context_token` 压力、微信限流压力和用户聊天窗口刷屏。

### 用户侧临时规避

如果真实微信长任务频繁 `ret=-2`，先让用户发送：

```text
/progress silent
```

这会减少中间进度消息，只保留关键节点和最终回复。它不是根治，但能明显降低触发概率。

## 排查 checklist

看到 `sendmessage failed: ret=-2 errcode=0` 时，先按下面顺序判断：

1. 发送 `/help`。
   如果能回，说明账号登录和基础发送大概率正常。

2. 发送 `/status`。
   查看 Channel 的 `State` 和 `Last error`，确认是否是 `sendmessage ret=-2`，而不是 `session expired`。

3. 切到静默进度：
   ```text
   /progress silent
   ```
   如果问题明显缓解，说明高频 progress 是主要诱因。

4. 测短任务和长任务。
   短任务能回、长任务失败，更支持“旧 context token / 长时间 / 长文本 / 多段发送”方向。

5. 如果 `/help` 也不能回，再考虑 `bot_token` 失效、网络不可用、微信接口异常或账号需要重新登录。

## 不要误判

不要把这个问题直接归因成：

- “Codex 坏了”：Codex 可能已经完成，只是微信出站失败。
- “微信登录一定过期了”：`/help` 能回时，登录态通常还在。
- “重新扫码一定能解决”：重新扫码可能短期缓解，但长任务继续高频复用旧上下文时还可能再出现。
- “只要无限重试就行”：连续重试会放大发送压力，可能让微信侧更容易拒收。

## 关键代码位置

- `src/protocol/channel.ts`
  - `replyTargetFromMessage()` 从入站消息提取 `context_token`。
- `src/channels/weixin/weixin-adapter.ts`
  - 构造 `sendmessage` 请求。
  - 处理 `ret=-2` 重试和去 token fallback。
- `src/channels/weixin/weixin-api.ts`
  - `sendmessage` API 调用和错误抛出。
- `src/bridge/bridge.ts`
  - progress、final reply、approval、typing、队列和失败冷却。
- `src/codex/app-server-codex-adapter.ts`
  - app-server commentary/progress 分片和事件映射。

## 维护原则

这类问题本质上是三方系统边界问题：

```text
Codex 长任务输出 -> 中间件投递策略 -> 微信上下文发送限制
```

中间件要做的是把不可控的微信行为变成可控的投递策略：

- 能少发就少发。
- 能合并就合并。
- 旧上下文不可靠时就不要强依赖。
- 关键消息优先送达。
- 失败要可观测，但不要让整个任务崩溃。
