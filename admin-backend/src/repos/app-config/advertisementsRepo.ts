import { db } from '@src/db/client.js'
import { advertisements } from '@shared/db/schema.js'
import { and, eq, desc, asc } from 'drizzle-orm'

export type CreateAdvertisementInput = {
	title: string
	subtitle?: string | null
	imageUrl: string
	type: 'BANNER' | 'PROMOTIONAL' | 'FEATURED'
	url?: string | null
	order?: number | null
	status?: 'ACTIVE' | 'INACTIVE'
	deviceType?: 'DESKTOP' | 'MOBILE' | 'BOTH'
}

export type UpdateAdvertisementInput = {
	title?: string
	subtitle?: string | null
	imageUrl?: string
	type?: 'BANNER' | 'PROMOTIONAL' | 'FEATURED'
	url?: string | null
	order?: number | null
	status?: 'ACTIVE' | 'INACTIVE'
	deviceType?: 'DESKTOP' | 'MOBILE' | 'BOTH'
}

export async function listAdvertisementsDb(tenant: string, filters?: { status?: string }) {
	const conditions = [eq(advertisements.whitelabelId, tenant)]
	if (filters?.status) {
		conditions.push(eq(advertisements.status, filters.status as 'ACTIVE' | 'INACTIVE'))
	}
	const where = and(...conditions)
	const rows = await db.select().from(advertisements).where(where).orderBy(asc(advertisements.order), desc(advertisements.createdAt)).execute()
	return rows.map((r) => ({
		id: String(r.id),
		title: r.title,
		subtitle: r.subtitle,
		imageUrl: r.imageUrl,
		type: r.type,
		url: r.url,
		order: r.order,
		status: r.status,
		deviceType: r.deviceType,
		createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
		updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
	}))
}

export async function getAdvertisementDb(id: number, tenant: string) {
	const row = await db.query.advertisements.findFirst({
		where: and(eq(advertisements.whitelabelId, tenant), eq(advertisements.id, id)),
	})
	if (!row) return null
	return {
		id: String(row.id),
		title: row.title,
		subtitle: row.subtitle,
		imageUrl: row.imageUrl,
		type: row.type,
		url: row.url,
		order: row.order,
		status: row.status,
		deviceType: row.deviceType,
		createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
		updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
	}
}

export async function createAdvertisementDb(tenant: string, input: CreateAdvertisementInput) {
	// Get max order if not provided
	let order = input.order
	if (order === null || order === undefined) {
		const maxOrderRow = await db.select().from(advertisements)
			.where(eq(advertisements.whitelabelId, tenant))
			.orderBy(desc(advertisements.order))
			.limit(1)
			.execute()
		order = maxOrderRow.length > 0 ? (maxOrderRow[0].order + 1) : 0
	}

	const inserted = await db.insert(advertisements).values({
		whitelabelId: tenant,
		title: input.title,
		subtitle: input.subtitle || null,
		imageUrl: input.imageUrl,
		type: input.type,
		url: input.url && input.url.trim() ? input.url.trim() : null,
		order: order,
		status: input.status || 'ACTIVE',
		deviceType: input.deviceType || 'BOTH',
	}).returning({ id: advertisements.id })
	return { success: true, id: inserted[0]?.id }
}

export async function updateAdvertisementDb(id: number, tenant: string, input: UpdateAdvertisementInput) {
	const updateData: any = {
		updatedAt: new Date() as any,
	}
	if (input.title !== undefined) updateData.title = input.title
	if (input.subtitle !== undefined) updateData.subtitle = input.subtitle
	if (input.imageUrl !== undefined && input.imageUrl !== null && input.imageUrl.trim() !== '') {
		updateData.imageUrl = input.imageUrl.trim()
	}
	if (input.type !== undefined) updateData.type = input.type
	if (input.url !== undefined) updateData.url = input.url && input.url.trim() ? input.url.trim() : null
	if (input.order !== undefined && input.order !== null) updateData.order = input.order
	if (input.status !== undefined) updateData.status = input.status
	if (input.deviceType !== undefined) updateData.deviceType = input.deviceType

	// success says whether a row of this tenant matched: an id of another tenant (or none) changes nothing, and
	// used to be answered "Advertisement updated" all the same.
	const rows = await db.update(advertisements)
		.set(updateData)
		.where(and(eq(advertisements.whitelabelId, tenant), eq(advertisements.id, id)))
		.returning({ id: advertisements.id })
	return { success: rows.length > 0, id }
}

export async function deleteAdvertisementDb(id: number, tenant: string) {
	const rows = await db.delete(advertisements)
		.where(and(eq(advertisements.whitelabelId, tenant), eq(advertisements.id, id)))
		.returning({ id: advertisements.id })
	return { success: rows.length > 0 }
}

class AdvertisementNotFound extends Error {}

export async function reorderAdvertisementsDb(tenant: string, orders: { id: number; order: number }[]) {
	// All or nothing, in one transaction: an id that is not one of this tenant's advertisements refuses the
	// whole reorder (it used to be skipped while the answer said "reordered").
	try {
		await db.transaction(async (tx) => {
			for (const { id, order } of orders) {
				const rows = await tx.update(advertisements)
					.set({ order, updatedAt: new Date() as any })
					.where(and(eq(advertisements.whitelabelId, tenant), eq(advertisements.id, id)))
					.returning({ id: advertisements.id })
				if (rows.length === 0) throw new AdvertisementNotFound()
			}
		})
	} catch (error) {
		if (error instanceof AdvertisementNotFound) return { success: false }
		throw error
	}
	return { success: true }
}

