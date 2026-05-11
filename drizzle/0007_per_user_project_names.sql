-- Migration: Change project name uniqueness from global to per-owner
-- This fixes a security issue where the duplicate_name error allowed
-- enumerating other users' project names and enabled name squatting.

-- Step 1: Drop global unique constraint on project name (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'project_name_unique'
  ) THEN
    ALTER TABLE "project" DROP CONSTRAINT "project_name_unique";
  END IF;
END $$;--> statement-breakpoint

-- Also drop the auto-generated unique constraint name if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'project_name_key'
  ) THEN
    ALTER TABLE "project" DROP CONSTRAINT "project_name_key";
  END IF;
END $$;--> statement-breakpoint

-- Step 2: Create composite unique index on (name, owner_id) (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_name_owner" ON "project" USING btree ("name","owner_id");