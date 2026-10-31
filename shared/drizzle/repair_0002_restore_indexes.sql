-- Restores indexes and foreign keys that this database is missing relative to
-- 0000_baseline.sql. It was reset behind an active session to a state that
-- predates the baseline, which among other things left 25 foreign keys without
-- a leading index — a property this platform otherwise holds at zero.
--
-- Every statement is guarded, so running this twice does nothing the second
-- time. Statements are copied verbatim from the baseline.

CREATE INDEX IF NOT EXISTS "vip_audit_tenant_at_idx" ON "vip_audit" USING btree ("tenant","at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vip_member_history_to_tier_id_idx" ON "vip_member_history" USING btree ("to_tier_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vip_member_history_member_id_idx" ON "vip_member_history" USING btree ("member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vip_members_tier_id_idx" ON "vip_members" USING btree ("tier_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vip_members_tenant_user_unique" ON "vip_members" USING btree ("tenant","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vip_tier_benefits_tier_id_idx" ON "vip_tier_benefits" USING btree ("tier_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vip_tier_perks_tier_id_idx" ON "vip_tier_perks" USING btree ("tier_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vip_transactions_member_id_idx" ON "vip_transactions" USING btree ("member_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whitelabel_sharing_config_whitelabel_id_idx" ON "whitelabel_sharing_config" USING btree ("whitelabel_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_settlement_transactions_agent_id_idx" ON "agent_settlement_transactions" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "commission_adjustments_agent_id_idx" ON "commission_adjustments" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "player_credit_adjustments_player_id_idx" ON "player_credit_adjustments" USING btree ("player_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sports_auto_configs_sport_id_idx" ON "sports_auto_configs" USING btree ("sport_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sports_results_runner_id_idx" ON "sports_results" USING btree ("runner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sports_bets_event_id_idx" ON "sports_bets" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "casino_bets_provider_id_idx" ON "casino_bets" USING btree ("provider_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "casino_bets_bonus_award_id_idx" ON "casino_bets" USING btree ("bonus_award_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matka_result_schedules_matka_id_idx" ON "matka_result_schedules" USING btree ("matka_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bonus_awards_campaign_awarded_idx" ON "bonus_awards" USING btree ("campaign_id","awarded_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_commission_config_agent_id_idx" ON "agent_commission_config" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_hierarchy_closure_descendant_id_idx" ON "agent_hierarchy_closure" USING btree ("descendant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_hierarchy_closure_ancestor_id_idx" ON "agent_hierarchy_closure" USING btree ("ancestor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_settlements_settled_by_agent_id_idx" ON "agent_settlements" USING btree ("settled_by_agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sharing_config_agent_id_idx" ON "agent_sharing_config" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_wallets_agent_id_idx" ON "agent_wallets" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_payout_accounts_approved_by_idx" ON "user_payout_accounts" USING btree ("approved_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawal_requests_wallet_id_idx" ON "withdrawal_requests" USING btree ("wallet_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawal_requests_payout_account_id_idx" ON "withdrawal_requests" USING btree ("payout_account_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "casino_provider_vendor_shares" ADD CONSTRAINT "casino_provider_vendor_shares_provider_id_casino_api_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."casino_api_providers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "whitelabel_casino_game_super_admin_override" ADD CONSTRAINT "whitelabel_casino_game_super_admin_override_tenant_id_whitelabels_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."whitelabels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "whitelabel_casino_game_super_admin_override" ADD CONSTRAINT "whitelabel_casino_game_super_admin_override_game_id_casino_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."casino_games"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "whitelabel_casino_provider_settings" ADD CONSTRAINT "whitelabel_casino_provider_settings_provider_id_casino_api_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."casino_api_providers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "whitelabel_casino_vendor_settings" ADD CONSTRAINT "whitelabel_casino_vendor_settings_vendor_id_casino_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."casino_vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "whitelabel_casino_vendor_super_admin_override" ADD CONSTRAINT "whitelabel_casino_vendor_super_admin_override_tenant_id_whitelabels_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."whitelabels"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "whitelabel_casino_vendor_super_admin_override" ADD CONSTRAINT "whitelabel_casino_vendor_super_admin_override_vendor_id_casino_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."casino_vendors"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_payout_account_id_user_payout_accounts_id_fk" FOREIGN KEY ("payout_account_id") REFERENCES "public"."user_payout_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
