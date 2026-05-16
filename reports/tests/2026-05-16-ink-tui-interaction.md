# 测试报告：Ink TUI 交互

## 测试目标

验证 `chat-codex` TTY 默认 Ink TUI 的基础交互实现，包括首页、首次配置引导、空渠道页、微信扫码入口、渠道页、聊天绑定页、权限页、启动确认页、运行期日志面板、TUI fallback 参数、TypeScript 构建和完整测试回归。

## 测试环境

- 日期：2026-05-16
- 分支/提交：main，本地未提交工作区
- Node.js 版本：项目要求 Node.js >= 22
- 操作系统：macOS
- Codex 版本：沿用本机 `checkCodexCli()` 检测
- 渠道：mock / 本地状态；未执行真实微信或飞书端到端

## 执行命令

```bash
npm install ink react @inkjs/ui ink-testing-library
npm install --save-dev @types/react
npm run build
node --test dist/tests/unit/ink-tui.test.js
npm test
npm audit --omit=dev
```

## 测试步骤

1. 安装 Ink、React、`@inkjs/ui`、`ink-testing-library` 和 React 类型声明。
2. 新增 `LauncherActions`，把 TUI 需要的 dashboard、渠道、绑定、权限、微信主聊天 pending binding、飞书机器人添加等操作作为结构化接口暴露。
3. 新增 Ink TUI shell，覆盖首页、管理渠道、添加微信、添加飞书、聊天绑定、绑定详情、Session 选择、手动 Session ID、权限设置、状态详情、启动确认和帮助页。
4. 接入 `runServe()`：TTY 且未传 `--no-tui` 时进入 Ink TUI；非 TTY、`--no-tui`、`--no-interactive` 保持 fallback 行为。
5. 新增 Ink TUI 单元测试，验证首页渲染、`c`、`b`、`p` 关键页面导航、pending 绑定展示、帮助页、飞书表单 Esc 返回和启动确认闭环。
6. 补充首次配置和空渠道页测试，验证无渠道时首页展示可执行菜单，`Enter` / 数字 / `w` / `f` 能进入添加流程，选中 `0. 退出` 后回车能退出。
7. 修复 TUI 中文排版：列表补齐和截断按终端显示宽度计算，避免中文双宽字符把右列顶歪；长运行提示移到独立提示区。
8. 状态详情页避免暴露 `routes/bound/pending` 内部字段名，改为中文汇总。
9. 调整微信入口：选择“添加微信账号”后立即发起扫码登录并展示二维码；若获取失败，停留在微信页并支持 `Enter` 重试。
10. 修复 TUI 启动结果回传：`runChatCodexTui()` 不再因为变量遮蔽把启动结果固定为 `{ start: false }`。
11. 优化启动确认页排版：将原始 summary 文本拆成“渠道 / 聊天绑定 / 权限 / 运行”分区，标签和值分列显示。
12. 新增运行期日志 TUI：TUI 启动后进入“Chat Codex 运行日志”面板，展示已启动渠道、策略、工作目录以及 Bridge 收到消息、发送回复、进度、媒体发送和 runtime logger 日志；`q` / `Esc` 停止服务并退出。
13. 执行完整测试回归。
14. 执行 npm audit 只读检查。

## 实际结果

- `npm run build` 通过。
- `node --test dist/tests/unit/ink-tui.test.js` 通过：6 passed，0 failed。
- `npm test` 通过：190 passed，0 failed。
- `npm audit --omit=dev` 报告 2 个 high severity，来源为既有 `@larksuiteoapi/node-sdk -> axios`；审计建议 `npm audit fix --force`，会安装 `@larksuiteoapi/node-sdk@1.56.1` 并产生 breaking change。本次未执行强制修复，避免破坏性降级/升级。

## 结论

通过。

## 遗留问题

- 本次未执行真实微信扫码和真实飞书机器人端到端验证；需要用户提供真实渠道环境后补测。
- 运行期 TUI 日志面板已接入 TTY 默认路径；`--no-tui` 仍沿用现有 `ConsoleTranscriptSink`。
- npm audit 的 axios 风险来自飞书 SDK 依赖链，当前无直接修复版本，需要后续关注 SDK 更新或替代方案。
