# Session 上下文外部更新检测与发送前刷新设计

## 背景

Chat-Codex 允许聊天 route 绑定一个已有 Codex session。用户可能在电脑终端里继续使用同一个 Codex CLI session，也可能在 Chat-Codex 里继续向同一个 session 投递消息。

当前风险是：Chat-Codex 进程已经 `resumeSession()` 过某个 session 后，会在本地 adapter/session store 里保留这个 session 的状态。若电脑端 Codex CLI 又对同一个 session 写入了新的上下文，Chat-Codex 目前没有显式感知这次外部写入，也没有在下一次发消息前主动刷新本地 session 状态。

这份文档设计一个较小的“发送前检测 + 懒刷新”能力：

```text
用户在 Chat-Codex 发消息
  -> 检测当前绑定 session 的本地 Codex 历史是否比 Chat-Codex 已知快照更新
  -> 如果更新：重新加载 session，通知用户，再投递本条消息
  -> 如果没更新：直接投递本条消息
```

它和长期的实时共享 app-server 模式不同。这里不追求 CLI 和 Chat-Codex 双端实时互看进度，只解决“Chat-Codex 下一条消息不要基于旧上下文继续跑”的问题。

## 模式归属

该能力归入当前“独立模式”，不放进 shared app-server 模式。

这里的“独立模式”指 Chat-Codex 继续按当前架构运行自己的 Codex adapter：

```text
Chat-Codex -> AppServerCodexAdapter / ExecCodexAdapter -> 本机 Codex session 文件
电脑端 Codex CLI -> 同一份本机 Codex session 文件
```

两边不共享一个长期 app-server 进程，不互相订阅实时事件。Chat-Codex 只在自己要发送下一条消息前，主动检查本机 Codex session 文件是否已经被电脑端更新。

因此它的边界是：

- 独立模式可用：解决“发消息前检测并刷新上下文”。
- shared app-server 模式不依赖它：未来如果实现 shared 模式，应由共享服务本身提供实时 thread 状态和进度同步。
- 两个模式的配置必须隔离：独立模式开关不应影响 shared 模式启动、绑定或实时同步策略。

## 结论

可实现，且第一版不需要解析完整历史，也不需要接管 Codex CLI 进程。

可用信号来自 Codex 本地状态：

- `~/.codex/state_5.sqlite` 的 `threads.updated_at_ms` / `updated_at`。
- `threads.rollout_path` 指向的 `~/.codex/sessions/**/*.jsonl` 文件。
- rollout JSONL 文件的 `mtimeMs` 和 `size`。
- `~/.codex/session_index.jsonl` 里的 `updated_at` 可作为低优先级 fallback。

本机观察也符合这个模型：同一个 session 继续写入后，`state_5.sqlite.threads.updated_at_ms` 和 rollout JSONL 的文件大小/mtime 都会变化。因此第一版可以用“上下文指纹”判断 session 是否比 Chat-Codex 保存的快照更新。

本地参考的 Codex 官方源码也支持这个判断：

- `references/openai-codex/codex-rs/utils/home-dir/src/lib.rs`：`CODEX_HOME` 可覆盖，默认 `~/.codex`。
- `references/openai-codex/codex-rs/state/src/lib.rs`：官方状态库文件名是 `state_5.sqlite`。
- `references/openai-codex/codex-rs/state/migrations/0001_threads.sql`：`threads` 表包含 `id`、`rollout_path`、`updated_at`、`cwd` 等字段。
- `references/openai-codex/codex-rs/state/migrations/0025_thread_timestamps_millis.sql`：官方迁移加入 `updated_at_ms`，并维护毫秒级索引。
- `references/openai-codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadResumeParams.ts`：`thread/resume` 支持按 `threadId` 从磁盘加载 thread。
- `references/openai-codex/codex-rs/thread-store/src/local/read_thread.rs`：读取 thread 时会优先使用 sqlite 元数据，并能从 rollout path 加载 history。

## 目标

1. 增加一个可关闭的开关，默认第一版建议关闭。
2. 只在普通用户消息真正投递给 Codex 前做检测。
3. 检测到外部上下文更新时，先重新加载当前绑定 session，再投递用户刚发的消息。
4. 重新加载成功后通知用户，让用户知道这条消息已经基于电脑端最新上下文继续。
5. 检测逻辑不依赖微信、飞书等具体渠道，放在 Bridge/Codex 通用层。
6. 不扫描全部 session，不读取完整 rollout 内容，避免明显性能成本。

