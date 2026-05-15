# 测试报告：微信终端二维码登录展示

## 测试目标

验证 `weixin login` 和 `weixin codex` 登录流程不再只打印二维码链接，而是复用统一 helper 在终端渲染二维码，并在渲染失败时保留备用链接。

## 测试环境

- 日期：2026-05-15
- 分支/提交：main / f2a485a
- Node.js 版本：v24.14.0
- 操作系统：Darwin Mac 25.4.0 arm64
- Codex 版本：本地测试不依赖真实 Codex
- 渠道：weixin adapter fake-fetch / terminal output helper

## 执行命令

```bash
npm run build
node --test dist/tests/unit/weixin-qr-display.test.js dist/tests/integration/weixin-adapter-api.test.js
node -e 'const qr = await import("qrcode-terminal"); let rendered = ""; qr.default.generate("https://login.example/qr", { small: true }, (text) => { rendered = text; }); if (!rendered || !rendered.includes("█")) process.exit(1);'
npm test
git diff --check
```

## 测试步骤

1. 对照 `@tencent-weixin/openclaw-weixin@2.4.3` 的 `displayQRCode()`，确认官方插件使用 `qrcode-terminal` 在终端展示二维码，并保留备用链接。
2. 新增 `displayWeixinQrCode()` helper，注入 fake generator 验证终端二维码内容会写入输出流。
3. 模拟二维码渲染抛错，验证 helper 不抛出异常，并继续输出备用登录链接。
4. 确认 `weixin login` 和 `weixin codex` 的未登录流程都调用统一 helper。
5. 运行微信 adapter fake-fetch 测试，确认二维码获取、登录确认和账号保存逻辑未受影响。

## 实际结果

- 终端输出会先提示用户扫码，再渲染小尺寸二维码，并输出备用链接。
- `qrcode-terminal` 可在当前 Node ESM 环境下动态导入，并能通过 callback 生成终端二维码文本。
- `qrcode-terminal` 加载或渲染失败时，会降级输出备用链接。
- `WeixinAdapter.startLogin()` 仍返回 `qrCodeText`，展示逻辑没有下沉到 adapter 协议层。
- 相关定向测试通过：14 个测试通过。
- `npm test` 通过：108 个测试通过。
- `git diff --check` 通过。

## 结论

通过。

## 遗留问题

- 真实微信扫码未在本轮执行；当前已覆盖终端展示 helper 和 fake-fetch 登录协议，真实通道仍需用户扫码后补测。
