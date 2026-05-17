# 大型核心文件模块化拆分第二阶段测试报告

日期：2026-05-17

## 范围

本阶段继续按 `docs/large-core-file-modularization-design.zh-CN.md` 拆分 `src/cli/serve.ts` 和 `src/codex/app-server-codex-adapter.ts`。目标不是只把文件降到 1000 行以下，而是让入口文件成为薄入口，并把功能边界迁到独立模块。

已完成：

- `src/cli/serve.ts` 收口为 `runServe` 入口，只保留 TUI/CLI/非交互路径选择、启动准备、初始渠道探测和最终启动调用。
- 新增 `src/cli/serve/home-loop.ts`，承载普通 CLI 首页循环和主菜单分发。
- 新增 `src/cli/serve/channel-management.ts`，承载渠道列表、渠道详情、备注、启用/停用、删除和状态展示。
- 新增 `src/cli/serve/weixin-setup.ts`，承载微信添加、扫码返回、微信主聊天 pending binding。
- 新增 `src/cli/serve/feishu-setup.ts`，承载飞书凭证输入、账号标识、domain 默认值和连通性检查。
- 新增 `src/cli/serve/route-binding-loop.ts`，承载聊天绑定列表、详情、切换 session、新建 session、解绑和 session 权限设置。
- 新增 `src/cli/serve/codex-settings.ts`，承载新 session 默认权限、工作目录、adapter mode、并发和首个 route binding 相关设置函数。
- 新增 `src/codex/app-server/rpc-client.ts`，承载 `codex app-server` 子进程、stdio JSON-RPC、request id、pending response、超时、stderr 和 notification/server request 分发。
- 新增 `src/codex/app-server/session-store.ts`，承载 app-server session record、threadId 到 sessionId 映射、status 查询和本地/历史 session 列表合并。
- 新增 `src/codex/app-server/turn-controller.ts`，承载 turn queue、early event、background turn、notification 处理、progress 草稿、turn close 和 background event 分发。
- 扩展 `src/codex/app-server/approval-handler.ts`，把 server request 到 `ApprovalRequest` 的转换从 adapter 迁出。
- 新增 `tests/unit/app-server-core-modules.test.ts`，定向覆盖新拆出的 app-server core 模块。
- 更新 `docs/large-core-file-modularization-design.zh-CN.md`，明确“低于 1000 行不是最终完成标准”。

行数变化：

```text
src/cli/serve.ts: 994 -> 44
src/codex/app-server-codex-adapter.ts: 966 -> 459
```

拆分后较大的模块：

```text
src/codex/app-server/turn-controller.ts: 349
src/cli/serve/route-binding-loop.ts: 262
src/cli/serve/codex-settings.ts: 244
src/cli/serve/weixin-setup.ts: 220
src/codex/app-server/rpc-client.ts: 198
src/cli/serve/channel-management.ts: 152
```

## 逐模块测试覆盖

| 模块 | 覆盖方式 |
| --- | --- |
| `serve.ts` | `npm test` 覆盖 CLI 入口、TUI 入口、非交互无渠道错误和启动路径；入口本身只做装配。 |
| `serve/home-loop.ts` | `tests/unit/serve-wizard.test.ts` 覆盖首页菜单解析和展示；`npm test` 覆盖 TUI/CLI 启动确认相关路径。 |
| `serve/channel-management.ts` | `tests/unit/channel-actions.test.ts` 覆盖注册、备注、删除和状态目录清理；`tests/unit/serve-helpers.test.ts` 覆盖启动确认中的渠道状态行为。 |
| `serve/weixin-setup.ts` | `tests/integration/weixin-adapter-api.test.ts`、`tests/unit/binding-actions.test.ts` 覆盖扫码登录结果、pending binding、已占用 session 排除和中文 owner 提示。 |
| `serve/feishu-setup.ts` | `tests/unit/channel-actions.test.ts` 和 `tests/unit/launcher-actions.test.ts` 覆盖飞书凭证、账号标识、连通探测前置要求和本地凭证持久化。 |
| `serve/route-binding-loop.ts` | `tests/unit/binding-actions.test.ts`、`tests/unit/serve-helpers.test.ts` 覆盖 session owner 独占、绑定/解绑、session choice 输入和绑定列表文案。 |
| `serve/codex-settings.ts` | `tests/unit/serve-helpers.test.ts`、`tests/unit/workdir.test.ts` 覆盖 full 权限确认、新 session 工作目录解析、目录创建和启动 cwd 语义。 |
| `app-server/rpc-client.ts` | `tests/unit/app-server-core-modules.test.ts` 用 fake stdio app-server 覆盖 initialize、request/response、notification 分发和 stop。 |
| `app-server/session-store.ts` | `tests/unit/app-server-core-modules.test.ts` 覆盖 session record、thread 映射、status fallback 和 route scoped list。 |
| `app-server/turn-controller.ts` | `tests/unit/app-server-core-modules.test.ts` 覆盖 token usage status 更新、assistant delta、turn completed、queue close；`tests/unit/app-server-codex-adapter.test.ts` 覆盖 approval、progress、transient reconnect、background goal。 |
| `app-server/approval-handler.ts` | `tests/unit/app-server-mappers.test.ts` 覆盖 server request 到 `ApprovalRequest` 的转换、审批决策响应、legacy decision 和高风险命令识别。 |
| `app-server-codex-adapter.ts` | `tests/unit/app-server-codex-adapter.test.ts` 覆盖 start/resume/run/steer/cancel/approval/model/goal/localImage/background goal 等外部行为。 |

## 执行命令

```bash
npm run build
node --test dist/tests/unit/app-server-core-modules.test.js dist/tests/unit/app-server-mappers.test.js dist/tests/unit/serve-helpers.test.js
node --test dist/tests/unit/app-server-codex-adapter.test.js dist/tests/unit/serve-wizard.test.js dist/tests/unit/launcher-actions.test.js
npm test
git diff --check
git show HEAD:src/codex/app-server-codex-adapter.ts | cmp - src/codex/app-server-codex-adapter.monolith.snapshot.ts.bak
git show HEAD:src/cli/serve.ts | cmp - src/cli/serve.monolith.snapshot.ts.bak
```

## 结果

```text
npm run build: passed
app-server core / mapper / serve helper 定向测试: 19 passed, 0 failed
app-server adapter / serve wizard / launcher actions 定向测试: 28 passed, 0 failed
npm test: 284 passed, 0 failed
git diff --check: passed
app-server adapter 备份一致性检查: passed
serve 备份一致性检查: passed
```

## 结论

第二阶段继续保持外部行为不变，只调整模块边界。`serve.ts` 已成为薄入口；`app-server-codex-adapter.ts` 已把 JSON-RPC、session store 和 turn/notification lifecycle 迁出，保留 CodexAdapter 对外方法和高层编排。
