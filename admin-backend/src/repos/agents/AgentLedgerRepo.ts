import { db } from '../../db/client';
import { agentLedger } from '@shared/db/schema.js';
import { and, desc, eq, gt, gte, inArray, lt, lte, sql, sum } from 'drizzle-orm';

export type AgentLedgerLineType = 'COMMISSION' | 'SHARE' | 'ADJUSTMENT' | 'SETTLEMENT';

export interface AddLedgerParams {
	agentId: string;
	domain: 'sports' | 'casino' | 'matka';
	periodFrom: Date;
	periodTo: Date;
	lineType: AgentLedgerLineType;
	amount: number;
	currency: string;
	refKey?: string | null;
	meta?: Record<string, unknown> | null;
}

/**
 * Ledger periods are half-open: a line for [periodFrom, periodTo) overlaps the
 * window [from, to) when periodFrom < to AND periodTo > from.
 *
 * This matters because settlement periods are contiguous. deriveSinceLastPeriod
 * starts the next SHARING period at exactly the previous periodTo, so with closed
 * bounds (periodFrom <= to AND periodTo >= from) the previous period's SHARE and
 * SETTLEMENT lines matched the new window by their shared boundary instant. The
 * second settlement then re-used the old SHARE total, subtracted the old
 * settlement from it, and reported "already fully settled" forever.
 *
 * `list`, `listBatch` and `sumSettlementLinesInPeriod` all use this one rule, and
 * it is the same rule `getEarnedPostedSum` and `getCurrentPeriodTotalsByType`
 * already used.
 */
export function ledgerWindowOverlap(from: Date, to: Date) {
	return and(lt(agentLedger.periodFrom, to), gt(agentLedger.periodTo, from));
}

/** In-memory twin of `ledgerWindowOverlap`, for lines already loaded. */
export function overlapsHalfOpen(
	lineFrom: Date | string,
	lineTo: Date | string,
	from: Date,
	to: Date
): boolean {
	return new Date(lineFrom).getTime() < to.getTime() && new Date(lineTo).getTime() > from.getTime();
}

type WindowedLedgerLine = {
	lineType: string;
	domain?: string | null;
	periodFrom: Date | string;
	periodTo: Date | string;
	createdAt?: Date | string | null;
};

/**
 * The SHARE lines posted for exactly the window [from, to) — same periodFrom and
 * the same periodTo, nothing that merely overlaps it.
 *
 * A SHARING settlement must settle the share of the period it derived. Lines
 * from a neighbouring or an earlier, shorter window (a partially settled period
 * that was later extended, or an attempt that failed before posting) describe a
 * different amount, so they are not reused; the caller computes the window
 * afresh instead.
 *
 * One line per domain: if two attempts raced and both posted a domain for this
 * window, only the newest counts, so the total can never be doubled.
 */
