# 大型核心文件模块化拆分第一阶段测试报告

日期：2026-05-17

## 范围

本次按 `docs/large-core-file-modularization-design.zh-CN.md` 开始拆分两个超过 1000 行的核心业务文件：

```text
src/codex/app-server-codex-adapter.ts
src/cli/serve.ts
```

已完成：

- 新增 `src/codex/app-server-codex-adapter.monolith.snapshot.ts.bak`，作为 app-server adapter 拆分前对照备份。
- 新增 `src/cli/serve.monolith.snapshot.ts.bak`，作为 serve 入口拆分前对照备份。
- 新增 `src/codex/app-server/value-parsers.ts`，承载 app-server 响应值解析工具。
- 新增 `src/codex/app-server/run-policy.ts`，承载 permission/sandbox/approval policy 映射。
- 新增 `src/codex/app-server/approval-handler.ts`，承载 approval request 类型识别和审批决策响应映射。
- 新增 `src/codex/app-server/goal-api.ts`，承载 Goal 响应解析。
- 新增 `src/codex/app-server/input-mapper.ts`，承载 `CodexPromptInput` 到 app-server user input 的映射。
- 新增 `src/codex/app-server/model-policy.ts`，承载 model policy、model list 和 token usage 解析。
- 新增 `src/codex/app-server/notification-mapper.ts`，承载 notification 相关 progress/error/plan 小映射。
- 新增 `src/codex/app-server/types.ts`，承载 app-server adapter 内部共享类型。
- 新增 `src/codex/app-server/turn-store.ts`，承载 async event queue、turn record 创建和 background turn 判断。
- 新增 `src/codex/app-server/session-status.ts`，承载 session status/context/model policy 合成和 collaboration mode payload。
- 新增 `src/cli/serve/shortcuts.ts`，承载普通 CLI 快捷键解析。
- 新增 `src/cli/serve/prompts.ts`，承载 readline prompt 和 shutdown signal helper。
- 新增 `src/cli/serve/formatters.ts`，承载 serve 专用 session/policy/runtime summary 格式化。
- 新增 `src/cli/serve/startup.ts`，承载 Codex 启动准备、权限确认和 first route binding plan。
- 新增 `src/cli/serve/summary.ts`，承载首页和启动确认摘要数据映射。
- 新增 `src/cli/serve/start-confirmation.ts`，承载启动前渠道可用性检查和启动确认。
- 新增 `src/cli/serve/bridge-runtime.ts`，承载 runtime adapters、Bridge、Codex adapter 和运行日志 TUI 启动。
- 新增 `src/cli/serve/route-binding-helpers.ts`，承载绑定列表格式化、BindingActions 创建、session choice 输入解析和短 session id。

行数变化：

```text
src/codex/app-server-codex-adapter.ts: 1460 -> 966
src/cli/serve.ts: 1369 -> 994
```

## 逐模块测试覆盖

