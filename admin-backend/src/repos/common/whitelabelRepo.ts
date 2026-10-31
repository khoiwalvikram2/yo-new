import { db } from '@src/db/client.js'
import { whitelabels, whitelabelSharingConfig, agents, agentLedger, whitelabelCasinoGameSettings, casinoGames } from '@shared/db/schema.js'
import { and, eq, desc, sql, between, inArray, or, ilike } from 'drizzle-orm'
import { seedDefaultVipTiers } from '@shared/vip/defaultTiers.js'
import { seedEmptyCasinoLounge } from '@shared/casino/defaultLounge.js'

export type WhitelabelRow = {
	id: string
	name: string
	domain: string
	logoUrl?: string | null
	faviconUrl?: string | null
	// sharePercent removed - use whitelabel_sharing_config table for per-domain rates
	status?: string | null
}

export async function findWhitelabelByDomain(domain: string): Promise<WhitelabelRow | null> {
	const rows = await db.select().from(whitelabels).where(eq(whitelabels.domain, domain))
	return rows[0] as any ?? null
}

export async function getWhitelabelById(id: string): Promise<WhitelabelRow | null> {
	const rows = await db.select().from(whitelabels).where(eq(whitelabels.id, id))
	return rows[0] as any ?? null
}

export async function listWhitelabelsDb(): Promise<WhitelabelRow[]> {
	const rows = await db.select().from(whitelabels)
	return rows as any
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Search whitelabels by name, domain, or id. Returns up to `limit` results. */
export async function searchWhitelabelsDb(query: string, limit: number = 10): Promise<WhitelabelRow[]> {
	const q = query.trim()
	if (q.length < 2) return []
	const pattern = `%${q}%`
	const conditions = [ilike(whitelabels.name, pattern), ilike(whitelabels.domain, pattern)]
	if (UUID_REGEX.test(q) || (q.length <= 64 && !q.includes('%'))) {
		conditions.push(eq(whitelabels.id, q))
	}
	const rows = await db
		.select()
		.from(whitelabels)
		.where(or(...conditions))
		.limit(limit)
	return rows as any
}

/**
 * Copies default tenant's casino game settings to a new whitelabel.
 * Only runs if the whitelabel exists (avoids tenant_id FK violation).
 * Only copies settings for games that still exist in casino_games (avoids game_id FK violation).
 * Uses explicit values for all columns to avoid DEFAULT keyword / serialization issues.
 * Uses onConflictDoNothing to avoid unique constraint errors if run multiple times.
 */
export async function copyDefaultCasinoGameSettingsToWhitelabel(newTenantId: string): Promise<void> {
	const whitelabelExists = await db
		.select({ id: whitelabels.id })
		.from(whitelabels)
		.where(eq(whitelabels.id, newTenantId))
		.limit(1)
	if (whitelabelExists.length === 0) return

	const defaultSettings = await db
		.select({
			gameId: whitelabelCasinoGameSettings.gameId,
			enabled: whitelabelCasinoGameSettings.enabled,
			order: whitelabelCasinoGameSettings.order,
			featured: whitelabelCasinoGameSettings.featured,
			premiumOnly: whitelabelCasinoGameSettings.premiumOnly,
			tags: whitelabelCasinoGameSettings.tags,
			limits: whitelabelCasinoGameSettings.limits,
		})
		.from(whitelabelCasinoGameSettings)
		.innerJoin(casinoGames, eq(casinoGames.id, whitelabelCasinoGameSettings.gameId))
		.where(eq(whitelabelCasinoGameSettings.tenantId, 'default'))

	if (defaultSettings.length === 0) return

	const now = new Date()
	const rows = defaultSettings.map((s) => ({
		tenantId: newTenantId,
		gameId: s.gameId,
		enabled: s.enabled === true,
		premiumOnly: s.premiumOnly === true,
		order: s.order ?? null,
		featured: s.featured ?? false,
		tags: s.tags ?? null,
		limits: s.limits ?? null,
		updatedAt: now,
	}))

	const BATCH_SIZE = 100
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE)
		try {
			await db
				.insert(whitelabelCasinoGameSettings)
				.values(batch)
				.onConflictDoNothing({ target: [whitelabelCasinoGameSettings.tenantId, whitelabelCasinoGameSettings.gameId] })
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err)
			const o = err as { detail?: string; constraint?: string; code?: string }
			const extra = [o.detail, o.constraint ? `constraint: ${o.constraint}` : null, o.code ? `code: ${o.code}` : null].filter(Boolean).join('; ')
			throw new Error(`Copy casino game settings failed (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${msg}${extra ? ` [${extra}]` : ''}`)
		}
	}
}

