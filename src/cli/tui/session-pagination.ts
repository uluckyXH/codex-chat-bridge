export const SESSION_SELECT_PAGE_SIZE = 10;

export interface SessionPage<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
  startIndex: number;
}

export function sessionPageCount(total: number, pageSize = SESSION_SELECT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampSessionPage(page: number, total: number, pageSize = SESSION_SELECT_PAGE_SIZE): number {
  return Math.min(Math.max(0, page), sessionPageCount(total, pageSize) - 1);
}

export function sessionPage<T>(items: T[], page: number, pageSize = SESSION_SELECT_PAGE_SIZE): SessionPage<T> {
  const clamped = clampSessionPage(page, items.length, pageSize);
  const startIndex = clamped * pageSize;
  return {
    items: items.slice(startIndex, startIndex + pageSize),
    page: clamped,
    pageCount: sessionPageCount(items.length, pageSize),
    total: items.length,
    startIndex,
  };
}
