# 2026-05-14 Codex 工作目录与全部会话命令测试报告

## 测试目标

- 验证真实 Codex 启动流程支持新会话工作目录设置。
- 验证新会话工作目录不存在时会自动创建。
- 验证历史 Codex 会话恢复时会读取原始 `cwd`。
- 验证微信/通道命令可通过 `/sessions all` 和 `/all-sessions` 查看全部可发现会话 ID。
- 验证中英文 README 与设计文档已同步更新。

## 覆盖范围

- `src/cli.ts`
- `src/bridge/bridge.ts`
- `src/codex/codex-cli.ts`
- `src/codex/exec-codex-adapter.ts`
- `src/codex/workdir.ts`
- `tests/unit/workdir.test.ts`
- `tests/unit/codex-cli.test.ts`
- `tests/unit/exec-codex-adapter.test.ts`
- `tests/integration/bridge-mock.test.ts`

## 自动化测试

命令：

```bash
npm test
```

结果：

```text
tests 31
pass 31
fail 0
cancelled 0
```

重点新增用例：

- `normalizeWorkdir defaults to current directory and resolves relative input`
- `resolveNewSessionWorkdir creates missing directory`
- `findCodexSessionById returns discovered session cwd`
- `ExecCodexAdapter resumes discovered sessions with original cwd`
- `ExecCodexAdapter lists discovered Codex sessions when route is not scoped`
- `Bridge exposes all sessions command for channel users`

## 启动流程验证

命令：

```bash
printf '/exit\n' | npm run cli:terminal:codex -- --session new --permission approval --cwd /tmp/codex-weixin-middleware-workdir-check
```

结果：

- Codex CLI 检测成功：`codex-cli 0.130.0`。
- 缺失工作目录已自动创建：`/tmp/codex-weixin-middleware-workdir-check`。
- 新会话确认消息包含 `Session`、`Cwd` 和 `Status`。
- 终端通道正常启动并退出。

## 结论

本轮功能通过自动化测试和 CLI 启动验证。真实微信侧 `/sessions all`、`/all-sessions`、新会话工作目录展示与历史会话 cwd 恢复的最终体验，还需要用户扫码登录微信后协助做真实通道验证。
