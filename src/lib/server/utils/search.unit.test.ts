import { describe, expect, it } from "vite-plus/test";
import { buildSearchQuery } from "./search";

describe("buildSearchQuery", () => {
  it.each([
    ["database connection failed", "database & connection & failed", "AND-joins terms"],
    ["error", "error", "single term"],
    ["database   connection    failed", "database & connection & failed", "collapses spaces"],
    ["  database connection  ", "database & connection", "trims edges"],
    ["", "", "empty string"],
    ["   ", "", "whitespace only"],
    ["error & warning", "error & warning", "ampersand"],
    ["error! warning", "error & warning", "exclamation"],
    ["error (warning) info", "error & warning & info", "parens"],
    ["error:warning", "error & warning", "colon splits terms"],
    ["error* warning", "error & warning", "asterisk"],
    ["error\\warning", "error & warning", "backslash splits terms"],
    ["error's warning", "error & s & warning", "single quote splits terms"],
    ['error "warning" info', "error & warning & info", "double quotes"],
    ["error!|&* (warning)", "error & warning", "combined specials"],
    // A hyphenated word also indexes its parts, so the logs-query integration test for
    // `search=user-service` passes even if hyphens were split; this row is the only guard
    // that a hyphenated term reaches tsquery intact.
    ["error-500 database-connection", "error-500 & database-connection", "hyphens kept"],
    ["user_ID error_CODE", "user_ID & error_CODE", "underscores and case kept"],
  ])("buildSearchQuery(%s) returns %s (%s)", (input, expected) => {
    expect(buildSearchQuery(input)).toBe(expected);
  });
});
