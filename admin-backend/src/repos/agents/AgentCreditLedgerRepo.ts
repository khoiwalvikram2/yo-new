import { db } from '../../db/client';
import {
	agentCreditLedger,
	creditTransactionTypeEnum,
	creditEntityTypeEnum,
} from '@shared/db/schema.js';
import { eq, and, gte, lte, inArray, desc, or } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export type CreditTransactionType =
	| 'ALLOCATION'
	| 'DEPOSIT'
	| 'WITHDRAWAL'
	| 'TRANSFER'
	| 'USAGE'
	| 'RELEASE'
	| 'ADJUSTMENT'
	| 'CREDIT_LIMIT_ADJUSTMENT'
	| 'CREDIT_USED_INCREASE'
	| 'CREDIT_USED_DECREASE';

export type CreditEntityType = 'agent' | 'player' | 'whitelabel';

export interface CreditTransaction {
	id: string;
	tenantId: string;
	fromEntityType: CreditEntityType;
	fromEntityId: string;
	toEntityType: CreditEntityType;
	toEntityId: string;
	transactionType: CreditTransactionType;
	amount: number;
	currency: string;
	balanceBefore: number;
	balanceAfter: number;
	reason: string | null;
	meta: any;
	createdBy: string | null;
	betId: string | null;
	settlementId: string | null;
	cashoutId: string | null;
	createdByType: string | null;
	metadata: any;
	createdAt: Date;
}

export interface CreditTransactionInput {
	tenantId: string;
	fromEntityType: CreditEntityType;
	fromEntityId: string;
	toEntityType: CreditEntityType;
	toEntityId: string;
	transactionType: CreditTransactionType;
	amount: number;
	currency?: string;
	balanceBefore: number;
	balanceAfter: number;
	reason?: string;
	meta?: any;
	createdBy?: string;
	betId?: string;
	settlementId?: string;
	cashoutId?: string;
	createdByType?: 'system' | 'admin' | 'agent';
	metadata?: any;
}

export class AgentCreditLedgerRepo {
  async countTransactionsByEntity(params: { entityType: CreditEntityType; entityId: string; tenantId: string }): Promise<number> {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(agentCreditLedger).where(and(
      eq(agentCreditLedger.tenantId, params.tenantId),
      or(and(eq(agentCreditLedger.toEntityType, params.entityType), eq(agentCreditLedger.toEntityId, params.entityId)),
        and(eq(agentCreditLedger.fromEntityType, params.entityType), eq(agentCreditLedger.fromEntityId, params.entityId),
          sql`${agentCreditLedger.transactionType} not in ('CREDIT_LIMIT_ADJUSTMENT','RELEASE')`)),
    ))
    return row?.count ?? 0
  }
	/**
	 * Record a credit transaction.
	 * Pass optional tx to run inside an existing transaction (e.g. reversal).
	 */
	async recordTransaction(input: CreditTransactionInput, tx?: any): Promise<CreditTransaction> {
		const ctx = tx ?? db;
		// Try inserting with all columns first (if migration 0024 is applied)
		// If that fails due to missing columns, fall back to basic insert
		try {
			const [transaction] = await ctx
				.insert(agentCreditLedger)
				.values({
					tenantId: input.tenantId,
					fromEntityType: input.fromEntityType,
					fromEntityId: input.fromEntityId,
					toEntityType: input.toEntityType,
					toEntityId: input.toEntityId,
					transactionType: input.transactionType,
					amount: input.amount.toString(),
					currency: input.currency || 'INR',
					balanceBefore: input.balanceBefore.toString(),
					balanceAfter: input.balanceAfter.toString(),
					reason: input.reason || null,
					meta: input.meta || null,
					createdBy: input.createdBy || null,
					betId: input.betId || null,
					settlementId: input.settlementId || null,
					cashoutId: input.cashoutId || null,
					createdByType: input.createdByType || null,
					metadata: input.metadata || null,
				})
				.returning();

			return this.mapToCreditTransaction(transaction);
		} catch (error: any) {
			// If error is about missing columns (bet_id, settlement_id, etc), use raw SQL fallback
			// Check both the error code and the cause (Drizzle wraps PostgreSQL errors)
			const errorCode = error?.code || error?.cause?.code;
			const errorMessage = error?.message || error?.cause?.message || '';
			
			if (errorCode === '42703' && (errorMessage.includes('bet_id') || errorMessage.includes('column') && errorMessage.includes('does not exist'))) {
				// Migration 0024 not applied - use raw SQL with only existing columns
				const result = await (ctx as any).execute(sql`
					INSERT INTO agent_credit_ledger (
						tenant_id, from_entity_type, from_entity_id, to_entity_type, to_entity_id,
						transaction_type, amount, currency, balance_before, balance_after,
						reason, meta, created_by, created_at
					) VALUES (
						${input.tenantId}, ${input.fromEntityType}, ${input.fromEntityId},
						${input.toEntityType}, ${input.toEntityId}, ${input.transactionType},
						${input.amount.toString()}, ${input.currency || 'INR'},
						${input.balanceBefore.toString()}, ${input.balanceAfter.toString()},
						${input.reason || null}, ${input.meta ? JSON.stringify(input.meta) : null},
						${input.createdBy || null}, NOW()
					) RETURNING *
				`);
				const row = (result as any).rows?.[0] || (result as any)[0];
				return this.mapToCreditTransaction(row);
			}
			// Re-throw if it's a different error
			throw error;
		}
	}

