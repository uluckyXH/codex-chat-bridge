# OpenClaw Weixin 源码参考

本目录记录 `@tencent-weixin/openclaw-weixin` 的本地源码参考如何重新获取和解包。下载得到的 npm 包和解包源码都只是本地工作文件，不提交到本项目仓库。

## 包信息

- 包名：`@tencent-weixin/openclaw-weixin`
- 当前适配参考版本：`2.4.3`
- 本地工作目录：`openclaw-weixin-npm/`
- 解包源码路径：`openclaw-weixin-npm/extracted/openclaw-weixin-2.4.3/`
- npm 包路径：`openclaw-weixin-npm/tencent-weixin-openclaw-weixin-2.4.3.tgz`
- SHA-256：

```text
422ee96c2fca294d6d80c193c2797d2a046cb8b512b84b0705c85865f0251bb7  tencent-weixin-openclaw-weixin-2.4.3.tgz
```

## 重新获取

在项目根目录执行：

```bash
mkdir -p openclaw-weixin-npm
npm pack @tencent-weixin/openclaw-weixin@2.4.3 --pack-destination openclaw-weixin-npm
rm -rf openclaw-weixin-npm/extracted
mkdir -p openclaw-weixin-npm/extracted
tar -xzf openclaw-weixin-npm/tencent-weixin-openclaw-weixin-2.4.3.tgz -C openclaw-weixin-npm/extracted
mv openclaw-weixin-npm/extracted/package openclaw-weixin-npm/extracted/openclaw-weixin-2.4.3
```

可选的完整性校验：

```bash
shasum -a 256 openclaw-weixin-npm/tencent-weixin-openclaw-weixin-2.4.3.tgz
```

## 常用参考文件

- `src/messaging/inbound.ts`：入站消息转换和 `context_token` 处理。
- `src/messaging/send.ts`：出站文本和媒体消息请求构造。
- `src/messaging/process-message.ts`：OpenClaw 消息管线参考行为。
- `src/api/api.ts`：底层微信 API 调用。
- `src/api/types.ts`：微信 API 请求和响应类型。

## 提交规则

`openclaw-weixin-npm/` 已被 Git 忽略。npm 包和解包源码只保留在该目录作为本地参考，不提交。参考版本或重新获取命令发生变化时，只更新并提交本 README。
