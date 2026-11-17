import { pgTable, serial, timestamp, varchar, integer, numeric, pgEnum, jsonb, uniqueIndex, index, text } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const depositMethodEnum = pgEnum('deposit_method', ['BANK_TRANSFER', 'UPI', 'CRYPTO'])
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
  utr: varchar('utr', { length: 128 }), // Required for UPI, nullable for BANK_TRANSFER; the transaction hash for CRYPTO
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
  // CRYPTO only: what the player was told to send, at the rate in force when the request was made.
  // `amount` stays the wallet credit in `currency`; a later rate change never touches these.
  cryptoAmount: numeric('crypto_amount', { precision: 24, scale: 6 }), // USDT to send
  cryptoRate: numeric('crypto_rate', { precision: 18, scale: 4 }), // `currency` per 1 USDT
  cryptoNetwork: varchar('crypto_network', { length: 32 }), // e.g. TRC20
  // CRYPTO only: the whitelabel's deposit bonus when the request was made, and what it adds on approval.
  // Paid into the cash wallet as its own ledger entry (category crypto_deposit_bonus); `amount` stays the
  // deposit alone, so deposit reports, VIP qualification and caps never count the bonus.
  cryptoBonusPercent: numeric('crypto_bonus_percent', { precision: 5, scale: 2 }),
  cryptoBonusAmount: numeric('crypto_bonus_amount', { precision: 18, scale: 2 }),
  bonusWalletTxnId: integer('bonus_wallet_txn_id'), // ledger entry of the bonus credit
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
  // One transaction hash backs at most one live crypto request (keyed on crypto_amount, see 0016).
  uniqueIndex('deposit_requests_crypto_txid_unique').on(sql`lower(btrim(${table.utr}))`)
    .where(sql`crypto_amount IS NOT NULL AND utr IS NOT NULL AND status IN ('PENDING', 'APPROVED')`),
])

export const whitelabelPaymentMethods = pgTable('whitelabel_payment_methods', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  enabledMethods: jsonb('enabled_methods').notNull().default('[]'), // Array of method strings
  bankDetails: jsonb('bank_details'), // { accountName, accountNumber, ifsc, bankName, branch, notes? }
  upiDetails: jsonb('upi_details'), // { upiId, displayName?, qrKey? } — qrKey holds a base64 data URI
  limits: jsonb('limits').notNull().default('{"min": 100, "max": 500000}'), // { min, max }
  cryptoDetails: jsonb('crypto_details'), // USDT wallets: { id, network, walletAddress, displayName?, qrKey?, minAmount?, maxAmount?, weight, enabled, vipTierIds? }
  cryptoRate: numeric('crypto_rate', { precision: 18, scale: 4 }), // Deposit currency per 1 USDT, one rate for the whole whitelabel; null = crypto deposits off
  cryptoBonusPercent: numeric('crypto_bonus_percent', { precision: 5, scale: 2 }), // Extra % of a crypto deposit paid on approval (0-50); null or 0 = none
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('whitelabel_payment_methods_tenant_unique').on(table.tenant),
])

