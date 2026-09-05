
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "project" LIMIT 1)
     AND NOT EXISTS (SELECT 1 FROM "user" LIMIT 1) THEN
    RAISE EXCEPTION
      'Migration blocked: Projects exist but no users found. Run "bun run db:seed" to create an admin user first, then retry.';
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project' AND column_name = 'owner_id'
  ) THEN
    ALTER TABLE "project" ADD COLUMN "owner_id" text;
  END IF;
END $$;--> statement-breakpoint

UPDATE "project" SET "owner_id" = (
  SELECT "id" FROM "user" ORDER BY "created_at" ASC LIMIT 1
) WHERE "owner_id" IS NULL;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'project'
      AND column_name = 'owner_id'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "project" ALTER COLUMN "owner_id" SET NOT NULL;
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'project_owner_id_user_id_fk'
  ) THEN
    ALTER TABLE "project" ADD CONSTRAINT "project_owner_id_user_id_fk"
      FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_project_owner_id" ON "project" USING btree ("owner_id");
