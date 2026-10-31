import { db } from '../../db/client';
import { agentSettlements, agentWallets, agentSettlementTransactions, agents } from '@shared/db/schema.js';
import { and, between, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';

export type SettlementStatus = 'OPEN' | 'POSTED' | 'LOCKED';

export class AgentSettlementsRepo {
	async open(params: {
		agentId: string;
		periodFrom: Date;
		periodTo: Date;
		totalAmount: number;
		currency: string;
		settledByAgentId?: string | null;
	}, tx: any = db) {
		const amount = Number(params.totalAmount);
		if (!Number.isFinite(amount)) {
			throw new Error(`Invalid settlement totalAmount for agent ${params.agentId}`);
		}
		const [row] = await tx
			.insert(agentSettlements)
			.values({
				agentId: params.agentId,
				periodFrom: params.periodFrom,
				periodTo: params.periodTo,
				totalAmount: String(amount),
				currency: params.currency,
				status: 'OPEN',
				...(params.settledByAgentId != null && { settledByAgentId: params.settledByAgentId }),
			})
			.returning();
		
		// If insert fails silently (should not happen), throw error
		if (!row) {
			throw new Error(`Failed to create settlement record for agent: ${params.agentId}`);
		}
		
		return row;
	}

	async post(params: { settlementId: string; postedBy?: string | null }, tx: any = db) {
		const [row] = await tx
			.update(agentSettlements)
			.set({
				status: 'POSTED',
				postedAt: new Date(),
				postedBy: params.postedBy ?? null,
			})
			.where(eq(agentSettlements.id, params.settlementId))
			.returning();
		
		// If settlement doesn't exist, throw error (should not happen in normal flow)
		if (!row) {
			throw new Error(`Settlement not found: ${params.settlementId}`);
		}
		
		return row;
	}

	async getLastPostedSettlement(agentId: string): Promise<{ periodFrom: Date; periodTo: Date } | null> {
		const rows = await db
			.select({
				periodFrom: agentSettlements.periodFrom,
				periodTo: agentSettlements.periodTo,
			})
			.from(agentSettlements)
			.where(and(eq(agentSettlements.agentId, agentId), eq(agentSettlements.status, 'POSTED')))
			.orderBy(desc(agentSettlements.periodTo))
			.limit(1);
		const row = rows[0];
		if (!row?.periodFrom || !row?.periodTo) return null;
		return {
			periodFrom: row.periodFrom instanceof Date ? row.periodFrom : new Date(row.periodFrom),
			periodTo: row.periodTo instanceof Date ? row.periodTo : new Date(row.periodTo),
		};
	}

	async list(agentId: string, from: Date, to: Date) {
		// Check for overlapping periods:
		// A period overlaps if:
		// - periodFrom is between from and to, OR
		// - periodTo is between from and to, OR
		// - periodFrom <= from AND periodTo >= to (period completely contains the range)
		return db
			.select()
			.from(agentSettlements)
			.where(
				and(
					eq(agentSettlements.agentId, agentId),
					or(
						// Period start is within the check range
						and(
							gte(agentSettlements.periodFrom, from),
							lte(agentSettlements.periodFrom, to)
						),
						// Period end is within the check range
						and(
							gte(agentSettlements.periodTo, from),
							lte(agentSettlements.periodTo, to)
						),
						// Period completely contains the check range
						and(
							lte(agentSettlements.periodFrom, from),
							gte(agentSettlements.periodTo, to)
						)
					)
				)
			)
			.orderBy(desc(agentSettlements.createdAt));
	}

	async listBatch(agentIds: string[], from: Date, to: Date) {
		if (!agentIds.length) return [];
		// Check for overlapping periods:
		// A period overlaps if:
		// - periodFrom is between from and to, OR
		// - periodTo is between from and to, OR
		// - periodFrom <= from AND periodTo >= to (period completely contains the range)
		return db
			.select()
			.from(agentSettlements)
			.where(
				and(
					inArray(agentSettlements.agentId, agentIds),
					or(
						// Period start is within the check range
						and(
							gte(agentSettlements.periodFrom, from),
							lte(agentSettlements.periodFrom, to)
						),
						// Period end is within the check range
						and(
							gte(agentSettlements.periodTo, from),
							lte(agentSettlements.periodTo, to)
						),
						// Period completely contains the check range
						and(
							lte(agentSettlements.periodFrom, from),
							gte(agentSettlements.periodTo, to)
						)
					)
				)
			)
			.orderBy(desc(agentSettlements.createdAt));
	}

	/**
	 * List settlements done by a parent agent (to their sub-agents). Used for "Downline - Settlements I did" history.
	 * Optionally restrict to direct child agentIds and/or date range on createdAt.
	 */
	async listWhereSettledByAgent(
		parentAgentId: string,
		options: { from?: Date; to?: Date; agentIds?: string[] } = {}
	) {
		const conditions = [eq(agentSettlements.settledByAgentId, parentAgentId)];
		if (options.from) {
			conditions.push(gte(agentSettlements.createdAt, options.from));
		}
		if (options.to) {
			conditions.push(lte(agentSettlements.createdAt, options.to));
		}
		if (options.agentIds != null && options.agentIds.length > 0) {
			conditions.push(inArray(agentSettlements.agentId, options.agentIds));
		}
		return db
			.select()
			.from(agentSettlements)
			.where(and(...conditions))
			.orderBy(desc(agentSettlements.createdAt));
	}

	/**
	 * Ensure a wallet exists for the agent and currency; create with zero balance if missing.
	 * Use inside settlement transaction so creditWallet never fails with "wallet not found".
	 */
	async ensureWalletExists(agentId: string, currency: string, tx: any = db) {
		const [existing] = await tx
			.select()
			.from(agentWallets)
			.where(and(eq(agentWallets.agentId, agentId), eq(agentWallets.currency, currency)))
			.limit(1);
		if (existing) return existing;
		const [row] = await tx
			.insert(agentWallets)
			.values({
				agentId,
				currency,
				balance: '0',
				lockedBalance: '0',
			})
			.returning();
		if (!row) {
			throw new Error(`Agent wallet not initialized for agentId: ${agentId}, currency: ${currency}`);
		}
		return row;
	}

	async creditWallet(agentId: string, currency: string, amount: number, tx: any = db) {
		// Ensure wallet exists (auto-create if missing) before updating
		await this.ensureWalletExists(agentId, currency, tx);
		// Support transactions for atomic settlement operations
		const [wallet] = await tx
			.update(agentWallets)
			.set({
				balance: sql`${agentWallets.balance} + ${String(amount)}`,
				updatedAt: new Date(),
			})
			.where(and(eq(agentWallets.agentId, agentId), eq(agentWallets.currency, currency)))
			.returning();
		
		// If wallet doesn't exist after ensure, throw (should not happen)
		if (!wallet) {
			throw new Error(`Agent wallet not initialized for agentId: ${agentId}, currency: ${currency}`);
		}
		
		return wallet;
	}

	/**
	 * Get settlement with notes from agent_settlement_transactions.
	 * Transaction is created in the same flow as the settlement, so match by settlement createdAt window (not period).
	 */
	async getSettlementWithNotes(settlementId: string): Promise<{
		settlement: any;
		notes: string | null;
		postedBy: string | null;
		postedAt: Date | null;
	} | null> {
		const [settlement] = await db
			.select()
			.from(agentSettlements)
			.where(eq(agentSettlements.id, settlementId))
			.limit(1);

		if (!settlement) {
			return null;
		}

		// Tenant from agent (transactions are keyed by tenant)
		const [agentRow] = await db
			.select({ tenantId: agents.tenantId })
			.from(agents)
			.where(eq(agents.id, settlement.agentId))
			.limit(1);
		const tenant = agentRow?.tenantId ?? 'default';

		const settlementCreatedAt = settlement.createdAt instanceof Date ? settlement.createdAt : new Date(settlement.createdAt);
		if (!settlement.createdAt || Number.isNaN(settlementCreatedAt.getTime())) {
			return { settlement, notes: null, postedBy: settlement.postedBy || null, postedAt: settlement.postedAt ? (settlement.postedAt instanceof Date ? settlement.postedAt : new Date(settlement.postedAt)) : null };
		}
		const from = new Date(settlementCreatedAt.getTime() - 30 * 1000);
		const to = new Date(settlementCreatedAt.getTime() + 5 * 60 * 1000);

		const [transaction] = await db
			.select({
				notes: agentSettlementTransactions.notes,
				settledBy: agentSettlementTransactions.settledBy,
				createdAt: agentSettlementTransactions.createdAt,
			})
			.from(agentSettlementTransactions)
			.where(
				and(
					eq(agentSettlementTransactions.tenant, tenant),
					eq(agentSettlementTransactions.agentId, settlement.agentId),
					gte(agentSettlementTransactions.createdAt, from),
					lte(agentSettlementTransactions.createdAt, to)
				)
			)
			.orderBy(agentSettlementTransactions.createdAt)
			.limit(1);

		return {
			settlement,
			notes: transaction?.notes ?? null,
			postedBy: settlement.postedBy || transaction?.settledBy || null,
			postedAt: settlement.postedAt ? (settlement.postedAt instanceof Date ? settlement.postedAt : new Date(settlement.postedAt)) : null,
		};
	}

	/**
	 * Get settlement by ID
	 */
	async getById(settlementId: string): Promise<any | null> {
		const [settlement] = await db
			.select()
			.from(agentSettlements)
			.where(eq(agentSettlements.id, settlementId))
			.limit(1);

		return settlement || null;
	}
}

