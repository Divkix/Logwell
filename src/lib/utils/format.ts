export function formatTimestamp(date: Date): string {
  const hours = date.getUTCHours().toString().padStart(2, "0");
  const minutes = date.getUTCMinutes().toString().padStart(2, "0");
  const seconds = date.getUTCSeconds().toString().padStart(2, "0");
  const milliseconds = date.getUTCMilliseconds().toString().padStart(3, "0");

  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

export function formatRelativeTime(date: Date, referenceTime?: Date): string {
  const now = referenceTime ? referenceTime.getTime() : Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) {
    return "just now";
  }

  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 5) {
    return "just now";
  }

  if (diffSeconds < 60) {
    return `${diffSeconds} seconds ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);

  if (diffMinutes < 60) {
    return diffMinutes === 1 ? "1 minute ago" : `${diffMinutes} minutes ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
  }

  const diffDays = Math.floor(diffHours / 24);

  return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
}

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