| 模块 | 覆盖方式 |
| --- | --- |
| `app-server/value-parsers.ts` | `tests/unit/app-server-mappers.test.ts` 覆盖 object/array/string/number/time 解析边界。 |
| `app-server/run-policy.ts` | `tests/unit/app-server-mappers.test.ts` 覆盖 approval/full、reviewer、sandbox mode、sandbox policy 映射。 |
| `app-server/approval-handler.ts` | `tests/unit/app-server-mappers.test.ts` 覆盖 approval kind、app-server decision、legacy review decision、permissions grant、risk command。 |
| `app-server/goal-api.ts` | `tests/unit/app-server-mappers.test.ts` 覆盖 camel/snake case Goal 响应、状态 fallback、缺失 Goal 错误。 |
| `app-server/input-mapper.ts` | `tests/unit/app-server-mappers.test.ts` 覆盖文本、`localImage`、`localFile` 到 app-server input 的映射。 |
| `app-server/model-policy.ts` | `tests/unit/app-server-mappers.test.ts` 覆盖 model info、policy overlay、model list、reasoning effort、service tier、token usage。 |
| `app-server/notification-mapper.ts` | `tests/unit/app-server-mappers.test.ts` 覆盖 phase、thread item progress、plan 文本、progress flush、transient error。 |
| `app-server/types.ts` | `npm run build` 覆盖共享类型和跨模块 import 编译。 |
| `app-server/turn-store.ts` | `tests/unit/app-server-mappers.test.ts` 覆盖 async event queue、turn record 默认字段、background turn 判断。 |
| `app-server/session-status.ts` | `tests/unit/app-server-mappers.test.ts` 覆盖 context/model 保留、model policy overlay、plan collaboration payload、prompt 截断。 |
| `app-server-codex-adapter.ts` | `tests/unit/app-server-codex-adapter.test.ts` 覆盖 start/resume/run/steer/cancel/approval/model/goal/localImage/background goal 等 app-server 集成路径。 |
| `serve/shortcuts.ts` | `tests/unit/serve-helpers.test.ts` 覆盖 `w/f/n/m/0/back/quit` 等快捷键语义。 |
| `serve/prompts.ts` | `tests/unit/serve-helpers.test.ts` 覆盖 required/optional prompt、trim、返回快捷键和 readline wrapper。 |
| `serve/formatters.ts` | `tests/unit/serve-helpers.test.ts` 覆盖权限文案、session choice 展示。 |
| `serve/startup.ts` | `tests/unit/serve-helpers.test.ts` 覆盖初始 plan、first route existing/new/clear、full permission 确认。 |
| `serve/summary.ts` | `tests/unit/serve-helpers.test.ts` 覆盖 Codex summary 和 channel summary 映射。 |
| `serve/start-confirmation.ts` | `tests/unit/serve-helpers.test.ts` 覆盖无启用渠道、已连接渠道确认、未连接渠道拒绝启动。 |
| `serve/bridge-runtime.ts` | `tests/unit/serve-helpers.test.ts` 覆盖 Codex adapter 选择和无 runtime adapter 错误；`tests/unit/ink-tui.test.tsx`、`tests/unit/runtime-log` 相关测试继续覆盖运行日志 TUI 组件。 |
| `serve/route-binding-helpers.ts` | `tests/unit/serve-helpers.test.ts` 覆盖短 session id、session choice 输入、绑定列表格式化。 |
| `serve.ts` | `tests/unit/serve-wizard.test.ts`、`tests/unit/ink-tui.test.tsx`、`tests/unit/launcher-actions.test.ts` 和全量 `npm test` 覆盖 TUI/CLI 入口相关行为。 |

## 执行命令

```bash
npm run build
node --test dist/tests/unit/app-server-mappers.test.js dist/tests/unit/serve-helpers.test.js dist/tests/unit/app-server-codex-adapter.test.js dist/tests/unit/serve-wizard.test.js dist/tests/unit/launcher-actions.test.js
npm test
git diff --check
git show HEAD:src/codex/app-server-codex-adapter.ts | cmp - src/codex/app-server-codex-adapter.monolith.snapshot.ts.bak
git show HEAD:src/cli/serve.ts | cmp - src/cli/serve.monolith.snapshot.ts.bak
```

## 结果

```text
npm run build: passed
定向测试: 44 passed, 0 failed
npm test: 281 passed, 0 failed
git diff --check: passed
app-server adapter 备份一致性检查: passed
serve 备份一致性检查: passed
```

## 结论

第一阶段拆分只改变模块边界，不改变外部行为。两个核心入口文件都已保留拆分前对照备份，并把纯映射、格式化、启动准备、启动确认、runtime 启动和 route binding helper 拆入独立模块。

本阶段后，`app-server-codex-adapter.ts` 和 `serve.ts` 均已回到 1000 行以下。后续如果继续拆，应优先处理：

- `app-server-codex-adapter.ts` 的 JSON-RPC 子进程/read loop。
- `app-server-codex-adapter.ts` 的 session store 和 turn lifecycle 更完整抽象。
- `serve.ts` 的渠道管理、微信配置、飞书配置和聊天绑定 loop。