## 非目标

- 不做实时双向同步。
- 不让电脑端 Codex CLI 实时看到 Chat-Codex 的运行进度。
- 不解决两个进程同时向同一个 session 写入造成的语义冲突。
- 不合并或重放 Chat-Codex 自己的聊天记录。
- 不修改 Codex CLI 的历史文件格式。
- 不直接写 rollout JSONL。
- 不把微信 `/fff` 这类渠道刷新命令复用成 Codex 上下文刷新。

## 当前代码观察

### Session 发现能力

现有 `src/codex/codex-cli.ts` 已有：

```ts
discoverCodexSessions()
findCodexSessionById()
```

它会合并读取：

- `~/.codex/session_index.jsonl`
- `~/.codex/sessions/**/*.jsonl`
- `~/.codex/state_5.sqlite`

其中 sqlite 查询已经读取 `threads.rollout_path`、`updated_at_ms`、`updated_at`、`cwd`、标题和 preview。也就是说，项目已经有读取 Codex 本地 session 元数据的基础。

### 消息投递入口

普通消息进入链路大致是：

```text
Bridge.handleMessage()
  -> pending media / command / session selection 处理
  -> routeSteering.tryEnqueue()
  -> routeQueue.enqueuePrompt()
  -> BridgeRouteQueue.forwardPrompt()
  -> sessionFlow.ensureSession()
  -> codex.run(session.id, prompt)
```

最适合插入检测的位置是 `BridgeRouteQueue.forwardPrompt()`：

- 它已经拿到了当前 route、target、prompt。
- 它会在真正 `codex.run()` 前调用 `ensureSession()`。
- 如果消息在队列里等待，检查会发生在实际执行前，而不是入队时，避免等待期间又被电脑端更新。

### Adapter 行为

`AppServerCodexAdapter.resumeSession()` 当前如果本地 `sessionStore` 已有记录，会直接返回本地 session，不会强制重新调用 `thread/resume`。

因此即使外部文件已经变新，Chat-Codex 也需要一个显式 reload 能力，不能只靠现有 `ensureSession()`。

`ExecCodexAdapter` 每轮最终通过 `codex exec resume <threadId>` 运行，天然更接近“每次从本地历史恢复”。但仍应支持同一套检测与快照更新，保证行为和状态提示一致。

## 核心设计

### 上下文指纹

新增轻量指纹类型：

```ts
export interface CodexSessionContextFingerprint {
  sessionId: string;
  detectedAt: string;
  source: "sqlite" | "rollout" | "session_index" | "unknown";
  updatedAtMs?: number;
  rolloutPath?: string;
  rolloutMtimeMs?: number;
  rolloutSize?: number;
}
```

比较规则：

1. 优先比较 `updatedAtMs`。
2. 如果 `updatedAtMs` 相同或不存在，再比较 `rolloutSize`。
3. 如果 size 不可用，再比较 `rolloutMtimeMs`。
4. 只有当前指纹明确大于已知指纹时，才认为有外部更新。
5. 当前指纹无法读取时，不阻塞投递，只记录日志并按“未检测到更新”处理。

### 快照来源

实现一个单 session 查询函数，不复用 `discoverCodexSessions()` 全量扫描：

```ts
readCodexSessionContextFingerprint(sessionId, { codexHome })
```

读取顺序：

1. `state_5.sqlite`：
   - `SELECT id, rollout_path, updated_at_ms, updated_at FROM threads WHERE id = ?`
   - 用 `updated_at_ms` 作为主更新时间。
   - 读取 `rollout_path` 后再 `stat()` 对应 JSONL，拿 `mtimeMs` 和 `size`。
2. 如果 sqlite 不存在、没有 `sqlite3`、或没有该 row：
   - 从已知 session path 或 `~/.codex/sessions/**/*.jsonl` 找到 session。
   - 只读首行 `session_meta` 获取 session id。
   - 对匹配文件做 `stat()`。
3. 如果仍失败：
   - 从 `session_index.jsonl` 找该 session 的 `updated_at`。

第一版不需要 tail JSONL，更不需要解析完整 JSONL。文件 `size + mtime` 足够判断“是否有新写入”。

### 已知快照存储

需要保存 Chat-Codex 对每个 session 的已知上下文快照：

```ts
export interface SessionContextSnapshotRecord {
  sessionId: string;
  fingerprint: CodexSessionContextFingerprint;
  observedBy: "bind" | "resume" | "chat-codex-turn" | "external-refresh";
  createdAt: string;
  updatedAt: string;
}
```

