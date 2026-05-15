import test from "node:test";
import assert from "node:assert/strict";
import { displayWeixinQrCode, type QrCodeGenerator } from "../../src/channels/weixin/weixin-qr-display.js";

function captureOutput(): { output: { write(chunk: string): void }; chunks: string[] } {
  const chunks: string[] = [];
  return {
    output: {
      write(chunk: string): void {
        chunks.push(chunk);
      },
    },
    chunks,
  };
}

test("displayWeixinQrCode renders terminal QR code and fallback link", async () => {
  const { output, chunks } = captureOutput();
  const calls: Array<{ text: string; small?: boolean }> = [];
  const generate: QrCodeGenerator = (text, options, callback) => {
    calls.push({ text, small: options?.small });
    callback?.("terminal-qr");
  };

  await displayWeixinQrCode("https://login.example/qr", { output, generate });

  assert.deepEqual(calls, [{ text: "https://login.example/qr", small: true }]);
  assert.match(chunks.join(""), /请用手机微信扫描下面的二维码完成登录。/);
  assert.match(chunks.join(""), /terminal-qr/);
  assert.match(chunks.join(""), /若二维码未能显示或无法使用/);
  assert.match(chunks.join(""), /https:\/\/login\.example\/qr/);
});

test("displayWeixinQrCode falls back to login link when QR rendering fails", async () => {
  const { output, chunks } = captureOutput();
  const generate: QrCodeGenerator = () => {
    throw new Error("render failed");
  };

  await displayWeixinQrCode("https://login.example/fallback", { output, generate });

  const rendered = chunks.join("");
  assert.match(rendered, /请用手机微信扫描下面的二维码完成登录。/);
  assert.match(rendered, /若二维码未能显示或无法使用/);
  assert.match(rendered, /https:\/\/login\.example\/fallback/);
});

test("displayWeixinQrCode renders with the bundled qrcode-terminal loader", async () => {
  const { output, chunks } = captureOutput();

  await displayWeixinQrCode("https://login.example/real-loader", { output });

  const rendered = chunks.join("");
  assert.match(rendered, /请用手机微信扫描下面的二维码完成登录。/);
  assert.match(rendered, /[▀▄█]/);
  assert.match(rendered, /https:\/\/login\.example\/real-loader/);
});
