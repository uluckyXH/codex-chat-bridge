# 测试报告：多渠道 CLI 启动向导

## 测试目标

验证轻量 `cli:serve` 渠道配置交互、首个 route 绑定策略、未绑定 route 询问策略和现有单渠道入口兼容性。

## 测试环境

- 日期：2026-05-15
- 分支/提交：main / 9f01323（本次变更提交前）
- Node.js 版本：v24.13.1
- 操作系统：macOS Darwin 25.3.0 arm64
- Codex 版本：codex-cli 0.130.0
- 渠道：mock / weixin 本地状态检查

## 执行命令

```bash
npm run build
npm test
git diff --check
node dist/src/cli.js help | sed -n '1,24p'
```

## 测试步骤

1. 构建 TypeScript，确认新增 `src/cli/serve.ts`、`src/cli/serve-wizard.ts` 类型通过。
2. 运行完整自动化测试，覆盖 serve wizard 中文菜单、首个 route 绑定策略解析、Bridge `unboundRoutePolicy=ask` 行为。
3. 运行 `git diff --check`，确认文档和代码无空白错误。
4. 查看 CLI help，确认 `serve`、`--max-concurrent-turns`、`--no-interactive` 已展示。

## 实际结果

- `npm run build` 通过。
- `npm test` 通过：136 个测试全部通过，0 失败。
- `git diff --check` 无输出，表示通过。
- CLI help 中已出现 `codex-wechat-bridge serve`，并说明“启动多渠道配置向导（当前真实渠道支持微信）”。

## 结论

通过。

## 遗留问题

- 本次未进行真实微信扫码启动 `cli:serve` 的长轮询收发验证；需要用户在真实微信环境补测。
- 当前 `cli:serve` 是 MVP：未实现 CLI 自有持久化、完整渠道管理页、route/session 管理页和真实飞书渠道。
- `new_first_route` 当前等价为首个微信私聊 route 的首条普通消息到达时创建并绑定新 session，尚未做启动前预创建 session。
