import type { Log } from "$lib/server/db/schema";

/**
 * Sort fields supported by the logs table.
 */
export type SortField = "timestamp" | "level" | "message";

/**
 * Sort direction for the logs table. `null` means no active sort.
 */
export type SortDirection = "asc" | "desc" | null;

const LEVEL_SORT_PRIORITY: Record<string, number> = {
  fatal: 5,
  error: 4,
  warn: 3,
  info: 2,
  debug: 1,
};

/**
 * Sort logs by the given field/direction without mutating the input array.
 *
 * Returns the original array unchanged when no sort is active so the table
 * (and the page's j/k row navigation) keep the pre-sort order.
 *
 * Shared by log-table.svelte and the logs page so the rows the user sees
 * always match the array the keyboard navigation walks.
 */
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
