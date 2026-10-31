CREATE TABLE "crm_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500),
	"filter" jsonb NOT NULL,
	"owner_id" uuid,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_segments" ADD CONSTRAINT "crm_segments_owner_id_crm_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."crm_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_segments_owner_name_key" ON "crm_segments" USING btree ("tenant","owner_id","name");--> statement-breakpoint
CREATE INDEX "crm_segments_tenant_shared_idx" ON "crm_segments" USING btree ("tenant","is_shared");--> statement-breakpoint
CREATE INDEX "crm_segments_owner_idx" ON "crm_segments" USING btree ("owner_id");