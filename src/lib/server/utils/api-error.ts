const UNIQUE_VIOLATION_SQLSTATE = "23505";

const MAX_CAUSE_DEPTH = 8;

/**
 * Detects a Postgres unique-constraint violation (SQLSTATE 23505).
 *
 * The driver error is wrapped by the ORM (`DrizzleQueryError`), whose own `code`
 * is undefined, so the SQLSTATE lives further down the `cause` chain.
 * With `constraint`, only that index/constraint counts, so unrelated collisions
 * (e.g. the `api_key_hash` unique constraint) are not reported as a duplicate name.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current !== "object" || current === null) return false;

    if ("code" in current && current.code === UNIQUE_VIOLATION_SQLSTATE) {
      if (constraint === undefined) return true;

      const named =
        ("constraint" in current && current.constraint === constraint) ||
        ("constraint_name" in current && current.constraint_name === constraint);

      if (named) return true;
    }

    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}

export function apiError(status: number, error: string, message?: string): Response {
  return new Response(JSON.stringify({ error, ...(message ? { message } : {}) }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