持久化位置建议：

```text
~/.chat-codex/state/bridge/session-context-snapshots.json
```

原因：

- Bridge 重启后仍知道上次 Chat-Codex 看到的 session 历史位置。
- 不污染 `routes.json` 和 `session-owners.json`。
- 后续可单独清理或迁移。

内存实现也可以作为第一阶段，但最终应落盘，否则重启后第一次发送无法判断是否外部更新。

注意：这里保存的是“Chat-Codex 已知这个 session 的历史位置”，不是用户开关。开关应按聊天 route 持久化，见下文“持久化策略”。

### 快照更新时间

以下时机写入快照：

1. route 绑定已有 session 成功后。
2. `ensureSession()` 首次恢复已有 session 成功后。
3. Chat-Codex 自己的 `codex.run()` 完成、失败或被取消后的 `finally` 阶段。
4. 检测到外部更新并 reload 成功后。

第 3 点很重要：Chat-Codex 自己刚写入的历史不应该在下一条消息前被误判为外部更新。

## 发送前流程

开启该功能后，`BridgeRouteQueue.forwardPrompt()` 的流程调整为：

```text
session = await sessionFlow.ensureSession(message)

refreshResult = await contextRefresh.beforeRun({
  routeKey,
  sessionId: session.id,
  target
})

if refreshResult.type === "reloaded":
  await delivery.sendText(target, refreshResult.notice)

if refreshResult.type === "reload_failed":
  await delivery.sendText(target, refreshResult.errorText)
  return

await codex.run(session.id, prompt)

finally:
  contextRefresh.recordAfterRun(session.id)
```

建议默认失败策略：

- 检测失败：继续投递，只记日志。
- 检测到更新但 reload 失败：不投递，回复用户 reload 失败。

原因是“已知上下文变新但 reload 失败”时，继续投递更可能把用户消息送进旧上下文，违反这个功能的核心预期。

## Reload 方案

### Adapter 能力扩展

在 `CodexAdapter` 增加可选能力：

```ts
export interface CodexSessionReloadResult {
  session: CodexSession;
  reloadedAt: string;
}

export interface CodexAdapter {
  reloadSession?(sessionId: string): Promise<CodexSessionReloadResult>;
}
```

不支持时，Bridge 可 fallback 到 `resumeSession(sessionId)`，但需要知道这只是弱 reload。

### AppServerCodexAdapter

实测后的实现：

1. 增加 `reloadSession(sessionId)`。
2. 检测到外部更新时，重启 Chat-Codex 自己启动的 app-server stdio 子进程。
3. 清空本地 app-server session/thread 映射，避免后续复用已经失效的内存 thread。
4. 重启后再调用 app-server `thread/resume`，从磁盘 rollout 加载目标 session。
5. 保留当前 Chat-Codex 自己设置的 run policy、model policy、collaboration mode。

原因：

- 官方 app-server 对“已经加载在内存中的 thread”再次 `thread/resume` 时，会返回磁盘历史给当前客户端并附加订阅，但不会替换该 app-server 内部正在持有的 thread 模型上下文。
- 因此只强制 `thread/resume` 会产生假阳性：Chat-Codex 会提示已重载，但下一轮 `turn/start` 仍可能基于旧的内存 thread。
- 重启的是 Chat-Codex 自己的 app-server 子进程，不会杀掉用户电脑上单独打开的 Codex CLI。
- 如果 app-server 仍有运行中的 turn，不能安全重启；此时 reload 应失败并阻止发送，提示用户等待当前任务结束。

### ExecCodexAdapter

`ExecCodexAdapter` 可以实现轻量 `reloadSession()`：

- 重新 `findCodexSessionById(sessionId)`。
- 更新本地 session 的 `cwd`、title、createdAt/updatedAt。
- 不需要启动长期 app-server。

因为 exec 每轮是独立进程，真正上下文读取主要发生在 `codex exec resume`。

## 开关设计

建议配置形态：

```ts
export type ContextRefreshMode = "off" | "detect" | "reload";

export interface ContextRefreshOptions {
  mode: ContextRefreshMode;
}
```

模式含义：

- `off`：不检测，保持当前行为。
- `detect`：只检测并提示，不 reload，不阻止投递。适合早期诊断。
- `reload`：检测到更新后 reload，成功后投递，失败则不投递。

默认建议：

```json
{
  "independentMode": {
    "contextRefresh": {
      "mode": "off"
    }
  }
}
```

