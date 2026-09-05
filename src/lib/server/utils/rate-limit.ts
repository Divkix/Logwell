interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();

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

export const INGEST_RPM = parsePositiveRpm(process.env.RATE_LIMIT_INGEST_RPM, 600);
export const LOGIN_RPM = parsePositiveRpm(process.env.RATE_LIMIT_LOGIN_RPM, 10);
const CLEANUP_INTERVAL = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.last > CLEANUP_INTERVAL) buckets.delete(k);
  }
}, CLEANUP_INTERVAL).unref?.();

export function checkRateLimit(key: string, rpm: number): boolean {
  const capacity = Number.isFinite(rpm) && rpm > 0 ? Math.floor(rpm) : 0;
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: capacity, last: now };
  const elapsed = (now - bucket.last) / 60000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * capacity);
  bucket.last = now;
  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}
