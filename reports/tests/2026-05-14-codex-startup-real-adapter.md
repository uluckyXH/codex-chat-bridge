# 测试报告：真实 Codex CLI 启动检测、会话选择和权限模式

## 测试目标

验证中间件真实 Codex 模式：

- 启动时检测 `codex --version`。
- 能发现本地 Codex 历史会话记录。
- 能通过启动参数选择新会话。
- 能设置安全沙箱模式或完全权限参数。
- 能通过中间件调用真实 `codex exec --json` 并收到回复。
- 完全权限模式有明确危险提醒和非交互确认参数。

## 测试环境

- 日期：2026-05-14
- Node.js 版本：v24.13.1
- npm 版本：11.8.0
- Codex CLI 版本：0.130.0
- 操作系统：macOS
- 渠道：terminal
- Codex 接入：`codex exec --json`

## 执行命令

```bash
npm test
printf '请只回复 CODEX_MIDDLEWARE_REAL_OK，不要执行命令。\n/exit\n' | npm run cli:terminal:codex -- --session new --permission approval
```

## 测试步骤

1. 执行 `npm test`，验证新增 Codex CLI 工具函数和现有桥接流程。
2. 以非交互方式启动 `terminal codex`，指定 `--session new --permission approval`。
3. 中间件启动时执行 `codex --version`。
4. 中间件自动创建新的桥接会话。
5. 终端通道发送固定提示词给真实 Codex。
6. 检查 Codex 回复是否从真实 `codex exec --json` 返回。

## 实际结果

`npm test` 结果：

```text
tests 22
pass 22
fail 0
duration_ms 122.693125
```

真实 Codex 中间件调用关键输出：

```text
Codex 可用: codex-cli 0.130.0
已创建新 Codex 会话
Session: exec-local-1778698059751
Status: idle

[Codex]
CODEX_MIDDLEWARE_REAL_OK
```

新增覆盖用例：

- `buildCodexRootArgs maps approval and full permission modes to Codex CLI flags`
- `parseSessionIndexLine reads Codex session index records`
- `discoverCodexSessions merges session index and rollout metadata`

## 结论

通过。

中间件已经和真实 Codex CLI 发生过通信交互，不再只是 Mock。当前真实接入基于 `codex exec --json`，适合作为第一阶段真实链路验证。

## 遗留问题

- `codex exec` 是非交互模式，源码中默认 `approval_policy=never`，并且不支持把 command/file/permissions approval request 交互回调给微信；当前 `approval` 只代表恢复 `workspace-write` sandbox。
- 后续仍需要实现 `codex app-server` adapter，把 command/file/permissions approval request 映射到微信 `/OK`、`/NO` 和 `/stop`。
- 当前启动时的会话选择已支持 terminal CLI；接入微信后还需要把同样能力映射为微信命令。