	/**
	 * Get transaction history with filters
	 */
	async getTransactionHistory(params: {
		entityType: CreditEntityType;
		entityId: string;
		transactionTypes?: CreditTransactionType[];
		from?: Date;
		to?: Date;
		limit?: number;
		tenantId?: string;
	}): Promise<CreditTransaction[]> {
		const conditions = [
			or(
				and(
					eq(agentCreditLedger.fromEntityType, params.entityType),
					eq(agentCreditLedger.fromEntityId, params.entityId)
				),
				and(
					eq(agentCreditLedger.toEntityType, params.entityType),
					eq(agentCreditLedger.toEntityId, params.entityId)
				)
			),
		];

		// CRITICAL: Filter by tenantId if provided for data isolation
		if (params.tenantId) {
			conditions.push(eq(agentCreditLedger.tenantId, params.tenantId));
		}

		if (params.transactionTypes && params.transactionTypes.length > 0) {
			conditions.push(
				inArray(agentCreditLedger.transactionType, params.transactionTypes)
			);
		}

		if (params.from) {
			conditions.push(gte(agentCreditLedger.createdAt, params.from));
		}

		if (params.to) {
			conditions.push(lte(agentCreditLedger.createdAt, params.to));
		}

		const query = db
			.select({
				id: agentCreditLedger.id,
				tenantId: agentCreditLedger.tenantId,
				fromEntityType: agentCreditLedger.fromEntityType,
				fromEntityId: agentCreditLedger.fromEntityId,
				toEntityType: agentCreditLedger.toEntityType,
				toEntityId: agentCreditLedger.toEntityId,
				transactionType: agentCreditLedger.transactionType,
				amount: agentCreditLedger.amount,
				currency: agentCreditLedger.currency,
				balanceBefore: agentCreditLedger.balanceBefore,
				balanceAfter: agentCreditLedger.balanceAfter,
				reason: agentCreditLedger.reason,
				createdBy: agentCreditLedger.createdBy,
				betId: agentCreditLedger.betId,
				settlementId: agentCreditLedger.settlementId,
				cashoutId: agentCreditLedger.cashoutId,
				createdByType: agentCreditLedger.createdByType,
				meta: agentCreditLedger.meta,
				metadata: agentCreditLedger.metadata,
				createdAt: agentCreditLedger.createdAt,
			})
			.from(agentCreditLedger)
			.where(and(...conditions))
      .orderBy(desc(agentCreditLedger.createdAt), desc(agentCreditLedger.id));

		if (params.limit) {
			query.limit(params.limit);
		}

		const transactions = await query;
		return transactions.map((t) => this.mapToCreditTransaction(t));
	}

