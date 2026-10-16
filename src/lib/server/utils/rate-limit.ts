import { isIPv4, isIPv6 } from "node:net";
import { parseEnvInt } from "../config/performance";

interface Bucket {
  tokens: number;
  last: number;
}

// Keys are attacker-influenced, so every store is capped at this many entries and the
// oldest-inserted entry is evicted first (mirrors the API-key caches).
const MAX_BUCKETS = 10_000;

const CLEANUP_INTERVAL = 5 * 60 * 1000;

function capacityOf(rpm: number): number {
  return Number.isFinite(rpm) && rpm > 0 ? Math.floor(rpm) : 0;
}

/**
 * Token-bucket limiter with its own bounded key space. Each purpose gets a separate store so
 * that churn in one (e.g. a /v1 flood from rotating addresses) cannot evict the buckets of
 * another (login attempts) through the shared size cap.
 */
export class RateLimitStore {
  readonly #buckets = new Map<string, Bucket>();

  #refill(key: string, capacity: number, now: number): Bucket {
    const bucket = this.#buckets.get(key) ?? { tokens: capacity, last: now };
    const elapsed = (now - bucket.last) / 60000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * capacity);
    bucket.last = now;

    return bucket;
  }

  #store(key: string, bucket: Bucket): void {
    if (this.#buckets.size >= MAX_BUCKETS && !this.#buckets.has(key)) {
      // Map iterates in insertion order, so the first key is the oldest entry.
      const oldest = this.#buckets.keys().next().value;

      if (oldest !== undefined) this.#buckets.delete(oldest);
    }

    this.#buckets.set(key, bucket);
  }

  /** Takes one token from `key`'s bucket; false (nothing taken) when it is empty. */
  take(key: string, rpm: number): boolean {
    const bucket = this.#refill(key, capacityOf(rpm), Date.now());

    if (bucket.tokens < 1) {
      this.#store(key, bucket);

      return false;
    }

    bucket.tokens -= 1;
    this.#store(key, bucket);

    return true;
  }

  /** Returns a token taken by `take`, for attempts that turned out not to count. */
  refund(key: string, rpm: number): void {
    const bucket = this.#buckets.get(key);

    if (bucket) bucket.tokens = Math.min(capacityOf(rpm), bucket.tokens + 1);
  }

  sweep(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.last > CLEANUP_INTERVAL) this.#buckets.delete(key);
    }
  }
}

/** Sign-in attempts per client network (see `clientNetworkKey`). */
export const loginIpLimiter = new RateLimitStore();

/** Failed sign-in attempts per account (see `loginAccountKey`), across all client networks. */
export const loginAccountLimiter = new RateLimitStore();

/** Pre-auth /v1 requests per client network (hooks.server.ts). */
export const ingestIpLimiter = new RateLimitStore();

/** Authenticated ingest requests per project (ingest.ts). */
export const ingestProjectLimiter = new RateLimitStore();

const stores = [loginIpLimiter, loginAccountLimiter, ingestIpLimiter, ingestProjectLimiter];

setInterval(() => {
  const now = Date.now();

  for (const store of stores) store.sweep(now);
}, CLEANUP_INTERVAL).unref?.();

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

/**
 * Failed sign-ins per minute for one account, from any address. Bounds a distributed guess rate
 * that the per-network limit cannot. The trade-off is lockout: whoever can sustain this many
 * failures a minute can keep the account's legitimate owner out too, so the default sits well
 * above LOGIN_RPM — denying the admin then takes several client networks, not one.
 */
export const LOGIN_ACCOUNT_RPM = parsePositiveRpm("RATE_LIMIT_LOGIN_ACCOUNT_RPM", 30);

function ipv4Groups(dotted: string): number[] {
  const [a = 0, b = 0, c = 0, d = 0] = dotted.split(".").map(Number);

  return [(a << 8) | b, (c << 8) | d];
}

function hexGroups(part: string | undefined): number[] {
  if (!part) return [];

  return part
    .split(":")
    .flatMap((group) => (group.includes(".") ? ipv4Groups(group) : [Number.parseInt(group, 16)]));
}

/** Expands a valid IPv6 literal (zone id already removed) into its eight 16-bit groups. */
function ipv6Groups(address: string): number[] {
  const [head, tail] = address.split("::");
  const left = hexGroups(head);
  const right = hexGroups(tail);
  const gap = tail === undefined ? 0 : 8 - left.length - right.length;

  return [...left, ...Array.from({ length: gap }, () => 0), ...right];
}

/**
 * Rate-limit key for a client address. An IPv6 host typically controls a whole /64, so keying
 * by full address would hand it 2^64 fresh buckets; IPv6 is collapsed to its /64 prefix and
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d`, what Node reports on a dual-stack socket) to plain IPv4.
 */
export function clientNetworkKey(address: string): string {
  if (isIPv4(address)) return address;

  const bare = address.split("%")[0] ?? address;

  if (!isIPv6(bare)) return address;

  const groups = ipv6Groups(bare);

  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [high = 0, low = 0] = groups.slice(6);

    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }

  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}
