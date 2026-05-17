# 本机时区时间展示统一设计

## 背景

当前项目里时间处理有两类场景：

- **内部存储和协议字段**：大多使用 `new Date().toISOString()`，即 UTC ISO 字符串。
- **用户可见展示**：TUI、CLI、日志、聊天内 `/status` 各自格式化，有些使用本机时区，有些直接展示 ISO，有些写死北京时间。

这导致用户看到的时间不够统一：

- `/status` 的 Goal 更新时间固定显示 `（北京时间）`，不适合在非中国时区机器上运行。
- TUI/CLI 的渠道添加时间、更新时间和 session 最近活跃时间实际使用本机时区，但实现分散在 `channel-actions.ts`。
- logger、transcript、runtime log TUI 各自维护 `formatClock()`。
- 部分状态文本仍直接输出 `2026-05-17T00:00:00.000Z` 这种 UTC ISO，用户容易误读。

## 目标

1. 用户可见时间统一按**当前运行机器时区**展示。
2. 运行时自动检测机器时区，不提供手动配置项。
3. 内部存储、状态文件、协议传递继续保持 UTC ISO，不改变持久化结构。
4. 所有用户可见时间格式都走统一工具函数，避免业务代码各自拼接。
5. 测试要能稳定覆盖，不依赖测试机真实时区。

## 非目标

- 不迁移已有状态文件里的 `createdAt`、`updatedAt`、`timestamp` 字段。
- 不改变排序逻辑，排序仍按原始时间戳或 ISO 解析结果处理。
- 不增加 `CHAT_CODEX_TIME_ZONE` 之类环境变量。
- 不在 TUI 列表里强行显示长时区标签，避免挤占空间。
- 不把存储格式改成本地时间字符串。

## 时区策略

运行时默认使用：

```ts
Intl.DateTimeFormat().resolvedOptions().timeZone
```

示例：

```text
Asia/Shanghai
America/Los_Angeles
UTC
```

如果运行环境无法返回有效时区，则回退到 `UTC`，但这只是兜底，不提供用户配置。

## 统一格式

建议新增：

```text
src/time/display-time.ts
```

导出：

```ts
export function currentTimeZone(): string;
export function formatLocalDateTime(value: string | number | Date | undefined): string;
export function formatLocalShortDateTime(value: string | number | Date | undefined): string;
export function formatLocalClock(value: string | number | Date | undefined): string;
export function formatLocalDateTimeWithZone(value: string | number | Date | undefined): string;
```

格式约定：

| 函数 | 输出 | 用途 |
| --- | --- | --- |
| `formatLocalDateTime` | `2026-05-17 23:25:10` | 详情页、状态详情、聊天内较重要时间。 |
| `formatLocalShortDateTime` | `05-17 23:25` | TUI/CLI 列表、空间有限位置。 |
| `formatLocalClock` | `23:25:10` | 日志行前缀、运行期 transcript。 |
| `formatLocalDateTimeWithZone` | `2026-05-17 23:25:10（Asia/Shanghai）` | `/status`、Goal 更新时间等需要避免误读的位置。 |

无效或缺失时间统一显示：

```text
未知
```

## 输入格式

统一工具需要接受：

- ISO 字符串，例如 `2026-05-17T15:25:10.000Z`
- 秒级 Unix 时间戳，例如 Goal API 的 `updatedAt`
- 毫秒级 Unix 时间戳
- `Date`
- `undefined`

建议策略：

- `Date` 直接使用。
- `string` 使用 `new Date(value)` 解析。
- `number` 默认按秒级处理；如果大于 `10_000_000_000`，按毫秒级处理。
- 非法值返回 `未知`。

## 需要适配的代码点

### Bridge 状态文案

文件：

```text
src/bridge/formatters.ts
src/bridge/status-text.ts
```

调整：

