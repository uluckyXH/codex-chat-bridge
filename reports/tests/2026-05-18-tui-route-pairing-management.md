# TUI 配对管理验证报告

## 背景

本次补齐 route 配对信任的第二阶段 TUI 管理能力：

- 首页增加“配对管理”入口。
- 配对管理页展示待配对聊天和已信任聊天。
- 支持本机手动信任待配对 route。
- 支持撤销信任，并可选择同时解绑当前 session。
- 聊天绑定页标记未信任 route，并禁止绑定、切换、新建或修改 session。

## 覆盖范围

- `docs/route-pairing-trust-design.zh-CN.md`
- `src/cli/actions/launcher-actions.ts`
- `src/cli/actions/binding-actions.ts`
- `src/cli/tui/app.tsx`
- `src/cli/tui/types.ts`
- `src/cli/tui/views.tsx`
- `src/cli/tui/ui-components.tsx`
- `tests/unit/launcher-actions.test.ts`
- `tests/unit/ink-tui.test.tsx`

## 验证命令

```bash
npm run build
node --test dist/tests/unit/launcher-actions.test.js
node --test dist/tests/unit/ink-tui.test.js
```

## 验证结果

- `npm run build`：通过。
- `launcher-actions.test.js`：3 passed。
- `ink-tui.test.js`：14 passed。

## 重点断言

- `LauncherActions` 能从 `routes.json` 和 `trusted-routes.json` 生成已信任/待配对摘要。
- 本机手动信任会写入 `trustMethod: "manual"`。
- 撤销信任并解绑会同时清理 route trust 和当前 session 绑定。
- TUI 配对页能展示待配对/已信任 route。
- TUI 可以对待配对 route 执行本机手动信任。
- TUI 可以撤销已信任 route。
- 聊天绑定页对未信任 route 显示“待配对，暂不能绑定”，并阻止 `n/m/u/p` 等 session 操作。

## 结论

配对管理核心交互已接入 TUI，现有配对安全链路保持不变：配对码仍只在运行日志显示，启动前 TUI 只管理已发现 route 的信任记录。
