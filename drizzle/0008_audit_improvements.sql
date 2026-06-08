-- Audit improvements migration

-- BC-1: Replace btree FTS index with GIN
DROP INDEX IF EXISTS "idx_log_search";
CREATE INDEX "idx_log_search" ON "log" USING gin ("search");

-- BC-8: Drop redundant project_id index (covered by compound indexes)
DROP INDEX IF EXISTS "idx_log_project_id";

-- BC-9: Drop duplicate api_key index (unique constraint index already exists)
DROP INDEX IF EXISTS "idx_project_api_key";

-- BC-16: Make timestamp not-null (safe; defaultNow so no nulls in practice)
-- Backfill any legacy NULL timestamps first so SET NOT NULL cannot fail.
UPDATE "log" SET "timestamp" = NOW() WHERE "timestamp" IS NULL;
ALTER TABLE "log" ALTER COLUMN "timestamp" SET NOT NULL;

-- BU-4: Add api_key_hash column for hashed API key storage
ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "api_key_hash" text NOT NULL DEFAULT '';

-- BU-4: Backfill api_key_hash from existing api_key values using sha256
UPDATE "project" SET "api_key_hash" = encode(sha256(api_key::bytea), 'hex') WHERE "api_key_hash" = '';

-- BU-4: Add unique constraint on api_key_hash
ALTER TABLE "project" ADD CONSTRAINT "project_api_key_hash_unique" UNIQUE ("api_key_hash");