	/**
	 * Get transactions by entity with limit and offset support
	 */
	async getTransactionsByEntity(params: {
		entityType: CreditEntityType;
		entityId: string;
		limit?: number;
		offset?: number;
		transactionType?: CreditTransactionType;
		transactionTypes?: CreditTransactionType[];
		tenantId?: string;
	}): Promise<CreditTransaction[]> {
		// Build entity matching condition
		// For CREDIT_LIMIT_ADJUSTMENT: only show if agent is the toEntity (whose limit changed), not fromEntity (who initiated)
		// For RELEASE: only show if agent is the toEntity (who received the released credit), not fromEntity (who released it)
		// For ALLOCATION: only show if agent is the fromEntity (who allocated credit), not toEntity (who received it)
		// For all other types: show if agent is either fromEntity or toEntity
		const entityConditions = [
			// Always include transactions where agent is the toEntity
			and(
				eq(agentCreditLedger.toEntityType, params.entityType),
				eq(agentCreditLedger.toEntityId, params.entityId)
			),
			// Include transactions where agent is the fromEntity, EXCEPT for:
			// - CREDIT_LIMIT_ADJUSTMENT (only show to the agent whose limit changed)
			// - RELEASE (only show to the agent who received the released credit)
			and(
				eq(agentCreditLedger.fromEntityType, params.entityType),
				eq(agentCreditLedger.fromEntityId, params.entityId),
				sql`${agentCreditLedger.transactionType} != 'CREDIT_LIMIT_ADJUSTMENT'`,
				sql`${agentCreditLedger.transactionType} != 'RELEASE'`
			),
		];
		
		const conditions = [
			or(...entityConditions),
		];
		
		// CRITICAL: Filter by tenantId if provided for data isolation
		if (params.tenantId) {
			conditions.push(eq(agentCreditLedger.tenantId, params.tenantId));
		}
		
		// Add transactionType filter if provided
		if (params.transactionType) {
			conditions.push(eq(agentCreditLedger.transactionType, params.transactionType));
		}
		
		// Add transactionTypes filter if provided (multiple types) - takes precedence over transactionType
		if (params.transactionTypes && params.transactionTypes.length > 0) {
			conditions.push(inArray(agentCreditLedger.transactionType, params.transactionTypes));
		}

		let query = db
			.select({
				id: agentCreditLedger.id,
				tenantId: agentCreditLedger.tenantId,
				fromEntityType: agentCreditLedger.fromEntityType,
				fromEntityId: agentCreditLedger.fromEntityId,
				toEntityType: agentCreditLedger.toEntityType,
				toEntityId: agentCreditLedger.toEntityId,
				transactionType: agentCreditLedger.transactionType,
				amount: agentCreditLedger.amount,
				currency: agentCreditLedger.currency,
				balanceBefore: agentCreditLedger.balanceBefore,
				balanceAfter: agentCreditLedger.balanceAfter,
				reason: agentCreditLedger.reason,
				createdBy: agentCreditLedger.createdBy,
				betId: agentCreditLedger.betId,
				settlementId: agentCreditLedger.settlementId,
				cashoutId: agentCreditLedger.cashoutId,
				createdByType: agentCreditLedger.createdByType,
				meta: agentCreditLedger.meta,
				metadata: agentCreditLedger.metadata,
				createdAt: agentCreditLedger.createdAt,
			})
			.from(agentCreditLedger)
			.where(and(...conditions))
			.orderBy(desc(agentCreditLedger.createdAt), desc(agentCreditLedger.id));

		if (params.limit) {
			query = query.limit(params.limit) as any;
		}
		if (params.offset) {
			query = query.offset(params.offset) as any;
		}

		const transactions = await query;
		return transactions.map((t) => this.mapToCreditTransaction(t));
	}

	/**
	 * Get settlements by entity (ADJUSTMENT transactions with settlement in reason)
	 */
	async getSettlementsByEntity(params: {
		entityType: CreditEntityType;
		entityId: string;
		limit?: number;
		offset?: number;
		tenantId?: string;
	}): Promise<CreditTransaction[]> {
		const conditions = [
			eq(agentCreditLedger.transactionType, 'ADJUSTMENT'),
			sql`${agentCreditLedger.reason} IS NOT NULL AND ${agentCreditLedger.reason} ILIKE '%settlement%'`,
			or(
				and(
					eq(agentCreditLedger.fromEntityType, params.entityType),
					eq(agentCreditLedger.fromEntityId, params.entityId)
				),
				and(
					eq(agentCreditLedger.toEntityType, params.entityType),
					eq(agentCreditLedger.toEntityId, params.entityId)
				)
			),
		];

		// CRITICAL: Filter by tenantId if provided for data isolation
		if (params.tenantId) {
			conditions.push(eq(agentCreditLedger.tenantId, params.tenantId));
		}

		let query = db
			.select({
				id: agentCreditLedger.id,
				tenantId: agentCreditLedger.tenantId,
				fromEntityType: agentCreditLedger.fromEntityType,
				fromEntityId: agentCreditLedger.fromEntityId,
				toEntityType: agentCreditLedger.toEntityType,
				toEntityId: agentCreditLedger.toEntityId,
				transactionType: agentCreditLedger.transactionType,
				amount: agentCreditLedger.amount,
				currency: agentCreditLedger.currency,
				balanceBefore: agentCreditLedger.balanceBefore,
				balanceAfter: agentCreditLedger.balanceAfter,
				reason: agentCreditLedger.reason,
				createdBy: agentCreditLedger.createdBy,
				betId: agentCreditLedger.betId,
				settlementId: agentCreditLedger.settlementId,
				cashoutId: agentCreditLedger.cashoutId,
				createdByType: agentCreditLedger.createdByType,
				meta: agentCreditLedger.meta,
				metadata: agentCreditLedger.metadata,
				createdAt: agentCreditLedger.createdAt,
			})
			.from(agentCreditLedger)
			.where(and(...conditions))
			.orderBy(desc(agentCreditLedger.createdAt), desc(agentCreditLedger.id));

		if (params.limit) {
			query = query.limit(params.limit) as any;
		}
		if (params.offset) {
			query = query.offset(params.offset) as any;
		}

		const transactions = await query;
		return transactions.map((t) => this.mapToCreditTransaction(t));
	}

