import { describe, expect, it } from "vite-plus/test";
import { parseTimeRange } from "./time-range";

describe("parseTimeRange", () => {
  it("returns null for null input", () => {
    expect(parseTimeRange(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseTimeRange("")).toBeNull();
  });

  it("returns null for unknown range string", () => {
    expect(parseTimeRange("99z")).toBeNull();
    expect(parseTimeRange("2h")).toBeNull();
    expect(parseTimeRange("30m")).toBeNull();
  });

  // Successful parsing of every valid range is asserted end-to-end by the
  // timeseries/stats integration tests and the picker component tests.
  it("is case-sensitive (uppercase variants are invalid)", () => {
    expect(parseTimeRange("15M")).toBeNull();
    expect(parseTimeRange("1H")).toBeNull();
    expect(parseTimeRange("24H")).toBeNull();
    expect(parseTimeRange("7D")).toBeNull();
  });
});
