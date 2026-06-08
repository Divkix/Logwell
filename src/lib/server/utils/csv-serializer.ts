/**
 * Escapes a field value for CSV format.
 * - Converts null/undefined to empty string
 * - Prefixes fields starting with formula characters (=, +, -, @) with single quote (OWASP CSV injection prevention)
 * - Wraps fields containing commas, quotes, or newlines in double quotes
 * - Escapes double quotes by doubling them
 */
export function escapeCSVField(field: unknown): string {
  if (field === null || field === undefined) {
    return "";
  }

  let value =
    typeof field === "object" && field !== null
      ? JSON.stringify(field)
      : String(field as string | number | boolean | bigint);

  // Prefix formula-starting characters to prevent CSV injection (OWASP)
  // Strip leading whitespace before testing to prevent whitespace bypass
  if (/^[=+\-@]/.test(value.trimStart())) {
    value = `'${value}`;
  }

  // Check if field needs quoting (contains comma, quote, newline, or carriage return)
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    // Escape double quotes by doubling them
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return value;
}
