CREATE TABLE "crm_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"player_id" integer NOT NULL,
	"channel" varchar(16) NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"from_state" varchar(16),
	"to_state" varchar(16) NOT NULL,
	"source" varchar(24) NOT NULL,
	"consent_text_version" varchar(40),
	"evidence_ref" varchar(200),
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"actor_kind" varchar(16) NOT NULL,
	"actor_id" varchar(64),
	"reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_consent_event_actor_kind" CHECK ("crm_consent_events"."actor_kind" in ('crm','admin','player','system')),
	CONSTRAINT "crm_consent_event_evidence" CHECK ("crm_consent_events"."source" not in ('AGENT_VERBAL','IMPORT') or "crm_consent_events"."evidence_ref" is not null)
);
--> statement-breakpoint
CREATE TABLE "crm_contact_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"player_id" integer NOT NULL,
	"task_id" uuid,
	"channel" varchar(16) NOT NULL,
	"direction" varchar(8) DEFAULT 'out' NOT NULL,
	"outcome" varchar(24) NOT NULL,
	"notes" varchar(500),
	"by_crm_user_id" uuid,
	"by_name" varchar(120) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_contact_direction" CHECK ("crm_contact_attempts"."direction" in ('out','in')),
	CONSTRAINT "crm_contact_outcome" CHECK ("crm_contact_attempts"."outcome" in ('connected','no_answer','wrong_number','refused','voicemail','busy'))
);
--> statement-breakpoint
CREATE TABLE "crm_exclusion_register" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"identifier_kind" varchar(16) NOT NULL,
	"identifier_hash" varchar(64) NOT NULL,
	"source_flag_id" uuid NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_exclusion_identifier_kind" CHECK ("crm_exclusion_register"."identifier_kind" in ('phone','email'))
);
--> statement-breakpoint
CREATE TABLE "crm_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"crm_user_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" varchar(500),
	"resource_type" varchar(24),
	"resource_id" varchar(64),
	"dedupe_key" varchar(120),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_player_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"player_id" integer NOT NULL,
	"channel" varchar(16) NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"state" varchar(16) NOT NULL,
	"state_since" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_at" timestamp with time zone,
	"last_asked_at" timestamp with time zone,
	"source" varchar(24) NOT NULL,
	"consent_text_version" varchar(40),
	"evidence_ref" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_consent_channel" CHECK ("crm_player_consents"."channel" in ('SMS','WHATSAPP','EMAIL','PUSH','CALL')),
	CONSTRAINT "crm_consent_purpose" CHECK ("crm_player_consents"."purpose" in ('MARKETING','SERVICE')),
	CONSTRAINT "crm_consent_state" CHECK ("crm_player_consents"."state" in ('GRANTED','WITHDRAWN','REFUSED')),
	CONSTRAINT "crm_consent_source" CHECK ("crm_player_consents"."source" in ('SIGNUP_FORM','PLAYER_PORTAL','AGENT_VERBAL','IMPORT','ADMIN','RG_AUTO'))
);
--> statement-breakpoint
CREATE TABLE "crm_player_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"player_id" integer NOT NULL,
	"body" text NOT NULL,
	"category" varchar(32),
	"labels" text[] DEFAULT '{}' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"visibility" varchar(16) DEFAULT 'all' NOT NULL,
	"author_crm_user_id" uuid,
	"author_admin_user_id" integer,
	"author_name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" varchar(64),
	CONSTRAINT "crm_player_notes_one_author" CHECK (num_nonnulls("crm_player_notes"."author_crm_user_id", "crm_player_notes"."author_admin_user_id") = 1),
	CONSTRAINT "crm_player_notes_visibility" CHECK ("crm_player_notes"."visibility" in ('all','crm_only','admin_only'))
);
--> statement-breakpoint
CREATE TABLE "crm_player_rg_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"player_id" integer NOT NULL,
	"flag_type" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"initiated_by" varchar(16) NOT NULL,
	"blocks_play" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"min_term_ends_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"reinstatement_requested_at" timestamp with time zone,
	"reinstatement_effective_at" timestamp with time zone,
	"balance_at_block" numeric(18, 2),
	"reason" text,
	"raised_by" varchar(64) NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_by" varchar(64),
	"lifted_at" timestamp with time zone,
	"lift_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_rg_flag_type" CHECK ("crm_player_rg_flags"."flag_type" in ('SELF_EXCLUSION','COOLING_OFF','DEPOSIT_ESCALATION','LOSS_CHASING','SESSION_LENGTH','AFFORDABILITY_CONCERN')),
	CONSTRAINT "crm_rg_status" CHECK ("crm_player_rg_flags"."status" in ('ACTIVE','LIFTED','EXPIRED')),
	CONSTRAINT "crm_rg_initiated_by" CHECK ("crm_player_rg_flags"."initiated_by" in ('player','operator')),
	CONSTRAINT "crm_rg_lifted_consistency" CHECK (("crm_player_rg_flags"."status" = 'LIFTED') = ("crm_player_rg_flags"."lifted_at" is not null)),
	CONSTRAINT "crm_rg_self_exclusion_min_term" CHECK ("crm_player_rg_flags"."flag_type" <> 'SELF_EXCLUSION' or "crm_player_rg_flags"."min_term_ends_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "crm_player_tags" (
	"tenant" varchar(128) NOT NULL,
	"player_id" integer NOT NULL,
	"tag_id" uuid NOT NULL,
	"tagged_by" varchar(64) NOT NULL,
	"tagged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_player_tags_player_id_tag_id_pk" PRIMARY KEY("player_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "crm_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"name" varchar(60) NOT NULL,
	"colour" varchar(7) DEFAULT '#6b7280' NOT NULL,
	"description" varchar(255),
	"created_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"merged_into_id" uuid,
	CONSTRAINT "crm_tags_colour_hex" CHECK ("crm_tags"."colour" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "crm_task_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"task_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"crm_user_id" uuid,
	"notified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"actor" varchar(64),
	"from_value" varchar(64),
	"to_value" varchar(64),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"player_id" integer,
	"book_id" uuid NOT NULL,
	"assignee_id" uuid,
	"created_by" varchar(64) NOT NULL,
	"source" varchar(32) DEFAULT 'manual' NOT NULL,
	"dedupe_key" varchar(120),
	"title" varchar(160) NOT NULL,
	"body" text,
	"priority" varchar(8) DEFAULT 'NORMAL' NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"outcome" varchar(24),
	"due_at" timestamp with time zone NOT NULL,
	"sla_minutes" integer NOT NULL,
	"breach_at" timestamp with time zone NOT NULL,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"next_escalation_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_tasks_priority" CHECK ("crm_tasks"."priority" in ('LOW','NORMAL','HIGH','URGENT')),
	CONSTRAINT "crm_tasks_status" CHECK ("crm_tasks"."status" in ('OPEN','IN_PROGRESS','BLOCKED','DONE','CANCELLED')),
	CONSTRAINT "crm_tasks_outcome" CHECK ("crm_tasks"."outcome" is null or "crm_tasks"."outcome" in ('contacted','no_answer','wrong_number','refused','resolved','not_required')),
	CONSTRAINT "crm_tasks_sla_min" CHECK ("crm_tasks"."sla_minutes" >= 5),
	CONSTRAINT "crm_tasks_done_consistency" CHECK (("crm_tasks"."status" = 'DONE') = ("crm_tasks"."completed_at" is not null)),
	CONSTRAINT "crm_tasks_done_outcome" CHECK ("crm_tasks"."status" <> 'DONE' or "crm_tasks"."outcome" is not null),
	CONSTRAINT "crm_tasks_breach_at_derived" CHECK ("crm_tasks"."breach_at" = "crm_tasks"."due_at" + make_interval(mins => "crm_tasks"."sla_minutes"))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rg_blocked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rg_block_reason" varchar(32);--> statement-breakpoint
ALTER TABLE "crm_users" ADD COLUMN "out_of_office_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm_users" ADD COLUMN "delegate_to" uuid;--> statement-breakpoint
ALTER TABLE "crm_whitelabel_settings" ADD COLUMN "timezone" varchar(64) DEFAULT 'Asia/Kolkata' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_whitelabel_settings" ADD COLUMN "desk_open_minute" integer DEFAULT 540 NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_whitelabel_settings" ADD COLUMN "desk_close_minute" integer DEFAULT 1260 NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_whitelabel_settings" ADD COLUMN "desk_days" smallint[] DEFAULT '{1,2,3,4,5,6}' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_contact_attempts" ADD CONSTRAINT "crm_contact_attempts_task_id_crm_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."crm_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contact_attempts" ADD CONSTRAINT "crm_contact_attempts_by_crm_user_id_crm_users_id_fk" FOREIGN KEY ("by_crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_exclusion_register" ADD CONSTRAINT "crm_exclusion_register_source_flag_id_crm_player_rg_flags_id_fk" FOREIGN KEY ("source_flag_id") REFERENCES "public"."crm_player_rg_flags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_notifications" ADD CONSTRAINT "crm_notifications_crm_user_id_crm_users_id_fk" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_player_notes" ADD CONSTRAINT "crm_player_notes_author_crm_user_id_crm_users_id_fk" FOREIGN KEY ("author_crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_player_tags" ADD CONSTRAINT "crm_player_tags_tag_id_crm_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."crm_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_task_escalations" ADD CONSTRAINT "crm_task_escalations_task_id_crm_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."crm_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_task_escalations" ADD CONSTRAINT "crm_task_escalations_crm_user_id_crm_users_id_fk" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_task_events" ADD CONSTRAINT "crm_task_events_task_id_crm_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."crm_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_book_id_crm_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."crm_books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_assignee_id_crm_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."crm_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_acknowledged_by_crm_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."crm_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_consent_events_player_idx" ON "crm_consent_events" USING btree ("tenant","player_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_consent_events_channel_idx" ON "crm_consent_events" USING btree ("tenant","channel","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_contact_attempts_player_idx" ON "crm_contact_attempts" USING btree ("tenant","player_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_contact_attempts_task_idx" ON "crm_contact_attempts" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "crm_contact_attempts_user_idx" ON "crm_contact_attempts" USING btree ("by_crm_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_exclusion_register_live_key" ON "crm_exclusion_register" USING btree ("tenant","identifier_kind","identifier_hash") WHERE released_at is null;--> statement-breakpoint
CREATE INDEX "crm_exclusion_register_flag_idx" ON "crm_exclusion_register" USING btree ("source_flag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_notifications_dedupe_key" ON "crm_notifications" USING btree ("crm_user_id","dedupe_key") WHERE dedupe_key is not null;--> statement-breakpoint
CREATE INDEX "crm_notifications_unread_idx" ON "crm_notifications" USING btree ("crm_user_id","created_at" DESC NULLS LAST) WHERE read_at is null;--> statement-breakpoint
CREATE INDEX "crm_notifications_tenant_idx" ON "crm_notifications" USING btree ("tenant","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_player_consents_key" ON "crm_player_consents" USING btree ("tenant","player_id","channel","purpose");--> statement-breakpoint
CREATE INDEX "crm_player_consents_granted_idx" ON "crm_player_consents" USING btree ("tenant","purpose","channel","player_id") WHERE state = 'GRANTED';--> statement-breakpoint
CREATE INDEX "crm_player_notes_player_idx" ON "crm_player_notes" USING btree ("tenant","player_id","is_pinned" DESC NULLS LAST,"created_at" DESC NULLS LAST) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "crm_player_notes_author_idx" ON "crm_player_notes" USING btree ("author_crm_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_player_rg_flags_active_key" ON "crm_player_rg_flags" USING btree ("tenant","player_id","flag_type") WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "crm_player_rg_flags_player_idx" ON "crm_player_rg_flags" USING btree ("tenant","player_id","starts_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_player_rg_flags_expiry_idx" ON "crm_player_rg_flags" USING btree ("ends_at") WHERE status = 'ACTIVE' and ends_at is not null;--> statement-breakpoint
CREATE INDEX "crm_player_rg_flags_type_idx" ON "crm_player_rg_flags" USING btree ("tenant","flag_type","starts_at" DESC NULLS LAST) WHERE status = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "crm_player_tags_tag_idx" ON "crm_player_tags" USING btree ("tag_id","player_id");--> statement-breakpoint
CREATE INDEX "crm_player_tags_tenant_idx" ON "crm_player_tags" USING btree ("tenant");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_tags_tenant_name_key" ON "crm_tags" USING btree ("tenant",lower("name"));--> statement-breakpoint
CREATE INDEX "crm_tags_live_idx" ON "crm_tags" USING btree ("tenant") WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "crm_tags_merged_into_idx" ON "crm_tags" USING btree ("merged_into_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_task_escalations_key" ON "crm_task_escalations" USING btree ("task_id","level","crm_user_id");--> statement-breakpoint
CREATE INDEX "crm_task_escalations_user_idx" ON "crm_task_escalations" USING btree ("crm_user_id","notified_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_task_events_task_idx" ON "crm_task_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_tasks_dedupe_key" ON "crm_tasks" USING btree ("tenant","dedupe_key") WHERE dedupe_key is not null and status in ('OPEN','IN_PROGRESS','BLOCKED');--> statement-breakpoint
CREATE INDEX "crm_tasks_assignee_open_idx" ON "crm_tasks" USING btree ("assignee_id","due_at") WHERE status in ('OPEN','IN_PROGRESS');--> statement-breakpoint
CREATE INDEX "crm_tasks_book_open_idx" ON "crm_tasks" USING btree ("book_id","due_at") WHERE status in ('OPEN','IN_PROGRESS');--> statement-breakpoint
CREATE INDEX "crm_tasks_player_idx" ON "crm_tasks" USING btree ("tenant","player_id","created_at" DESC NULLS LAST) WHERE player_id is not null;--> statement-breakpoint
CREATE INDEX "crm_tasks_sweep_idx" ON "crm_tasks" USING btree ("next_escalation_at") WHERE acknowledged_at is null and status in ('OPEN','IN_PROGRESS');--> statement-breakpoint
CREATE INDEX "crm_tasks_breach_idx" ON "crm_tasks" USING btree ("breach_at") WHERE escalation_level = 0 and status in ('OPEN','IN_PROGRESS');--> statement-breakpoint
CREATE INDEX "crm_tasks_acknowledged_by_idx" ON "crm_tasks" USING btree ("acknowledged_by");--> statement-breakpoint
CREATE INDEX "users_rg_blocked_idx" ON "users" USING btree ("rg_blocked_until") WHERE rg_blocked_until is not null;--> statement-breakpoint
CREATE INDEX "users_tenant_created_idx" ON "users" USING btree ("tenant","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "crm_users_delegate_idx" ON "crm_users" USING btree ("delegate_to");--> statement-breakpoint
ALTER TABLE "crm_users" ADD CONSTRAINT "crm_users_no_self_delegate" CHECK ("crm_users"."delegate_to" is null or "crm_users"."delegate_to" <> "crm_users"."id");