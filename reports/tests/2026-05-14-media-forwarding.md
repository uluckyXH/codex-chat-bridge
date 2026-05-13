# 2026-05-14 Codex 图片转发测试报告

## 测试目标

- 验证 Bridge 能从 Codex 阶段性输出和最终回复中抽取图片引用。
- 验证本地图片路径、相对路径、`file://`、Markdown 图片和远程图片 URL 的识别与去重。
- 验证支持媒体的通道会收到 `ChannelMedia`，不依赖微信私有结构。
- 验证微信图片发送链路会调用 `getuploadurl`、上传 AES-128-ECB 加密后的 CDN 内容，再发送 `image_item`。

## 覆盖范围

- `src/bridge/media-extractor.ts`
- `src/bridge/bridge.ts`
- `src/codex/exec-codex-adapter.ts`
- `src/protocol/channel.ts`
- `src/channels/weixin/weixin-api.ts`
- `src/channels/weixin/weixin-media.ts`
- `src/channels/weixin/weixin-adapter.ts`
- `tests/unit/media-extractor.test.ts`
- `tests/unit/exec-codex-adapter.test.ts`
- `tests/integration/bridge-mock.test.ts`
- `tests/integration/weixin-adapter-api.test.ts`

## 自动化测试

命令：

```bash
npm test
```

结果：

```text
tests 40
pass 40
fail 0
cancelled 0
```

新增重点用例：

- `extractMediaRefs extracts local images from markdown, absolute, relative, and file URL refs`
- `extractMediaRefs keeps remote markdown image URLs as media URLs`
- `parseExecJsonLine maps exec progress items` 中覆盖 `aggregated_output` 图片路径摘要
- `Bridge forwards generated image refs as channel media and transcript media events`
- `WeixinAdapter uploads and sends image media with caption`

## 结果说明

- 本地图片必须真实存在才会被转成媒体消息，避免误把普通文本路径发送给微信。
- Bridge 先发送 Codex 文本，再发送媒体；同一轮里相同 `path/url` 只发送一次。
- 微信当前实现支持图片媒体发送。若通道不支持媒体，或微信上传/发送失败，Bridge 会退回文本说明，保留图片路径或 URL 供用户手动查看。
