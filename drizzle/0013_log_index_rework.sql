-- Large log tables: this migration runs in the migrator's transaction, so its plain CREATE INDEX
-- blocks writes to "log" for the whole build. To avoid that, build the indexes first, outside
-- any transaction, under the same names:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_log_project_timestamp_id" ON "log" ("project_id","timestamp","id");
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_log_project_level_timestamp_id" ON "log" ("project_id","level","timestamp","id");
-- then this migration only records them. A failed or cancelled CONCURRENTLY build leaves an
-- INVALID index behind, which IF NOT EXISTS would skip; the guard below refuses to continue
-- (and so to drop the old index) until it is dropped and rebuilt. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE indrelid = 'log'::regclass AND NOT indisvalid;
DO $$
DECLARE
  invalid_indexes text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO invalid_indexes
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE i.indrelid = 'log'::regclass
    AND NOT i.indisvalid
    AND c.relname IN ('idx_log_project_timestamp_id', 'idx_log_project_level_timestamp_id');

  IF invalid_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'invalid index(es) on "log": % (a CREATE INDEX CONCURRENTLY failed or was cancelled)', invalid_indexes
      USING HINT = 'DROP INDEX CONCURRENTLY each one, rebuild it with CREATE INDEX CONCURRENTLY, then rerun the migration.';
  END IF;
END $$;--> statement-breakpoint
-- Create the replacements first, so the planner always has a (project_id, timestamp) index.
CREATE INDEX IF NOT EXISTS "idx_log_project_timestamp_id" ON "log" USING btree ("project_id","timestamp","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_log_project_level_timestamp_id" ON "log" USING btree ("project_id","level","timestamp","id");--> statement-breakpoint
DROP INDEX IF EXISTS "idx_log_project_timestamp";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_log_project_fingerprint_timestamp";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_log_project_service_name";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_log_timestamp";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_log_level";
