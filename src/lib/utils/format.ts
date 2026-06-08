/**
 * Formats a Date object as a timestamp string in HH:mm:ss.SSS format.
 * Uses UTC timezone.
 *
 * @param date - The date to format
 * @returns Formatted timestamp string (e.g., "14:30:45.123")
 *
 * @example
 * formatTimestamp(new Date("2024-01-15T14:30:45.123Z"))
 * // Returns: "14:30:45.123"
 */
export function formatTimestamp(date: Date): string {
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");
  const milliseconds = date.getUTCMilliseconds().toString().padStart(3, "0");

  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

/**
 * Formats a Date object as a human-readable relative time string.
 * Handles future dates by returning "just now".
 *
 * @param date - The date to format relative to current time
 * @param referenceTime - Optional reference time to compare against (defaults to current time)
 * @returns Human-readable relative time string
 *
 * @example
 * formatRelativeTime(new Date(Date.now() - 5000))
 * // Returns: "5 seconds ago"
 *
 * formatRelativeTime(new Date(Date.now() - 90000))
 * // Returns: "1 minute ago"
 */
export function formatRelativeTime(date: Date, referenceTime?: Date): string {
  const now = referenceTime ? referenceTime.getTime() : Date.now();
  const diffMs = now - date.getTime();

  // Handle future dates
  if (diffMs < 0) {
    return "just now";
  }

  const diffSeconds = Math.floor(diffMs / 1000);

  // Less than 5 seconds
  if (diffSeconds < 5) {
    return "just now";
  }

  // Less than 60 seconds
  if (diffSeconds < 60) {
    return `${diffSeconds} seconds ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);

  // Less than 60 minutes
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? "1 minute ago" : `${diffMinutes} minutes ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  // Less than 24 hours
  if (diffHours < 24) {
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
  }

  const diffDays = Math.floor(diffHours / 24);

  // 24 hours or more
  return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
}

/**
 * Returns a Date representing the start of a given time range from now.
 *
 * @param range - Time range identifier ('15m' | '1h' | '24h' | '7d')
 * @param referenceTime - Optional reference time (defaults to current time)
 * @returns Date object representing the start of the time range
 *
 * @example
 * getTimeRangeStart('15m')
 * // Returns: Date object 15 minutes ago
 *
 * getTimeRangeStart('7d')
 * // Returns: Date object 7 days ago
 */
export function getTimeRangeStart(range: "15m" | "1h" | "24h" | "7d", referenceTime?: Date): Date {
  const now = referenceTime || new Date();
  const nowMs = now.getTime();

  switch (range) {
    case "15m":
      return new Date(nowMs - 15 * 60 * 1000);
    case "1h":
      return new Date(nowMs - 60 * 60 * 1000);
    case "24h":
      return new Date(nowMs - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
  }
}

/**
 * Formats a Date object as a full date-time string in YYYY-MM-DD HH:mm:ss.SSS UTC format.
 * Uses UTC timezone.
 *
 * @param date - The date to format
 * @returns Formatted full date string (e.g., "2024-01-15 14:30:45.123 UTC")
 *
 * @example
 * formatFullDate(new Date("2024-01-15T14:30:45.123Z"))
 * // Returns: "2024-01-15 14:30:45.123 UTC"
 */
export function formatFullDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");
  const milliseconds = date.getUTCMilliseconds().toString().padStart(3, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds} UTC`;
}
