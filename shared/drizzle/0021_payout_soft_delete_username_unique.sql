ALTER TABLE "user_payout_accounts" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenant_username_ci_unique" ON "users" USING btree ("tenant", lower(btrim("username"))) WHERE "username" IS NOT NULL AND btrim("username") <> '';