export async function upsertWhitelabel(row: WhitelabelRow): Promise<WhitelabelRow> {
	const existing = await getWhitelabelById(row.id)
	if (existing) {
		await db.update(whitelabels).set({
			name: row.name,
			domain: row.domain,
			logoUrl: row.logoUrl ?? null,
			faviconUrl: row.faviconUrl ?? null,
			status: row.status ?? 'active',
			updatedAt: new Date(),
		}).where(eq(whitelabels.id, row.id))
		const updated = await getWhitelabelById(row.id)
		return updated!
	}
	await db.transaction(async tx => {
		await tx.insert(whitelabels).values({
			id: row.id,
			name: row.name,
			domain: row.domain,
			logoUrl: row.logoUrl ?? null,
			faviconUrl: row.faviconUrl ?? null,
			status: row.status ?? 'active',
		})
		// Deposits resolve a VIP tier, so a new whitelabel starts on the default ladder.
		await seedDefaultVipTiers(tx, row.id)
		// Homepage collections start empty; assigning games is an explicit admin action.
		await seedEmptyCasinoLounge(tx, row.id)
	})
	const created = await getWhitelabelById(row.id)
	return created!
}

export type WhitelabelDomain = 'sports' | 'casino' | 'matka';

export async function getWhitelabelSharingConfig(
	whitelabelId: string,
	domain: WhitelabelDomain,
	at: Date
): Promise<{ id: string; whitelabelId: string; domain: string; shareRate: string; basis: string } | null> {
	// Get the config for this whitelabel and domain (fixed sharing rates, no date filtering)
	// Since we have unique constraint on (whitelabel_id, domain), there should be only one row
	const rows = await db
		.select({
			id: whitelabelSharingConfig.id,
			whitelabelId: whitelabelSharingConfig.whitelabelId,
			domain: whitelabelSharingConfig.domain,
			shareRate: whitelabelSharingConfig.shareRate,
			basis: whitelabelSharingConfig.basis,
		})
		.from(whitelabelSharingConfig)
		.where(
			and(
				eq(whitelabelSharingConfig.whitelabelId, whitelabelId),
				eq(whitelabelSharingConfig.domain, domain)
			)
		)
		.limit(1);
	
	return rows[0] ?? null;
}

