# Plan 013: Cap the unbounded `COUNT(*)` on the first page of the logs query

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/routes/api/projects/'[id]'/logs/+server.ts src/routes/'(app)'/projects/'[id]'/+page.server.ts src/routes/'(app)'/projects/'[id]'/+page.svelte` — if any changed, compare against the "Current state" excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (independent of plan 012; both touch the logs read path but different statements)
- **Category**: perf
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

On the **first** page of the log viewer (no cursor), both the API endpoint and the `(app)` page loader run an exact `SELECT COUNT(*) FROM log WHERE …`. With filters that aren't covered by an index (e.g. a full-text `search` predicate, or a broad time range), this count scans every matching row. For a project with millions of logs this is the single most expensive query in the read path, runs on every first load and every filter change, and the exact number adds little user value — the UI shows "Showing 100 of 4,213,991 logs". A bounded count ("10,000+") keeps the page responsive while preserving the "is there more?" signal (which `has_more` already provides independently via the limit+1 overflow row).

## Current state

There are **two** call sites with the same unbounded count.

**API** — `src/routes/api/projects/[id]/logs/+server.ts` (around lines 159–162):

```ts
// Skip COUNT(*) when a cursor is provided (subsequent pages); saves a DB round-trip
const total = cursorParam
  ? undefined
  : ((await db.select({ count: count() }).from(log).where(whereClause))[0]?.count ?? 0);
```

Response includes `total: total ?? null`. The endpoint already correctly skips the count on cursor pages — the problem is only the first-page exact count.

**Page loader** — `src/routes/(app)/projects/[id]/+page.server.ts` (around lines 133–135):

```ts
// Get total count
const [countResult] = await db.select({ count: count() }).from(log).where(whereClause);
const total = countResult?.count ?? 0;
```

Note: this loader runs the count **even on cursor pages** (it does not skip like the API does). Returned as `pagination.total`.

**UI consumer** — `src/routes/(app)/projects/[id]/+page.svelte:519-521`:

```svelte
{#if data.pagination.total > 0}
  <div class="text-xs sm:text-sm text-muted-foreground">
    Showing {Math.min(allLogs.length, data.pagination.limit)} of {data.pagination.total} logs
```

**Relevant indexes** (`schema.ts`): `idx_log_project_timestamp` on `(projectId, timestamp)`, `idx_log_search` GIN on `search`, `idx_log_level`, plus composite incident/fingerprint indexes. A count filtered only by `projectId` (+ time) can use an index; a count with a `search` tsvector predicate cannot be satisfied index-only and is the worst case.

**`has_more` is independent of `total`**: it's computed from the `limit + 1` overflow row, so capping/removing the exact count does NOT affect pagination correctness.

## Design decision: bounded count via a capped subquery

Replace the exact count with a count that stops at a ceiling (e.g. `COUNT_CEILING = 10000`):

```sql
SELECT count(*) FROM (SELECT 1 FROM log WHERE <conditions> LIMIT 10000) AS capped
```

Postgres stops scanning after 10,000 matching rows, bounding the work. The API then reports `total` plus a flag indicating the count is a floor. Drizzle expression:

```ts
const COUNT_CEILING = 10_000;
const capped = db
  .select({ one: sql`1` })
  .from(log)
  .where(whereClause)
  .limit(COUNT_CEILING)
  .as("capped");
const [{ c }] = await db.select({ c: count() }).from(capped);
const total = c; // 0..10000
const totalIsCapped = c >= COUNT_CEILING;
```

(Confirm the exact Drizzle subquery-count syntax against the installed drizzle-orm version; if `.as()` subquery counting is awkward, use `sql<number>\`(SELECT count(\*) FROM (SELECT 1 FROM ${log} WHERE ${whereClause} LIMIT ${COUNT_CEILING}) s)\`` as a single scalar.)

The API response gains a field (e.g. `total_is_capped: boolean`) so the UI can render `10,000+`. This is an additive, backward-compatible response change.

## Commands you will need

| Purpose                    | Command                                   | Expected              |
| -------------------------- | ----------------------------------------- | --------------------- |
| Logs API tests             | `bun run test:integration -- logs`        | pass                  |
| Page loader tests (if any) | `bun run test:integration -- page.server` | pass/none             |
| Typecheck                  | `bun run check`                           | exit 0                |
| Lint                       | `vp check`                                | exit 0                |
| E2E (log viewer renders)   | `bun run test:e2e`                        | pass (needs Postgres) |
| Full integration           | `bun run test:integration`                | pass                  |

## Scope

**In scope** (the only files you should modify):

