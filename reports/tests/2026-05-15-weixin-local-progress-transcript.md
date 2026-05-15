# 测试报告：微信本地进度日志

## 测试目标

验证微信渠道通过 delivery policy 不向微信投递 task-start/progress 时，Codex 阶段性进度仍会写入启动终端的 transcript，并明确标记为“本地进度（未投递）”。

## 测试环境

- 日期：2026-05-15
- 分支/提交：main / f2a485a
- Node.js 版本：v24.14.0
- 操作系统：Darwin Mac 25.4.0 arm64
- Codex 版本：MockCodexAdapter / ProgressCodexAdapter
- 渠道：mock / weixin-like mock

## 执行命令

```bash
npm run build
node --test dist/tests/unit/transcript.test.js dist/tests/integration/bridge-mock.test.js
npm test
git diff --check
```

## 测试步骤

1. 构造 weixin-like delivery policy：`taskStart=suppress`、`progress=suppress`、`progressCommand=disabled`。
2. 让 Codex adapter 产生 reasoning progress 和 command progress。
3. 验证微信 channel 没有收到 `Codex 进度:` 文本。
4. 验证 transcript 没有把该进度记录为普通 outbound。
5. 验证 transcript 通过 `localProgress` 记录被抑制的进度，包括 command 细节。
6. 验证 `ConsoleTranscriptSink` 输出标题为 `本地进度（未投递）`。

## 实际结果

- 微信 channel 未收到 task-start/progress。
- 被微信策略抑制的 progress 会进入本地 transcript。
- 本地 transcript 使用 `微信 -- direct:<id> | 本地进度（未投递）` 形式展示，避免误认为已发给微信。
- 定向测试通过：41 个测试通过。
- `npm test` 通过。
- `git diff --check` 通过。

## 结论

通过。

## 遗留问题

- 真实微信扫码通道未在本轮执行；当前覆盖 Bridge transcript 行为和 weixin-like policy。
