// Token bucket per key. Env-configurable via RATE_LIMIT_INGEST_RPM and RATE_LIMIT_LOGIN_RPM.
interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();

export const INGEST_RPM = Number(process.env.RATE_LIMIT_INGEST_RPM ?? 600); // 600 req/min per key
export const LOGIN_RPM = Number(process.env.RATE_LIMIT_LOGIN_RPM ?? 10); // 10 req/min per IP
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 min

// Clean up stale buckets
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.last > CLEANUP_INTERVAL) buckets.delete(k);
  }
}, CLEANUP_INTERVAL).unref?.();

export function checkRateLimit(key: string, rpm: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: rpm, last: now };
  const elapsed = (now - bucket.last) / 60000; // minutes
  bucket.tokens = Math.min(rpm, bucket.tokens + elapsed * rpm);
  bucket.last = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false; // rate limited
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}
