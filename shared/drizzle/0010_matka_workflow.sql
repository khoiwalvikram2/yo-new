-- Additive Matka trading-date, request idempotency and settlement linkage.
-- Existing market, bet, result and wallet rows are retained.
ALTER TYPE "public"."matka_type" ADD VALUE IF NOT EXISTS 'sattaMatka';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "matka_bet_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant" varchar(128) NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "matka_id" uuid NOT NULL REFERENCES "matkas"("id"),
  "request_key" varchar(128) NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "wallet_type" varchar(16) NOT NULL,
  "total_stake" numeric(18,2) NOT NULL,
  "run_date" date NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "matka_bet_batches_request_unique" ON "matka_bet_batches" ("tenant","user_id","request_key");
--> statement-breakpoint
ALTER TABLE "matka_bets" ADD COLUMN IF NOT EXISTS "run_date" date;
ALTER TABLE "matka_bets" ADD COLUMN IF NOT EXISTS "batch_id" uuid REFERENCES "matka_bet_batches"("id");
ALTER TABLE "matka_bets" ADD COLUMN IF NOT EXISTS "wallet_type" varchar(16) DEFAULT 'cash' NOT NULL;
ALTER TABLE "matka_bets" ADD COLUMN IF NOT EXISTS "settlement_result_id" uuid;
ALTER TABLE "matka_bets" ADD COLUMN IF NOT EXISTS "bonus_award_id" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matka_bets_result_scope_idx" ON "matka_bets" ("tenant","matka_id","run_date","market_session","status");
CREATE INDEX IF NOT EXISTS "matka_bets_batch_idx" ON "matka_bets" ("batch_id");

--> statement-breakpoint
-- Admin actor IDs include numeric user IDs; retain existing UUID actors as text.
ALTER TABLE "matka_worli_instances" ALTER COLUMN "result_actor_id" TYPE varchar(64) USING "result_actor_id"::text;
ALTER TABLE "matka_activity_logs" ALTER COLUMN "actor_id" TYPE varchar(64) USING "actor_id"::text;
