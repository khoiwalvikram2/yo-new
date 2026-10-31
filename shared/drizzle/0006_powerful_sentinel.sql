ALTER TABLE "roles" ADD COLUMN "is_whitelabel_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "roles_whitelabel_admin_idx" ON "roles" USING btree ("tenant") WHERE is_whitelabel_admin;--> statement-breakpoint
-- Backfill from the name, which is what every existing tenant's administrator
-- role is still called. This is the last time the name decides anything: from
-- here the flag carries the identity, so a later rename cannot take it away.
UPDATE "roles"
SET "is_whitelabel_admin" = true
WHERE lower(btrim("name")) IN ('whitelabel admin', 'wl admin');