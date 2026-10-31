import { pgTable, serial, timestamp, varchar, uniqueIndex, index, numeric, integer, jsonb } from 'drizzle-orm/pg-core'

export const wallets = pgTable('wallets', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  userId: integer('user_id').notNull(),
  currency: varchar('currency', { length: 8 }).notNull().default('INR'),
  cash: numeric('cash', { precision: 18, scale: 2 }).notNull().default('0'),
  bonus: numeric('bonus', { precision: 18, scale: 2 }).notNull().default('0'),
  exposure: numeric('exposure', { precision: 18, scale: 2 }).notNull().default('0'),
  referralBonus: numeric('referral_bonus', { precision: 18, scale: 2 }).notNull().default('0'),
  referralBalance: numeric('referral_balance', { precision: 18, scale: 2 }).notNull().default('0'),
}, (table) => [
  index('wallets_tenant_idx').on(table.tenant),
  uniqueIndex('wallets_id_tenant_unique').on(table.id, table.tenant),
])

export const ledgerEntries = pgTable('ledger_entries', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  walletId: integer('wallet_id').notNull(),
  type: varchar('type', { length: 32 }).notNull(),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  balanceBefore: numeric('balance_before', { precision: 18, scale: 2 }),
  balanceAfter: numeric('balance_after', { precision: 18, scale: 2 }),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('ledger_entries_tenant_idx').on(table.tenant),
  // Player profile first-deposit, transaction history and wallet-period summaries.
  index('ledger_entries_tenant_wallet_created_idx').on(table.tenant, table.walletId, table.createdAt),
  uniqueIndex('ledger_entries_id_tenant_unique').on(table.id, table.tenant),
])