理由：

- 这是跨进程读 Codex 本地状态的能力，第一版应保守默认关闭。
- 需要真实双端测试确认 app-server `thread/resume` 是否足够强。

### 配置入口

全局默认值放入 `config.json`，但语义上必须归属独立模式配置，不和 shared 模式配置混用：

```json
{
  "codexDefaults": {
    "independentMode": {
      "contextRefresh": {
        "mode": "reload"
      }
    }
  }
}
```

如果后续配置文件不想显式命名 `independentMode`，也可以放在：

```json
{
  "codexDefaults": {
    "contextRefresh": {
      "mode": "reload"
    }
  }
}
```

但内部类型和文档必须说明：该字段只对当前独立接入模式生效。shared app-server 模式应有独立字段，例如：

```json
{
  "codexDefaults": {
    "sharedMode": {
      "serverUrl": "ws://127.0.0.1:xxxxx"
    }
  }
}
```

运行时 route 级开关可后续增加命令：

```text
/context-refresh status
/context-refresh on
/context-refresh off
/context-refresh detect
```

其中 `on` 等价于 `reload`。

命令属于 route 语义变更，当前 route busy 时应被 busy guard 拦截，和 `/model`、`/permission`、`/compact` 一类命令保持一致。

TUI 里可放在 Codex 设置页：

```text
上下文刷新: 关闭 / 仅检测 / 检测并刷新
```

## 持久化策略

这个功能不应该只作为启动时临时开关。用户启用后，下次启动 Chat-Codex 应继续沿用同一个聊天上下文的设置，否则会变成“每次启动都要重新开关”的低效交互。

建议采用两层配置：

```text
全局默认：config.json / codexDefaults.independentMode.contextRefresh
route 覆盖：routes.json / routes[].policy.contextRefresh
```

解析规则：

1. 当前 route 有 `policy.contextRefresh` 时，优先使用 route 级设置。
2. route 没有设置时，使用全局默认。
3. 全局默认也没有设置时，使用内置默认 `off`。

全局默认第一版应保持 `off`。这个功能涉及跨进程读取 Codex 本地状态和 reload，默认开启容易让用户在不了解机制时遇到额外提示或 reload 失败。推荐交互是：用户明确在 TUI 或聊天命令里给某个聊天打开。

### route 级存储

现有 `routes.json` 已经保存已发现聊天上下文，并且 `RouteRecord.policy` 已预留 route 级策略字段。该功能应扩展 `RoutePolicyRecord`：

```ts
export type ContextRefreshMode = "off" | "detect" | "reload";

export interface RouteContextRefreshPolicy {
  mode: ContextRefreshMode;
  updatedAt: string;
}

export interface RoutePolicyRecord {
  unboundRoute?: string;
  progressMode?: string;
  contextRefresh?: RouteContextRefreshPolicy;
}
```

对应 `routes.json` 示例：

```json
{
  "routeKey": "feishu-main:default:direct:oc_xxx",
  "channelId": "feishu-main",
  "channelType": "feishu",
  "accountId": "default",
  "conversationKind": "direct",
  "conversationId": "oc_xxx",
  "activeSessionId": "019e...",
  "policy": {
    "contextRefresh": {
      "mode": "reload",
      "updatedAt": "2026-05-19T03:30:00.000Z"
    }
  }
}
```

这样可以自然覆盖用户说的“一对一存储”：

- 微信私聊：`channelId + accountId + direct + conversationId` 唯一定位一个微信一对一聊天。
- 飞书私聊：`channelId + accountId + direct + chat_id` 唯一定位一个飞书私聊。
- 后续群聊/thread：继续沿用同一个 `routeKey` 模型，不需要为每个渠道写分支。

这里的 route 级不是技术上随便起的名字，而是产品语义上的“哪个渠道里的哪个对话”：

```text
route = channel instance + account + conversation kind + conversation id
```

因此 TUI 展示时不应该把用户暴露给 `routeKey`，而应该展示成：

```text
微信 / <账号备注> / <联系人或脱敏 conversationId>
飞书 / <机器人备注> / <chat_id 或可读 chat 名>
```

底层仍保存 routeKey，UI 只展示友好标签。

### 为什么不只按 session 存储

不建议只按 session 存储开关。

原因：

- 一个 session 当前有唯一 owner route，但用户心智是“这个微信聊天/飞书 chat 要不要自动刷新上下文”，不是“这个 session id 永远要刷新”。
- route 切换到新 session 后，用户可能仍希望这个聊天保持同样策略。
- session 被解绑后，如果设置还挂在 session 上，后续重新绑定其它聊天会产生不直观的继承。

