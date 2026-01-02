import type { ExportableLog } from '$lib/types/export';

const CSV_HEADERS = [
  'id',
  'timestamp',
  'level',
  'message',
  'metadata',
  'sourceFile',
  'lineNumber',
  'requestId',
  'userId',
  'ipAddress',
] as const;

/**
 * Escapes a field value for CSV format.
 * - Converts null/undefined to empty string
 * - Wraps fields containing commas, quotes, or newlines in double quotes
 * - Escapes double quotes by doubling them
 */
export function escapeCSVField(field: unknown): string {
  if (field === null || field === undefined) {
    return '';
  }

  const value = String(field);

  // Check if field needs quoting (contains comma, quote, or newline)
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    // Escape double quotes by doubling them
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return value;
}

/**
 * Serializes an array of log entries to CSV format.
 * Returns CSV string with headers and properly escaped values.
 */
export function serializeToCsv(logs: ExportableLog[]): string {
  // Create header row
  const headerRow = CSV_HEADERS.join(',');

  if (logs.length === 0) {
    return `${headerRow}\n`;
  }

  // Create data rows
  const dataRows = logs.map((log) => {
    const values = CSV_HEADERS.map((header) => {
      const value = log[header];
      return escapeCSVField(value);
    });
    return values.join(',');
  });

  // Combine header and data rows
  return `${headerRow}\n${dataRows.join('\n')}\n`;
}
