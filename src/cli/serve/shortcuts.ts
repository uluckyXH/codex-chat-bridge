export function normalizeText(input: string): string {
  return input.trim().toLowerCase();
}

export function isAddWeixinAction(input: string): boolean {
  const normalized = normalizeText(input);
  return normalized === "w" || normalized === "wx" || normalized === "weixin" || normalized === "微信";
}

export function isAddFeishuAction(input: string): boolean {
  const normalized = normalizeText(input);
  return normalized === "f" || normalized === "fs" || normalized === "feishu" || normalized === "lark" || normalized === "飞书";
}

export function isNewSessionAction(input: string): boolean {
  const normalized = normalizeText(input);
  return normalized === "n" || normalized === "new" || normalized === "新建";
}

export function isManualSessionInputAction(input: string): boolean {
  const normalized = normalizeText(input);
  return normalized === "m" || normalized === "manual" || normalized === "id" || normalized === "手动";
}

export function isBackText(input: string): boolean {
  const normalized = normalizeText(input);
  return normalized === "0" || normalized === "back" || normalized === "返回" || normalized === "q" || normalized === "quit";
}