因此推荐：

- 开关策略按 route 存储。
- 快照按 session 存储。

也就是：

```text
routes.json                 保存这个聊天要不要检测/刷新
session-context-snapshots   保存这个 session 上次看到哪里
```

### 命令语义

聊天命令应默认修改当前 route：

```text
/context-refresh status
/context-refresh off
/context-refresh detect
/context-refresh on
```

其中：

- `on` 等价于 `reload`。
- 命令只影响当前微信一对一或当前飞书 `chat_id`。
- 修改后立即写入 `routes.json`。
- `/status` 应显示该 route 的实际模式，以及它来自 route 覆盖还是全局默认。

示例：

```text
- 上下文刷新: 检测并刷新（当前聊天设置）
```

或：

```text
- 上下文刷新: 关闭（全局默认）
```

### TUI/CLI 入口

TUI/CLI 建议分成两个入口：

1. Codex 设置页：设置全局默认。
2. 聊天绑定详情页：设置某个已发现 route 的覆盖策略。

这样用户可以选择：

- 全局默认关闭，只给某个微信一对一或某个飞书 `chat_id` 开启。
- 全局默认 detect，只给高频聊天改成 reload。
- 清除 route 覆盖，让该聊天重新跟随全局默认。

### TUI 交互细化

TUI 需要支持配置，但不应让它成为启动一次才生效的临时选项。

#### Codex 设置页

Codex 设置页管理全局默认：

```text
上下文刷新默认: 关闭

1. 关闭（默认）
2. 仅检测并提醒
3. 检测并刷新
4. 刷新策略: resume
```

保存后写入 `config.json`。第一版默认值仍是关闭，用户主动选择后才改变全局默认。

#### 聊天绑定详情页

聊天绑定详情页管理当前 route 的覆盖策略：

```text
聊天: 微信 / 小黄
Session: 019e...
上下文刷新: 跟随全局默认（关闭）

1. 跟随全局默认
2. 当前聊天关闭
3. 当前聊天仅检测
4. 当前聊天检测并刷新
```

保存后写入当前 route 的 `routes.json -> policy.contextRefresh`。

如果选择“跟随全局默认”，应删除该 route 的 `policy.contextRefresh` 字段，而不是写入一个和全局默认相同的值。这样后续全局默认改变时，该 route 会自然跟随。

#### 列表展示

聊天绑定列表可只显示简短状态，不需要刷屏：

```text
微信 / 小黄        Session 019e...    上下文刷新: 继承
飞书 / oc_xxx      Session 019e...    上下文刷新: reload
```

其中：

- `继承` 表示 route 没有覆盖，实际值来自全局默认。
- `off` / `detect` / `reload` 表示当前聊天有 route 覆盖。

#### Actions 边界

TUI 仍然不能直接读写 JSON。需要新增 actions/services：

```ts
getContextRefreshDefaults()
setContextRefreshDefaults(policy)
getRouteContextRefreshPolicy(routeKey)
setRouteContextRefreshPolicy(routeKey, policy)
clearRouteContextRefreshPolicy(routeKey)
```

TUI 只调用 actions，业务层负责校验、写入 `config.json` / `routes.json`、刷新 dashboard。

## 用户通知文案

检测到外部更新并 reload 成功：

```text
【Chat-Codex中间件提醒】
检测到当前 Codex session 已在电脑端更新，已重新加载后再发送你的消息。

Session: 019e...
电脑端更新时间: 2026-05-19 11:12:52 GMT+8
```

检测到更新但 reload 失败：

```text
【Chat-Codex中间件提醒】
检测到当前 Codex session 已在电脑端更新，但重新加载失败，本条消息未发送给 Codex。

Session: 019e...
原因: <error>

请稍后重试，或关闭上下文刷新后手动确认是否继续。
```

`detect` 模式只提示不 reload：

```text
【Chat-Codex中间件提醒】
检测到当前 Codex session 可能已在电脑端更新。当前处于仅检测模式，本条消息会按现有方式继续发送。
```

`silent` 模式不发聊天提醒，但仍应写入本地 transcript/logger。

## 性能评估

第一版的性能成本可控：

- 每条真正进入 Codex 的普通消息最多查一次当前 session。
- sqlite 按主键查单 row，不扫描全表。
- JSONL 只做 `stat()`，不读取全文。
- 队列消息是在真正执行前检查，不会因为入队大量消息而提前做多次无效 IO。

