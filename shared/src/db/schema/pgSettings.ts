import { pgTable, serial, varchar, boolean, numeric, text, integer, timestamp, pgEnum, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core'
import type { PayoutRequest } from '../../services/welivepay/welivepayClient.js'
import { withdrawalRequests } from './userPayouts'

export const welivepayOrderStatusEnum = pgEnum('welivepay_order_status', ['pending', 'success', 'expired', 'invalid'])

// Per-tenant payment gateway settings. `provider` allows adding more PGs later.
export const whitelabelPgSettings = pgTable('whitelabel_pg_settings', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull(),
  provider: varchar('provider', { length: 32 }).notNull().default('WELIVEPAY'),
  enabled: boolean('enabled').notNull().default(false),
  // Create-path code of the assigned pay-in gateway (`/api/irispay/create-payment` → IRISPAY).
  payinGateway: varchar('payin_gateway', { length: 32 }).notNull().default('IRISPAY'),
  payoutEnabled: boolean('payout_enabled').notNull().default(false),
  // AUTO = `/api/create-payout` (the project's active assigned provider), else a create-path code.
  payoutGateway: varchar('payout_gateway', { length: 32 }).notNull().default('AUTO'),
  displayName: varchar('display_name', { length: 128 }).notNull().default('UPI (Instant)'),
  secretSiteKeyEncrypted: text('secret_site_key_encrypted'),
  webhookToken: varchar('webhook_token', { length: 64 }).notNull(),
  minDeposit: numeric('min_deposit', { precision: 18, scale: 2 }),
  maxDeposit: numeric('max_deposit', { precision: 18, scale: 2 }),
  minPayout: numeric('min_payout', { precision: 18, scale: 2 }),
  maxPayout: numeric('max_payout', { precision: 18, scale: 2 }),
  redirectSuccessUrl: text('redirect_success_url'),
  redirectFailureUrl: text('redirect_failure_url'),
  updatedByUserId: varchar('updated_by_user_id', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('whitelabel_pg_settings_tenant_unique').on(table.tenant),
  uniqueIndex('whitelabel_pg_settings_webhook_token_unique').on(table.webhookToken),
])

// One row per gateway order; drives idempotent crediting after an authenticated status read.
export const welivepayOrders = pgTable('welivepay_orders', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull(),
  userId: integer('user_id').notNull(),
  orderid: varchar('orderid', { length: 128 }).notNull(),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  gateway: varchar('gateway', { length: 32 }).notNull().default('IRISPAY'),
  // The merchant key the order was created with, so a later key change cannot strand its reconciliation.
  merchantKeyEncrypted: text('merchant_key_encrypted'),
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }).defaultNow().notNull(),
  status: welivepayOrderStatusEnum('status').notNull().default('pending'),
  txnRef: varchar('txn_ref', { length: 128 }),
  paymentLink: text('payment_link'),
  depositRequestId: integer('deposit_request_id'),
  vipPolicySnapshot: jsonb('vip_policy_snapshot'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('welivepay_orders_orderid_unique').on(table.orderid),
  index('welivepay_orders_tenant_idx').on(table.tenant),
  index('welivepay_orders_user_id_idx').on(table.userId),
  index('welivepay_orders_status_idx').on(table.status),
  index('welivepay_orders_reconcile_idx').on(table.status, table.nextCheckAt),
])

// One immutable provider request per already-reserved withdrawal. Retries reuse this body and reference.
export const welivepayPayouts = pgTable('welivepay_payouts', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull(),
  withdrawalRequestId: integer('withdrawal_request_id').notNull().references(() => withdrawalRequests.id),
  orderid: varchar('orderid', { length: 80 }).notNull(),
  gateway: varchar('gateway', { length: 32 }).notNull().default('AUTO'),
  merchantKeyEncrypted: text('merchant_key_encrypted'),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  request: jsonb('request').$type<PayoutRequest>().notNull(),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  payoutId: varchar('payout_id', { length: 128 }),
  merchantTransactionId: varchar('merchant_transaction_id', { length: 128 }),
  utr: varchar('utr', { length: 128 }),
  failureReason: text('failure_reason'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  nextCheckAt: timestamp('next_check_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  uniqueIndex('welivepay_payouts_withdrawal_unique').on(table.withdrawalRequestId),
  uniqueIndex('welivepay_payouts_orderid_unique').on(table.orderid),
  index('welivepay_payouts_reconcile_idx').on(table.status, table.nextCheckAt),
  index('welivepay_payouts_tenant_idx').on(table.tenant),
])
