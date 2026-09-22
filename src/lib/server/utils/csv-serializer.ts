import { z } from "zod";
import type { JsonValue } from "$lib/shared/schemas/json";

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean()]);

export function escapeCSVField(field: JsonValue | undefined): string {
  if (field === null || field === undefined) {
    return "";
  }

  const primitive = jsonPrimitiveSchema.safeParse(field);

  let value = primitive.success ? String(primitive.data) : JSON.stringify(field);

  if (/^[=+\-@]/.test(value.trimStart())) {
    value = `'${value}`;
  }

  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    const escaped = value.replace(/"/g, '""');

    return `"${escaped}"`;
  }

  return value;
}
