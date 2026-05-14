# 2026-05-14 媒体链接误判与 app-server 断连进度测试报告

## 背景

真实微信对话中发现两个问题：

- 普通 Markdown 链接 `[ts-rs](https://github.com/Aleph-Alpha/ts-rs)` 被误识别为文件媒体，并以 `application/octet-stream` 发到微信。
- app-server 临时断连通知 `Reconnecting... 1/5` 被当成 `Codex 执行失败` 推送，导致用户误以为 turn 已失败。

同时补齐 `item/reasoning/summaryPartAdded` 的分段处理，避免 reasoning summary 分段事件丢失或在完成事件里重复刷整段摘要。

## 修复点

- 普通远程 Markdown 链接不再被抽取为文件附件。
- 远程普通文件必须使用 `FILE:`、`MEDIA:`、`附件:`、`File:` 等显式标签，并且 URL 路径带可识别文件后缀。
- 本地 Markdown 文件链接仍可在文件存在且后缀可识别时发送为附件。
- `item/reasoning/summaryPartAdded` 会刷新当前 reasoning draft，作为用户可见“自言自语”的分段边界。
- `Reconnecting... n/m` 这类 app-server transient error 会转为 `assistant.progress`，不再触发 `turn.failed`，也不会关闭当前 turn。

## 验证命令

```bash
npm run build
node --test --test-timeout=5000 dist/tests/unit/media-extractor.test.js dist/tests/unit/app-server-codex-adapter.test.js
npm test
```

## 结果

- `npm run build` 通过。
- 针对性单测 12 个通过。
- 全量测试 68 个通过。

## 结论

这次修复后，GitHub 仓库等普通链接不会再触发微信文件发送；app-server 的短暂重连状态会作为进度提示继续运行，不会误报为执行失败。默认 `brief` 模式仍会投递 reasoning summary 和 plan 这类阶段性进度。
