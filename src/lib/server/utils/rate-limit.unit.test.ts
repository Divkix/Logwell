import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { clientNetworkKey, RateLimitStore } from "./rate-limit";

describe("rate-limit env parsing", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    // Mutate process.env in place: reassigning it to `originalEnv` would make later test writes
    // mutate the snapshot itself, leaking env into every later test.
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }

    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  async function loadLimit(key: string, value: string | undefined) {
    vi.resetModules();

    if (value === undefined) delete process.env[key];
    else process.env[key] = value;

    return import("./rate-limit");
  }

  // SAFETY: each row is [RATE_LIMIT_LOGIN_RPM / RATE_LIMIT_INGEST_RPM, value or unset, expected
  // limit, label] — the literals below only take those four shapes. Each variable keeps its own
  // fallback rows so both exports' wiring is proven independently.
  it.each([
    ["RATE_LIMIT_LOGIN_RPM", undefined, 10, "unset"],
    ["RATE_LIMIT_LOGIN_RPM", "", 10, "empty"],
    ["RATE_LIMIT_LOGIN_RPM", "30", 30, "in range"],
    ["RATE_LIMIT_LOGIN_RPM", "0", 10, "zero has no documented meaning, so it is invalid"],
    ["RATE_LIMIT_LOGIN_RPM", "-1", 10, "negative"],
    ["RATE_LIMIT_LOGIN_RPM", "0.5", 10, "fractional"],
    ["RATE_LIMIT_LOGIN_RPM", "abc", 10, "non-numeric"],
    ["RATE_LIMIT_LOGIN_RPM", "600rpm", 10, "numeric prefix with a unit"],
    ["RATE_LIMIT_LOGIN_RPM", "1e999", 10, "overflow"],
    ["RATE_LIMIT_INGEST_RPM", undefined, 600, "unset"],
    ["RATE_LIMIT_INGEST_RPM", "0", 600, "zero"],
    ["RATE_LIMIT_INGEST_RPM", "-100", 600, "negative"],
    ["RATE_LIMIT_INGEST_RPM", "0.9", 600, "fractional"],
    ["RATE_LIMIT_INGEST_RPM", "600 rpm", 600, "numeric prefix with a unit"],
    ["RATE_LIMIT_INGEST_RPM", "1200", 1200, "in range"],
  ] as [string, string | undefined, number, string][])(
    "%s=%s → %s (%s)",
    async (key, value, expected) => {
      const { LOGIN_RPM, INGEST_RPM } = await loadLimit(key, value);

      expect(key === "RATE_LIMIT_LOGIN_RPM" ? LOGIN_RPM : INGEST_RPM).toBe(expected);
    },
  );

  it.each([
    [undefined, 30],
    ["0", 30],
    ["50", 50],
  ])("RATE_LIMIT_LOGIN_ACCOUNT_RPM=%s → %s", async (value, expected) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { LOGIN_ACCOUNT_RPM } = await loadLimit("RATE_LIMIT_LOGIN_ACCOUNT_RPM", value);

    expect(LOGIN_ACCOUNT_RPM).toBe(expected);
    vi.restoreAllMocks();
  });

  it("warns with the variable name and the value actually used", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const { LOGIN_RPM } = await loadLimit("RATE_LIMIT_LOGIN_RPM", "600rpm");
      expect(LOGIN_RPM).toBe(10);
      // `mockRestore()` resets recorded calls, so read them while the spy is still installed.
      const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain("RATE_LIMIT_LOGIN_RPM");
      expect(logged).toContain("600rpm");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("RateLimitStore token bucket", () => {
  let store: RateLimitStore;

  beforeEach(() => {
    store = new RateLimitStore();
  });

  it("allows up to capacity then blocks further immediate calls", () => {
    expect(store.take("k1", 2)).toBe(true);
    expect(store.take("k1", 2)).toBe(true);
    expect(store.take("k1", 2)).toBe(false);
  });

  it("tracks buckets independently per key", () => {
    expect(store.take("k2", 1)).toBe(true);
    expect(store.take("k2", 1)).toBe(false);
    expect(store.take("k3", 1)).toBe(true);
  });

  it("fails closed when rpm is zero", () => {
    expect(store.take("zero", 0)).toBe(false);
    expect(store.take("zero", 0)).toBe(false);
  });

  it("fails closed when rpm is negative", () => {
    expect(store.take("negative", -5)).toBe(false);
  });

  it("fails closed when rpm is NaN", () => {
    expect(store.take("nan", Number.NaN)).toBe(false);
  });

  it("fails closed when rpm is not a finite number", () => {
    expect(store.take("infinity", Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("bounds the bucket map, evicting the oldest key instead of growing forever", () => {
    // One bucket per client address is attacker-influenced, so the map is capped. Prime a key,
    // flood with unique keys, then observe the cap: the primed key was evicted (fresh capacity,
    // rpm 1 would otherwise still deny it) while a recent key survives with its spent bucket.
    expect(store.take("cap:oldest", 1)).toBe(true);

    for (let i = 0; i < 25_000; i++) store.take(`cap:${i}`, 1);

    expect(store.take("cap:oldest", 1)).toBe(true);
    expect(store.take("cap:24999", 1)).toBe(false);
  });

  it("refunds a taken token without exceeding capacity", () => {
    expect(store.take("refund", 1)).toBe(true);
    expect(store.take("refund", 1)).toBe(false);

    store.refund("refund", 1);
    store.refund("refund", 1);

    expect(store.take("refund", 1)).toBe(true);
    expect(store.take("refund", 1)).toBe(false);
  });

  it("keeps separate stores from sharing buckets or the eviction cap", () => {
    const other = new RateLimitStore();
    expect(store.take("shared-key", 1)).toBe(true);

    for (let i = 0; i < 25_000; i++) other.take(`flood:${i}`, 1);

    expect(other.take("shared-key", 1)).toBe(true);
    // The flood in `other` did not evict this store's spent bucket.
    expect(store.take("shared-key", 1)).toBe(false);
  });
});

describe("clientNetworkKey", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::ffff:cb00:7107", "203.0.113.7"],
    ["2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"],
    ["2001:db8:1:2::1", "2001:db8:1:2::/64"],
    ["2001:DB8:0001:0002:ffff::", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["not-an-ip", "not-an-ip"],
  ])("%s → %s", (address, expected) => {
    expect(clientNetworkKey(address)).toBe(expected);
  });

  it("puts every address in one IPv6 /64 in the same bucket", () => {
    const store = new RateLimitStore();
    expect(store.take(clientNetworkKey("2001:db8:5:6::1"), 1)).toBe(true);
    expect(store.take(clientNetworkKey("2001:db8:5:6:dead:beef:0:2"), 1)).toBe(false);
    expect(store.take(clientNetworkKey("2001:db8:5:7::1"), 1)).toBe(true);
  });
});
