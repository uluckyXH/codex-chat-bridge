# 2026-05-14 移除旧 cancel 命令与 exec 审批状态测试报告

## 测试目标

- 验证用户可见命令中彻底移除旧 cancel 命令，当前任务终止只使用 `/stop`。
- 验证 `codex exec` adapter 明确暴露“非交互审批”状态。
- 验证 `/permission approval` 在当前 exec 接入下只恢复 `workspace-write` sandbox，不再伪装成交互审批。
- 验证 `/status` 能显示当前权限和真实审批能力，帮助用户判断微信侧切换是否真的生效。

## 覆盖范围

- `src/bridge/bridge.ts`
- `src/cli.ts`
- `src/codex/codex-cli.ts`
- `src/codex/exec-codex-adapter.ts`
- `src/codex/mock-codex-adapter.ts`
- `src/codex/types.ts`
- `tests/integration/bridge-mock.test.ts`
- `tests/unit/codex-cli.test.ts`
- `tests/unit/exec-codex-adapter.test.ts`

## 自动化测试

命令：

```bash
npm run build
npm test
git diff --check
```

结果：

```text
tests 55
pass 55
fail 0
cancelled 0
skipped 0
todo 0
```

## 结果说明

- `/help` 不再展示旧 cancel 命令，命令路由也不再把它当作 `/stop` 的别名。
- `buildCodexRootArgs()` 不再向 `codex exec` 注入 `--ask-for-approval on-request`，避免展示一个实际不会交互生效的配置。
- `ExecCodexAdapter.getRunPolicyStatus()` 固定报告 `interactiveApprovals=false`、`effectiveApprovalPolicy=never`。
- `/permission approval` 的回执会提示：当前 adapter 不支持交互审批，真实生效的 `approval_policy` 仍是 `never`；如果任务已在运行，需要 `/stop` 后后续任务才会使用新 sandbox 设置。
