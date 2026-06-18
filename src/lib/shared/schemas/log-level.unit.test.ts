import { describe, expect, it } from "vite-plus/test";
import { LOG_LEVELS, logLevelSchema, parseLevelFilter } from "./log";

describe("logLevelSchema", () => {
  it("accepts all valid log levels", () => {
    for (const level of LOG_LEVELS) {
      const result = logLevelSchema.safeParse(level);
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid log level", () => {
    const result = logLevelSchema.safeParse("invalid");
    expect(result.success).toBe(false);
  });
});

describe("parseLevelFilter", () => {
  it("returns null for null input", () => {
    expect(parseLevelFilter(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseLevelFilter("")).toBeNull();
  });

  it("returns null when all values are invalid", () => {
    expect(parseLevelFilter("critical,trace")).toBeNull();
  });

  it("returns a single valid level", () => {
    expect(parseLevelFilter("error")).toEqual(["error"]);
  });

  it("parses a comma-separated list of valid levels", () => {
    expect(parseLevelFilter("error,fatal")).toEqual(["error", "fatal"]);
  });

  it("trims whitespace around level names", () => {
    expect(parseLevelFilter(" warn , info ")).toEqual(["warn", "info"]);
  });

  it("lowercases level names", () => {
    expect(parseLevelFilter("ERROR,WARN")).toEqual(["error", "warn"]);
  });

  it("filters out invalid levels from a mixed list", () => {
    expect(parseLevelFilter("error,critical,fatal")).toEqual(["error", "fatal"]);
  });

  it("accepts all valid log levels", () => {
    const all = LOG_LEVELS.join(",");
    expect(parseLevelFilter(all)).toEqual([...LOG_LEVELS]);
  });
});
