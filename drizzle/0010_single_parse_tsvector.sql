-- Plan 014: Collapse log.search to a single to_tsvector parse
--
-- OPERATIONAL WARNING: This migration performs a full rewrite of the "log" table
-- while holding an ACCESS EXCLUSIVE lock. On a large production table this can
-- take a significant amount of time and will block all reads and writes for the
-- duration. Run this migration during a scheduled maintenance window.
-- If a zero-downtime path is required, consider: drop the GENERATED column and
-- replace it with a trigger-maintained column plus a batched backfill (out of
-- scope for this plan).
--
-- What changed and why:
-- The previous expression called setweight(to_tsvector(...)) five times per row
-- (once per source field, with A/B/C weights). The weights only mattered for
-- ts_rank ordering in searchLogs, which is now removed (plan 005). Every live
-- query uses @@ to_tsquery, which ignores weights. Concatenating all five
-- fields and calling to_tsvector once produces an equivalent lexeme SET for
-- @@ matching at roughly 1/5 the parse cost.
--
-- NOTE: keep this expression in sync with:
--   (1) the generatedAlwaysAs in src/lib/server/db/schema.ts
--   (2) the log_search_trigger() in src/lib/server/db/test-db.ts

-- Dropping the column also drops the idx_log_search GIN index automatically.
ALTER TABLE "log" DROP COLUMN "search";
--> statement-breakpoint

-- Recreate with the single-parse expression. Uses IMMUTABLE || + COALESCE
-- instead of concat_ws (which is only STABLE) so that Postgres accepts the
-- expression in a STORED generated column (requires IMMUTABLE).
ALTER TABLE "log" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (
  to_tsvector('english',
    COALESCE("message", '') || ' ' ||
    COALESCE("body"::text, '') || ' ' ||
    COALESCE("metadata"::text, '') || ' ' ||
    COALESCE("resource_attributes"::text, '') || ' ' ||
    COALESCE("scope_attributes"::text, '')
  )
) STORED;
--> statement-breakpoint

-- Recreate the GIN index for @@ queries.
CREATE INDEX "idx_log_search" ON "log" USING gin ("search");
