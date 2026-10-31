import { pgTable, serial, timestamp, varchar, uniqueIndex, index, boolean, pgEnum, integer, jsonb, uuid, numeric } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// Define enums at module scope so Drizzle can generate CREATE TYPE statements
export const userStatusEnum = pgEnum('user_status', ['active', 'inactive', 'suspended'])
export const riskTypeEnum = pgEnum('risk_type', ['low', 'medium', 'high'])
export const otpPurposeEnum = pgEnum('otp_purpose', ['login', 'register', 'reset'])
export const playerTypeEnum = pgEnum('player_type', ['REGULAR', 'AGENT_CREDIT', 'WHITELABEL_CREDIT', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER'])

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  email: varchar('email', { length: 160 }),
  name: varchar('name', { length: 120 }).notNull(),
  username: varchar('username', { length: 120 }),
  phone: varchar('phone', { length: 32 }),
  // account status
  status: userStatusEnum('status').notNull().default('active'),
  // account-level flags
  bonusAllowed: boolean('bonus_allowed').notNull().default(true),
  requirePasswordReset: boolean('require_password_reset').notNull().default(false),
  // domain visibility and betting toggles
  sportsVisible: boolean('sports_visible').notNull().default(true),
  sportsBetAllowed: boolean('sports_bet_allowed').notNull().default(true),
  casinoVisible: boolean('casino_visible').notNull().default(true),
  casinoBetAllowed: boolean('casino_bet_allowed').notNull().default(true),
  matkaVisible: boolean('matka_visible').notNull().default(false),
  matkaBetAllowed: boolean('matka_bet_allowed').notNull().default(false),
  // withdrawals
  withdrawalLock: boolean('withdrawal_lock').notNull().default(false),
  // risk controls
  riskType: riskTypeEnum('risk_type'),
  // player flags (stored as array of flag objects: [{ flag: 'SUSPICIOUS', reason: '...', setBy: '...', setAt: '...' }])
  flags: jsonb('flags').$type<Array<{ flag: string; reason: string; setBy: string; setAt: string }>>(),
  // VIP
  vipTierId: varchar('vip_tier_id', { length: 64 }),
  vipTierMode: varchar('vip_tier_mode', { length: 8 }).notNull().default('AUTO'),
  // Credit system (for AGENT_CREDIT and WHITELABEL_CREDIT players)
  playerType: playerTypeEnum('player_type').notNull().default('REGULAR'),
  agentId: uuid('agent_id'), // Reference to sharing agent (for AGENT_CREDIT players)
  creditLimit: numeric('credit_limit', { precision: 18, scale: 2 }).default('0'),
  creditUsed: numeric('credit_used', { precision: 18, scale: 2 }).default('0'),
  creditAvailable: numeric('credit_available', { precision: 18, scale: 2 }).default('0'),
  settlementBalance: numeric('settlement_balance', { precision: 18, scale: 2 }).default('0').notNull(),
  settlementBalanceSports: numeric('settlement_balance_sports', { precision: 18, scale: 2 }).default('0').notNull(),
  settlementBalanceCasino: numeric('settlement_balance_casino', { precision: 18, scale: 2 }).default('0').notNull(),
  settlementBalanceMatka: numeric('settlement_balance_matka', { precision: 18, scale: 2 }).default('0').notNull(),
  // Director Admin preferences (only for Director Admin users)
  directorMode: varchar('director_mode', { length: 16 }), // 'core' | 'whitelabel'
  directorSelectedWhitelabelId: varchar('director_selected_whitelabel_id', { length: 128 }), // Selected whitelabel ID when in whitelabel mode
  passwordHash: varchar('password_hash', { length: 120 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  // Force logout: increment to invalidate all existing JWTs for this user
  tokenVersion: integer('token_version').notNull().default(0),
  // Last successful login (user-facing app); used for admin "Last Activity"
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  // Admin/whitelabel remark for player (e.g. notes visible in player list)
  remark: varchar('remark', { length: 512 }),
  /**
   * Responsible-gambling block. Null means free to play.
   *
   * Deliberately not `status`. That column is written by blockPlayer,
   * unblockPlayer, suspendPlayer and the player-update mutation, none of which
   * know anything about responsible gambling — an admin clicking Activate would
   * silently undo a self-exclusion. Its enum has no value meaning "excluded"
   * either, and settlement contribution filters on status='active', so an RG
   * action would quietly move an agent's revenue share. Two writers, two
   * columns, no lost update.
   *
   * This gates staking and funding only. It must never gate login or
   * withdrawal: an excluded player has to be able to sign in and take their
   * balance out, and stranding it is the failure with no defence.
   *
   * A COOLING_OFF period expires by itself because this is a timestamp; nothing
   * has to run for the player to be freed.
   */
  rgBlockedUntil: timestamp('rg_blocked_until', { withTimezone: true }),
  rgBlockReason: varchar('rg_block_reason', { length: 32 }),
}, (table) => [
  index('users_agent_id_idx').on(table.agentId),
  index('users_rg_blocked_idx').on(table.rgBlockedUntil).where(sql`rg_blocked_until is not null`),
  index('users_tenant_created_idx').on(table.tenant, table.createdAt.desc()),
  uniqueIndex('users_id_tenant_unique').on(table.id, table.tenant),
  uniqueIndex('users_tenant_email_unique').on(table.tenant, table.email),
  // Note: Partial unique index on (tenant, phone) WHERE phone IS NOT NULL is created via migration
  // See: shared/drizzle/0041_add_phone_uniqueness.sql
])

export const userOtps = pgTable('user_otps', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  phone: varchar('phone', { length: 32 }).notNull(),
  codeHash: varchar('code_hash', { length: 120 }).notNull(),
  purpose: otpPurposeEnum('purpose').notNull().default('login'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumed: boolean('consumed').notNull().default(false),
  /** Send throttling. Each OTP costs a real SMS, and the row is upserted per
   *  (phone, purpose, tenant), so the send history has to live on the row
   *  itself. `createdAt` is not refreshed on upsert and cannot serve here. */
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
  sendsInWindow: integer('sends_in_window').notNull().default(0),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('user_otps_tenant_idx').on(table.tenant),
  uniqueIndex('user_otps_phone_purpose_tenant_unique').on(table.phone, table.purpose, table.tenant),
])

