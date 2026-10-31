-- Player profile: avoid scanning the tenant ledger for one wallet's history.
-- For an existing busy database, apply this index online with
-- shared/scripts/applyPlayerProfileReadIndex.ts before the normal migration run.
CREATE INDEX IF NOT EXISTS "ledger_entries_tenant_wallet_created_idx"
ON "ledger_entries" USING btree ("tenant", "wallet_id", "created_at");