- `src/routes/api/projects/[id]/logs/+server.ts` — capped count + `total_is_capped` in response
- `src/routes/(app)/projects/[id]/+page.server.ts` — same capped count; ALSO skip the count on cursor pages (match the API's existing optimization)
- `src/routes/(app)/projects/[id]/+page.svelte` — render `N+` when capped
- A shared helper for the capped count is encouraged (see Step 1) to avoid drift between the two call sites

**Out of scope** (do NOT touch):

- The cursor/limit/offset pagination logic (the `limit + 1` overflow detection stays).
- The incident count loaders (`incidents/+page.server.ts`, `settings/+page.server.ts`, `stats/+page.server.ts`) — incident/stat counts are over much smaller tables and are out of scope for this perf plan.
- The `.returning()`/SSE concerns (plan 012) and the tsvector write cost (plan 014).
- The `search` index definition.

## Git workflow

- Branch: `advisor/013-cap-log-count`
- Commit message: `perf(logs): bound first-page COUNT with a ceiling and report capped total`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add a shared capped-count helper

The two call sites must behave identically. Add a helper next to the logs query utilities (e.g. in `src/lib/server/utils/` — check where `buildSearchQuery`/`cursor` live and colocate). Signature roughly:

```ts
export const LOG_COUNT_CEILING = 10_000;
export async function cappedLogCount(db, whereClause): Promise<{ total: number; capped: boolean }> {
  const [{ c }] = await db.select({ c: count() }).from(
    db
      .select({ one: sql`1` })
      .from(log)
      .where(whereClause)
      .limit(LOG_COUNT_CEILING)
      .as("capped"),
  );
  return { total: c, capped: c >= LOG_COUNT_CEILING };
}
```

Verify the subquery-count compiles under PGlite (the integration DB). If the nested-select form is problematic, fall back to the raw `sql` scalar form noted in the design section.

**Verify**: `bun run check` → exit 0.

### Step 2: Use it in the API endpoint

Replace the first-page count with the helper; keep the cursor-page skip (`total` stays `undefined` / `null` with a cursor). Add `total_is_capped` to the JSON response (only meaningful on the first page; on cursor pages send `false` or omit consistently with how `total` is handled). Keep `total: total ?? null`.

**Verify**: `bun run test:integration -- logs` → pass. Update any test that asserts an exact `total` for a large fixture (small fixtures < ceiling are unaffected — `total` equals the real count and `capped` is false).

### Step 3: Use it in the page loader (and add the cursor-skip)

In `+page.server.ts`, replace the unbounded count with the helper AND skip the count when `cursorParam` is present (mirror the API: on subsequent pages the total isn't re-rendered meaningfully). Return `pagination.total` and a new `pagination.totalIsCapped`.

**Verify**: `bun run check` → exit 0.

### Step 4: Update the UI string

In `+page.svelte`, when `data.pagination.totalIsCapped` is true render `{data.pagination.total.toLocaleString()}+` (e.g. "10,000+"), otherwise the exact number as today. Keep the `(more available)` hint driven by `hasMore`.

**Verify**: `bun run check` → exit 0; `vp check` → exit 0.

### Step 5: Validate end to end

Run integration + (if Postgres available) E2E to confirm the log viewer still renders counts and pagination works.

**Verify**: `bun run test:integration` → pass; `bun run test:e2e` → pass or documented as environment-blocked.

## Test plan

- Small-fixture tests (< ceiling): `total` equals the exact match count, `total_is_capped`/`totalIsCapped` is `false` — existing logs tests should keep passing with at most additive field assertions.
- Add a test (if feasible without seeding 10k rows): lower the ceiling via the helper's exported constant in a unit test, OR add a focused unit test of `cappedLogCount` with a tiny ceiling against a seeded set proving `capped` flips to `true` and `total` equals the ceiling. Prefer a unit test of the helper to avoid seeding huge data.
- E2E: log viewer first page shows a count; loading more pages still works.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] A shared capped-count helper exists and is used by BOTH the API endpoint and the page loader (no duplicated count logic)
- [ ] `grep -n "count()" src/routes/api/projects/'[id]'/logs/+server.ts src/routes/'(app)'/projects/'[id]'/+page.server.ts` shows the count goes through the helper / capped subquery, not a bare unbounded `select({count: count()}).from(log)`
- [ ] The page loader skips the count on cursor pages (matches the API)
- [ ] API response includes `total_is_capped` (or equivalent) and the UI renders `N+` when capped
- [ ] `has_more`/pagination behavior is unchanged (still driven by `limit + 1`)
- [ ] `bun run test:integration` passes; `bun run check` and `vp check` exit 0
- [ ] `bun run test:e2e` passes (or documented as environment-blocked)
- [ ] Only the in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Either count call site does not match the "Current state" excerpts.
- The Drizzle nested-subquery count does not compile/run under PGlite and the raw-`sql` scalar fallback also fails — report the exact error.
- An existing logs test asserts an exact `total` that the capped form would change for a SMALL fixture (it shouldn't — small fixtures are below the ceiling; if one does, the ceiling logic is wrong — report).
- The UI consumes `total` somewhere else that would misbehave with a capped value (grep `pagination.total` across `src/` first).

## Maintenance notes

- For the reviewer: confirm the ceiling is applied as `LIMIT` INSIDE the subquery (so Postgres can stop scanning), not as a JS `Math.min` after a full count — the latter would not save any work.
- Pick `LOG_COUNT_CEILING` to balance UX vs cost; 10,000 is a reasonable default. Document it next to the constant.
- This pairs conceptually with plan 014 (tsvector): heavy `search`-filtered counts are the worst case; capping bounds their cost regardless.
- If a future feature genuinely needs exact totals (e.g. export), compute it in that path explicitly rather than reverting this cap.
