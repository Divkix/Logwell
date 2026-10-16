import { z } from "zod";

const UNIQUE_VIOLATION_SQLSTATE = "23505";

const QUERY_CANCELED_SQLSTATE = "57014";

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
 * Walks the driver error's `cause` chain for a node carrying `sqlState` that also
 * satisfies `matches`.
 *
 * The driver error is wrapped by the ORM (`DrizzleQueryError`), whose own `code` is
 * undefined, so the SQLSTATE lives further down its `cause` chain.
 */
function hasSqlState(
  cause: unknown,
  sqlState: string,
  matches: (node: z.infer<typeof errorCauseNodeSchema>) => boolean = () => true,
): boolean {
  let current: unknown = cause;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    // The driver wraps errors as plain objects whose `code`, `constraint` and
    // `cause` fields are all optional; a non-object node ends the walk here.
    const decoded = errorCauseNodeSchema.safeParse(current);

    if (!decoded.success) return false;

    if (decoded.data.code === sqlState && matches(decoded.data)) return true;

    current = decoded.data.cause;
  }

  return false;
}

/**
 * Detects a Postgres unique-constraint violation (SQLSTATE 23505).
 *
 * With `constraint`, only that index/constraint counts, so unrelated collisions
 * (e.g. the `api_key_hash` unique constraint) are not reported as a duplicate name.
 */
export function isUniqueViolation(cause: unknown, constraint?: string): boolean {
  return hasSqlState(
    cause,
    UNIQUE_VIOLATION_SQLSTATE,
    (node) =>
      constraint === undefined ||
      node.constraint === constraint ||
      node.constraint_name === constraint,
  );
}

/**
 * Detects a statement Postgres cancelled (SQLSTATE 57014 query_canceled) — in practice the
 * pool's statement_timeout firing on a query that ran too long.
 */
export function isQueryCanceled(cause: unknown): boolean {
  return hasSqlState(cause, QUERY_CANCELED_SQLSTATE);
}

export function apiError(status: number, error: string, message?: string): Response {
  return new Response(JSON.stringify(message ? { error, message } : { error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
