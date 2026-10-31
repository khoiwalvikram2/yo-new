import { db } from '@src/db/client.js'
import { cmsPages } from '@shared/db/schema.js'
import { and, eq } from 'drizzle-orm'

export async function listCmsPagesDb(tenant: string, filters?: { locale?: string; status?: 'DRAFT' | 'PUBLISHED' }) {
	const where = and(
		eq(cmsPages.whitelabelId, tenant),
		filters?.locale ? eq(cmsPages.locale, filters.locale) : undefined as any,
		filters?.status ? eq(cmsPages.status, filters.status) : undefined as any,
	)
	return db.select().from(cmsPages).where(where).execute()
}

export async function getCmsPageByIdDb(tenant: string, id: number) {
	return db.query.cmsPages.findFirst({
		where: and(eq(cmsPages.whitelabelId, tenant), eq(cmsPages.id, id)),
	})
}

export async function getCmsPageBySlugDb(tenant: string, slug: string, locale?: string) {
	return db.query.cmsPages.findFirst({
		where: and(
			eq(cmsPages.whitelabelId, tenant),
			eq(cmsPages.slug, slug),
			locale ? eq(cmsPages.locale, locale) : undefined as any
		),
	})
}

export async function upsertCmsPageDb(tenant: string, input: { id?: number; slug: string; title: string; locale?: string; body?: string; seoTitle?: string; seoDescription?: string }) {
	const locale = input.locale || 'en'
	if (input.id) {
		await db.update(cmsPages)
			.set({
				slug: input.slug,
				title: input.title,
				locale,
				body: input.body,
				seoTitle: input.seoTitle,
				seoDescription: input.seoDescription,
				updatedAt: new Date() as any,
			})
			.where(and(eq(cmsPages.whitelabelId, tenant), eq(cmsPages.id, input.id)))
		return { success: true, id: input.id }
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

export async function publishCmsPageDb(tenant: string, id: number) {
	await db.update(cmsPages)
		.set({ status: 'PUBLISHED', updatedAt: new Date() as any })
		.where(and(eq(cmsPages.whitelabelId, tenant), eq(cmsPages.id, id)))
	return { success: true }
}

export async function deleteCmsPageDb(tenant: string, id: number) {
	await db.delete(cmsPages).where(and(eq(cmsPages.whitelabelId, tenant), eq(cmsPages.id, id)))
	return { success: true }
}