预期成本：

- sqlite 查询：通常毫秒级到几十毫秒。
- rollout `stat()`：通常毫秒级。
- fallback 扫描 `sessions/**/*.jsonl`：可能较慢，只在 sqlite 不可用或缺 row 时使用，并可限制为按年月目录和 `session_index` 线索查找。

需要避免：

- 每次消息都调用 `discoverCodexSessions()` 全量扫描。
- tail 或 parse 大型 rollout JSONL。
- 在 route busy 的 steer 高频路径中反复检测。

## 并发与一致性

### 同一 route 正在运行

如果 Chat-Codex 当前 route 已经有 active turn，普通补充消息可能走 `turn/steer`。这时不应做外部 reload：

- active turn 是 Chat-Codex 自己正在运行的上下文。
- reload 会和 active turn 冲突。
- queued prompt 会在轮到执行时再检查。

### 外部 CLI 正在运行

如果电脑端 Codex CLI 正在同一个 session 上运行，Chat-Codex 只能看到本地文件正在变化，无法可靠知道外部 turn 是否已经完成。

第一版建议：

- 如果两次快速读取 fingerprint 不稳定，比如 size/mtime 在短时间内变化，可以延迟 500ms 再读一次。
- 如果仍变化，提示用户“电脑端 session 仍在更新”，本条消息不投递或进入短延迟重试。

后续可增加：

```ts
externalWriteStabilityWindowMs: 1000
externalWriteMaxWaitMs: 5000
```

### 多写冲突边界

该功能不能保证两个进程不会同时写同一个 session。它只能降低“Chat-Codex 明知本地历史已变却继续用旧状态”的问题。

如果用户确实需要双端同时实时协作，应使用长期共享 app-server 模式，而不是本设计。

## 文件与模块规划

建议新增或修改：

```text
src/codex/session-context-fingerprint.ts
  读取单个 session 的 sqlite / rollout / session_index 指纹。

src/context-refresh/types.ts
  定义 off / detect / reload 策略、默认值、归一化和展示文案。

src/bridge/context-refresh.ts
  根据开关、已知快照和当前指纹执行 beforeRun / afterRun。

src/state/persistent-state-types.ts
  增加 RoutePolicyRecord.contextRefresh、SessionContextSnapshotRecord / SessionContextSnapshotsDocument。

src/state/file-state-store.ts
  读写 route 级 contextRefresh policy，并读写 session-context-snapshots.json。

src/state/memory-state-store.ts
  提供内存版 route policy 和 snapshot API，方便测试。

src/codex/types.ts
  增加 CodexSessionReloadResult 和 CodexAdapter.reloadSession?。

src/codex/app-server-codex-adapter.ts
  实现 reloadSession(sessionId)，重启 Chat-Codex 自己的 app-server 子进程后再 thread/resume，避免复用旧内存 thread。

src/codex/exec-codex-adapter.ts
  实现轻量 reloadSession(sessionId)。

src/bridge/route-queue.ts
  在 forwardPrompt() 中插入发送前 context refresh preflight。

src/bridge/command-router.ts
src/bridge/commands/context-refresh-command.ts
src/bridge/status-text.ts
  支持 /context-refresh 和 /status 展示。

src/state/channel-config-store.ts
src/cli/actions/launcher-actions.ts
src/cli/serve/bridge-runtime.ts
src/cli/tui/*
  支持全局默认和 route 覆盖的配置入口，并持久化到 config.json / routes.json。
```

测试建议：

```text
tests/unit/session-context-fingerprint.test.ts
tests/unit/bridge-context-refresh.test.ts
tests/unit/app-server-codex-adapter.test.ts
tests/unit/file-state-store.test.ts
  tests/unit/serve-wizard.test.ts
  tests/unit/ink-tui.test.tsx
```

## 实施阶段

### 阶段 1：只读检测能力

- 实现 `readCodexSessionContextFingerprint()`。
- 增加内存 snapshot store。
- 在测试里构造 sqlite/JSONL fixture，验证更新时间、文件 size/mtime 比较。
- 不接入 Bridge 运行路径。

### 阶段 2：Bridge 发送前 detect 模式

- 增加 `ContextRefreshManager`。
- `BridgeRouteQueue.forwardPrompt()` 中在 `codex.run()` 前调用。
- 支持 `mode: "detect"`。
- 检测到更新时只提示，不 reload。
- 写 afterRun 快照，避免自写误报。

