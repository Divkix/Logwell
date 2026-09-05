-- OPERATIONAL WARNING: This migration performs a full rewrite of the "log" table
-- while holding an ACCESS EXCLUSIVE lock. On a large production table this can
-- take a significant amount of time and will block all reads and writes for the
-- duration. Run this migration during a scheduled maintenance window.
-- If a zero-downtime path is required, consider: drop the GENERATED column and
-- replace it with a trigger-maintained column plus a batched backfill (out of
-- scope for this plan).

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
