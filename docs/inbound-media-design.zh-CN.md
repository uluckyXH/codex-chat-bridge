# 入站图片和文件适配设计

## 背景

当前中间件已经支持 Codex 最终回复通过 `/sendfile` 显式发送图片或文件到渠道，但入站方向还没有真正打通。用户在微信或飞书里发送图片时，中间件目前不能把图片作为可用上下文传给 Codex。

这份文档定义设计和实施边界。当前核心逻辑与微信/飞书 adapter 第一阶段已落地：Bridge 能处理带 `localPath` 的入站图片/文件、route 级 pending media、结构化 `CodexTurnInput`、app-server `localImage` 投递和 busy route 下结构化 steer；微信/飞书 adapter 已能把入站图片/文件下载保存到本地，飞书也已支持出站图片/文件发送。

## 当前现状

协议层和 Bridge Core 的第一阶段入口已经具备：

- `ChannelMessage.attachments?: ChannelAttachment[]` 已存在。
- `ChannelAttachment` 已扩展 `localPath`、`url`、`downloadState`、`error`。
- `Bridge.handleMessage()` 已支持 attachment-only 消息，不再因为没有文本直接忽略。
- Mock channel 已支持入站 attachment 测试入口。
- app-server Codex adapter 已支持 `turn/start` 和 `turn/steer` 的 `localImage` 结构化输入。

渠道实现现状：

- 微信 adapter 已支持出站 `sendMedia()`，可以把本地图片/文件上传并发送给微信。
- 微信入站已识别 `image_item` / `file_item`，通过微信 CDN `full_url` 或 `encrypt_query_param` 下载，必要时按 AES-128-ECB 解密，再保存到本地上传目录并填入 `ChannelMessage.attachments[].localPath`。
- 飞书 adapter 已声明 `media=true`、`receiveMedia=true`，支持私聊 `text` / `image` / `file` / `post` 消息映射；入站图片和文件通过 `im.messageResource.get` 下载保存。
- 飞书出站 `sendMedia()` 已支持图片和文件：图片走 `im.image.create` 上传后发送 `msg_type=image`，文件走 `im.file.create` 上传后发送 `msg_type=file`；有 caption 时先发一条文本说明。

Codex 侧现状：

- `CodexAdapter.run()` 和 `steer()` 已支持 `string | CodexTurnInput`。
- `AppServerCodexAdapter.run()` 和 `steer()` 已能把 `localImage` 映射到 app-server `UserInput.localImage`。
- `MockCodexAdapter` 和 `ExecCodexAdapter` 会把结构化输入降级为带本地路径说明的文本。
- Codex app-server v2 协议支持 `UserInput`：
  - `{ type: "text", text, text_elements }`
  - `{ type: "image", url }`
  - `{ type: "localImage", path }`
  - `{ type: "skill", name, path }`
  - `{ type: "mention", name, path }`
- 因此图片先保存到本地，再通过 `localImage` 投递给 Codex 是可行的。普通文件没有直接的 app-server `UserInput` 类型，第一阶段应以本地路径文本方式交给 Codex 读取。

## 目标行为

### 图片加文本

当渠道消息同时包含图片和文本时，Bridge 应直接投递给 Codex：

```text
用户文本 + 本地图片输入
```

示例：

- 飞书：同一条消息里有图片和文字，adapter 下载图片并填入 attachment，本条消息直接进入 Codex。
- 微信：如果平台事件能同时提供图片和文字，也按同样规则处理。

### 图片无文本

当用户只发图片，没有任何说明时，不应直接让 Codex 猜用途。Bridge 应保存图片，并回复当前 route：

```text
【Chat-Codex中间件提醒】
已收到 1 张图片。你想让 Codex 如何处理这张图片？
请直接回复你的要求，例如：解释这张图、提取文字、检查 UI 问题、根据截图定位代码问题。
发送 /cancel 可取消本次图片。
```

这条提醒是中间件本地回复，不进入 Codex prompt，不计入 Codex 任务队列。

用户下一条普通文本会和待处理图片合并后投递给 Codex。用户发送 slash command 时仍按命令处理，不消耗待处理图片，除非是专门的取消命令。

### 微信分开发图和文字

微信常见形态是先发一张图片，再发文字说明。这个场景按“图片无文本”的 pending 流程处理：

1. 收到图片，保存本地。
2. 回复 `【Chat-Codex中间件提醒】...你想让 Codex 如何处理这张图片？`
3. 用户回复文字。
4. Bridge 把文字和图片一起投递给 Codex。

同一路由只维护自己的 pending media，不影响其他微信好友、群、飞书 chat 或其他渠道。