export async function setWhitelabelSharingConfig(params: {
	whitelabelId: string;
	domain: WhitelabelDomain;
	shareRate: number;
	basis?: 'GGR';
}): Promise<{ id: string; whitelabelId: string; domain: string; shareRate: string; basis: string }> {
	// Set sharing config - fixed rates (no date filtering)
	// Use upsert to update if exists, insert if not
	
	// Try to find existing config
	const existing = await db
		.select({ id: whitelabelSharingConfig.id })
		.from(whitelabelSharingConfig)
		.where(
			and(
				eq(whitelabelSharingConfig.whitelabelId, params.whitelabelId),
				eq(whitelabelSharingConfig.domain, params.domain)
			)
		)
		.limit(1);
	
	if (existing.length > 0) {
		// Update existing
		const [row] = await db
			.update(whitelabelSharingConfig)
			.set({
				shareRate: String(params.shareRate),
				basis: params.basis ?? 'GGR',
			})
			.where(eq(whitelabelSharingConfig.id, existing[0].id))
			.returning({
				id: whitelabelSharingConfig.id,
				whitelabelId: whitelabelSharingConfig.whitelabelId,
				domain: whitelabelSharingConfig.domain,
				shareRate: whitelabelSharingConfig.shareRate,
				basis: whitelabelSharingConfig.basis,
			});
		return row;
	} else {
		// Insert new
		const [row] = await db
			.insert(whitelabelSharingConfig)
			.values({
				whitelabelId: params.whitelabelId,
				domain: params.domain,
				shareRate: String(params.shareRate),
				basis: params.basis ?? 'GGR',
			})
			.returning({
				id: whitelabelSharingConfig.id,
				whitelabelId: whitelabelSharingConfig.whitelabelId,
				domain: whitelabelSharingConfig.domain,
				shareRate: whitelabelSharingConfig.shareRate,
				basis: whitelabelSharingConfig.basis,
			});
		return row;
	}

}

export async function getWhitelabelAllTimeSharingTotals(whitelabelId: string): Promise<Array<{domain: string, totalAmount: number}>> {
	if (!whitelabelId) {
		return [];
	}

	try {
		// Get all agent IDs for this whitelabel
		const whitelabelAgents = await db
			.select({ id: agents.id })
			.from(agents)
			.where(eq(agents.tenantId, whitelabelId));

		if (whitelabelAgents.length === 0) {
			return [];
		}

		const agentIds = whitelabelAgents.map(a => a.id).filter(id => id); // Filter out any null/undefined IDs

		// Safety check: ensure we have valid agent IDs before using inArray
		if (agentIds.length === 0) {
			return [];
		}

		// Sum sharing ledger entries for all agents in whitelabel
		const results = await db
			.select({
				domain: agentLedger.domain,
				totalAmount: sql<number>`SUM(CAST(${agentLedger.amount} AS NUMERIC))`,
			})
			.from(agentLedger)
			.where(
				and(
					inArray(agentLedger.agentId, agentIds),
					eq(agentLedger.lineType, 'SHARE')
				)
			)
			.groupBy(agentLedger.domain);

		return results.map(r => ({
			domain: r.domain || '',
			totalAmount: Number(r.totalAmount) || 0,
		}));
	} catch (err) {
		return [];
	}
}

export async function getWhitelabelCurrentPeriodSharingTotals(
	whitelabelId: string,
	periodFrom: Date,
	periodTo: Date
): Promise<Array<{domain: string, totalAmount: number}>> {
	if (!whitelabelId || !periodFrom || !periodTo) {
		return [];
	}

	try {
		// Get all agent IDs for this whitelabel
		const whitelabelAgents = await db
			.select({ id: agents.id })
			.from(agents)
			.where(eq(agents.tenantId, whitelabelId));

		if (whitelabelAgents.length === 0) {
			return [];
		}

		const agentIds = whitelabelAgents.map(a => a.id).filter(id => id); // Filter out any null/undefined IDs

		// Safety check: ensure we have valid agent IDs before using inArray
		if (agentIds.length === 0) {
			return [];
		}

		// Sum sharing ledger entries for current period
		const results = await db
			.select({
				domain: agentLedger.domain,
				totalAmount: sql<number>`SUM(CAST(${agentLedger.amount} AS NUMERIC))`,
			})
			.from(agentLedger)
			.where(
				and(
					inArray(agentLedger.agentId, agentIds),
					eq(agentLedger.lineType, 'SHARE'),
					between(agentLedger.periodFrom, periodFrom, periodTo),
					between(agentLedger.periodTo, periodFrom, periodTo)
				)
			)
			.groupBy(agentLedger.domain);

		return results.map(r => ({
			domain: r.domain || '',
			totalAmount: Number(r.totalAmount) || 0,
		}));
	} catch (err) {
		return [];
	}
}
