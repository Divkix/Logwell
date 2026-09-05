export function escapeCSVField(field: unknown): string {
  if (field === null || field === undefined) {
    return "";
  }

  let value =
    typeof field === "object" && field !== null
      ? JSON.stringify(field)
      : String(field as string | number | boolean | bigint);

  if (/^[=+\-@]/.test(value.trimStart())) {
    value = `'${value}`;
  }

  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return value;
}
