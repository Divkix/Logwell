DROP INDEX "uq_project_name_owner";--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_name_owner" ON "project" USING btree ("name","owner_id") WHERE "project"."deleted_at" IS NULL;