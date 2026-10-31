import type { Pool, PoolClient } from 'pg'

/** Empty homepage collections: only games explicitly assigned in admin belong here. */
export async function provisionCasinoLounge(pool: Pick<Pool | PoolClient, 'query'>): Promise<number> {
  const result = await pool.query(`
    INSERT INTO casino_categories (tenant_id, main_category, type, name, slug, "order", is_active)
    SELECT tenant.id, main.value::casino_main_category, 'lounge'::casino_category_type,
      'Casino lounge', 'casino-lounge', 90, true
    FROM whitelabels AS tenant
    CROSS JOIN (VALUES ('live_casino'), ('casino'), ('slots')) AS main(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM casino_categories AS existing
      WHERE existing.tenant_id = tenant.id
        AND existing.main_category = main.value::casino_main_category
        AND existing.type = 'lounge'::casino_category_type
    )
    ON CONFLICT (tenant_id, main_category, slug) DO NOTHING
  `)
  return result.rowCount ?? 0
}
