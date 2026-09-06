import { describe, expect, it } from "vite-plus/test";
import { LOG_LEVELS, logLevelSchema, parseLevelFilter } from "./log";

describe("logLevelSchema", () => {
  it.each([...LOG_LEVELS])("accepts valid level %s", (level) => {
    expect(logLevelSchema.safeParse(level).success).toBe(true);
  });

  it("rejects invalid log level", () => {
    expect(logLevelSchema.safeParse("invalid").success).toBe(false);
  });
});

describe("parseLevelFilter", () => {
  it.each([[null], [""]])("returns null for %s", (input) => {
    expect(parseLevelFilter(input)).toBeNull();
  });

  it.each([
    ["critical,trace", null, "all invalid"],
    ["error", ["error"], "single level"],
    ["error,fatal", ["error", "fatal"], "comma-separated"],
    [" warn , info ", ["warn", "info"], "trims whitespace"],
    ["ERROR,WARN", ["error", "warn"], "lowercases"],
    ["error,critical,fatal", ["error", "fatal"], "drops invalid"],
  ] as [string, string[] | null, string][])("parseLevelFilter(%s) (%s)", (input, expected) => {
    expect(parseLevelFilter(input)).toEqual(expected);
  });

  it("accepts all valid log levels", () => {
    expect(parseLevelFilter(LOG_LEVELS.join(","))).toEqual([...LOG_LEVELS]);
  });
});
