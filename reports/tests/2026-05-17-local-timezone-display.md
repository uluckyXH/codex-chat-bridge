# 本机时区时间展示统一验证

## 背景

按 `docs/local-timezone-display-design.zh-CN.md` 实现用户可见时间统一格式化：

- 内部存储和状态文件继续使用 UTC ISO。
- TUI、CLI、日志和聊天内状态按当前运行机器时区展示。
- 不提供环境变量或手动时区覆盖。
- Goal 更新时间不再写死“北京时间”。

## 适配范围

- 新增 `src/time/display-time.ts` 作为统一时间展示工具。
- Bridge `/status` Goal 更新时间使用当前机器时区标签。
- Bridge status session 更新时间不再直接展示 ISO。
- CLI/TUI 渠道添加时间、更新时间和 session 最近活跃时间改为统一工具。
- logger、transcript、runtime log TUI 的时钟前缀改为统一工具。
- 旧 CLI session 选择里的最近更新时间不再直接展示 ISO。

## 当前机器检测

```text
Intl.DateTimeFormat().resolvedOptions().timeZone = Asia/Shanghai
formatLocalDateTimeWithZone(1700000000) = 2023-11-15 06:13:20（Asia/Shanghai）
```

## 已执行验证

```bash
npm run build
node --test dist/tests/unit/display-time.test.js dist/tests/unit/bridge-formatters.test.js dist/tests/unit/transcript.test.js
node --test dist/tests/integration/bridge-mock.test.js --test-name-pattern "Goal|status|sessions"
node --test dist/tests/unit/channel-actions.test.js dist/tests/unit/binding-actions.test.js dist/tests/unit/ink-tui.test.js dist/tests/unit/serve-helpers.test.js
git diff --check
npm test
```

## 结果

- 构建通过。
- 统一时间工具单测通过。
- Bridge Goal/status 相关集成测试通过。
- TUI、渠道、绑定、serve helper 相关测试通过。
- `git diff --check` 通过。
- 全量 `npm test` 通过，`288 passed, 0 failed`。

## 关键断言

- `formatLocalDateTime("2026-05-17T15:25:10.000Z", { timeZone: "Asia/Shanghai" })` 输出 `2026-05-17 23:25:10`。
- `formatGoalTimestamp(1700000000, { timeZone: "Asia/Shanghai" })` 输出 `2023-11-15 06:13:20（Asia/Shanghai）`。
- `/status` Goal 更新时间包含当前机器时区名。
- `/status` Goal 更新时间不再包含 `北京时间`。
- `/status` Goal 更新时间不直接展示 `T...Z` ISO 字符串。