### 阶段 3：reload 模式

- 增加 `CodexAdapter.reloadSession?`。
- AppServer adapter 实现 app-server 子进程重启后 `thread/resume`。
- Exec adapter 实现本地元数据刷新。
- `mode: "reload"` 下 reload 成功再投递，失败不投递。

### 阶段 4：用户开关

- `config.json` 增加独立模式专属 `codexDefaults.independentMode.contextRefresh`，或保留短字段但内部明确只对独立模式生效。
- `routes.json` 增加 `routes[].policy.contextRefresh`，保存当前微信一对一、飞书 `chat_id` 等 route 的覆盖策略。
- CLI/TUI 增加配置入口。
- 可选增加聊天命令 `/context-refresh`。
- `/status` 展示当前 route 的上下文刷新模式和最近快照时间。

### 阶段 5：真实双端验证

需要实测两种路径：

1. Chat-Codex 绑定 session 后，电脑端用 `codex resume <sessionId>` 继续聊，再回 Chat-Codex 发送消息。
2. Chat-Codex 绑定 session 后，电脑端用 `codex exec resume <sessionId> <prompt>` 写入历史，再回 Chat-Codex 发送消息。

验收重点：

- Chat-Codex 能检测到 fingerprint 变新。
- reload 后下一条消息能基于电脑端新上下文回答。
- app-server adapter 的 reload 必须能绕过已加载 thread 的内存缓存。

## 风险

1. AppServer reload 会重启 Chat-Codex 自己的 app-server 子进程；如果还有其它 route 正在运行，必须阻止 reload，避免中断其它任务。
2. Windows 用户可能没有 `sqlite3` 命令，必须有 JSONL fallback。
3. 外部 Codex CLI 正在写入时，文件可能处于变化中，需要稳定窗口避免半途接入。
4. Codex 本地 schema 可能变化，因此 sqlite 查询必须容错，不能让检测失败影响主链路。
5. 默认开启可能让用户困惑，第一版应默认关闭或仅在 TUI 里明确启用。

## 推荐第一版策略

第一版建议做成：

```text
默认 off
提供 detect / reload 两档
优先 sqlite updated_at_ms + rollout stat
发送前检查
reload 用 adapter.reloadSession()
reload 失败不投递
afterRun 更新快照
```

这能满足“Chat-Codex 主动察觉上下文更新，在下一次发消息前刷新并通知用户”的核心需求，同时避免把它误做成实时共享模式。

## macOS 与 Windows 兼容性

这个功能必须按 macOS 和 Windows 双平台设计，不能只按当前 macOS 开发机实现。

### CODEX_HOME

Codex 官方源码显示：

```text
CODEX_HOME 有值时使用 CODEX_HOME
CODEX_HOME 没有值时默认使用 ~/.codex
```

Chat-Codex 应继续沿用当前策略：

- 优先 `process.env.CODEX_HOME`。
- 否则 `path.join(os.homedir(), ".codex")`。
- 不硬编码 macOS `~/Library/...` 或 Windows `%APPDATA%`。
- 所有路径拼接必须用 Node `path.join()` / `path.resolve()`，不能手写 `/`。

### SQLite 读取

macOS 通常自带 `sqlite3` 命令；Windows 很多机器没有。

因此第一版不能把 `sqlite3` CLI 作为硬依赖：

- 有 `sqlite3` 时，用 `spawnSync("sqlite3", ["-readonly", "-json", dbPath, sql])` 读取单个 session。
- 不通过 shell 拼字符串，避免 Windows 路径空格、反斜杠和引号问题。
- `sqlite3` 不存在、超时、数据库被锁或返回异常时，降级到 JSONL/`session_index.jsonl` fallback。
- 检测失败不能阻断正常投递，除非已经明确检测到更新但 reload 失败。

后续如果需要更稳定的 Windows 体验，可以考虑引入跨平台 SQLite 依赖，但第一版不建议为了一个可选检测功能增加 native dependency。

### Rollout JSONL 路径

`threads.rollout_path` 可能是：

- macOS/Linux 绝对路径：`/Users/name/.codex/sessions/.../rollout-....jsonl`
- Windows 绝对路径：`C:\Users\name\.codex\sessions\...\rollout-....jsonl`
- 少数场景下可能是相对 `CODEX_HOME` 的路径。

实现要求：

