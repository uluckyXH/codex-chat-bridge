# Agent 开发指南

本文由旧版根 README 拆出，专门给参与本仓库开发的 coding agent 使用。普通用户请先读根目录 [README.md](../README.md)。

详细规范以 [development-and-test.zh-CN.md](development-and-test.zh-CN.md) 和 [git-management.zh-CN.md](git-management.zh-CN.md) 为准。

## 阅读顺序

1. [README.md](README.md)：文档索引、项目边界和推荐阅读顺序。
2. [requirements.zh-CN.md](requirements.zh-CN.md)：产品需求、支持命令、安全预期和非目标。
3. [technical-design.zh-CN.md](technical-design.zh-CN.md)：架构、adapter 边界、route key 设计、Codex/Weixin 集成和分阶段路线。
4. [channel-delivery-policy.zh-CN.md](channel-delivery-policy.zh-CN.md)：task-start、progress、`/progress` 和 refresh 命令的渠道投递策略。
5. [multi-channel-design.zh-CN.md](multi-channel-design.zh-CN.md)：多渠道 route/session 绑定、并发、配置交互和 adapter 代码规范。
6. [development-and-test.zh-CN.md](development-and-test.zh-CN.md)：代码规则、模块拆分、测试要求和中文测试报告格式。
7. [git-management.zh-CN.md](git-management.zh-CN.md)：仓库边界、忽略文件、本地参考源码和提交要求。
8. [../references/README.md](../references/README.md)：如何拉取 `@tencent-weixin/openclaw-weixin`、Codex 协议等本地参考源码；参考源码不提交。

## 核心规则

- 项目文档、测试报告和开发记录默认使用中文。
- 保持项目轻量：Node.js + TypeScript，不引入 NestJS、Next.js 等重型框架。
- Codex 逻辑、渠道逻辑、命令解析、审批、状态存储和日志必须分层。
- Bridge Core 只能依赖通用渠道协议，不能 import `openclaw-weixin` 原始类型。
- 具体渠道 adapter 必须实现 `ChannelAdapter`，把原始入站消息归一化为 `ChannelMessage`，提供稳定 `routeKey`，声明 `ChannelCapabilities`，并暴露 `getStatus()`。
- 渠道投递差异通过 capability、delivery policy 或 adapter-owned 行为表达，避免 Bridge Core 出现长期 `if channel === "weixin"` 分支。
- 命令处理和审批处理不能直接调用微信 API。

## 目录边界

- `src/channels/<channel-id>/`：具体渠道 adapter。
- `src/codex/`：Codex adapter 和 Codex 协议处理。
- `src/commands/` 或 `src/bridge/commands/`：命令解析和命令行为。
- `src/approvals/` 或 `src/bridge/approvals/`：审批状态和审批映射。
- `src/state/`：状态存储和 session binding。
- `src/logging/`：日志、transcript 格式化和脱敏。
- `reports/tests/`：每次功能变更或真实通道修复的中文测试报告。

## 模块拆分规则

- 优先按职责边界拆分：协议边界、状态所有权、生命周期和测试边界比行数更重要。
- 单个文件只承担一个主要职责。如果开始混合传输、映射、重试、命令处理、持久化和格式化，应按职责拆分。
- 消息映射、请求构造、重试策略、输出格式化、状态读写和测试 fixture 增长后应优先抽成纯函数或独立模块。
- 300-400 行左右是 review 触发点，不是硬性限制；超过时检查是否有多职责或测试边界不清。
- 600 行以上的业务文件默认应拆分，除非它主要是声明式类型、测试样例或一个内聚状态机。
- 不为了行数把强相关逻辑硬拆成碎片；拆分后不能引入隐式共享状态、循环依赖或明显跳转成本。
- 公共接口保持小而稳定；共享类型放在明确的 type/protocol 文件中。
- 新增能力时优先扩展既有职责模块，不扩大中央 switch 或万能工具文件。
- 测试结构跟随模块拆分：纯工具和协议映射写单元测试，Bridge/Core 流程写集成测试。

## 测试和提交

每个功能或行为修复都需要自测；如果只能等用户真实微信登录后补测，必须在报告里说明。

每次自测都要在 `reports/tests/` 留下中文测试报告，文件名建议：

```text
YYYY-MM-DD-feature-name.md
```

提交前执行：

```bash
git status --short --ignored
npm test
```

不要提交：

- `node_modules/`
- `dist/`
- `coverage/`
- `state/`
- 日志
- `.env`
- token/cookie 文件
- 微信登录态
- `openclaw-weixin-npm/`
- `references/` 下除 `README.md` 外的本地参考源码

## 许可证

本项目使用 [MIT License](../LICENSE)。

作者：小黄 and Codex
