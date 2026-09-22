import { z } from "zod";

const UNIQUE_VIOLATION_SQLSTATE = "23505";

const MAX_CAUSE_DEPTH = 8;

// Fields are optional because only some nodes in the cause chain carry them
// (the ORM wrapper's own `code` is undefined, the driver node holds it).
const errorCauseNodeSchema = z.object({
  code: z.unknown().optional(),
  constraint: z.unknown().optional(),
  constraint_name: z.unknown().optional(),
  cause: z.unknown().optional(),
});

/**
 * Detects a Postgres unique-constraint violation (SQLSTATE 23505).
 *
 * `cause` is the thrown driver error: the driver wraps it in the ORM
 * (`DrizzleQueryError`), whose own `code` is undefined, so the SQLSTATE lives
 * further down its `cause` chain.
 * With `constraint`, only that index/constraint counts, so unrelated collisions
 * (e.g. the `api_key_hash` unique constraint) are not reported as a duplicate name.
 */
export function isUniqueViolation(cause: unknown, constraint?: string): boolean {
  let current: unknown = cause;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    // The driver wraps errors as plain objects whose `code`, `constraint` and
    // `cause` fields are all optional; a non-object node ends the walk here.
    const decoded = errorCauseNodeSchema.safeParse(current);

    if (!decoded.success) return false;

    if (decoded.data.code === UNIQUE_VIOLATION_SQLSTATE) {
      if (constraint === undefined) return true;

      const named =
        decoded.data.constraint === constraint || decoded.data.constraint_name === constraint;

      if (named) return true;
    }

    current = decoded.data.cause;
  }

  return false;
}

export function apiError(status: number, error: string, message?: string): Response {
  return new Response(JSON.stringify(message ? { error, message } : { error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
