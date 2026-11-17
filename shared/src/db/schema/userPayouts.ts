import { sql } from 'drizzle-orm'
import { pgTable, serial, varchar, integer, timestamp, numeric, boolean, text, index, uniqueIndex, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'
import { wallets } from './wallets'

export const payoutMethodEnum = pgEnum('payout_method', ['BANK', 'UPI'])
export const payoutStatusEnum = pgEnum('payout_status', ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'])
export const payoutAccountApprovalEnum = pgEnum('payout_account_approval', ['PENDING', 'APPROVED', 'REJECTED'])

export const userPayoutAccounts = pgTable('user_payout_accounts', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  method: payoutMethodEnum('method').notNull().default('BANK'),
  accountNumber: varchar('account_number', { length: 64 }).notNull(),
  ifscCode: varchar('ifsc_code', { length: 32 }),
  bankName: varchar('bank_name', { length: 128 }),
  accountHolderName: varchar('account_holder_name', { length: 160 }).notNull(),
  label: varchar('label', { length: 64 }),
  isPrimary: boolean('is_primary').notNull().default(false),
  approvalStatus: payoutAccountApprovalEnum('approval_status').notNull().default('PENDING'),
  approvedBy: integer('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  // FIN-05: a player's delete is a soft delete, so deleted accounts still count toward the auto-approval rule
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  index('user_payout_accounts_approved_by_idx').on(table.approvedBy),
  index('user_payout_accounts_tenant_idx').on(table.tenant),
  index('user_payout_accounts_user_idx').on(table.userId),
  index('user_payout_accounts_approval_status_idx').on(table.approvalStatus),
  uniqueIndex('user_payout_accounts_primary_unique').on(table.userId, table.tenant, table.isPrimary).where(sql`${table.isPrimary}`),
])

export const withdrawalRequests = pgTable('withdrawal_requests', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  walletId: integer('wallet_id').references(() => wallets.id, { onDelete: 'set null' }),
  payoutAccountId: integer('payout_account_id').references(() => userPayoutAccounts.id, { onDelete: 'set null' }),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 8 }).notNull().default('INR'),
  status: payoutStatusEnum('status').notNull().default('PENDING'),
  reviewerId: integer('reviewer_id'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  note: text('note'),
  ledgerTxnId: integer('ledger_txn_id'),
  balanceBefore: numeric('balance_before', { precision: 18, scale: 2 }), // Wallet balance before withdrawal
  balanceAfter: numeric('balance_after', { precision: 18, scale: 2 }), // Wallet balance after withdrawal
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('withdrawal_requests_wallet_id_idx').on(table.walletId),
  index('withdrawal_requests_payout_account_id_idx').on(table.payoutAccountId),
  index('withdrawal_requests_tenant_idx').on(table.tenant),
  index('withdrawal_requests_user_idx').on(table.userId),
  index('withdrawal_requests_status_idx').on(table.status),
  index('withdrawal_requests_created_idx').on(table.createdAt),
  index('withdrawal_requests_user_created_idx').on(table.userId, table.createdAt),
])

