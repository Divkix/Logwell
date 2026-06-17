# Plan 014: Collapse the 5-call `search` tsvector into a single `to_tsvector` parse

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 8ec01b0..HEAD -- src/lib/server/db/schema.ts src/lib/server/db/test-db.ts src/lib/server/utils/search.ts drizzle/` — if any changed, compare against the "Current state" excerpts before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: HIGH (schema migration with a full-table rewrite on the largest table; three synchronized definitions)
- **Depends on**: plans/005-fix-knip-config-and-remove-dead-searchlogs.md (MUST land first — it removes `searchLogs`, the only consumer of `ts_rank`/weights; without that removal this change alters ranking behavior)
- **Category**: perf
- **Planned at**: commit `8ec01b0`, 2026-06-17

## Why this matters

The `log.search` column is a `STORED` generated `tsvector` computed on **every insert** as five separate `setweight(to_tsvector('english', …))` calls concatenated (message, body, metadata, resource_attributes, scope_attributes). On the highest-volume write path (log ingestion, up to 100 rows per request) that's five text-search parses per row. The per-field weights (A/B/C) only matter for relevance ranking via `ts_rank` — and the **only** code that ranked by weight is `searchLogs` in `search.ts`, which is dead code removed by plan 005. Every live query uses the `@@` match operator, which ignores weights entirely. So the weights are pure write-time overhead. Concatenating the source fields and calling `to_tsvector` **once** produces an equivalent searchable vector for `@@` matching at roughly 1/5 the parse cost.

## Preconditions (verify BEFORE touching anything)

1. **Plan 005 has landed**: `grep -rn "searchLogs\|ts_rank" src/` returns NOTHING (or only this plan's own references). If `ts_rank` still appears, STOP — collapsing the weights would change that query's ordering. This dependency is hard.
2. Confirm the only live use of `log.search` is the `@@ to_tsquery` predicate in exactly these three files:
   - `src/routes/api/projects/[id]/logs/+server.ts:144`
   - `src/routes/(app)/projects/[id]/+page.server.ts:127`
   - `src/routes/api/projects/[id]/logs/export/+server.ts:136`
     Command: `grep -rn "log.search\|\.search\b" src/ | grep -v node_modules`. If any consumer reads weights or uses `ts_rank`, STOP.

## Current state

The tsvector definition is **duplicated in three places that MUST stay in sync**:

**(1) `src/lib/server/db/schema.ts:122-130`** — the Drizzle generated column:

```ts
search: tsvector("search").generatedAlwaysAs(
  (): SQL =>
    sql`setweight(to_tsvector('english', ${log.message}), 'A') ||
    setweight(to_tsvector('english', COALESCE(${log.body}::text, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(${log.metadata}::text, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(${log.resourceAttributes}::text, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(${log.scopeAttributes}::text, '')), 'C')`,
),
```

**(2) `drizzle/0001_jazzy_the_anarchist.sql:47-51`** — the SQL that created the `STORED` column (historical; a NEW migration will supersede it). The GIN index was later rebuilt in `0008_audit_improvements.sql`.

**(3) `src/lib/server/db/test-db.ts:289-295`** — a PGlite trigger function (`log_search_trigger`) that replicates the same expression, because PGlite doesn't support `GENERATED ALWAYS AS` for this. Integration tests rely on this trigger to populate `search`.

The GIN index `idx_log_search` (`schema.ts:149`) backs the `@@` queries and must survive the migration.

## The change (equivalent vector, one parse)

Replace the five weighted calls with a single `to_tsvector` over the concatenated sources. Use `concat_ws(' ', …)` (or `||` with COALESCE) so NULL fields don't poison the result:

```sql
to_tsvector('english',
  concat_ws(' ',
    message,
    body::text,
    metadata::text,
    resource_attributes::text,
    scope_attributes::text
  )
)
```

`concat_ws` skips NULL arguments, so the explicit `COALESCE(..., '')` per field becomes unnecessary (verify behavior; if you prefer, keep COALESCE for parity). The resulting lexeme SET for `@@` matching is the union of all five fields' lexemes — identical match results to the weighted version, minus the (now unused) A/B/C labels.

## Commands you will need

| Purpose               | Command                                                                                     | Expected                 |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------------------ |
| Generate migration    | `bun run db:generate` (or the project's drizzle-kit generate script — check `package.json`) | new `drizzle/0010_*.sql` |
| Apply migration (dev) | `bun run db:migrate`                                                                        | applies clean            |
| Search-related tests  | `bun run test:integration -- search` and `-- logs`                                          | pass                     |
| Full integration      | `bun run test:integration`                                                                  | pass                     |
| Typecheck             | `bun run check`                                                                             | exit 0                   |
| Lint                  | `vp check`                                                                                  | exit 0                   |
| E2E (search works)    | `bun run test:e2e`                                                                          | pass (needs Postgres)    |

## Scope

**In scope** (the only files you should modify/create):

- `src/lib/server/db/schema.ts` — single-parse generated column
- `src/lib/server/db/test-db.ts` — update the trigger function to match
- A NEW migration file under `drizzle/` (generated, then hand-verified) that drops and recreates the `search` column + GIN index
- The drizzle `meta/` snapshot updates that `db:generate` produces

**Out of scope** (do NOT touch):

- The three `@@ to_tsquery` query sites — they're unaffected (weights were never used there).
- `buildSearchQuery` in `search.ts` (the query builder stays; only the dead `searchLogs` is gone via plan 005).
- The `tsvector` custom column type helper in the db layer.
- Editing historical migrations `0001`/`0008` — never rewrite applied migrations; supersede with a new one.

## Git workflow

- Branch: `advisor/014-tsvector-single-parse`
- Commit message: `perf(db): compute log.search with a single to_tsvector parse`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Re-confirm preconditions

Run the two precondition checks above. If `ts_rank`/`searchLogs` still exist, STOP — plan 005 must merge first.

**Verify**: `grep -rn "ts_rank\|searchLogs" src/` is empty.

### Step 2: Update the generated column in schema.ts

Replace the five-call `generatedAlwaysAs` body with the single `to_tsvector(... concat_ws ...)` expression. Keep the `tsvector("search")` type and the `.generatedAlwaysAs(...)` wrapper and the GIN index definition unchanged.

**Verify**: `bun run check` → exit 0.

### Step 3: Update the PGlite trigger to match

In `src/lib/server/db/test-db.ts`, change `log_search_trigger()` so `NEW.search :=` uses the SAME single-parse expression (with `NEW.` column references). The trigger and the generated column MUST compute identical vectors or integration tests will diverge from production.

**Verify**: `bun run check` → exit 0.

### Step 4: Generate the migration

Run the drizzle generate script. Because a `STORED` generated column's expression cannot be altered in place, the migration must `DROP COLUMN search` (which also drops `idx_log_search`) then `ADD COLUMN search tsvector GENERATED ALWAYS AS (…) STORED` and `CREATE INDEX idx_log_search … USING gin (search)`. Inspect the generated SQL and confirm it does exactly this. If drizzle-kit emits something lossy or wrong, hand-write the migration following the `0001`/`0008` style (with `--> statement-breakpoint` separators).

**CRITICAL operational note to put in the migration as a comment**: `ADD COLUMN … STORED GENERATED` triggers a **full rewrite of the `log` table** to populate the new column for every existing row, holding an `ACCESS EXCLUSIVE` lock. On a large production `log` table this can take a long time and block writes. Document this in the migration and in the plan's "Maintenance notes"; recommend running it during a maintenance window. (No online/zero-downtime path is in scope here — flag it for the operator.)

**Verify**: the new `drizzle/00XX_*.sql` exists and contains DROP COLUMN + ADD COLUMN (generated, single parse) + CREATE INDEX gin. `meta/` snapshot updated.

### Step 5: Apply and test

Apply the migration to a dev database, then run the search + logs integration tests and (if Postgres available) E2E search.

**Verify**:

- `bun run db:migrate` applies cleanly.
- `bun run test:integration -- search` and `-- logs` pass — these prove `@@` matching still finds logs by message/body/metadata content.
- Add/confirm a test that inserts a log whose searchable term is ONLY in `metadata` or `scope_attributes` and asserts it's found by `@@` search — this proves the concatenation still indexes all five fields (the whole point).
- `bun run test:integration` → all pass.

### Step 6: Full validation

**Verify**: `bun run check` → 0; `vp check` → 0; `bun run test:e2e` → pass or documented as environment-blocked.

## Test plan

- Confirm `@@` search still matches terms located in each of the five source fields (message, body, metadata, resource_attributes, scope_attributes) — add a focused integration test per field if not already covered, since the equivalence of the collapsed vector is the core risk.
- Confirm the PGlite trigger and the Postgres generated column produce matching search results for the same input (integration tests run on PGlite; E2E on real Postgres — both must find the same logs).
- No test should assert weight/rank ordering (those were removed with `searchLogs`).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "ts_rank\|searchLogs" src/` is empty (plan 005 precondition holds)
- [ ] `schema.ts` `search` column uses a SINGLE `to_tsvector(...)` (no `setweight`, no 5 calls): `grep -c "to_tsvector" src/lib/server/db/schema.ts` returns 1
- [ ] `test-db.ts` trigger uses the SAME single-parse expression: `grep -c "to_tsvector" src/lib/server/db/test-db.ts` returns 1
- [ ] A new `drizzle/00XX_*.sql` migration drops+recreates `search` and the `idx_log_search` GIN index, with a comment documenting the table-rewrite/lock cost
- [ ] Integration tests prove `@@` search still matches content in all five source fields
- [ ] `bun run test:integration` passes; `bun run check` and `vp check` exit 0
- [ ] `bun run test:e2e` passes (or documented as environment-blocked)
- [ ] No historical migration was edited (`git status` shows only a NEW migration + meta snapshot)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `ts_rank`/`searchLogs` still exist (plan 005 not merged) — hard dependency.
- The generated-column expression, the `0001` migration, or the test-db trigger do not match the "Current state" excerpts.
- `db:generate` produces a migration that ALTERs the column in place (Postgres can't) or fails to recreate the GIN index — hand-write per the style guide and report what the generator did.
- An integration test shows a term present only in `metadata`/`resource_attributes`/`scope_attributes` is NO LONGER found after the change — the concatenation is wrong; report (do not ship a search regression).
- The PGlite trigger and the real-Postgres generated column diverge (integration vs E2E disagree on a search result).

## Maintenance notes

- For the reviewer: the three definitions (schema generated column, migration SQL, PGlite trigger) MUST stay identical. Consider a comment in each pointing at the other two. The core correctness question is "does `@@` matching return the same rows?" — not byte-equality of the tsvector.
- **Operational**: the migration rewrites the entire `log` table under an exclusive lock. For large deployments, the operator should run it in a maintenance window. If that's unacceptable, an alternative (out of scope) is a non-generated column maintained by a trigger plus a backfill in batches — note this option but do not build it here.
- If a future feature reintroduces relevance ranking, it must re-add weights to ALL THREE definitions and re-add a `ts_rank` order-by; that's a deliberate reversal of this plan, not a regression.
- `concat_ws` skips NULLs natively; if you kept per-field COALESCE for parity, that's fine but redundant.
