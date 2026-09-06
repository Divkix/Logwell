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
    ["error | warning", "error & warning", "pipe"],
    ["error! warning", "error & warning", "exclamation"],
    ["error (warning) info", "error & warning & info", "parens"],
    ["error:warning", "error & warning", "colon splits terms"],
    ["error* warning", "error & warning", "asterisk"],
    ["error\\warning", "error & warning", "backslash splits terms"],
    ["error's warning", "error & s & warning", "single quote splits terms"],
    ['error "warning" info', "error & warning & info", "double quotes"],
    ["error!|&* (warning)", "error & warning", "combined specials"],
    ["error-500 database-connection", "error-500 & database-connection", "hyphens kept"],
    ["user_id error_message", "user_id & error_message", "underscores kept"],
    [
      "Database connection failed! (timeout: 30s)",
      "Database & connection & failed & timeout & 30s",
      "real-world mix",
    ],
  ])("buildSearchQuery(%s) returns %s (%s)", (input, expected) => {
    expect(buildSearchQuery(input)).toBe(expected);
  });
});
