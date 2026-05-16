# 飞书 Typing 表情适配测试报告

日期：2026-05-16

## 测试范围

- 飞书 adapter 声明支持通用 `typing` 能力。
- 飞书 `sendTyping(true)` 使用 `im.messageReaction.create` 给用户原消息添加 `Typing` 表情。
- 飞书 `sendTyping(false)` 使用 `im.messageReaction.delete` 移除已添加的 reaction。
- Bridge 处理飞书普通任务时，复用现有 Codex turn 生命周期自动触发 typing 开始/结束。
- reaction 添加失败时不阻断 Codex 回复，也不把渠道状态降级。
- README 和飞书设计文档补充 reaction typing 说明。

## 官方插件对照

本地参考项目 `references/openclaw-lark` 的做法是：

- `references/openclaw-lark/src/messaging/outbound/typing.ts` 使用 `Typing` reaction 模拟输入中。
- 添加时调用 `client.im.messageReaction.create`。
- 删除时调用 `client.im.messageReaction.delete`。
- 失败只作为 best-effort 记录，不影响正常消息处理。

本项目按同一语义接入到 `FeishuAdapter.sendTyping()`。

## 自动化测试

### 单元测试

命令：

```bash
npm run test:unit
```

结果：

```text
99 passed, 0 failed
```

覆盖：

- Feishu capabilities 中 `typing: true`。
- `sendTyping(true)` 添加 `Typing` reaction。
- 重复 `sendTyping(true)` 不重复添加 reaction。
- `sendTyping(false)` 使用 create 返回的 `reaction_id` 删除 reaction。
- reaction 添加失败时 channel 仍保持 `connected`，`lastError` 不污染主发送状态。

### 集成测试

命令：

```bash
npm run test:integration
```

结果：

```text
66 passed, 0 failed
```

覆盖：

- 飞书私聊普通任务通过 Bridge 触发 `Typing` reaction 添加和删除。
- `/help`、`/status` 等命令不进入 Codex 普通任务队列，不触发 typing reaction。
- 默认 progress 投递和 `/progress silent` 行为保持不变。

### 全量测试

命令：

```bash
npm test
```

结果：

```text
165 passed, 0 failed
```

## 格式检查

命令：

```bash
git diff --check
```

结果：通过。

