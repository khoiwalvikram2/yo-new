import { and, asc, eq, or, inArray, sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '../db/client.js'
import { users, wallets } from '../db/schema.js'
import { isCreditPlayer } from '@shared/services/credit/isCreditPlayer.js'

type DbOrTx = typeof db
import { normalizePhoneForLookup } from '../utils/phoneUtils.js'

export type UserRow = typeof users.$inferSelect
export type WalletRow = typeof wallets.$inferSelect

export async function findUserByPhone(phone: string, tenant = 'default'): Promise<UserRow | null> {
  // Normalize phone to try multiple formats (with/without +91 prefix)
  const phoneFormats = normalizePhoneForLookup(phone)
  
  // Find user only in the specified tenant (no cross-tenant fallback for login isolation)
  let rows: UserRow[] = []
  if (phoneFormats.length === 1) {
    rows = await db.select().from(users).where(and(eq(users.phone, phoneFormats[0]), eq(users.tenant, tenant)))
  } else {
    rows = await db.select().from(users).where(and(inArray(users.phone, phoneFormats), eq(users.tenant, tenant)))
  }
  return rows[0] ?? null
}

/**
 * Every player of the tenant with exactly this username, oldest first. New usernames are unique per tenant
 * (isUsernameTaken), but older duplicates exist, so a username login has to see all of them: taking whichever
 * row came back first let one duplicate's password log in and the other's fail by physical row order.
 */
export async function findUsersByUsername(username: string, tenant = 'default'): Promise<UserRow[]> {
  return db.select().from(users).where(and(eq(users.username, username), eq(users.tenant, tenant))).orderBy(asc(users.id))
}

/** Is this username taken in the tenant, ignoring case and surrounding spaces? */
export async function isUsernameTaken(username: string, tenant: string, executor: DbOrTx = db): Promise<boolean> {
  const normalized = username.trim().toLowerCase()
  if (!normalized) return false
  const rows = await executor
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenant, tenant), sql`lower(btrim(${users.username})) = ${normalized}`))
    .limit(1)
  return rows.length > 0
}

/**
 * There is no unique index on (tenant, username) yet (existing duplicates must be renamed first), so a creation
 * checks under this transaction-scoped advisory lock: two creations of the same name serialise and the second
 * sees the first. The key is the one admin-backend's createPlayerDb takes (validateUsernameUniqueness), so a
 * signup and an admin creation of the same name serialise too. Keep the two formulas identical.
 */
