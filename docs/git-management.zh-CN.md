# Git 管理规范

本文档说明本项目的 Git 管理方式。

## 1. 仓库边界

当前目录 `codex-openclaw-wechat/` 是独立 Git 仓库。

本仓库提交：

- 项目源码。
- 项目配置。
- 中文需求、设计、开发规范文档。
- 中文测试报告。
- `openclaw-weixin` npm 原始 tarball 和说明文件。
- 轻量参考索引文件。

本仓库不提交：

- `node_modules/`。
- `dist/`、`coverage/` 等构建和测试产物。
- 运行日志和运行态数据。
- `.env`、token、cookie、微信登录态、session 文件。
- `openclaw-weixin-npm/extracted/` 解压目录。
- `references/openai-codex/` Codex 源码参考仓库。

## 2. 本地参考仓库

`references/openai-codex/` 是本地参考仓库，用于查 Codex 协议和实现细节。它本身是一个独立 Git 仓库，不提交到本项目仓库。

如果需要重新拉取：

```bash
git clone --depth 1 --filter=blob:none https://github.com/openai/codex.git references/openai-codex
```

当前参考 commit 记录在 `docs/technical-design.zh-CN.md`。

## 3. openclaw-weixin 包管理

本仓库保留：

- `openclaw-weixin-npm/tencent-weixin-openclaw-weixin-2.4.3.tgz`
- `openclaw-weixin-npm/README.md`

`openclaw-weixin-npm/extracted/` 是从 tarball 解压得到的参考目录，不提交。需要时可以重新解压。

## 4. 提交要求

每个功能提交前必须：

- 运行相关测试。
- 更新或新增中文测试报告到 `reports/tests/`。
- 检查 `git status --short`，确认没有登录态、token、日志和构建产物进入暂存区。
- 确认文档与实际实现一致。

## 4.1 忽略规则重点

`.gitignore` 中运行态状态目录必须使用根路径忽略，例如：

```gitignore
/state/
```

不能写成裸 `state/`，否则会误伤源码目录 `src/state/`。`src/state/` 是中间件状态存储源码，必须被 Git 追踪。

## 5. 建议提交粒度

- 文档和规范调整可以单独提交。
- 通用协议、Codex Adapter、Channel Adapter、命令、审批、状态存储应按功能分批提交。
- 每个实现提交应包含对应测试或测试报告。
