-- CREDIT scheme on Deposit/Withdraw chips; see docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md.
-- Adds an agent's own chip balance and the chip ledger, then converts every CREDIT agent and credit player from the
-- credit-limit model. An agent keeps the chips it had not handed down (credit_limit - credit_used). A player's chips
-- are its credit limit plus its unsettled P/L, minus the casino and matka stakes still open (the cash-wallet path it
-- moves to takes a stake at bet time). credit_limit stays as each account's credit reference; the retired credit
-- figures are zeroed on converted rows. Safe to re-run: an account with an OPENING ledger row is not converted again.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS chip_balance numeric(15,2) NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE chip_movement_kind AS ENUM ('OPENING', 'DEPOSIT', 'WITHDRAW', 'CREDIT_REFERENCE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS credit_chip_ledger (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	tenant_id varchar(128) NOT NULL,
	transfer_id uuid NOT NULL,
	account_type credit_entity_type NOT NULL,
	account_id varchar(128) NOT NULL,
	counterparty_type credit_entity_type,
	counterparty_id varchar(128),
	kind chip_movement_kind NOT NULL,
	amount numeric(18,2) NOT NULL,
	balance_before numeric(18,2) NOT NULL,
	balance_after numeric(18,2) NOT NULL,
	credit_reference_before numeric(18,2),
	credit_reference_after numeric(18,2),
	remark text,
	created_by varchar(128),
	created_by_type varchar(32),
	created_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS credit_chip_ledger_account_idx ON credit_chip_ledger (tenant_id, account_type, account_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS credit_chip_ledger_transfer_idx ON credit_chip_ledger (transfer_id);
--> statement-breakpoint
-- CREDIT agents: the chips not yet handed down become the agent's own balance.
WITH todo AS (
	SELECT a.id, a.tenant_id, COALESCE(a.credit_limit, 0)::numeric(18,2) AS credit_reference,
		GREATEST(0, COALESCE(a.credit_limit, 0) - COALESCE(a.credit_used, 0))::numeric(15,2) AS chips
	FROM agents a
	WHERE a.scheme_type = 'CREDIT'
		AND NOT EXISTS (
			SELECT 1 FROM credit_chip_ledger l
			WHERE l.account_type = 'agent' AND l.account_id = a.id::text AND l.kind = 'OPENING'
		)
), converted AS (
	UPDATE agents a
	SET chip_balance = todo.chips, credit_used = 0, credit_available = 0, settlement_balance = 0,
		settlement_balance_sports = 0, settlement_balance_casino = 0, settlement_balance_matka = 0
	FROM todo
	WHERE a.id = todo.id
	RETURNING a.id
)
INSERT INTO credit_chip_ledger (tenant_id, transfer_id, account_type, account_id, kind, amount, balance_before,
	balance_after, credit_reference_before, credit_reference_after, remark, created_by_type)
SELECT todo.tenant_id, gen_random_uuid(), 'agent', todo.id::text, 'OPENING', todo.chips, 0, todo.chips,
	todo.credit_reference, todo.credit_reference, 'Opening chips: converted from the credit-limit model', 'system'
FROM todo;
--> statement-breakpoint
-- Every credit player needs a cash wallet to hold its chips.
INSERT INTO wallets (tenant, user_id)
SELECT u.tenant, u.id
FROM users u
WHERE u.player_type IN ('AGENT_CREDIT', 'WHITELABEL_CREDIT')
	AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = u.id AND w.tenant = u.tenant);
--> statement-breakpoint
-- Credit players: chips = credit limit + unsettled P/L - open casino and matka credit stakes.
WITH todo AS (
	SELECT u.id, u.tenant, COALESCE(u.credit_limit, 0)::numeric(18,2) AS credit_reference,
		GREATEST(0,
			COALESCE(u.credit_limit, 0) + COALESCE(u.settlement_balance, 0)
			- (SELECT COALESCE(SUM(c.stake), 0) FROM casino_bets c
				WHERE c.user_id = u.id AND c.tenant = u.tenant AND c.status IN ('pending', 'active'))
			- (SELECT COALESCE(SUM(m.bet_amount), 0) FROM matka_bets m
				WHERE m.user_id = u.id AND m.tenant = u.tenant AND m.status IN ('pending', 'active') AND m.wallet_type = 'credit')
		)::numeric(18,2) AS chips
	FROM users u
	WHERE u.player_type IN ('AGENT_CREDIT', 'WHITELABEL_CREDIT')
		AND NOT EXISTS (
			SELECT 1 FROM credit_chip_ledger l
			WHERE l.account_type = 'player' AND l.account_id = u.id::text AND l.kind = 'OPENING'
		)
), funded AS (
	UPDATE wallets w SET cash = todo.chips
	FROM todo
	WHERE w.user_id = todo.id AND w.tenant = todo.tenant
	RETURNING w.user_id
), cleared AS (
	UPDATE users u
	SET credit_used = 0, credit_available = 0, settlement_balance = 0,
		settlement_balance_sports = 0, settlement_balance_casino = 0, settlement_balance_matka = 0
	FROM todo
	WHERE u.id = todo.id
	RETURNING u.id
)
INSERT INTO credit_chip_ledger (tenant_id, transfer_id, account_type, account_id, kind, amount, balance_before,
	balance_after, credit_reference_before, credit_reference_after, remark, created_by_type)
SELECT todo.tenant, gen_random_uuid(), 'player', todo.id::text, 'OPENING', todo.chips, 0, todo.chips,
	todo.credit_reference, todo.credit_reference, 'Opening chips: converted from the credit-limit model', 'system'
FROM todo;
--> statement-breakpoint
-- The agent's per-player credit mirror has no meaning on chips.
UPDATE agent_player_credits
SET current_balance = 0, open_exposure = 0, credit_used = 0, credit_available = 0
WHERE current_balance <> 0 OR open_exposure <> 0 OR credit_used <> 0 OR credit_available <> 0;
