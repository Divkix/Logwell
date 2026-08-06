import { describe, expect, it } from "vite-plus/test";
import { checkRateLimit, INGEST_RPM, LOGIN_RPM } from "./rate-limit";

describe("rate-limit env defaults", () => {
  it("defaults LOGIN_RPM to 10 when env is unset", () => {
    expect(LOGIN_RPM).toBe(10);
  });

  it("defaults INGEST_RPM to 600 when env is unset", () => {
    expect(INGEST_RPM).toBe(600);
  });
});

describe("checkRateLimit token bucket", () => {
  it("allows up to capacity then blocks further immediate calls", () => {
    expect(checkRateLimit("k1", 2)).toBe(true);
    expect(checkRateLimit("k1", 2)).toBe(true);
    expect(checkRateLimit("k1", 2)).toBe(false);
  });

  it("tracks buckets independently per key", () => {
    expect(checkRateLimit("k2", 1)).toBe(true);
    expect(checkRateLimit("k2", 1)).toBe(false);
    expect(checkRateLimit("k3", 1)).toBe(true);
  });

  it("fails closed when rpm is zero", () => {
    expect(checkRateLimit("zero", 0)).toBe(false);
    expect(checkRateLimit("zero", 0)).toBe(false);
  });

  it("fails closed when rpm is negative", () => {
    expect(checkRateLimit("negative", -5)).toBe(false);
  });

  it("fails closed when rpm is NaN", () => {
    expect(checkRateLimit("nan", Number.NaN)).toBe(false);
  });

  it("fails closed when rpm is not a finite number", () => {
    expect(checkRateLimit("infinity", Number.POSITIVE_INFINITY)).toBe(false);
  });
});