## 协议设计

### ChannelAttachment 扩展

建议扩展 `ChannelAttachment`，保持向后兼容：

```ts
export interface ChannelAttachment {
  id: string;
  type: "image" | "voice" | "file" | "video" | "unknown";
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  caption?: string;
  localPath?: string;
  url?: string;
  downloadState?: "available" | "failed" | "unsupported";
  error?: string;
  raw?: unknown;
}
```

约定：

- `localPath` 是 Bridge 可读取的本地绝对路径。
- `url` 只用于平台能提供临时可访问 URL 的场景。图片第一阶段仍建议下载到 `localPath`。
- `downloadState=available` 表示可以投递给 Codex。
- `downloadState=failed` 应向用户提示“图片保存失败，请重发”。
- `downloadState=unsupported` 表示 adapter 识别到了媒体但当前不支持下载。

### 入站媒体存储

入站媒体必须保存到 Git 忽略的本地目录，不写入仓库。默认目录放在 Chat-Codex 进程启动工作目录下：

```text
<chat-codex-start-cwd>/.chat-codex-uploads/<channelId>/<accountId>/<routeHash>/<yyyy-mm>/<messageId>-<attachmentId>.<ext>
```

这里的 `chat-codex-start-cwd` 是启动 `npm run chat-codex` 或 `chat-codex` 时的进程工作目录，不等同于某个 Codex session 的工作目录。Codex 新会话可以选择其它工作目录，但上传附件默认仍存放在 Chat-Codex 启动目录下，便于用户知道“聊天渠道上传给中间件的文件”在哪里。

目录命名选择：

- 默认使用 `.chat-codex-uploads/`，语义明确且尽量减少对项目目录的打扰。
- 不建议使用通用名 `uploads/`、`attachments/`，容易和用户项目自己的目录冲突。
- 本仓库 `.gitignore` 必须忽略 `.chat-codex-uploads/` 和 `chat-codex-uploads/`。
- 如果用户在自己的 Git 仓库目录下启动 Chat-Codex，程序不应静默修改用户项目 `.gitignore`。后续实现可以在检测到该目录未被忽略时提示用户添加：

```gitignore
.chat-codex-uploads/
chat-codex-uploads/
```

配置覆盖：

- 默认：`process.cwd()/.chat-codex-uploads/`。
- 后续允许通过环境变量覆盖：

```text
CHAT_CODEX_UPLOAD_DIR=/absolute/path/to/chat-codex-uploads
```

- TUI 后续可以增加“上传附件目录”配置项，但第一阶段先用默认目录和环境变量。
- 无论存储目录如何配置，投递给 Codex 的路径必须是绝对路径，避免 Codex session 工作目录变化后找不到文件。

要求：

- 文件名必须 sanitize，不信任平台原始文件名。
- 根据 MIME 和 magic bytes 校验扩展名。
- 第一阶段支持图片：png、jpg/jpeg、webp、gif。
- 文件大小设上限，建议默认图片 20MB，普通文件 50MB。
- 保存元数据时不要记录真实 secret、cookie、下载 token。
- 后续加清理任务：按 TTL 删除旧文件，默认保留 7 天或可配置。
- 文件路径只作为本机中间件和 Codex 之间的上下文，不应回显完整路径给普通聊天用户，除非用于调试或明确需要。

### CodexAdapter 输入扩展

当前 `CodexAdapter.run(sessionId, prompt: string)` 只接收字符串。建议引入结构化输入：

```ts
export type CodexInputItem =
  | { type: "text"; text: string }
  | { type: "localImage"; path: string }
  | { type: "localFile"; path: string; name?: string; mimeType?: string };

export interface CodexTurnInput {
  text: string;
  items: CodexInputItem[];
}
```

兼容策略：

- Bridge 内部统一构建 `CodexTurnInput`。
- `CodexTurnInput.text` 保持用户原始文本；`items` 保存结构化附件。
- 对 app-server，最终 JSON-RPC `input` 应按顺序构造成：

```json
[
  { "type": "text", "text": "用户说明", "text_elements": [] },
  { "type": "localImage", "path": "/absolute/path/.chat-codex-uploads/weixin/default/route/2026-05/msg-att.png" }
]
```

- `AppServerCodexAdapter` 把 `localImage` 映射为 app-server `UserInput.localImage`。该能力已经存在于 Codex app-server v2 协议。
- `localFile` 第一阶段映射为文本说明，因为 app-server 当前没有通用 file input：

```text
用户上传了文件：
- report.pdf: /absolute/path/report.pdf

请根据用户要求读取这些文件。
```