- 读取 sqlite 返回的 `rollout_path` 后，先判断 `path.isAbsolute()`。
- 相对路径按 `path.resolve(codexHome, rolloutPath)` 处理。
- 对文件只做 `fs.stat()`，不通过 shell 命令 `stat`。
- 保存 snapshot 时保存原始 path 和 normalize 后 path，便于排障。
- 不假设路径分隔符是 `/`。

### JSONL fallback

没有 sqlite 时，fallback 会扫描 `CODEX_HOME/sessions/**/*.jsonl` 找首行 `session_meta.payload.id` 匹配的文件。

兼容要求：

- 扫描用 `fs.readdirSync(..., { withFileTypes: true })` 或异步等价 API。
- 只读首行，最多读取固定字节，比如 64 KiB。
- 不要求文件名格式完全稳定，只要求首行 `session_meta` 可解析。
- 扫描应限制在当前 `CODEX_HOME/sessions` 下，避免误扫用户全盘。
- Windows 上要处理 `EPERM` / `EBUSY` / `ENOENT`，遇到单个文件错误跳过。

### 文件时间与稳定性

跨平台不能只看 `mtime`：

- macOS APFS 和 Windows NTFS 都能提供足够细的 `mtimeMs`，但不同文件系统和同步盘可能有精度差异。
- 指纹必须组合 `updatedAtMs + rolloutSize + rolloutMtimeMs`。
- 如果 `mtimeMs` 变了但 size 没变，不一定代表有用户上下文更新，应该只作为弱信号。
- 如果 size 变大，基本可以认为 rollout 有新写入。

外部 CLI 正在写入时，Windows 更容易遇到短暂锁或读失败。因此检测应支持稳定窗口：

```text
读 fingerprint A
等待 300-500ms
读 fingerprint B
如果 B 仍在变化，认为电脑端 session 可能仍在写入
```

第一版可以先只在检测到变化时做一次短延迟复读，避免每条消息都增加固定延迟。

### App-server reload

`thread/resume` 官方协议说明可以按 `threadId` 从磁盘加载 thread。独立模式下的 AppServer adapter 会在 reload 时先重启 Chat-Codex 自己启动的 app-server 子进程，再用 `thread/resume` 从磁盘加载目标 session。

真实测试和官方 app-server 代码都显示：如果当前 app-server 进程里已经加载了同一个 thread，重复 `thread/resume` 只会向客户端返回磁盘历史并附加订阅，不会替换后续 `turn/start` 使用的内存 thread。因此不能只靠强制 `thread/resume`。

兼容策略：

- macOS/Windows 都使用同一套指纹检测逻辑。
- AppServer reload 只重启 Chat-Codex 自己启动的 app-server 子进程，不能杀用户电脑上独立打开的 Codex CLI。
- Exec reload 只刷新本地 session 元数据，真正上下文读取交给每轮 `codex exec resume`。

## 工作量估算

按现有代码结构估算，这个功能属于中等改动，主要复杂度在跨平台容错和真实双端验证。

### 最小可用版

目标：

- 独立模式下提供全局开关。
- 发送前检测 sqlite/rollout 指纹。
- detect/reload 两档。
- AppServer/Exec adapter 支持 reload。
- macOS 和 Windows 路径、sqlite fallback 基本兼容。

预计改动：

- 新增 `session-context-fingerprint.ts`。
- 新增 `context-refresh.ts`。
- 扩展 state store 保存 snapshot。
- 扩展 CodexAdapter `reloadSession?`。
- route queue 接入 preflight。
- 基础 CLI/TUI 开关。
- 单元测试覆盖 sqlite、JSONL、Windows path、reload 成功/失败。

估算：2-3 个开发日。

### 稳健版

在最小可用版基础上补：

- 外部写入稳定窗口。
- Windows 无 sqlite3 的完整 fallback 测试。
- 多 route 并发时 app-server reload 的安全阻断和用户提示。
- `/context-refresh` 聊天命令和 `/status` 展示。
- 真实 macOS + Windows 双端手测报告。

估算：4-6 个开发日。

### 风险最高的验证项

1. AppServer adapter 重启子进程后再 resume 是否能稳定读取外部新增历史。
2. Windows 上没有 `sqlite3` 时，fallback 扫描性能和可靠性。
3. 外部 CLI 正在写同一个 rollout 时，检测是否会误判或过早 reload。
4. 同一 session 被两个进程同时写入时，Codex 官方是否允许、是否会产生历史顺序问题。

因此建议先做最小可用版，并把默认模式设为 `off` 或 `detect`，通过真实双端验证后再考虑默认推荐 `reload`。
