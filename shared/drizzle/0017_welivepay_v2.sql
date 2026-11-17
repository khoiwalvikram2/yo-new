-- WeLivePay current merchant API (docs dated 2026-10-10), ported from the gw project's 0092:
-- gateway selection, payout settings, order reconciliation and IMPS payouts. Additive, safe to re-run.
-- On 2026-10-31 no whitelabel here had a merchant key or a single order, so every row takes the
-- current default gateway (Iris) instead of gw's AK Multi carry-over.
ALTER TABLE whitelabel_pg_settings ADD COLUMN IF NOT EXISTS payin_gateway varchar(32) NOT NULL DEFAULT 'IRISPAY';
--> statement-breakpoint
ALTER TABLE whitelabel_pg_settings ADD COLUMN IF NOT EXISTS payout_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE whitelabel_pg_settings ADD COLUMN IF NOT EXISTS payout_gateway varchar(32) NOT NULL DEFAULT 'AUTO';
--> statement-breakpoint
ALTER TABLE whitelabel_pg_settings ADD COLUMN IF NOT EXISTS min_payout numeric(18,2);
--> statement-breakpoint
ALTER TABLE whitelabel_pg_settings ADD COLUMN IF NOT EXISTS max_payout numeric(18,2);
--> statement-breakpoint
ALTER TABLE welivepay_orders ADD COLUMN IF NOT EXISTS gateway varchar(32) NOT NULL DEFAULT 'IRISPAY';
--> statement-breakpoint
ALTER TABLE welivepay_orders ADD COLUMN IF NOT EXISTS next_check_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE welivepay_orders ADD COLUMN IF NOT EXISTS merchant_key_encrypted text;
--> statement-breakpoint
UPDATE welivepay_orders o SET merchant_key_encrypted = s.secret_site_key_encrypted
FROM whitelabel_pg_settings s WHERE o.tenant = s.tenant AND o.merchant_key_encrypted IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS welivepay_orders_reconcile_idx ON welivepay_orders (status, next_check_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS welivepay_payouts (
  id serial PRIMARY KEY,
  tenant varchar(128) NOT NULL,
  withdrawal_request_id integer NOT NULL REFERENCES withdrawal_requests(id),
  orderid varchar(80) NOT NULL,
  gateway varchar(32) NOT NULL DEFAULT 'AUTO',
  merchant_key_encrypted text,
  amount numeric(18,2) NOT NULL,
  request jsonb NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'pending',
  payout_id varchar(128),
  merchant_transaction_id varchar(128),
  utr varchar(128),
  failure_reason text,
  submitted_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS welivepay_payouts_withdrawal_unique ON welivepay_payouts (withdrawal_request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS welivepay_payouts_orderid_unique ON welivepay_payouts (orderid);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS welivepay_payouts_reconcile_idx ON welivepay_payouts (status, next_check_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS welivepay_payouts_tenant_idx ON welivepay_payouts (tenant);
