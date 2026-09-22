import { z } from "zod";

/**
 * A decoded JSON value: the wire shape of a request body before schema parsing.
 *
 * Every ingest boundary receives JSON, so `JsonValue` is the named contract for
 * values that have been decoded but not yet validated against a domain schema.
 */
export const jsonValueSchema = z.json();

/** A decoded JSON object: the wire shape of `metadata` and `resourceAttributes`. */
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export type JsonValue = z.infer<typeof jsonValueSchema>;

export type JsonObject = z.infer<typeof jsonObjectSchema>;
