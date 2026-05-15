# 测试报告：渠道能力声明与会话形态校验

## 测试目标

验证通用渠道协议把 `direct`、`group`、`thread` 都纳入 `ChannelCapabilities`，并确认 `ChannelRegistry` 会拒绝渠道未声明支持的会话形态。同步确认微信渠道当前按已验证私聊能力运行，不把未验证群聊/thread 暴露给 Bridge Core。

## 测试环境

- 日期：2026-05-15 20:54:12 CST
- Node.js 版本：v24.13.1
- 操作系统：macOS
- 渠道：mock / terminal / weixin adapter 单元与集成测试

## 执行命令

```bash
npm test
node --test dist/tests/unit/app-server-codex-adapter.test.js
npm test
git diff --check
```

## 测试步骤

1. 为 `ChannelCapabilities` 增加 `thread` 能力声明。
2. 更新 mock、terminal、weixin adapter 的能力返回值。
3. 更新 `ChannelRegistry`，对 `direct`、`group`、`thread` 都按 capability 校验。
4. 新增单测覆盖不支持 `group`、`thread` 的渠道会拒绝对应入站消息。
5. 运行完整测试。

## 实际结果

- 第一次 `npm test`：编译通过，新增 `ChannelRegistry rejects unsupported conversation kinds` 通过；`AppServerCodexAdapter sends collaboration mode on turn start` 单项失败。
- 单独复跑 `node --test dist/tests/unit/app-server-codex-adapter.test.js`：17 项全部通过。
- 第二次 `npm test`：130 项全部通过。
- `git diff --check`：通过。

## 结论

通过。渠道能力声明与 Registry 校验已覆盖 `direct`、`group`、`thread`，微信当前能力收紧为 `direct: true, group: false, thread: false`。

## 遗留问题

- 真实微信群聊链路未验证，保持关闭。
- 飞书私聊、群聊、thread 需要在真实 adapter 落地时按同一能力契约补测试。
