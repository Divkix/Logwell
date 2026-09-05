
DROP INDEX IF EXISTS "idx_log_search";
CREATE INDEX "idx_log_search" ON "log" USING gin ("search");

DROP INDEX IF EXISTS "idx_log_project_id";

DROP INDEX IF EXISTS "idx_project_api_key";

UPDATE "log" SET "timestamp" = NOW() WHERE "timestamp" IS NULL;
ALTER TABLE "log" ALTER COLUMN "timestamp" SET NOT NULL;

ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "api_key_hash" text NOT NULL DEFAULT '';

UPDATE "project" SET "api_key_hash" = encode(sha256(api_key::bytea), 'hex') WHERE "api_key_hash" = '';

ALTER TABLE "project" ADD CONSTRAINT "project_api_key_hash_unique" UNIQUE ("api_key_hash");
