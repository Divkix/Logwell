import { describe, expect, it } from "vite-plus/test";
import { buildSearchQuery } from "./search";

describe("buildSearchQuery", () => {
  it("converts space-separated terms to tsquery with AND operator", () => {
    const result = buildSearchQuery("database connection failed");
    expect(result).toBe("database & connection & failed");
  });

  it("handles single term", () => {
    const result = buildSearchQuery("error");
    expect(result).toBe("error");
  });

  it("handles multiple spaces between terms", () => {
    const result = buildSearchQuery("database   connection    failed");
    expect(result).toBe("database & connection & failed");
  });

  it("handles leading and trailing whitespace", () => {
    const result = buildSearchQuery("  database connection  ");
    expect(result).toBe("database & connection");
  });

  it("handles empty string", () => {
    const result = buildSearchQuery("");
    expect(result).toBe("");
  });

  it("handles string with only whitespace", () => {
    const result = buildSearchQuery("   ");
    expect(result).toBe("");
  });

  it("escapes ampersand (&) character", () => {
    const result = buildSearchQuery("error & warning");
    expect(result).toBe("error & warning");
  });

  it("escapes pipe (|) character", () => {
    const result = buildSearchQuery("error | warning");
    expect(result).toBe("error & warning");
  });

  it("escapes exclamation (!) character", () => {
    const result = buildSearchQuery("error! warning");
    expect(result).toBe("error & warning");
  });

  it("escapes parentheses () characters", () => {
    const result = buildSearchQuery("error (warning) info");
    expect(result).toBe("error & warning & info");
  });

  it("escapes colon (:) character", () => {
    const result = buildSearchQuery("error:warning");
    // Colon replaced with space, creates two terms
    expect(result).toBe("error & warning");
  });

  it("escapes asterisk (*) character", () => {
    const result = buildSearchQuery("error* warning");
    expect(result).toBe("error & warning");
  });

  it("escapes backslash (\\) character", () => {
    const result = buildSearchQuery("error\\warning");
    // Backslash replaced with space, creates two terms
    expect(result).toBe("error & warning");
  });

  it("escapes single quote (') character", () => {
    const result = buildSearchQuery("error's warning");
    // Quote replaced with space, creates three terms
    expect(result).toBe("error & s & warning");
  });

  it('escapes double quote (") character', () => {
    const result = buildSearchQuery('error "warning" info');
    expect(result).toBe("error & warning & info");
  });

  it("handles multiple special characters together", () => {
    const result = buildSearchQuery("error!|&* (warning)");
    expect(result).toBe("error & warning");
  });

  it("preserves alphanumeric characters and hyphens", () => {
    const result = buildSearchQuery("error-500 database-connection");
    expect(result).toBe("error-500 & database-connection");
  });

  it("preserves underscores", () => {
    const result = buildSearchQuery("user_id error_message");
    expect(result).toBe("user_id & error_message");
  });

  it("handles real-world example with mixed content", () => {
    const result = buildSearchQuery("Database connection failed! (timeout: 30s)");
    expect(result).toBe("Database & connection & failed & timeout & 30s");
  });
});
