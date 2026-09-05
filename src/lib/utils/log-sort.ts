import type { Log } from "$lib/server/db/schema";

export type SortField = "timestamp" | "level" | "message";

export type SortDirection = "asc" | "desc" | null;

const LEVEL_SORT_PRIORITY: Record<string, number> = {
  fatal: 5,
  error: 4,
  warn: 3,
  info: 2,
  debug: 1,
};

export function sortLogs(logs: Log[], field: SortField | null, direction: SortDirection): Log[] {
  if (!field || !direction) return logs;

  return [...logs].sort((a, b) => {
    let comparison = 0;
    if (field === "timestamp") {
      comparison = (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0);
    } else if (field === "level") {
      comparison = (LEVEL_SORT_PRIORITY[a.level] ?? 0) - (LEVEL_SORT_PRIORITY[b.level] ?? 0);
    } else if (field === "message") {
      comparison = a.message.localeCompare(b.message);
    }
    return direction === "desc" ? -comparison : comparison;
  });
}
