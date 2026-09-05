
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'project_name_unique'
  ) THEN
    ALTER TABLE "project" DROP CONSTRAINT "project_name_unique";
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'project_name_key'
  ) THEN
    ALTER TABLE "project" DROP CONSTRAINT "project_name_key";
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_name_owner" ON "project" USING btree ("name","owner_id");
