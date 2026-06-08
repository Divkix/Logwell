// Token bucket per key. Env-configurable via RATE_LIMIT_INGEST_RPM and RATE_LIMIT_LOGIN_RPM.
interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Parse an RPM env value into a finite positive integer, falling back to the
 * default when the value is missing, non-numeric, zero, or negative.
 */
function parsePositiveRpm(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const INGEST_RPM = parsePositiveRpm(process.env.RATE_LIMIT_INGEST_RPM, 600); // 600 req/min per key
export const LOGIN_RPM = parsePositiveRpm(process.env.RATE_LIMIT_LOGIN_RPM, 10); // 10 req/min per IP
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 min

// Clean up stale buckets
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.last > CLEANUP_INTERVAL) buckets.delete(k);
  }
}, CLEANUP_INTERVAL).unref?.();

export function checkRateLimit(key: string, rpm: number): boolean {
  // Guard against NaN / non-positive capacities reaching the bucket math.
  const capacity = Number.isFinite(rpm) && rpm > 0 ? Math.floor(rpm) : 1;
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: capacity, last: now };
  const elapsed = (now - bucket.last) / 60000; // minutes
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * capacity);
  bucket.last = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false; // rate limited
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}
