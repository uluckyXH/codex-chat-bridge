declare module "qrcode-terminal" {
  const qrcodeTerminal: {
    generate(
      text: string,
      options?: { small?: boolean },
      callback?: (qrCode: string) => void,
    ): void;
  };
  export default qrcodeTerminal;
}