export async function lockUsernameForCreation(tx: DbOrTx, username: string, tenant: string): Promise<void> {
  const normalized = username.trim().toLowerCase()
  if (!normalized) return
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`users.username:${tenant}:${normalized}`}))`)
}

export async function findUserById(id: number, tenant = 'default'): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(and(eq(users.id, id), eq(users.tenant, tenant)))
  return rows[0] ?? null
}

/** Used by auth to validate JWT token version (force-logout invalidation). */
export async function getTokenVersion(userId: number, tenant = 'default'): Promise<number | null> {
  const rows = await db.select({ tokenVersion: users.tokenVersion }).from(users).where(and(eq(users.id, userId), eq(users.tenant, tenant))).limit(1)
  const row = rows[0]
  return row != null ? Number((row as any).tokenVersion ?? (row as any).token_version ?? 0) : null
}

/** Get token version by user id only (when tenant not in JWT). Id is PK so one row. */
export async function getTokenVersionById(userId: number): Promise<number | null> {
  const rows = await db.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, userId)).limit(1)
  const row = rows[0]
  return row != null ? Number((row as any).tokenVersion ?? (row as any).token_version ?? 0) : null
}

/**
 * Atomically increment the token_version for a player.
 * This invalidates every JWT signed with the old version,
 * enforcing single-device login (previous sessions are force-logged-out).
 * Returns the NEW version so the caller can embed it in the fresh JWT.
 */
export async function incrementTokenVersion(userId: number, tenant = 'default'): Promise<number> {
  const result = await db
    .update(users)
    .set({ tokenVersion: sql<number>`COALESCE(${users.tokenVersion}, 0) + 1` })
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    .returning({ tokenVersion: users.tokenVersion })
  return Number(result[0]?.tokenVersion ?? 1)
}

/** Set last_login_at to now for the user (called on successful login). */
export async function setLastLoginAt(userId: number, tenant = 'default'): Promise<void> {
  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
}

export async function createUser(params: {
  phone: string
  username: string
  password: string
  tenant?: string
  name?: string
  /** Agent attribution (signup through an agent's link). Written in the same insert as the account. */
  agentId?: string | null
  playerType?: UserRow['playerType']
}): Promise<UserRow> {
  const tenant = params.tenant ?? 'default'
  const passwordHash = await bcrypt.hash(params.password, 10)
  const { normalizePhoneForStorage } = await import('../utils/phoneUtils.js')
  const normalizedPhone = normalizePhoneForStorage(params.phone)
  
  // Wrap validation and insert in transaction to prevent race conditions
  return await db.transaction(async (tx) => {
    // Validate phone uniqueness inside transaction
    // Note: authService already checks before calling this, but we validate again here for atomicity
    if (normalizedPhone && normalizedPhone.trim() !== '') {
      // Use normalized phone for direct lookup (phone is already normalized, so direct query is correct)
      const existing = await tx.select().from(users).where(and(eq(users.phone, normalizedPhone), eq(users.tenant, tenant))).limit(1)
      if (existing.length > 0) {
        throw new Error('This phone number is already registered')
      }
    }
    // authService checked the username before sending the OTP; checked again here, under the lock, for atomicity.
    await lockUsernameForCreation(tx as unknown as DbOrTx, params.username, tenant)
    if (await isUsernameTaken(params.username, tenant, tx as unknown as DbOrTx)) {
      throw new Error('This username is already taken')
    }

    let inserted: UserRow[]
    try {
      inserted = await tx.insert(users).values({
        tenant,
        phone: normalizedPhone,
        username: params.username,
        name: params.name || params.username,
        passwordHash,
        email: null,
        ...(params.agentId
          ? { agentId: params.agentId, playerType: params.playerType ?? 'REGULAR' }
          : {}),
      }).returning()
    } catch (error: any) {
      // Catch unique constraint violations and provide user-friendly error
      if (error?.code === '23505' || error?.message?.includes('unique') || error?.message?.includes('duplicate')) {
        if (error?.constraint === 'users_tenant_phone_unique' || error?.message?.includes('phone')) {
          throw new Error('This phone number is already registered')
        }
        throw new Error(error.message || 'A unique constraint violation occurred')
      }
      throw error
    }
    return inserted[0]
  })
}

export async function updatePassword(userId: number, newPassword: string): Promise<void> {
  const passwordHash = await bcrypt.hash(newPassword, 10)
  await db.update(users).set({ passwordHash, requirePasswordReset: false }).where(eq(users.id, userId))
}

export async function getWalletByUserId(userId: number, tenant = 'default'): Promise<WalletRow | null> {
  const rows = await db.select().from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))
  return rows[0] ?? null
}

export async function getWalletByUserIdWithExecutor(
  executor: DbOrTx,
  userId: number,
  tenant = 'default'
): Promise<WalletRow | null> {
  const rows = await executor.select().from(wallets).where(and(eq(wallets.userId, userId), eq(wallets.tenant, tenant)))
  return rows[0] ?? null
}

export async function ensureWalletWithExecutor(
  executor: DbOrTx,
  userId: number,
  tenant = 'default',
  currency = 'INR'
): Promise<WalletRow> {
  const existing = await getWalletByUserIdWithExecutor(executor, userId, tenant)
  if (existing) return existing
  const inserted = await executor.insert(wallets).values({ tenant, userId, currency, cash: '0', bonus: '0', exposure: '0' }).returning()
  return inserted[0]
}

export async function ensureWallet(userId: number, tenant = 'default', currency = 'INR'): Promise<WalletRow> {
  const existing = await getWalletByUserId(userId, tenant)
  if (existing) return existing
  const inserted = await db.insert(wallets).values({ tenant, userId, currency, cash: '0', bonus: '0', exposure: '0' }).returning()
  return inserted[0]
}

export function mapUserProfile(row: UserRow, wallet: WalletRow | null, _legacyUnsettledReferralBalance?: number) {
  // Extract playerType from row (handle both direct property and nested access)
  const playerType = (row as any).playerType || (row as any)?.playerType || 'REGULAR'
  // Credit players (AGENT_CREDIT / WHITELABEL_CREDIT) hold their Deposit/Withdraw chips in
  // wallets.cash, so their credit figures come from the wallet too: creditLimit is only the
  // credit reference their upline set, creditAvailable is their free chips (cash - exposure)
  // and creditUsed is the sports liability held as exposure. users.credit_used and
  // credit_available are retired for them (left at 0) and are not read.
  const creditPlayer = isCreditPlayer(playerType)
  const walletCash = wallet ? Number(wallet.cash ?? 0) : 0
  const walletExposure = wallet ? Number(wallet.exposure ?? 0) : 0

  return {
    id: String(row.id),
    username: row.username || row.name || 'User',
    name: row.name || row.username || 'User',
    phone: row.phone || '',
    level: 1,
    balance: wallet ? Number(wallet.cash ?? 0) : 0,
    bonusBalance: wallet ? Number(wallet.bonus ?? 0) : 0,
    exposure: wallet ? Number(wallet.exposure ?? 0) : 0,
    walletType: '1' as const,
    affiliateCode: undefined,
    referralBalance: wallet ? Number(wallet.referralBalance ?? 0) : _legacyUnsettledReferralBalance ?? 0,
    referralBonusBalance: wallet ? Number(wallet.referralBonus ?? 0) : 0,
    playerType: playerType, // Include playerType for credit player detection
    creditAvailable: creditPlayer
      ? Math.round(Math.max(0, walletCash - walletExposure) * 100) / 100
      : Number((row as any).creditAvailable ?? 0),
    creditLimit: Number((row as any).creditLimit ?? 0),
    creditUsed: creditPlayer ? walletExposure : Number((row as any).creditUsed ?? 0),
    requirePasswordReset: !!(row as any).requirePasswordReset,
  }
}

