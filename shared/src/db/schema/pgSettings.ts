import { pgTable, serial, varchar, boolean, numeric, text, integer, timestamp, pgEnum, index, uniqueIndex, jsonb } from 'drizzle-orm/pg-core'

export const welivepayOrderStatusEnum = pgEnum('welivepay_order_status', ['pending', 'success', 'expired', 'invalid'])

// Per-tenant payment gateway settings. `provider` allows adding more PGs later.
export const whitelabelPgSettings = pgTable('whitelabel_pg_settings', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull(),
  provider: varchar('provider', { length: 32 }).notNull().default('WELIVEPAY'),
  enabled: boolean('enabled').notNull().default(false),
  displayName: varchar('display_name', { length: 128 }).notNull().default('UPI (Instant)'),
  secretSiteKeyEncrypted: text('secret_site_key_encrypted'),
  webhookToken: varchar('webhook_token', { length: 64 }).notNull(),
  minDeposit: numeric('min_deposit', { precision: 18, scale: 2 }),
  maxDeposit: numeric('max_deposit', { precision: 18, scale: 2 }),
  redirectSuccessUrl: text('redirect_success_url'),
  redirectFailureUrl: text('redirect_failure_url'),
  updatedByUserId: varchar('updated_by_user_id', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('whitelabel_pg_settings_tenant_unique').on(table.tenant),
  uniqueIndex('whitelabel_pg_settings_webhook_token_unique').on(table.webhookToken),
])

// One row per gateway order; drives idempotent webhook crediting.
export const welivepayOrders = pgTable('welivepay_orders', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull(),
  userId: integer('user_id').notNull(),
  orderid: varchar('orderid', { length: 128 }).notNull(),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
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
])
