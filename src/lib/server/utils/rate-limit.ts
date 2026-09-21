import { parseEnvInt } from "../config/performance";

interface Bucket {
  tokens: number;
  last: number;
}

// One bucket per client address / project key — keys are attacker-influenced, so the map is capped
// at this many entries and the oldest-inserted entry is evicted first (mirrors the API-key caches).
const MAX_BUCKETS = 10_000;
const buckets = new Map<string, Bucket>();

/**
 * Reads a requests-per-minute limit. Anything that is not a whole number ≥ 1 falls back to the
 * documented default, because capacity 0 denies every request: an unset/empty value or an invalid
 * one (0, -1, "0.5", "600rpm") must not be able to lock out all ingest or all logins.
 */
function parsePositiveRpm(key: string, fallback: number): number {
  const rpm = parseEnvInt(key, fallback);
  if (rpm >= 1) {
    return rpm;
  }
  console.warn(`[config] invalid ${key}="${process.env[key]}", using default ${fallback}`);
  return fallback;
}

export const INGEST_RPM = parsePositiveRpm("RATE_LIMIT_INGEST_RPM", 600);
export const LOGIN_RPM = parsePositiveRpm("RATE_LIMIT_LOGIN_RPM", 10);
const CLEANUP_INTERVAL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.last > CLEANUP_INTERVAL) buckets.delete(k);
  }
}, CLEANUP_INTERVAL).unref?.();

function storeBucket(key: string, bucket: Bucket): void {
  if (buckets.size >= MAX_BUCKETS && !buckets.has(key)) {
    // Map iterates in insertion order, so the first key is the oldest entry.
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }
  buckets.set(key, bucket);
}

export function checkRateLimit(key: string, rpm: number): boolean {
  const capacity = Number.isFinite(rpm) && rpm > 0 ? Math.floor(rpm) : 0;
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: capacity, last: now };
  const elapsed = (now - bucket.last) / 60000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * capacity);
  bucket.last = now;
  if (bucket.tokens < 1) {
    storeBucket(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  storeBucket(key, bucket);
  return true;
}
