import { pgTable, serial, varchar, timestamp, numeric, boolean, uuid, text, integer, date, pgEnum, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { agents } from './agents'
import { users } from './users'

// Partner settlements (existing)
export const settlements = pgTable('settlements', {
	id: serial('id').primaryKey(),
	tenant: varchar('tenant', { length: 128 }).notNull(),
	periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
	periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
	ggr: numeric('ggr', { precision: 18, scale: 2 }).notNull().default('0'),
	sharePercent: numeric('share_percent', { precision: 5, scale: 2 }).notNull().default('0'),
	partnerShareAmount: numeric('partner_share_amount', { precision: 18, scale: 2 }).notNull().default('0'),
	status: varchar('status', { length: 16 }).notNull().default('pending'),
	settledAt: timestamp('settled_at', { withTimezone: true }),
	notes: varchar('notes', { length: 1024 }),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Agent Settlement Transactions (for SHARING and CREDIT agents)
export const agentSettlementTransactions = pgTable('agent_settlement_transactions', {
	id: uuid('id').primaryKey().defaultRandom(),
	tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
	agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
	settlementType: varchar('settlement_type', { length: 20 }).notNull(), // 'P_L' | 'CREDIT'
	amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
	direction: varchar('direction', { length: 20 }).notNull(), // 'TO_AGENT' | 'FROM_AGENT'
	previousBalance: numeric('previous_balance', { precision: 18, scale: 2 }),
	newBalance: numeric('new_balance', { precision: 18, scale: 2 }),
	notes: text('notes'),
	settledBy: uuid('settled_by'), // admin user id
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('agent_settlement_transactions_agent_id_idx').on(table.agentId),
])

// Commission Payouts (for COMMISSION agents)
export const commissionPayouts = pgTable(
	'commission_payouts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
		agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
		amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
		periodFrom: date('period_from'),
		periodTo: date('period_to'),
		turnover: numeric('turnover', { precision: 18, scale: 2 }),
		notes: text('notes'),
		paidBy: uuid('paid_by'), // admin user id
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		// Idempotency: one payout per agent per IST cycle (full-cycle-only settlement)
		uniqueIndex('commission_payouts_agent_cycle_key').on(table.agentId, table.periodFrom, table.periodTo),
	],
)

// Commission cycle lock snapshots (IST Monday->Monday). COMMISSION-only; CREDIT/SHARING untouched.
export const commissionCycleSnapshotStatusEnum = pgEnum('commission_cycle_snapshot_status', [
	'OPEN',
	'CLOSED_UNSETTLED',
	'SETTLED',
	'BLOCKED',
])

export const commissionCycleSnapshots = pgTable(
	'commission_cycle_snapshots',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenantId: varchar('tenant_id', { length: 128 }).notNull().default('default'),
		agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
		cycleFrom: timestamp('cycle_from', { withTimezone: true }).notNull(),
		cycleTo: timestamp('cycle_to', { withTimezone: true }).notNull(),
		calculatedTotal: numeric('calculated_total', { precision: 18, scale: 2 }).notNull().default('0'),
		postedTotal: numeric('posted_total', { precision: 18, scale: 2 }).notNull().default('0'),
		paidTotal: numeric('paid_total', { precision: 18, scale: 2 }).notNull().default('0'),
		payableAmount: numeric('payable_amount', { precision: 18, scale: 2 }).notNull().default('0'),
		status: commissionCycleSnapshotStatusEnum('status').notNull().default('OPEN'),
		meta: jsonb('meta'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('commission_cycle_snapshots_agent_cycle_key').on(table.agentId, table.cycleFrom, table.cycleTo),
	],
)

// Commission adjustments (post-close void/refund/rollback). COMMISSION-only; applied to next eligible cycle.
export const commissionAdjustments = pgTable('commission_adjustments', {
	id: uuid('id').primaryKey().defaultRandom(),
	tenantId: varchar('tenant_id', { length: 128 }).notNull().default('default'),
	agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
	amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
	sourceCycleFrom: timestamp('source_cycle_from', { withTimezone: true }).notNull(),
	sourceCycleTo: timestamp('source_cycle_to', { withTimezone: true }).notNull(),
	targetCycleFrom: timestamp('target_cycle_from', { withTimezone: true }),
	targetCycleTo: timestamp('target_cycle_to', { withTimezone: true }),
	reason: varchar('reason', { length: 64 }).notNull(),
	refMeta: jsonb('ref_meta'),
	status: varchar('status', { length: 24 }).notNull().default('PENDING'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	appliedAt: timestamp('applied_at', { withTimezone: true }),
}, (table) => [
  index('commission_adjustments_agent_id_idx').on(table.agentId),
])

// Player Credit Adjustments (for WHITELABEL_CREDIT players)
export const playerCreditAdjustments = pgTable('player_credit_adjustments', {
	id: uuid('id').primaryKey().defaultRandom(),
	tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
	playerId: integer('player_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	adjustmentType: varchar('adjustment_type', { length: 20 }).notNull(), // 'INCREASE' | 'DECREASE' | 'LIMIT_CHANGE'
	amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
	previousLimit: numeric('previous_limit', { precision: 18, scale: 2 }),
	newLimit: numeric('new_limit', { precision: 18, scale: 2 }),
	previousUsed: numeric('previous_used', { precision: 18, scale: 2 }),
	newUsed: numeric('new_used', { precision: 18, scale: 2 }),
	notes: text('notes'),
	adjustedBy: uuid('adjusted_by'), // admin user id
	balanceBefore: numeric('balance_before', { precision: 18, scale: 2 }), // creditAvailable before adjustment
	balanceAfter: numeric('balance_after', { precision: 18, scale: 2 }), // creditAvailable after adjustment
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('player_credit_adjustments_player_id_idx').on(table.playerId),
])
