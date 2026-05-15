# 测试报告：核心多渠道内核

## 测试目标

验证核心多渠道内核改造是否满足本轮范围：`ChannelRegistry` 多渠道注册和投递、Bridge registry 接入、微信实例 `channelId` 映射、`SessionBindings` 唯一 owner、`TurnScheduler` 默认不限并发和有限并发背压，以及双 mock channel 的路由隔离。

## 测试环境

- 日期：2026-05-15
- 分支/提交：main / 162b68d
- Node.js 版本：v24.13.1
- 操作系统：macOS 26.3.1
- Codex 版本：codex-cli 0.130.0
- 渠道：mock / weixin local fake API

## 执行命令

```bash
npm run build
node --test dist/tests/unit/channel-registry.test.js dist/tests/unit/session-bindings.test.js dist/tests/unit/turn-scheduler.test.js dist/tests/unit/weixin-message-mapping.test.js dist/tests/integration/bridge-mock.test.js
npm test
```

## 测试步骤

1. 执行 TypeScript 构建，确认新增模块和 Bridge 改造没有类型错误。
2. 执行新增单元测试，覆盖 `ChannelRegistry`、`SessionBindings`、`TurnScheduler` 和微信消息映射。
3. 执行 Bridge mock 集成测试，覆盖两个 mock channel 同进程进入一个 Bridge。
4. 执行全量测试，确认旧的 mock、terminal、weixin fake API、Codex adapter、审批、媒体和 CLI 相关测试仍通过。

## 实际结果

- `npm run build`：通过。
- 定向测试：58 个测试通过。
- `npm test`：129 个测试通过，0 失败。
- 覆盖到的关键行为：
  - 重复 `channelId` 会被 `ChannelRegistry` 拒绝。
  - 出站消息按 `target.channelId` 投递到正确 adapter。
  - adapter 入站 `message.channelId` 与实例 ID 不一致时被拒绝。
  - 同一个 Bridge 可接两个 mock channel，A/B 回复不会串线。
  - 不同 route 默认并行，同 route 仍由原 route 队列串行。
  - 一个 Codex session 只能属于一个 owner route，其他 route `/resume` 会被拒绝。
  - `/OK` 只处理当前 route 的 pending approval，不能处理其他渠道 route 的审批。
  - `UnlimitedTurnScheduler` 不限制并发，`LimitedTurnScheduler(1)` 串行执行并能跳过已取消的排队 turn。
  - `WeixinAdapter` 默认仍使用 `weixin`，同时支持实例级 `channelId` 映射。

## 结论

通过。核心多渠道内核已完成本地 mock/local 验证，现有单渠道入口相关测试保持通过。

## 遗留问题

- 本轮未做真实第二渠道、配置文件、启动向导、`/cwd` 或复杂工作目录策略，符合本轮范围。
- 真实微信多实例运行需要后续用户扫码登录后补测；本轮微信验证范围是 fake API、本地映射和既有二维码显示测试。
