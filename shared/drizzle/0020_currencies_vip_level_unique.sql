-- Two follow-ups from the 2026-11-03 admin panel fixes.
-- 1. The Currency Management page now keeps its currency list on the platform row of app_configs
--    (admin-backend/src/services/currencyStore.ts). Until this column exists every change is refused.
ALTER TABLE "app_configs" ADD COLUMN IF NOT EXISTS "currencies" jsonb;
--> statement-breakpoint
-- 2. One VIP tier per level per tenant. createVIPTier already refuses a used level; the index closes the race
--    between two saves. Checked before writing: no tenant had a duplicate level.
CREATE UNIQUE INDEX IF NOT EXISTS "vip_tiers_tenant_level_unique" ON "vip_tiers" USING btree ("tenant","level");
