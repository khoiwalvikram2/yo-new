import {
  pgTable,
  serial,
  timestamp,
  varchar,
  numeric,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const walletLedger = pgTable(
  'wallet_ledger',
  {
    id: serial('id').primaryKey(),
    tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
    walletId: integer('wallet_id').notNull(),
    userId: integer('user_id').notNull(),
    walletType: varchar('wallet_type', { length: 32 }).notNull(),
    category: varchar('category', { length: 64 }).notNull(),
    direction: varchar('direction', { length: 8 }).notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    balanceBefore: numeric('balance_before', { precision: 18, scale: 2 }),
    balanceAfter: numeric('balance_after', { precision: 18, scale: 2 }),
    description: varchar('description', { length: 256 }),
    referenceType: varchar('reference_type', { length: 64 }),
    referenceId: varchar('reference_id', { length: 128 }),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('wallet_ledger_tenant_user_id_idx').on(table.tenant, table.userId),
    index('wallet_ledger_tenant_wallet_id_type_idx').on(table.tenant, table.walletId, table.walletType),
    index('wallet_ledger_created_at_idx').on(table.createdAt),
    uniqueIndex('wallet_ledger_id_tenant_unique').on(table.id, table.tenant),
  ]
)