	/**
	 * Get balance summary for an entity
	 */
	async getBalanceSummary(
		entityType: CreditEntityType,
		entityId: string
	): Promise<{
		totalInflow: number;
		totalOutflow: number;
		netBalance: number;
		lastTransactionAt: Date | null;
	}> {
		const result = await db
			.select({
				totalInflow: sql<number>`COALESCE(SUM(CASE WHEN ${agentCreditLedger.toEntityId} = ${entityId} AND ${agentCreditLedger.toEntityType} = ${entityType} THEN ${agentCreditLedger.amount} ELSE 0 END), 0)`,
				totalOutflow: sql<number>`COALESCE(SUM(CASE WHEN ${agentCreditLedger.fromEntityId} = ${entityId} AND ${agentCreditLedger.fromEntityType} = ${entityType} THEN ${agentCreditLedger.amount} ELSE 0 END), 0)`,
				lastTransactionAt: sql<Date | null>`MAX(${agentCreditLedger.createdAt})`,
			})
			.from(agentCreditLedger)
			.where(
				or(
					and(
						eq(agentCreditLedger.fromEntityType, entityType),
						eq(agentCreditLedger.fromEntityId, entityId)
					),
					and(
						eq(agentCreditLedger.toEntityType, entityType),
						eq(agentCreditLedger.toEntityId, entityId)
					)
				)
			);

		const summary = result[0];
		return {
			totalInflow: Number(summary?.totalInflow || 0),
			totalOutflow: Number(summary?.totalOutflow || 0),
			netBalance: Number(summary?.totalInflow || 0) - Number(summary?.totalOutflow || 0),
			lastTransactionAt: summary?.lastTransactionAt || null,
		};
	}

	/**
	 * Map database row to CreditTransaction
	 */
	private mapToCreditTransaction(row: any): CreditTransaction {
		return {
			id: row.id,
			tenantId: row.tenantId,
			fromEntityType: row.fromEntityType,
			fromEntityId: row.fromEntityId,
			toEntityType: row.toEntityType,
			toEntityId: row.toEntityId,
			transactionType: row.transactionType,
			amount: Number(row.amount),
			currency: row.currency,
			balanceBefore: Number(row.balanceBefore),
			balanceAfter: Number(row.balanceAfter),
			reason: row.reason,
			meta: row.meta ?? row.metadata ?? null,
			createdBy: row.createdBy,
			betId: row.betId || null,
			settlementId: row.settlementId || null,
			cashoutId: row.cashoutId || null,
			createdByType: row.createdByType || null,
			metadata: row.metadata || null,
			createdAt: row.createdAt,
		};
	}

	/**
	 * Export ledger to CSV format
	 */
	async exportToCSV(params: {
		entityType: CreditEntityType;
		entityId: string;
		transactionTypes?: CreditTransactionType[];
		from?: Date;
		to?: Date;
		betId?: string;
		tenantId?: string;
	}): Promise<string> {
		const transactions = await this.getTransactionHistory({
			entityType: params.entityType,
			entityId: params.entityId,
			transactionTypes: params.transactionTypes,
			from: params.from,
			to: params.to,
			tenantId: params.tenantId,
		});

		// Filter by betId if provided
		const filtered = params.betId
			? transactions.filter((t) => t.betId === params.betId)
			: transactions;

		// Generate CSV header
		const headers = [
			'ID',
			'Date',
			'Transaction Type',
			'From Entity',
			'To Entity',
			'Amount',
			'Currency',
			'Balance Before',
			'Balance After',
			'Reason',
			'Bet ID',
			'Settlement ID',
			'Cashout ID',
			'Created By Type',
		];

		// Generate CSV rows
		const rows = filtered.map((t) => [
			t.id,
			t.createdAt.toISOString(),
			t.transactionType,
			`${t.fromEntityType}:${t.fromEntityId}`,
			`${t.toEntityType}:${t.toEntityId}`,
			t.amount.toString(),
			t.currency,
			t.balanceBefore.toString(),
			t.balanceAfter.toString(),
			t.reason || '',
			t.betId || '',
			t.settlementId || '',
			t.cashoutId || '',
			t.createdByType || '',
		]);

		// Combine header and rows
		const csvLines = [headers.join(','), ...rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))];

		return csvLines.join('\n');
	}
}