- `MockCodexAdapter` 和 `ExecCodexAdapter` 可以先把结构化输入降级为文本，保证现有测试和 fallback 行为稳定。
- `steer()` 也应支持同一套 `CodexTurnInput`，因为 app-server `turn/steer` 同样接收 `UserInput[]`。

`turn/start` 和 `turn/steer` 的区别：

- 空闲 route：调用 `turn/start`，把文本和图片作为新 turn 输入。
- busy route：如果当前 adapter 支持结构化 `steer()`，调用 `turn/steer`，同样传入 text + `localImage`。
- 如果 busy route 的 adapter 不支持结构化 steer，必须回落到 route 队列，不丢图片。
- `expectedTurnId` 仍由 app-server adapter 维护，避免图片误投到其它 turn。

`CodexTurnInput.items` 必须保留输入顺序。后续实现 route 级 steer buffer 时，不能继续只保存 `string[]`，需要保存结构化输入：

```ts
interface PendingSteerInput {
  target: ChannelTarget;
  input: CodexTurnInput;
  createdAt: number;
}
```

连续普通文本可以像现有 mid-turn steer 一样短窗口聚合；一旦批次里包含图片或文件，聚合逻辑必须保留每条消息的边界和附件顺序。可接受的策略是把同 route 的多条补充消息合并成一个结构化 `CodexTurnInput`，按顺序排列 `text`、`localImage` 和 `localFile`；也可以先 flush 之前的文本批次，再单独投递图文补充。无论选择哪种实现，都不能为了复用文本 batching 把 `localImage` 丢掉或只剩一句“用户发了图片”。

## Bridge 行为设计

### 消息分类

Bridge 收到 `ChannelMessage` 后按以下顺序处理：

1. 解析 text。
2. 解析可用 attachments。
3. 如果是 slash command：
   - 执行命令。
   - 不自动消费 pending media。
4. 如果有文本且有 attachment：
   - 构建 `CodexTurnInput`，直接进入 `enqueuePrompt` 或 busy route steer。
5. 如果只有 attachment：
   - 保存到 route pending media。
   - 回复 `【Chat-Codex中间件提醒】...`
   - 不入队 Codex。
6. 如果只有文本且当前 route 有 pending media：
   - 文本和 pending media 合并投递。
   - 清空该 route pending media。
7. 如果只有文本且没有 pending media：
   - 保持现有文本流程。

### Pending media 状态

新增 route 级状态：

```ts
interface PendingRouteMedia {
  routeKey: string;
  attachments: ChannelAttachment[];
  createdAt: number;
  sourceMessageIds: string[];
}
```

规则：

- pending media 按 `routeKey` 隔离。
- 默认最多保留 5 个 pending attachment。
- 新图片到来时，如果已有 pending media，可以追加；超过上限则提示用户先描述或取消。
- pending media 默认 10 分钟过期。
- `/cancel` 可取消 pending media；如果当前没有会话选择流程或其他取消上下文，回复“已取消待处理图片”。
- `/status` 可显示 `待处理图片: N`。
- `/stop` 应清空未投递 pending media，避免用户以为之后还会处理。

### 与 busy route 和 steer 的关系

如果 route 正在执行：

- 文本加图片应优先尝试 `steer()`，前提是 Codex adapter 支持结构化 steer。
- 如果 adapter 不支持结构化 steer，回落到 route 队列，作为下一轮任务处理。
- 单独图片仍不 steer，因为没有用户意图，继续进入 pending media 并询问用户。
- 语义修改命令继续由 busy guard 阻断，不因为 pending media 改变。

### 执行中收到图片

Codex 执行过程中收到图片时，Bridge 仍按当前 route 处理，不做全局阻断，也不跨 route 共享状态。

#### 执行中收到图片加文本

当同一条消息包含文本和图片，或者当前 route 已有 pending media 且用户补充了普通文本：

1. Bridge 先确认图片已经保存为本地绝对路径。
2. 构建结构化 `CodexTurnInput`，内容包含用户文本和 `localImage`。
3. 如果当前 route 有 active regular turn，且 `CodexAdapter.steer()` 支持结构化输入，进入 route 级 steer buffer。
4. steer buffer 必须按 route 保序、串行 drain，不能并发投递，也不能和其它 route 混用。
5. 投递成功后向当前渠道回复现有 mid-turn steer 确认文案，例如：

```text
已投递到当前 Codex 任务，会在下一次工具调用或模型继续推理时生效。
```

