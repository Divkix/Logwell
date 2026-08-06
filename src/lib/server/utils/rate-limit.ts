// Token bucket per key. Env-configurable via RATE_LIMIT_INGEST_RPM and RATE_LIMIT_LOGIN_RPM.
interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Parse an RPM env value into a finite positive integer.
 *
 * A missing/empty value falls back to the default. An explicitly configured
 * non-positive or non-numeric value fails closed (returns 0 → capacity 0) so
 * a misconfigured limit can never silently relax into an unlimited bucket.
 */
function parsePositiveRpm(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return Math.floor(n);
  }
  return 0;
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
  // Guard against NaN / non-positive capacities: fail closed (capacity 0) so
  // every check is denied rather than letting a broken limit pass requests.
  const capacity = Number.isFinite(rpm) && rpm > 0 ? Math.floor(rpm) : 0;
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
