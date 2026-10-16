-- IF [NOT] EXISTS so operators of large log tables can run these statements CONCURRENTLY
-- (same index names) before upgrading; this migration then only records them.
-- Create the replacements first, so the planner always has a (project_id, timestamp) index.
CREATE INDEX IF NOT EXISTS "idx_log_project_timestamp_id" ON "log" USING btree ("project_id","timestamp","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_log_project_level_timestamp_id" ON "log" USING btree ("project_id","level","timestamp","id");--> statement-breakpoint
DROP INDEX IF EXISTS "idx_log_project_timestamp";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_log_project_fingerprint_timestamp";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_log_project_service_name";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_log_timestamp";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_log_level";
