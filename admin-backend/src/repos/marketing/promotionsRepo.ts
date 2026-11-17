import { randomUUID } from 'node:crypto'
import { db } from '@src/db/client.js'
import { cmsPages } from '@shared/db/schema.js'

/*
 * What is left of Promotions > Campaigns and Promotions > Content (MAR-02, MAR-14). Both pages and their operations
 * were retired on 2026-11-04 (owner decision); Bonuses and the CMS pages feature are separate and untouched.
 *
 * Their content blocks are rows of `cms_pages` (keyed by whitelabel_id) whose slug sits in the
 * PROMOTION_CONTENT_SLUG_PREFIX namespace. The generic CMS page API (cmsRepo) still leaves that namespace alone, so
 * the blocks already stored never surface among the other pages. Campaign rows stay in `promotions`; no screen or
 * operation reads them any more.
 */

export type PromotionContentRow = typeof cmsPages.$inferSelect

export const PROMOTION_CONTENT_SLUG_PREFIX = 'promotions/'

/**
 * A content block in the prefix namespace, made the way the retired page made them (the slug is generated, never
 * typed). The CMS page tests build their fixture with it.
 */
export async function createPromotionContentDb(
  tenant: string,
  input: { name: string; locale: string; body: string }
): Promise<PromotionContentRow> {
  const [row] = await db
    .insert(cmsPages)
    .values({
      whitelabelId: tenant,
      slug: `${PROMOTION_CONTENT_SLUG_PREFIX}${randomUUID()}`,
      title: input.name,
      locale: input.locale,
      body: input.body,
      status: 'DRAFT',
    })
    .returning()
  return row
}
