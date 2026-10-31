ALTER TABLE whitelabels ADD COLUMN IF NOT EXISTS vip_started_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE vip_tiers ADD COLUMN IF NOT EXISTS deposit_policy jsonb NOT NULL DEFAULT '{"enabled":true,"methods":["BANK_TRANSFER","UPI","GATEWAY"],"min":null,"max":null,"daily":null,"monthly":null}'::jsonb;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN IF NOT EXISTS vip_tier_mode varchar(8) NOT NULL DEFAULT 'AUTO';
--> statement-breakpoint
-- Preserve pre-program assignments, including memberships whose old create path
-- never synchronized users.vip_tier_id. No points or wallet balances are reset.
UPDATE users u SET vip_tier_id = m.tier_id::text, vip_tier_mode = 'MANUAL'
FROM vip_members m JOIN vip_tiers t ON t.id=m.tier_id AND t.tenant=m.tenant
WHERE m.user_id=u.id::text AND m.tenant=u.tenant AND m.status='active'
  AND u.vip_tier_id IS NULL AND u.player_type NOT IN ('AGENT_CREDIT','WHITELABEL_CREDIT');
--> statement-breakpoint
UPDATE users SET vip_tier_mode='MANUAL' WHERE vip_tier_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE deposit_requests ADD COLUMN IF NOT EXISTS receiving_account_id varchar(160);
--> statement-breakpoint
ALTER TABLE deposit_requests ADD COLUMN IF NOT EXISTS vip_policy_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE welivepay_orders ADD COLUMN IF NOT EXISTS vip_policy_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE vip_transactions ADD COLUMN IF NOT EXISTS deposit_request_id integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS vip_transactions_deposit_request_unique ON vip_transactions(deposit_request_id) WHERE deposit_request_id IS NOT NULL;
