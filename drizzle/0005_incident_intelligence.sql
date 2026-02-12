CREATE TABLE "incident" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "fingerprint" text NOT NULL,
  "title" text NOT NULL,
  "normalized_message" text NOT NULL,
  "service_name" text,
  "source_file" text,
  "line_number" integer,
  "highest_level" "log_level" NOT NULL,
  "first_seen" timestamp with time zone NOT NULL,
  "last_seen" timestamp with time zone NOT NULL,
  "total_events" integer DEFAULT 0 NOT NULL,
  "reopen_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "incident" ADD CONSTRAINT "incident_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "incident_id" text;
--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "fingerprint" text;
--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "service_name" text;
--> statement-breakpoint
ALTER TABLE "log" ADD CONSTRAINT "log_incident_id_incident_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incident"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_incident_project_last_seen" ON "incident" USING btree ("project_id","last_seen");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_incident_project_fingerprint" ON "incident" USING btree ("project_id","fingerprint");
--> statement-breakpoint
CREATE INDEX "idx_log_project_incident_timestamp" ON "log" USING btree ("project_id","incident_id","timestamp");
--> statement-breakpoint
CREATE INDEX "idx_log_project_fingerprint_timestamp" ON "log" USING btree ("project_id","fingerprint","timestamp");
--> statement-breakpoint
CREATE INDEX "idx_log_project_service_name" ON "log" USING btree ("project_id","service_name");
