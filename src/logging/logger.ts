export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export class ConsoleLogger implements Logger {
  constructor(private readonly debugEnabled = false) {}

  info(message: string, meta?: Record<string, unknown>): void {
    this.write("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write("error", message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.debugEnabled) this.write("debug", message, meta);
  }

  private write(level: string, message: string, meta?: Record<string, unknown>): void {
    const metaText = meta ? ` ${formatMeta(redact(meta))}` : "";
    const line = `[${formatClock(new Date())}] ${level.toUpperCase()} ${message}${metaText}`;
    if (level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}

export class SilentLogger implements Logger {
  info(): void {}
  warn(): void {}
  error(): void {}
  debug(): void {}
}

function redact(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|cookie|secret|password|authorization/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = item;
    }
  }
  return result;
}

function formatMeta(value: Record<string, unknown>): string {
  return Object.entries(value)
    .map(([key, item]) => `${key}=${formatMetaValue(item)}`)
    .join(" ");
}

function formatMetaValue(value: unknown): string {
  if (typeof value === "string") return value.includes(" ") ? JSON.stringify(value) : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return JSON.stringify(value);
}

function formatClock(date: Date): string {
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}
