# 测试报告：微信侧 Goal 命令

## 测试目标

验证微信侧 `/goal` 能管理 Codex app-server 的实验 thread goal，并确认 `/goal pause`、`/goal resume`、`/goal clear` 的语义在 `/help` 中清晰展示。

## 测试环境

- 日期：2026-05-15
- 分支/提交：main / f2a485a
- Node.js 版本：v24.14.0
- 操作系统：Darwin Mac 25.4.0 arm64
- Codex 版本：codex-cli 0.130.0 / fake app-server / MockCodexAdapter
- 渠道：mock

## 执行命令

```bash
npm run build
node --test dist/tests/integration/bridge-mock.test.js dist/tests/unit/app-server-codex-adapter.test.js
npm test
git diff --check
```

## 测试步骤

1. 检查本机 `codex features list`，确认 `goals` 为 experimental 且当前启用。
2. 通过 app-server experimental protocol 确认 Goal API 为 `thread/goal/set`、`thread/goal/get`、`thread/goal/clear`。
3. 在 Mock channel 发送 `/help`，确认显示 `/goal [目标]`、`/goal pause`、`/goal resume`、`/goal clear`，并解释 pause/resume/clear 语义。
4. 发送 `/goal`，确认没有绑定会话时只展示当前没有 Goal，不自动创建目标。
5. 发送 `/goal 完成微信 Goal 适配并保持测试通过`，确认创建/绑定 session 并设置 active Goal。
6. 发送 `/status`，确认显示 `Goal: active ...`。
7. 发送 `/goal pause`、`/goal resume`、`/goal clear`，确认分别暂停、恢复和清除当前 thread 的 Goal。
8. 通过 fake app-server 验证 adapter 调用了 `thread/goal/get`、`thread/goal/set` 和 `thread/goal/clear`。

## 实际结果

- `/goal <目标>` 设置当前 thread 的长期目标，不进入普通 prompt 队列。
- `/goal` 查看当前目标；无目标时返回当前没有 Goal。
- `/goal pause` 保留目标并把状态改为 `paused`。
- `/goal resume` 把状态恢复为 `active`。
- `/goal clear` 清除当前 thread 的 Goal，相当于退出 Goal 追踪，但不关闭 `features.goals` 实验功能。
- app-server adapter 通过 Goal API 管理目标，exec adapter 未暴露该能力时会被 Bridge 拒绝。
- 定向测试通过：56 个测试通过。
- `npm test` 通过：112 个测试通过。
- `git diff --check` 通过。

## 结论

通过。

## 遗留问题

- 未在真实微信扫码通道执行；当前覆盖 mock channel 和 fake app-server。
- Goal 是 Codex 实验功能，若运行环境未启用 `features.goals`，Bridge 会提示按 Codex 官方方式启用后重启。
