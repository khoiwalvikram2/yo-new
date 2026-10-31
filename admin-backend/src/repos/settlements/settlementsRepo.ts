/**
 * @deprecated PLACEHOLDER — NOT the real settlement system.
 * Computes GGR via computeGgrPlaceholder() (stubbed). Operates on the legacy `settlements`
 * table, unrelated to agentSettlements / agentSettlementTransactions. Do NOT build on this.
 * The real agent settlement logic lives in repos/agents/AgentSettlementsRepo.ts (period settlements)
 * and repos/settlements/AgentSettlementTransactionsRepo.ts (settlement transactions).
 * TODO: remove once the common/resolvers settlement endpoints are migrated or dropped.
 */
import { db } from '@src/db/client.js'
import { settlements } from '@src/db/schema.js'
import { and, eq, gte, lte } from 'drizzle-orm'

export type Settlement = {
	id: number
	tenant: string
	periodStart: string
	periodEnd: string
	ggr: number
	sharePercent: number
	partnerShareAmount: number
	status: 'pending'|'settled'
	settledAt?: string | null
	notes?: string | null
}

function toRow(s: any): Settlement {
	return {
		id: s.id,
		tenant: s.tenant,
		periodStart: s.periodStart as any,
		periodEnd: s.periodEnd as any,
		ggr: Number(s.ggr),
		sharePercent: Number(s.sharePercent),
		partnerShareAmount: Number(s.partnerShareAmount),
		status: (s.status as any) || 'pending',
		settledAt: s.settledAt as any,
		notes: s.notes || null,
	}
}

export async function listSettlements(tenant: string): Promise<Settlement[]> {
	const rows = await db.select().from(settlements).where(eq(settlements.tenant, tenant))
	return rows.map(toRow)
}

// Placeholder GGR: for now, simulate or pull from simple aggregated placeholder
async function computeGgrPlaceholder(tenant: string, start: Date, end: Date): Promise<number> {
	// TODO: replace with real aggregated data source later
	const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 3600 * 1000)))
	return 100000 * days // 100k per day placeholder
}

export async function generateSettlement(tenant: string, start: string, end: string, sharePercent: number, notes?: string): Promise<Settlement> {
	const periodStart = new Date(start)
	const periodEnd = new Date(end)
	const ggr = await computeGgrPlaceholder(tenant, periodStart, periodEnd)
	const partnerShareAmount = ggr * (sharePercent / 100)
	const inserted = await db.insert(settlements).values({
		tenant,
		periodStart,
		periodEnd,
		ggr: String(ggr),
		sharePercent: String(sharePercent),
		partnerShareAmount: String(partnerShareAmount),
		status: 'pending',
		notes: notes || null,
	}).returning()
	return toRow(inserted[0])
}

export async function markSettlementSettled(id: number, tenant: string): Promise<Settlement | null> {
	await db.update(settlements).set({ status: 'settled', settledAt: new Date() }).where(and(eq(settlements.id, id), eq(settlements.tenant, tenant)))
	const rows = await db.select().from(settlements).where(and(eq(settlements.id, id), eq(settlements.tenant, tenant)))
	return rows.length ? toRow(rows[0]) : null
}

export async function exportSettlementsCSV(tenant: string, start?: string, end?: string): Promise<string> {
	let where: any = eq(settlements.tenant, tenant)
	if (start) where = and(where, gte(settlements.periodStart, new Date(start)))
	if (end) where = and(where, lte(settlements.periodEnd, new Date(end)))
	const rows = await db.select().from(settlements).where(where)
	const header = ['id','tenant','periodStart','periodEnd','ggr','sharePercent','partnerShareAmount','status','settledAt','notes'].join(',')
	const lines = rows.map(r => [
		r.id,
		r.tenant,
		r.periodStart?.toISOString?.() || r.periodStart,
		r.periodEnd?.toISOString?.() || r.periodEnd,
		Number(r.ggr),
		Number(r.sharePercent),
		Number(r.partnerShareAmount),
		r.status,
		r.settledAt ? (r.settledAt as any)?.toISOString?.() || r.settledAt : '',
		r.notes || ''
	].join(','))
	return [header, ...lines].join('\n')
}
