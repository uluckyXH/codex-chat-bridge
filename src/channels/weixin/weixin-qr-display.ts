import { stdout } from "node:process";

export interface TerminalOutput {
  write(chunk: string): unknown;
}

export type QrCodeGenerator = (
  text: string,
  options?: { small?: boolean },
  callback?: (qrCode: string) => void,
) => void;

export interface WeixinQrDisplayOptions {
  output?: TerminalOutput;
  generate?: QrCodeGenerator;
}

export async function displayWeixinQrCode(
  qrCodeText: string,
  options: WeixinQrDisplayOptions = {},
): Promise<void> {
  const output = options.output ?? stdout;
  const writeFallbackLink = () => {
    output.write("若二维码未能显示或无法使用，你可以访问以下链接以继续：\n");
    output.write(`${qrCodeText}\n`);
  };

  output.write("请用手机微信扫描下面的二维码完成登录。\n");
  try {
    const generate = options.generate ?? await loadQrCodeGenerator();
    generate(qrCodeText, { small: true }, (qrCode) => {
      output.write(`${qrCode}\n`);
    });
    writeFallbackLink();
  } catch {
    writeFallbackLink();
  }
}

async function loadQrCodeGenerator(): Promise<QrCodeGenerator> {
  const qrTerminal = await import("qrcode-terminal");
  return qrTerminal.default.generate;
}
