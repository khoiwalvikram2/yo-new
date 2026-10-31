CREATE TABLE "crm_book_members" (
	"book_id" uuid NOT NULL,
	"crm_user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_book_members_book_id_crm_user_id_pk" PRIMARY KEY("book_id","crm_user_id")
);
--> statement-breakpoint
CREATE TABLE "crm_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_ip_allowlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"crm_user_id" uuid NOT NULL,
	"cidr" varchar(64) NOT NULL,
	"label" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"crm_user_id" uuid,
	"username" varchar(120) NOT NULL,
	"success" boolean NOT NULL,
	"reason" varchar(40),
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_pii_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"crm_user_id" uuid,
	"resource_type" varchar(40) NOT NULL,
	"resource_id" varchar(128) NOT NULL,
	"action" varchar(24) NOT NULL,
	"fields" text[],
	"ip_address" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_player_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"player_id" integer NOT NULL,
	"book_id" uuid NOT NULL,
	"owner_id" uuid,
	"assigned_by" varchar(128),
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_role_permissions" (
	"role_id" uuid NOT NULL,
	"domain" varchar(64) NOT NULL,
	"action" varchar(40) NOT NULL,
	CONSTRAINT "crm_role_permissions_role_id_domain_action_pk" PRIMARY KEY("role_id","domain","action")
);
--> statement-breakpoint
CREATE TABLE "crm_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(255),
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_user_credentials" (
	"crm_user_id" uuid PRIMARY KEY NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"username" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"password_changed_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_user_roles" (
	"crm_user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_user_roles_crm_user_id_role_id_pk" PRIMARY KEY("crm_user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "crm_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(160),
	"phone" varchar(32),
	"status" varchar(24) DEFAULT 'ACTIVE' NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"require_password_reset" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_whitelabel_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant" varchar(128) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"seat_limit" integer DEFAULT 0 NOT NULL,
	"session_idle_minutes" integer DEFAULT 60 NOT NULL,
	"enforce_ip_allowlist" boolean DEFAULT false NOT NULL,
	"updated_by" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_book_members" ADD CONSTRAINT "crm_book_members_book_id_crm_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."crm_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_book_members" ADD CONSTRAINT "crm_book_members_crm_user_id_crm_users_id_fk" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_ip_allowlist" ADD CONSTRAINT "crm_ip_allowlist_crm_user_id_crm_users_id_fk" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_login_attempts" ADD CONSTRAINT "crm_login_attempts_crm_user_id_crm_users_id_fk" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pii_access_log" ADD CONSTRAINT "crm_pii_access_log_crm_user_id_crm_users_id_fk" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_player_assignments" ADD CONSTRAINT "crm_player_assignments_book_id_crm_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."crm_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_player_assignments" ADD CONSTRAINT "crm_player_assignments_owner_id_crm_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."crm_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_role_permissions" ADD CONSTRAINT "crm_role_permissions_role_id_crm_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."crm_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_user_credentials" ADD CONSTRAINT "crm_user_credentials_crm_user_id_crm_users_id_fk" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_user_roles" ADD CONSTRAINT "crm_user_roles_crm_user_id_crm_users_id_fk" FOREIGN KEY ("crm_user_id") REFERENCES "public"."crm_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_user_roles" ADD CONSTRAINT "crm_user_roles_role_id_crm_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."crm_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_book_members_book_idx" ON "crm_book_members" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "crm_book_members_user_idx" ON "crm_book_members" USING btree ("crm_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_books_tenant_name_key" ON "crm_books" USING btree ("tenant",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "crm_ip_allowlist_user_cidr_key" ON "crm_ip_allowlist" USING btree ("crm_user_id","cidr");--> statement-breakpoint
CREATE INDEX "crm_ip_allowlist_tenant_idx" ON "crm_ip_allowlist" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "crm_login_attempts_tenant_created_idx" ON "crm_login_attempts" USING btree ("tenant","created_at");--> statement-breakpoint
CREATE INDEX "crm_login_attempts_user_idx" ON "crm_login_attempts" USING btree ("crm_user_id");--> statement-breakpoint
CREATE INDEX "crm_pii_access_log_tenant_created_idx" ON "crm_pii_access_log" USING btree ("tenant","created_at");--> statement-breakpoint
CREATE INDEX "crm_pii_access_log_user_idx" ON "crm_pii_access_log" USING btree ("crm_user_id");--> statement-breakpoint
CREATE INDEX "crm_pii_access_log_resource_idx" ON "crm_pii_access_log" USING btree ("tenant","resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_player_assignments_tenant_player_key" ON "crm_player_assignments" USING btree ("tenant","player_id");--> statement-breakpoint
CREATE INDEX "crm_player_assignments_book_idx" ON "crm_player_assignments" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "crm_player_assignments_owner_idx" ON "crm_player_assignments" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "crm_player_assignments_tenant_idx" ON "crm_player_assignments" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "crm_role_permissions_role_idx" ON "crm_role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_roles_tenant_name_key" ON "crm_roles" USING btree ("tenant",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "crm_user_credentials_tenant_username_key" ON "crm_user_credentials" USING btree ("tenant",lower("username"));--> statement-breakpoint
CREATE INDEX "crm_user_roles_user_idx" ON "crm_user_roles" USING btree ("crm_user_id");--> statement-breakpoint
CREATE INDEX "crm_user_roles_role_idx" ON "crm_user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "crm_users_tenant_idx" ON "crm_users" USING btree ("tenant");--> statement-breakpoint
CREATE INDEX "crm_users_tenant_status_idx" ON "crm_users" USING btree ("tenant","status");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_whitelabel_settings_tenant_key" ON "crm_whitelabel_settings" USING btree ("tenant");