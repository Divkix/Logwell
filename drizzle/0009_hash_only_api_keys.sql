-- Hash-only API keys: drop the plaintext api_key column.
-- API keys are now stored as SHA-256 hashes only (api_key_hash). The plaintext
-- key is returned to the caller once at creation/regeneration and never persisted.

-- Drop the unique constraint on the plaintext column (created in 0000)
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_api_key_unique";

-- Drop the plaintext api_key column
ALTER TABLE "project" DROP COLUMN IF EXISTS "api_key";

-- api_key_hash is now required on every insert; drop the backfill default from 0008
ALTER TABLE "project" ALTER COLUMN "api_key_hash" DROP DEFAULT;
