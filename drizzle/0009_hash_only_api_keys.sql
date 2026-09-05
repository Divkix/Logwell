
ALTER TABLE "project" DROP CONSTRAINT IF EXISTS "project_api_key_unique";

ALTER TABLE "project" DROP COLUMN IF EXISTS "api_key";

ALTER TABLE "project" ALTER COLUMN "api_key_hash" DROP DEFAULT;
