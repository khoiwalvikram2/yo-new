import {
	pgEnum,
	pgTable,
	uuid,
	varchar,
	text,
	timestamp,
	jsonb,
	numeric,
	index,
	uniqueIndex,
	integer,
	boolean,
} from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { users } from './users';

// Credit transaction types
export const creditTransactionTypeEnum = pgEnum('credit_transaction_type', [
	'ALLOCATION',
	'DEPOSIT',
	'WITHDRAWAL',
	'TRANSFER',
	'USAGE',
	'RELEASE',
	'ADJUSTMENT',
	'CREDIT_LIMIT_ADJUSTMENT',
	'CREDIT_USED_INCREASE',
	'CREDIT_USED_DECREASE',
]);

// Entity types for credit transactions
export const creditEntityTypeEnum = pgEnum('credit_entity_type', [
	'agent',
	'player',
	'whitelabel',
]);

// Credit ledger - tracks all credit transactions
export const agentCreditLedger = pgTable(
	'agent_credit_ledger',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: varchar('tenant_id', { length: 128 }).notNull().default('default'),
		// Source entity
		fromEntityType: creditEntityTypeEnum('from_entity_type').notNull(),
		// Must support both UUIDs (agents) and integer IDs (players), so store as string.
		fromEntityId: varchar('from_entity_id', { length: 128 }).notNull(),
		// Target entity
		toEntityType: creditEntityTypeEnum('to_entity_type').notNull(),
		// Must support both UUIDs (agents) and integer IDs (players), so store as string.
		toEntityId: varchar('to_entity_id', { length: 128 }).notNull(),
		// Transaction details
		transactionType: creditTransactionTypeEnum('transaction_type').notNull(),
		amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
		currency: varchar('currency', { length: 8 }).notNull().default('INR'),
		// Balance tracking
		balanceBefore: numeric('balance_before', { precision: 18, scale: 2 }).notNull(),
		balanceAfter: numeric('balance_after', { precision: 18, scale: 2 }).notNull(),
		// Metadata
		reason: text('reason'),
		meta: jsonb('meta'),
		createdBy: uuid('created_by'),
		// Reference keys for audit trail
		betId: uuid('bet_id'), // Reference to sports_bets, casino_bets, or matka_bets
		settlementId: uuid('settlement_id'), // Reference to agent_settlements
		cashoutId: uuid('cashout_id'), // Reference to cashout operations
		createdByType: varchar('created_by_type', { length: 32 }), // 'system', 'admin', 'agent'
		metadata: jsonb('metadata'), // Flexible JSONB for additional context
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index('agent_credit_ledger_tenant_idx').on(table.tenantId),
		index('agent_credit_ledger_from_entity_idx').on(
			table.fromEntityType,
			table.fromEntityId
		),
		index('agent_credit_ledger_to_entity_idx').on(
			table.toEntityType,
			table.toEntityId
		),
		index('agent_credit_ledger_transaction_type_idx').on(table.transactionType),
		index('agent_credit_ledger_created_at_idx').on(table.createdAt),
		index('agent_credit_ledger_bet_id_idx').on(table.betId),
		index('agent_credit_ledger_settlement_id_idx').on(table.settlementId),
		index('agent_credit_ledger_cashout_id_idx').on(table.cashoutId),
		index('agent_credit_ledger_created_by_type_idx').on(table.createdByType),
	]
);

// Agent-player credit allocation tracking
export const agentPlayerCredits = pgTable(
	'agent_player_credits',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		agentId: uuid('agent_id')
			.notNull()
			.references(() => agents.id, { onDelete: 'cascade' }),
		playerId: integer('player_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// Credit allocation details
		creditLimit: numeric('credit_limit', { precision: 18, scale: 2 })
			.notNull()
			.default('0'),
		// Note: currentBalance is used as settlementBalance for AGENT_CREDIT players
		// It tracks wins/losses (net position) for settlement calculations
		currentBalance: numeric('current_balance', { precision: 18, scale: 2 })
			.notNull()
			.default('0'),
		openExposure: numeric('open_exposure', { precision: 18, scale: 2 })
			.notNull()
			.default('0'),
		creditUsed: numeric('credit_used', { precision: 18, scale: 2 })
			.notNull()
			.default('0'),
		creditAvailable: numeric('credit_available', { precision: 18, scale: 2 })
			.notNull()
			.default('0'),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index('agent_player_credits_player_idx').on(table.playerId),
		// One apc row per (agent, player). Backed by migration 0087; lets inserts use
		// ON CONFLICT upsert/do-nothing semantics keyed on this index.
		uniqueIndex('agent_player_credits_agent_player_key').on(
			table.agentId,
			table.playerId
		),
	]
);

// Credit alerts configuration and history
export const agentCreditAlerts = pgTable(
	'agent_credit_alerts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		agentId: uuid('agent_id')
			.notNull()
			.references(() => agents.id, { onDelete: 'cascade' }),
		alertType: varchar('alert_type', { length: 32 }).notNull(), // 'threshold', 'limit_exceeded', etc.
		threshold: numeric('threshold', { precision: 5, scale: 2 }), // Percentage or absolute value
		currentValue: numeric('current_value', { precision: 18, scale: 2 }),
		isActive: boolean('is_active').notNull().default(true),
		notifiedAt: timestamp('notified_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index('agent_credit_alerts_agent_idx').on(table.agentId),
		index('agent_credit_alerts_active_idx').on(table.isActive),
	]
);

