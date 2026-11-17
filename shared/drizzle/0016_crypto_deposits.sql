-- Crypto (USDT) deposits, ported from the gw project's 0093/0094 and merged with the VIP
-- deposit policy. Additive and safe to re-run.
--
-- drizzle runs every pending migration in ONE transaction, and PostgreSQL forbids using an
-- enum value before the transaction that added it commits. Nothing below may therefore
-- mention 'CRYPTO' as a deposit_method value; the TxID index keys on crypto_amount instead.
ALTER TYPE deposit_method ADD VALUE IF NOT EXISTS 'CRYPTO';
--> statement-breakpoint
-- Whitelabel wallets (jsonb list, like bank_details/upi_details), one USDT rate and one bonus %.
ALTER TABLE whitelabel_payment_methods ADD COLUMN IF NOT EXISTS crypto_details jsonb;
--> statement-breakpoint
ALTER TABLE whitelabel_payment_methods ADD COLUMN IF NOT EXISTS crypto_rate numeric(18,4);
--> statement-breakpoint
ALTER TABLE whitelabel_payment_methods ADD COLUMN IF NOT EXISTS crypto_bonus_percent numeric(5,2);
--> statement-breakpoint
-- What each crypto request was quoted when it was made; a later rate or bonus change never alters it.
ALTER TABLE deposit_requests ADD COLUMN IF NOT EXISTS crypto_amount numeric(24,6);
--> statement-breakpoint
ALTER TABLE deposit_requests ADD COLUMN IF NOT EXISTS crypto_rate numeric(18,4);
--> statement-breakpoint
ALTER TABLE deposit_requests ADD COLUMN IF NOT EXISTS crypto_network varchar(32);
--> statement-breakpoint
ALTER TABLE deposit_requests ADD COLUMN IF NOT EXISTS crypto_bonus_percent numeric(5,2);
--> statement-breakpoint
ALTER TABLE deposit_requests ADD COLUMN IF NOT EXISTS crypto_bonus_amount numeric(18,2);
--> statement-breakpoint
ALTER TABLE deposit_requests ADD COLUMN IF NOT EXISTS bonus_wallet_txn_id integer;
--> statement-breakpoint
-- One on-chain transaction backs at most one live crypto request across the platform. A rejected
-- or cancelled request frees its hash, so a player can resubmit a corrected request.
CREATE UNIQUE INDEX IF NOT EXISTS deposit_requests_crypto_txid_unique
  ON deposit_requests (lower(btrim(utr)))
  WHERE crypto_amount IS NOT NULL AND utr IS NOT NULL AND status IN ('PENDING', 'APPROVED');
--> statement-breakpoint
-- Every stored tier policy offers crypto (owner decision 2026-10-31); admins can untick it per tier.
-- Players still see no wallet until the whitelabel saves a USDT rate.
UPDATE vip_tiers
SET deposit_policy = jsonb_set(deposit_policy, '{methods}', (deposit_policy->'methods') || '["CRYPTO"]'::jsonb),
    updated_at = now()
WHERE jsonb_typeof(deposit_policy->'methods') = 'array'
  AND NOT (deposit_policy->'methods') ? 'CRYPTO';
--> statement-breakpoint
ALTER TABLE vip_tiers ALTER COLUMN deposit_policy
  SET DEFAULT '{"enabled":true,"methods":["BANK_TRANSFER","UPI","GATEWAY","CRYPTO"],"min":null,"max":null,"daily":null,"monthly":null}'::jsonb;
