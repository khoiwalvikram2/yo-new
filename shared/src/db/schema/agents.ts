import { pgEnum, pgTable, uuid, varchar, text, integer, boolean, timestamp, jsonb, numeric, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Enums
export const agentSchemeEnum = pgEnum('agent_scheme', ['COMMISSION', 'SHARING', 'CREDIT']);
export const agentLedgerLineTypeEnum = pgEnum('agent_ledger_line_type', [
	'COMMISSION',
	'SHARE',
	'ADJUSTMENT',
	'SETTLEMENT',
]);

// Core agents table
export const agents = pgTable('agents', {
	id: uuid('id').primaryKey().defaultRandom(),
	// Align tenant column type with rest of codebase (string tenant like 'default')
	tenantId: varchar('tenant_id', { length: 128 }).notNull().default('default'),
	schemeType: agentSchemeEnum('scheme_type').notNull(),
	// sports | casino | matka
	allowedDomains: text('allowed_domains').array().notNull(),
	status: varchar('status', { length: 24 }).notNull().default('ACTIVE'),
	phone: varchar('phone', { length: 20 }),
	// Sharing hierarchy (sharing-only)
	parentAgentId: uuid('parent_agent_id'),
	levelIndex: integer('level_index'),
	// Commission tally (commission-only)
	tallyEnabled: boolean('tally_enabled').notNull().default(false),
	tallyDomains: text('tally_domains').array(),
	// Credit management
	creditLimit: numeric('credit_limit', { precision: 15, scale: 2 }).default('0'),
	creditUsed: numeric('credit_used', { precision: 15, scale: 2 }).default('0'),
	creditAvailable: numeric('credit_available', { precision: 15, scale: 2 }).default('0'),
	creditAlertThreshold: numeric('credit_alert_threshold', { precision: 5, scale: 2 }).default('80.00'),
	tokenVersion: integer('token_version').notNull().default(0),
	settlementBalance: numeric('settlement_balance', { precision: 15, scale: 2 }).default('0').notNull(),
	settlementBalanceSports: numeric('settlement_balance_sports', { precision: 15, scale: 2 }).default('0').notNull(),
	settlementBalanceCasino: numeric('settlement_balance_casino', { precision: 15, scale: 2 }).default('0').notNull(),
	settlementBalanceMatka: numeric('settlement_balance_matka', { precision: 15, scale: 2 }).default('0').notNull(),
	// CREDIT scheme on Deposit/Withdraw chips (migration 0019): the chips this agent holds itself, not yet deposited
	// to its downline. credit_limit is its credit reference; credit_used, credit_available and the settlement
	// balances are no longer written for CREDIT agents.
	chipBalance: numeric('chip_balance', { precision: 15, scale: 2 }).notNull().default('0'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Credentials
export const agentCredentials = pgTable(
	'agent_credentials',
	{
		agentId: uuid('agent_id').primaryKey().references(() => agents.id, { onDelete: 'cascade' }),
		// Task 24: usernames are unique PER TENANT (not globally). tenant_id mirrors the owning
		// agent's tenant; the DB enforces uniqueness via the composite index below.
		tenantId: varchar('tenant_id', { length: 128 }).notNull().default('default'),
		username: varchar('username', { length: 120 }).notNull(),
		passwordHash: text('password_hash').notNull(),
		lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
	},
	(t) => ({
		// Mirrors migration 0084: unique on (tenant_id, lower(username)). The lower() functional
		// expression matches the app's case-insensitive normalization. The DB index is the real
		// enforcer; this declaration keeps the schema in parity for documentation/introspection.
		tenantUsernameKey: uniqueIndex('agent_credentials_tenant_username_key').on(
			t.tenantId,
			sql`lower(${t.username})`
		),
	})
);

// Commission config (per domain)
export const agentCommissionConfig = pgTable('agent_commission_config', {
	id: uuid('id').primaryKey().defaultRandom(),
	agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
	domain: varchar('domain', { length: 24 }).notNull(), // sports | casino | matka
	commissionRate: numeric('commission_rate', { precision: 6, scale: 4 }).notNull(), // 0..1
	effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
	effectiveTo: timestamp('effective_to', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('agent_commission_config_agent_id_idx').on(table.agentId),
]);

// Sharing config (per domain)
export const agentSharingConfig = pgTable('agent_sharing_config', {
	id: uuid('id').primaryKey().defaultRandom(),
	agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
	domain: varchar('domain', { length: 24 }).notNull(), // sports | casino | matka
	shareRate: numeric('share_rate', { precision: 6, scale: 4 }).notNull(), // 0..1
	basis: varchar('basis', { length: 12 }).notNull().default('GGR'),
	effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
	effectiveTo: timestamp('effective_to', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('agent_sharing_config_agent_id_idx').on(table.agentId),
]);

// Wallets
export const agentWallets = pgTable('agent_wallets', {
	id: uuid('id').primaryKey().defaultRandom(),
	agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
	currency: varchar('currency', { length: 8 }).notNull(),
	balance: numeric('balance', { precision: 18, scale: 2 }).notNull().default('0'),
	lockedBalance: numeric('locked_balance', { precision: 18, scale: 2 }).notNull().default('0'),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('agent_wallets_agent_id_idx').on(table.agentId),
]);

// Ledger
export const agentLedger = pgTable('agent_ledger', {
	id: uuid('id').primaryKey().defaultRandom(),
	agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
	domain: varchar('domain', { length: 24 }).notNull(),
	periodFrom: timestamp('period_from', { withTimezone: true }).notNull(),
	periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
	lineType: agentLedgerLineTypeEnum('line_type').notNull(),
	amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
	currency: varchar('currency', { length: 8 }).notNull(),
	refKey: varchar('ref_key', { length: 128 }),
	meta: jsonb('meta'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
	// Commission-race hardening: at most one COMMISSION line per (agent, domain, period).
	// Partial (line_type='COMMISSION') so SHARE/SETTLEMENT/ADJUSTMENT lines for the same
	// agent/domain/period are unaffected. Matches existsCommissionLine; addLine uses
	// ON CONFLICT DO NOTHING so a concurrent duplicate accrual is an idempotent no-op.
	uniqueIndex('agent_ledger_commission_unique')
		.on(table.agentId, table.domain, table.periodFrom, table.periodTo)
		.where(sql`line_type = 'COMMISSION'`),
]);

// Settlements
export const agentSettlements = pgTable('agent_settlements', {
	id: uuid('id').primaryKey().defaultRandom(),
	agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
	periodFrom: timestamp('period_from', { withTimezone: true }).notNull(),
	periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
	totalAmount: numeric('total_amount', { precision: 18, scale: 2 }).notNull(),
	currency: varchar('currency', { length: 8 }).notNull(),
	status: varchar('status', { length: 24 }).notNull().default('OPEN'),
	postedAt: timestamp('posted_at', { withTimezone: true }),
	postedBy: uuid('posted_by'),
	/** When a parent agent settles a sub-agent, set to parent's agent id; null when admin settles */
	settledByAgentId: uuid('settled_by_agent_id').references(() => agents.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('agent_settlements_settled_by_agent_id_idx').on(table.settledByAgentId),
	// CR-16: idempotency backstop. Partial unique index on OPEN rows only so it blocks
	// concurrent in-flight settlements for the same (agent, period) without conflicting
	// with the multiple POSTED rows produced by legitimate partial settlements.
	uniqueIndex('agent_settlements_agent_period_open_key')
		.on(table.agentId, table.periodFrom, table.periodTo)
		.where(sql`status = 'OPEN'`),
]);

// Sharing hierarchy closure table (sharing-only agents)
export const agentHierarchyClosure = pgTable('agent_hierarchy_closure', {
	ancestorId: uuid('ancestor_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
	descendantId: uuid('descendant_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
	depth: integer('depth').notNull(),
}, (table) => [
  index('agent_hierarchy_closure_descendant_id_idx').on(table.descendantId),
  index('agent_hierarchy_closure_ancestor_id_idx').on(table.ancestorId),
]);