- `formatGoalTimestamp()` 不再写死 `Asia/Shanghai`。
- Goal 更新时间改为 `formatLocalDateTimeWithZone(goal.updatedAt)`。
- session 列表里的 `updatedAt` 不再直接输出 ISO，改为本机时区完整时间或短时间。

### CLI/TUI 渠道和绑定时间

文件：

```text
src/cli/actions/channel-actions.ts
src/cli/actions/binding-actions.ts
src/cli/tui/views.tsx
src/cli/tui/ui-components.tsx
src/cli/serve/channel-management.ts
src/cli/serve/route-binding-helpers.ts
src/cli/serve/weixin-setup.ts
src/cli/serve/formatters.ts
```

调整：

- `formatShortDateTime()` / `formatFullDateTime()` 迁到统一时间工具，或改成统一工具的薄转发。
- TUI 列表继续用短时间。
- TUI 详情页和普通 CLI 详情页用完整时间。
- session 最近活跃仍通过 `formatSessionActiveTime()` 暴露，但内部改用统一工具。

### 日志和 transcript

文件：

```text
src/logging/logger.ts
src/logging/transcript.ts
src/cli/tui/runtime-log.tsx
```

调整：

- 删除各自重复的 `formatClock()`。
- 日志前缀统一使用 `formatLocalClock()`。
- 运行日志 TUI 继续显示短时钟，不显示时区标签。

### CLI 旧入口展示

文件：

```text
src/cli.ts
```

调整：

- `最近更新: ${session.updatedAt}` 改为本机时区格式。
- 避免向用户直接展示 ISO UTC。

### 文档和历史测试

需要更新：

```text
tests/unit/bridge-formatters.test.ts
tests/integration/bridge-mock.test.ts
tests/unit/channel-actions.test.ts
tests/unit/binding-actions.test.ts
tests/unit/ink-tui.test.tsx
tests/unit/transcript.test.ts
```

如果测试需要固定时区，不应依赖当前机器真实时区。建议统一工具支持内部测试注入：

```ts
formatLocalDateTime(value, { timeZone: "Asia/Shanghai" })
```

这个参数只用于测试和内部调用，不暴露为用户配置。

## 实施步骤

1. 新增统一时间工具和单元测试。
2. 替换 Bridge Goal 时间和 status session 时间展示。
3. 替换 CLI/TUI 渠道、绑定、session 活跃时间展示。
4. 替换 logger、transcript、runtime log TUI 的重复 clock 格式化。
5. 替换旧 CLI 里直接输出 ISO 的 session 更新时间。
6. 更新测试断言，从 `（北京时间）` 改为当前时区标签或注入时区标签。
7. 新增中文测试报告。

## 测试要求

基础验证：

```bash
npm run build
npm test
git diff --check
```

定向验证：

```bash
node --test dist/tests/unit/bridge-formatters.test.js
node --test dist/tests/integration/bridge-mock.test.js --test-name-pattern "Goal|status|sessions"
node --test dist/tests/unit/channel-actions.test.js dist/tests/unit/binding-actions.test.js dist/tests/unit/ink-tui.test.js dist/tests/unit/transcript.test.js
```

测试重点：

- UTC ISO 存储值展示为指定时区的人类可读时间。
- Goal 更新时间不再出现 `（北京时间）`。
- Goal 更新时间包含当前时区名，例如 `（Asia/Shanghai）`。
- TUI/CLI 列表短时间保持紧凑。
- 日志前缀仍是 `HH:mm:ss`。
- 无效时间显示 `未知`。
- 排序和持久化文件内容不变。

## 完成标准

- 用户可见时间没有业务代码自行拼接本地日期。
- 用户可见时间不再直接暴露 UTC ISO，除非明确是调试或原始协议输出。
- `/status` Goal 更新时间按当前运行机器时区展示，不写死北京时间。
- TUI、CLI、日志、聊天内状态时间格式一致。
- 自动化测试覆盖统一时间工具和主要展示入口。
