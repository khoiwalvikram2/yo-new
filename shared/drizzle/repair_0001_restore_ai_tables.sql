-- Restores the four AI assistant tables, which were dropped from this database
-- by a process outside this session. The statements are copied verbatim from
-- 0000_baseline.sql, so the result is exactly what the baseline would create.
--
-- Guarded with IF NOT EXISTS / DO blocks so re-running it is safe: this is a
-- repair, and a repair that cannot be run twice is a repair you are afraid of.

CREATE TABLE IF NOT EXISTS "ai_action_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"conversation_id" uuid NOT NULL,
	"admin_user_id" integer NOT NULL,
	"tool_name" varchar(128) NOT NULL,
	"args" jsonb NOT NULL,
	"summary" text NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"error" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"admin_user_id" integer NOT NULL,
	"title" varchar(200),
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"tenant" varchar(128) DEFAULT 'default' NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"tool_call_id" varchar(128),
	"tool_name" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_whitelabel_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"chat_limit" integer DEFAULT 0 NOT NULL,
	"limit_period" varchar(16) DEFAULT 'monthly' NOT NULL,
	"updated_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_action_proposals" ADD CONSTRAINT "ai_action_proposals_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_action_proposals_conversation_idx" ON "ai_action_proposals" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_action_proposals_status_idx" ON "ai_action_proposals" USING btree ("tenant","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conversations_tenant_admin_idx" ON "ai_conversations" USING btree ("tenant","admin_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conversations_updated_idx" ON "ai_conversations" USING btree ("updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_messages_conversation_idx" ON "ai_messages" USING btree ("conversation_id","seq");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_whitelabel_settings_tenant_key" ON "ai_whitelabel_settings" USING btree ("tenant");
