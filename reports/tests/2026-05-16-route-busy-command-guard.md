# 2026-05-16 Route Busy Command Guard 测试报告

## 背景

Codex turn 启动时会快照权限、模型和 collaboration mode。运行中再切换 `/permission`、`/model`、`/plan`、`/goal` 或会话绑定不会改写当前 turn，但容易让用户误以为已经生效。Bridge 需要在当前 route busy 时拒绝这些会改变执行语义的命令，并且不能影响其他 route。

## 变更

- Bridge 新增 route 级 busy 判定，用于命令 guard。
- busy 条件覆盖当前 route worker、background goal turn、普通 prompt 队列、pending approval，以及 adapter 状态 `running` / `waiting_approval`。
- busy 时拒绝会改变执行语义的命令：
  - `/new`
  - `/use`
  - `/resume`
  - 会话编号选择
  - `/permission <...>`
  - `/model <...>`、`/model effort <...>`、`/model default`
  - `/plan`
  - `/code`
  - `/default`
  - `/goal <目标>`、`/goal pause`、`/goal resume`、`/goal clear`
- busy 时仍允许 `/status`、`/help`、`/sessions`、`/permission` 查看、`/model` 查看、`/goal` 查看、`/progress`、审批命令和 `/stop`。
- guard 只检查当前 `routeKey`，其他渠道或聊天上下文不受影响。

## 验证

已执行：

```bash
npm run build
node --test dist/tests/integration/bridge-mock.test.js
npm test
git diff --check
```

结果：

- `npm run build` 通过。
- `bridge-mock` 集成测试通过：55 tests passed。
- `npm test` 全量通过：193 tests passed。
- `git diff --check` 通过。

新增/覆盖的关键用例：

- `Bridge rejects collaboration mode changes while a route is busy`
- `Bridge rejects semantic mutations while the current route is busy`
- `Bridge treats pending approvals as busy for semantic mutations`
- `Bridge keeps route busy mutation guard scoped to the active route`
- `Bridge rejects numbered session selection while the route is busy`
