import { pgTable, serial, timestamp, varchar, index, uniqueIndex, integer, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'

export const casinoWalletTypeEnum = pgEnum('casino_wallet_type', ['cash', 'bonus', 'referralBonus'])

export const userCasinoSessions = pgTable(
  'user_casino_sessions',
  {
    id: serial('id').primaryKey(),
    tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    providerKey: varchar('provider_key', { length: 64 }).notNull(),
    token: varchar('token', { length: 256 }).notNull(),
    walletType: casinoWalletTypeEnum('wallet_type').notNull().default('cash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('user_casino_sessions_provider_token_unique').on(table.providerKey, table.token),
    index('user_casino_sessions_user_idx').on(table.userId),
    index('user_casino_sessions_tenant_idx').on(table.tenant),
  ]
)
