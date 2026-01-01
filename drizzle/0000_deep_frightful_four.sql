CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"api_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "project_name_unique" UNIQUE("name"),
	CONSTRAINT "project_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE INDEX "idx_project_api_key" ON "project" USING btree ("api_key");