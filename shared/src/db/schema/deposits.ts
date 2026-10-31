import { pgTable, serial, timestamp, varchar, integer, numeric, pgEnum, jsonb, uniqueIndex, index, text } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const depositMethodEnum = pgEnum('deposit_method', ['BANK_TRANSFER', 'UPI'])
export const depositStatusEnum = pgEnum('deposit_status', ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])

export const depositRequests = pgTable('deposit_requests', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  userId: integer('user_id').notNull(),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 8 }).notNull().default('INR'),
  method: depositMethodEnum('method').notNull(),
  receivingAccountId: varchar('receiving_account_id', { length: 160 }),
  vipPolicySnapshot: jsonb('vip_policy_snapshot'),
  utr: varchar('utr', { length: 128 }), // Required for UPI, nullable for BANK_TRANSFER
  referenceId: varchar('reference_id', { length: 128 }), // Optional reference for BANK_TRANSFER
  proofKey: varchar('proof_key', { length: 512 }).notNull(), // S3 object key
  proofData: text('proof_data'), // base64 data URI; proofKey retained for sentinels
  status: depositStatusEnum('status').notNull().default('PENDING'),
  reviewerId: integer('reviewer_id'), // Admin who reviewed
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  note: varchar('note', { length: 512 }), // Admin note
  walletTxnId: integer('wallet_txn_id'), // Reference to ledger entry, unique to prevent double credit
  balanceBefore: numeric('balance_before', { precision: 18, scale: 2 }), // Wallet balance before deposit
  balanceAfter: numeric('balance_after', { precision: 18, scale: 2 }), // Wallet balance after deposit
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('deposit_requests_tenant_idx').on(table.tenant),
  index('deposit_requests_user_id_idx').on(table.userId),
  index('deposit_requests_status_idx').on(table.status),
  index('deposit_requests_created_at_idx').on(table.createdAt),
  index('deposit_requests_user_created_idx').on(table.userId, table.createdAt),
  uniqueIndex('deposit_requests_id_tenant_unique').on(table.id, table.tenant),
  uniqueIndex('deposit_requests_wallet_txn_id_unique').on(table.walletTxnId).where(sql`wallet_txn_id IS NOT NULL`),
])

export const whitelabelPaymentMethods = pgTable('whitelabel_payment_methods', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  enabledMethods: jsonb('enabled_methods').notNull().default('[]'), // Array of method strings
  bankDetails: jsonb('bank_details'), // { accountName, accountNumber, ifsc, bankName, branch, notes? }
  upiDetails: jsonb('upi_details'), // { upiId, displayName?, qrKey? } — qrKey holds a base64 data URI
  limits: jsonb('limits').notNull().default('{"min": 100, "max": 500000}'), // { min, max }
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('whitelabel_payment_methods_tenant_unique').on(table.tenant),
])

