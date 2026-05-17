export type DisplayTimeInput = string | number | Date | undefined;

export interface DisplayTimeOptions {
  timeZone?: string;
}

export function currentTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return normalizeTimeZone(timeZone);
}

export function formatLocalDateTime(value: DisplayTimeInput, options: DisplayTimeOptions = {}): string {
  return formatDateTime(value, "full", options);
}

export function formatLocalShortDateTime(value: DisplayTimeInput, options: DisplayTimeOptions = {}): string {
  return formatDateTime(value, "short", options);
}

export function formatLocalClock(value: DisplayTimeInput, options: DisplayTimeOptions = {}): string {
  return formatDateTime(value, "clock", options);
}

export function formatLocalDateTimeWithZone(value: DisplayTimeInput, options: DisplayTimeOptions = {}): string {
  const formatted = formatLocalDateTime(value, options);
  if (formatted === "未知") return formatted;
  return `${formatted}（${resolveTimeZone(options)}）`;
}

type DisplayTimeStyle = "full" | "short" | "clock";

function formatDateTime(value: DisplayTimeInput, style: DisplayTimeStyle, options: DisplayTimeOptions): string {
  const date = parseDisplayTimeInput(value);
  if (!date) return "未知";
  const parts = dateTimeParts(date, resolveTimeZone(options));
  if (!parts) return "未知";
  if (style === "clock") return `${parts.hour}:${parts.minute}:${parts.second}`;
  if (style === "short") return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function parseDisplayTimeInput(value: DisplayTimeInput): Date | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) return validDate(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    const timestampMs = Math.abs(value) > 10_000_000_000 ? value : value * 1000;
    return validDate(new Date(timestampMs));
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return validDate(new Date(trimmed));
}

function validDate(date: Date): Date | undefined {
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function resolveTimeZone(options: DisplayTimeOptions): string {
  return normalizeTimeZone(options.timeZone ?? currentTimeZone());
}

function normalizeTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return "UTC";
  }
}

function dateTimeParts(date: Date, timeZone: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
} | undefined {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = parts.hour;
  const minute = parts.minute;
  const second = parts.second;
  if (!year || !month || !day || !hour || !minute || !second) return undefined;
  return { year, month, day, hour, minute, second };
}
