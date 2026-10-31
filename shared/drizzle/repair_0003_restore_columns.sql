-- Restores four columns this database is missing relative to 0000_baseline.sql.
-- They belong to work that predates the reset: the OTP send throttle, and the
-- tenant column on vip_audit. Definitions are copied verbatim from the baseline.
--
-- IF NOT EXISTS throughout, so running this twice does nothing the second time.

ALTER TABLE "user_otps" ADD COLUMN IF NOT EXISTS "last_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "user_otps" ADD COLUMN IF NOT EXISTS "sends_in_window" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_otps" ADD COLUMN IF NOT EXISTS "window_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "vip_audit" ADD COLUMN IF NOT EXISTS "tenant" varchar(64);