6. 如果 steer 失败、adapter 不支持、active turn 已结束或当前 turn 不可 steer，原始图文输入必须按原顺序回退当前 route 普通队列，使用现有排队提示。
7. 已成功 steer 的图片和文本已经进入当前 Codex turn，不能再通过 `/cancel` 单独撤回；用户只能继续补充说明或 `/stop` 中断当前任务。

这类输入不是 `/plan`、`/goal`、`/permission` 等执行语义修改命令，不应被 busy guard 直接拒绝。它和普通文本 mid-turn steer 属于同一类“用户补充上下文”。

#### 执行中收到纯图片

当消息只有图片，没有任何文本说明时：

1. Bridge 只保存图片到当前 route 的 pending media。
2. 不调用 `turn/steer`，不启动新 turn，也不进入普通队列。
3. 回复 `【Chat-Codex中间件提醒】`，询问用户希望 Codex 如何处理这张图片。
4. 用户下一条普通文本到达时，Bridge 把该文本和 pending media 合并。
5. 如果那时当前 route 仍在执行，则按“图片加文本”的规则尝试结构化 steer。
6. 如果那时当前 route 已空闲，则按普通新 turn 流程调用 `turn/start` 或进入队列。

这样做的原因是：纯图片没有明确意图，自动投递给正在执行的 Codex 容易让当前任务语义漂移，也会让用户误以为“发图本身就是一个新指令”。中间件只确认已收到图片，直到用户给出说明后才把图片交给 Codex。

#### 执行中收到多张图片

多张图片遵循同一规则：

- 多张图片加文本：作为同一个结构化补充输入投递或排队。
- 多张纯图片：追加到当前 route pending media，超过上限时提示用户先描述或取消。
- 用户连续发送“图片、图片、文字”时，文字一次性消费当前 route 的 pending media，按发送顺序交给 Codex。

#### 执行中命令与图片的关系

slash command 不消费 pending media，除非命令本身就是取消语义：

- `/cancel`：当前没有其它更高优先级取消上下文时，取消未投递的 pending media。
- `/stop`：中断当前任务，同时清空未投递 pending media 和未投递 steer buffer。
- `/status`：展示 pending media 数量和待投递补充消息数量。

busy guard 仍然阻断会改变执行语义的命令，例如 `/plan`、`/code`、`/goal <目标>`、`/goal pause`、`/goal resume`、`/goal clear`、`/permission ...`、`/model ...`、`/new`、`/use`、`/resume` 和会话编号选择。图片 pending 不应让这些命令绕过 busy guard。

#### 微信和飞书的用户可见差异

微信渠道通常禁用 progress 投递，所以用户可能只看到：

- 图片-only 的中间件提醒。
- 图文补充的投递确认或排队提示。
- Codex 最终回复、错误、审批请求和审批结果。

飞书、Terminal、Mock 或未来其它渠道是否显示 progress，仍由 `ChannelDeliveryPolicy` 控制。入站图片处理不应写成微信特例；Bridge Core 只按 route、pending media 和 Codex structured input 处理。

## 渠道适配策略

### 微信

目标：

- 从 `item_list` 中识别 `image_item` 和 `file_item`。
- adapter 负责调用微信媒体下载链路，把图片或文件保存到本地。
- 发给 Bridge 的 `ChannelMessage.attachments[]` 必须包含 `localPath`。

第一阶段：

- 支持私聊图片。
- 图片-only 走中间件提醒。
- 图片后续文字走 pending media 合并。
- 暂不支持群聊图片，除非现有 group route 已稳定。

注意：

- 微信经常是一条图片消息和一条文字消息，不要依赖“同消息图文”。
- 下载失败必须向用户提示，不能静默丢图。

### 飞书

目标：

- 支持私聊图片消息和图文消息。
- adapter 根据飞书事件里的 image/file key 调用飞书资源下载 API，并保存到本地。
- 如果飞书富文本/消息结构能同时携带文本和图片，则同一条 `ChannelMessage` 同时填 `text` 和 `attachments`。

第一阶段：

- `getCapabilities().media` 表示当前 adapter 已实现出站媒体发送。
- `receiveMedia` 表示当前 adapter 已实现入站媒体接收、下载和本地保存。
- 飞书当前两者都声明为 `true`：

```ts
media: true;
receiveMedia: true;
```

## 用户可见文案

### 单张图片无文本

```text
【Chat-Codex中间件提醒】
已收到 1 张图片。你想让 Codex 如何处理这张图片？
请直接回复你的要求，例如：解释这张图、提取文字、检查 UI 问题、根据截图定位代码问题。
发送 /cancel 可取消本次图片。
```

### 多张图片无文本