export function shareLinesForExactWindow<T extends WindowedLedgerLine>(lines: T[], from: Date, to: Date): T[] {
	const fromMs = from.getTime();
	const toMs = to.getTime();
	const newestFirst = [...lines].sort(
		(a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
	);
	const byDomain = new Map<string, T>();
	for (const line of newestFirst) {
		if (line.lineType !== 'SHARE') continue;
		if (new Date(line.periodFrom).getTime() !== fromMs) continue;
		if (new Date(line.periodTo).getTime() !== toMs) continue;
		const key = line.domain ?? '';
		if (!byDomain.has(key)) byDomain.set(key, line);
	}
	return [...byDomain.values()];
}

export class AgentLedgerRepo {
	// Returns the inserted row, or undefined if a unique constraint made the insert a no-op.
	// The only unique constraint on agent_ledger is the partial COMMISSION index
	// (agent_ledger_commission_unique), so onConflictDoNothing only ever no-ops a concurrent
	// duplicate COMMISSION accrual — making accrual idempotent without aborting the transaction.
	// Non-COMMISSION lines have no unique constraint, so this never changes their behavior.
	async addLine(params: AddLedgerParams, tx: any = db) {
		const [row] = await tx
			.insert(agentLedger)
			.values({
				agentId: params.agentId,
				domain: params.domain,
				periodFrom: params.periodFrom,
				periodTo: params.periodTo,
				lineType: params.lineType,
				amount: String(params.amount),
				currency: params.currency,
				refKey: params.refKey ?? null,
				meta: (params.meta ?? null) as any,
			})
			.onConflictDoNothing()
			.returning();
		return row;
	}

	/** Sum of COMMISSION line amounts (earnedPosted) for an agent, optionally filtered by period and currency. */
	async getEarnedPostedSum(
		agentId: string,
		options?: { from?: Date; to?: Date; currency?: string }
	): Promise<number> {
		try {
			const conditions = [
				eq(agentLedger.agentId, agentId),
				eq(agentLedger.lineType, 'COMMISSION'),
			];
			// Use half-open overlap to avoid double-counting at exact cycle boundaries.
			if (options?.from != null) conditions.push(gt(agentLedger.periodTo, options.from));
			if (options?.to != null) conditions.push(lt(agentLedger.periodFrom, options.to));
			if (options?.currency != null) conditions.push(eq(agentLedger.currency, options.currency));
			const [row] = await db
				.select({
					total: sql<number>`COALESCE(SUM(CAST(${agentLedger.amount} AS NUMERIC)), 0)`,
				})
				.from(agentLedger)
				.where(and(...conditions));
			const n = Number(row?.total ?? 0);
			return Number.isFinite(n) ? n : 0;
		} catch (err) {
			console.error('[AgentLedgerRepo] getEarnedPostedSum failed:', err instanceof Error ? err.message : err);
			return 0;
		}
	}

	/**
	 * List ledger entries whose period overlaps the half-open window [from, to):
	 * periodFrom < to AND periodTo > from. A line that only touches the window at
	 * its boundary instant belongs to the neighbouring period — see ledgerWindowOverlap.
	 */
	async list(agentId: string, from: Date, to: Date) {
		return db
			.select()
			.from(agentLedger)
			.where(
				and(
					eq(agentLedger.agentId, agentId),
					ledgerWindowOverlap(from, to)
				)
			)
			.orderBy(desc(agentLedger.createdAt));
	}

	/** Batch list ledger entries for multiple agents whose period overlaps [from, to) (half-open, as `list`). */
	async listBatch(agentIds: string[], from: Date, to: Date) {
		if (agentIds.length === 0) return [];
		return db
			.select()
			.from(agentLedger)
			.where(
				and(
					inArray(agentLedger.agentId, agentIds),
					ledgerWindowOverlap(from, to)
				)
			)
			.orderBy(desc(agentLedger.createdAt));
	}

	/** Returns true if a COMMISSION line already exists for this agent/domain/period (idempotent accrual). */
	async existsCommissionLine(
		agentId: string,
		domain: 'sports' | 'casino' | 'matka',
		periodFrom: Date,
		periodTo: Date,
		tx: any = db
	): Promise<boolean> {
		const rows = await tx
			.select({ id: agentLedger.id })
			.from(agentLedger)
			.where(
				and(
					eq(agentLedger.agentId, agentId),
					eq(agentLedger.domain, domain),
					eq(agentLedger.periodFrom, periodFrom),
					eq(agentLedger.periodTo, periodTo),
					eq(agentLedger.lineType, 'COMMISSION')
				)
			)
			.limit(1);
		return rows.length > 0;
	}

	async getAllTimeTotalsByType(agentId: string, lineType: 'SHARE' | 'COMMISSION'): Promise<Array<{domain: string, totalAmount: number}>> {
		if (!agentId || !lineType) {
			return [];
		}

		try {
			const results = await db
				.select({
					domain: agentLedger.domain,
					totalAmount: sql<number>`SUM(CAST(${agentLedger.amount} AS NUMERIC))`,
				})
				.from(agentLedger)
				.where(
					and(
						eq(agentLedger.agentId, agentId),
						eq(agentLedger.lineType, lineType)
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

	async getCurrentPeriodTotalsByType(
		agentId: string,
		lineType: 'SHARE' | 'COMMISSION',
		periodFrom: Date,
		periodTo: Date
	): Promise<Array<{domain: string, totalAmount: number}>> {
		if (!agentId || !lineType || !periodFrom || !periodTo) {
			return [];
		}

		try {
			const results = await db
				.select({
					domain: agentLedger.domain,
					totalAmount: sql<number>`SUM(CAST(${agentLedger.amount} AS NUMERIC))`,
				})
				.from(agentLedger)
				.where(
					and(
						eq(agentLedger.agentId, agentId),
						eq(agentLedger.lineType, lineType),
						// Use half-open overlap to avoid including adjacent periods sharing boundaries.
						lt(agentLedger.periodFrom, periodTo),
						gt(agentLedger.periodTo, periodFrom)
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

	/**
	 * Sum of SETTLEMENT line amounts for an agent in the given period (overlapping
	 * the half-open window [periodFrom, periodTo), as `list`). A settlement of the
	 * previous period ends exactly where this one starts and is not counted here.
	 * Ledger stores: negative when platform pays agent, positive when agent pays platform.
	 * Returns the value to use in pending = -totalShare + sumSettled so that remaining is correct:
	 * e.g. we owe 1400, we paid 1400 (ledger -1400) → sumSettled = +1400 → pending = 0.
	 */
	async sumSettlementLinesInPeriod(agentId: string, periodFrom: Date, periodTo: Date): Promise<number> {
		try {
			const rows = await db
				.select({
					total: sql<number>`COALESCE(SUM(CAST(${agentLedger.amount} AS NUMERIC)), 0)`,
				})
				.from(agentLedger)
				.where(
					and(
						eq(agentLedger.agentId, agentId),
						eq(agentLedger.lineType, 'SETTLEMENT'),
						ledgerWindowOverlap(periodFrom, periodTo)
					)
				);
			const rawSum = Number(rows[0]?.total ?? 0);
			return Number.isFinite(rawSum) ? -rawSum : 0;
		} catch (err) {
			return 0;
		}
	}
}

