import { db } from '@src/db/client.js'
import { cmsPages } from '@shared/db/schema.js'
import { and, eq, notLike } from 'drizzle-orm'
import { PROMOTION_CONTENT_SLUG_PREFIX } from '@src/repos/marketing/promotionsRepo.js'

/*
 * Promotions > Content keeps its blocks in cms_pages under PROMOTION_CONTENT_SLUG_PREFIX (MAR-14),
 * behind promotions.content. This generic CMS page API is gated on config.app / config.cms instead,
 * so it leaves that namespace alone: it lists, reads, edits, publishes and deletes only the other
 * pages, and it cannot create a page in the prefix or move one into it.
 */
const notPromotionContent = () => notLike(cmsPages.slug, `${PROMOTION_CONTENT_SLUG_PREFIX}%`)

function refusePromotionSlug(slug: string) {
	if (slug.startsWith(PROMOTION_CONTENT_SLUG_PREFIX)) {
		throw new Error(`Slugs starting with "${PROMOTION_CONTENT_SLUG_PREFIX}" belong to Promotions > Content`)
	}
}

export async function listCmsPagesDb(tenant: string, filters?: { locale?: string; status?: 'DRAFT' | 'PUBLISHED' }) {
	const where = and(
		eq(cmsPages.whitelabelId, tenant),
		notPromotionContent(),
		filters?.locale ? eq(cmsPages.locale, filters.locale) : undefined as any,
		filters?.status ? eq(cmsPages.status, filters.status) : undefined as any,
	)
	return db.select().from(cmsPages).where(where).execute()
}

export async function getCmsPageByIdDb(tenant: string, id: number) {
	return db.query.cmsPages.findFirst({
		where: and(eq(cmsPages.whitelabelId, tenant), eq(cmsPages.id, id), notPromotionContent()),
	})
}

export async function getCmsPageBySlugDb(tenant: string, slug: string, locale?: string) {
	return db.query.cmsPages.findFirst({
		where: and(
			eq(cmsPages.whitelabelId, tenant),
			eq(cmsPages.slug, slug),
			notPromotionContent(),
			locale ? eq(cmsPages.locale, locale) : undefined as any
		),
	})
}

export async function upsertCmsPageDb(tenant: string, input: { id?: number; slug: string; title: string; locale?: string; body?: string; seoTitle?: string; seoDescription?: string }) {
	const locale = input.locale || 'en'
	refusePromotionSlug(input.slug)
	if (input.id) {
		const updated = await db.update(cmsPages)
			.set({
				slug: input.slug,
				title: input.title,
				locale,
				body: input.body,
				seoTitle: input.seoTitle,
				seoDescription: input.seoDescription,
				updatedAt: new Date() as any,
			})
			.where(and(eq(cmsPages.whitelabelId, tenant), eq(cmsPages.id, input.id), notPromotionContent()))
			.returning({ id: cmsPages.id })
		// Another tenant's page, a missing id or a promotion block changes nothing: say so.
		return { success: updated.length > 0, id: input.id }
	}

	const inserted = await db.insert(cmsPages).values({
		whitelabelId: tenant,
		slug: input.slug,
		title: input.title,
		locale,
		status: 'DRAFT',
		body: input.body,
		seoTitle: input.seoTitle,
		seoDescription: input.seoDescription,
	}).returning({ id: cmsPages.id })
	return { success: true, id: inserted[0]?.id }
}

/** success is whether a page of the tenant was published: another tenant's, a missing id or a promotion block is not. */
export async function publishCmsPageDb(tenant: string, id: number) {
	const published = await db.update(cmsPages)
		.set({ status: 'PUBLISHED', updatedAt: new Date() as any })
		.where(and(eq(cmsPages.whitelabelId, tenant), eq(cmsPages.id, id), notPromotionContent()))
		.returning({ id: cmsPages.id })
	return { success: published.length > 0 }
}

/** success is whether a page of the tenant was deleted (a second delete of the same id is not). */
export async function deleteCmsPageDb(tenant: string, id: number) {
	const deleted = await db.delete(cmsPages)
		.where(and(eq(cmsPages.whitelabelId, tenant), eq(cmsPages.id, id), notPromotionContent()))
		.returning({ id: cmsPages.id })
	return { success: deleted.length > 0 }
}