```text
【Chat-Codex中间件提醒】
已收到 3 张图片。你想让 Codex 如何处理这些图片？
请直接回复你的要求；我会把这些图片和你的说明一起交给 Codex。
发送 /cancel 可取消本次图片。
```

### 图片保存失败

```text
【Chat-Codex中间件提醒】
图片保存失败，暂时不能交给 Codex 处理。请稍后重发。
```

### 附件类型不支持

```text
【Chat-Codex中间件提醒】
已收到附件，但当前只能处理已成功保存到本地的图片或文件。请稍后重发，或换成图片/文件重新发送。
```

## 实施顺序

1. 扩展协议和测试工具：
   - `ChannelAttachment` 增加 `localPath`、`url`、`downloadState`。
   - Mock channel 增加入站 attachment 测试入口。
   - Bridge 不再忽略 attachment-only 消息。

2. 增加本地入站媒体存储：
   - 新建 `src/bridge/inbound-media-store.ts` 或 `src/protocol/media-store.ts`。
   - 默认保存到 `<chat-codex-start-cwd>/.chat-codex-uploads/...`。
   - 支持 `CHAT_CODEX_UPLOAD_DIR` 覆盖上传目录。
   - 本仓库 `.gitignore` 忽略默认上传目录；对用户项目只提醒，不静默改 `.gitignore`。
   - 增加 MIME、大小、路径安全检查。

3. Bridge pending media 流程：
   - 图片-only 回复中间件提醒。
   - 下一条普通文本合并 pending media。
   - route busy 时，图文输入优先进入结构化 steer buffer；纯图片只进入 pending media。
   - `/status`、`/cancel`、`/stop` 覆盖 pending media。
   - route 隔离测试。

4. CodexAdapter 结构化输入：
   - 增加 `CodexTurnInput`。
   - AppServer adapter 映射 `localImage` 到 `UserInput.localImage`。
   - `turn/start` 和 `turn/steer` 都支持图片。
   - Bridge 的 steer buffer 从文本队列扩展为结构化输入队列，保留附件顺序。
   - Mock/Exec adapter 降级为文本。

5. 微信入站图片和文件：
   - 已识别 `image_item` / `file_item`。
   - 已下载保存并填入 `localPath`。
   - 已覆盖入站图片/文件下载成功和图片下载失败测试。

6. 飞书入站图片和文件：
   - 已支持私聊图片消息和文件消息。
   - 已支持富文本 `post` 中提取文本和图片。
   - 已保持飞书多机器人、多 chat route 隔离由既有 routeKey 机制负责。

7. 普通文件：
   - 已先保存本地并以 `localFile` 降级文本路径交给 Codex。
   - 后续再评估是否需要专门的文件解析、预览或摘要能力。

## 测试要求

必须新增测试：

- `ChannelMessage` attachment-only 不再被 Bridge 忽略。
- 图片-only 回复 `【Chat-Codex中间件提醒】`，不触发 Codex run。
- 图片-only 后接普通文本，合并图片和文本投递 Codex。
- 图片加文本同消息直接投递 Codex。
- pending media 按 route 隔离，不串微信好友、飞书 chat 或渠道。
- `/cancel` 取消 pending media。
- `/stop` 清空 pending media。
- busy route 下图片加文本优先 steer，失败 fallback 到队列。
- busy route 下纯图片只进入 pending media，不调用 steer，不触发 Codex run。
- busy route 下先发纯图片、再发普通文本；如果当前 turn 仍活跃，应合并 pending 图片后走结构化 steer。
- busy route 下先发纯图片、再等当前 turn 结束、再发普通文本；应合并 pending 图片后启动下一轮或进入普通队列。
- route 级 steer buffer 必须保留 `localImage`，不能把图文补充降级成纯文本后丢图。
- `/status` 同时显示 pending media 数量和待投递 steer buffer 数量。
- AppServer adapter 发送 `localImage` 到 `turn/start`。
- AppServer adapter 发送 `localImage` 到 `turn/steer`。
- 默认上传目录解析为 `process.cwd()/.chat-codex-uploads/`，并能被 `CHAT_CODEX_UPLOAD_DIR` 覆盖。
- `.chat-codex-uploads/` 不出现在本仓库 `git status` 中。
- 微信图片下载失败时给用户明确提醒。
- 飞书非 text 图片消息不再 `unsupported_message_type`，而是映射为 attachment。

每次实现后需要跑：

```bash
npm run build
node --test dist/tests/integration/bridge-mock.test.js
node --test dist/tests/unit/app-server-codex-adapter.test.js
npm test
git diff --check
```

并在 `reports/tests/` 增加中文测试报告。
