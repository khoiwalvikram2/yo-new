import { db, pool } from '@/db/client.js'
import { users, roles, userRoles, wallets as walletsTable, playerLimits as playerLimitsTable, agents } from '@/db/schema.js'
import { and, eq, inArray, ilike, or, ne, notInArray, desc, count, gte, lte } from 'drizzle-orm'
import { hashPassword } from '@/domains/common/auth.js'
import { sql } from 'drizzle-orm'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'
import { getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'
import { getRoleNamesByUserIds } from '@src/repos/rbac/rbacRepo.js'
import { changePlayerVipTier } from '@shared/vip/membership.js'

export async function findUserByEmailWithRoles(email: string, tenant = 'default'): Promise<{ id: number; name: string; email: string; passwordHash: string; roles: string[] } | null> {
  const rows = await db.select({ id: users.id, name: users.name, email: users.email, passwordHash: users.passwordHash }).from(users).where(and(eq(users.email, email), eq(users.tenant, tenant)))
  if (!rows.length) return null
  const u = rows[0]
  const ur = await db.select({ roleId: userRoles.roleId }).from(userRoles).where(and(eq(userRoles.userId, u.id), eq(userRoles.tenant, tenant)))
  const roleIds = ur.map(r => r.roleId)
  let roleNames: string[] = []
  if (roleIds.length) {
    const rs = await db.select({ name: roles.name }).from(roles).where(and(inArray(roles.id, roleIds), eq(roles.tenant, tenant)))
    roleNames = rs.map(r => r.name)
  }
  return { id: u.id, name: u.name, email: u.email || '', passwordHash: u.passwordHash, roles: roleNames }
}

export async function getUsersByIdsDb(ids: number[], tenant = 'default'): Promise<Array<{ id: number; name: string }>> {
  if (!ids.length) return []
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.tenant, tenant)))
  return rows
}

/** For audit trail: resolve actorId to { id, name, email, type, role }. Uses DB and RBAC repo only. */
export async function getAuditActorInfo(
  actorId: string,
  tenant: string
): Promise<{ id: string; name: string; email: string | null; type: string; role: string | null }> {
  if (actorId === 'system' || actorId.startsWith('system:')) {
    return { id: actorId, name: 'System', email: null, type: 'system', role: null }
  }
  const userIdNum = parseInt(actorId, 10)
  if (isNaN(userIdNum) || !Number.isFinite(userIdNum)) {
    return { id: actorId, name: `User ${actorId}`, email: null, type: 'agent', role: null }
  }
  try {
    const userRows = await db
      .select({ id: users.id, name: users.name, email: users.email, username: users.username })
      .from(users)
      .where(eq(users.id, userIdNum))
      .limit(1)
    if (userRows.length === 0) {
      return { id: actorId, name: `User ${actorId}`, email: null, type: 'agent', role: null }
    }
    const user = userRows[0]
    const roleMap = await getRoleNamesByUserIds([userIdNum], tenant)
    const roles = roleMap.get(userIdNum) || []
    const isAdmin = roles.length > 0
    return {
      id: actorId,
      name: user.name || user.username || `User ${actorId}`,
      email: user.email ?? null,
      type: isAdmin ? 'admin' : 'agent',
      role: roles.length > 0 ? roles[0] : null,
    }
  } catch (err) {
    console.warn('[audit] getAuditActorInfo failed', { actorId, tenant, err: err instanceof Error ? err.message : String(err) })
    return { id: actorId, name: `User ${actorId}`, email: null, type: 'agent', role: null }
  }
}

/** For exclusion list and player activity: id, name, username, email, phone, status by IDs (preserves order of requested ids where possible). */
export async function getUsersByIdsForExclusion(ids: number[], tenant: string): Promise<Array<{ id: number; name: string; username: string | null; email: string | null; phone: string | null; status: string | null }>> {
  if (!ids.length) return []
  const rows = await db
    .select({ id: users.id, name: users.name, username: users.username, email: users.email, phone: users.phone, status: users.status })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.tenant, tenant)))
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => r != null)
}

/** Resolve phone numbers to user IDs for the tenant (for exclusion list upload). Normalizes phones before lookup. */
export async function getUserIdsByPhones(phones: string[], tenant: string): Promise<number[]> {
  if (!phones.length) return []
  const { normalizePhoneForStorage } = await import('@/utils/phoneUtils.js')
  const normalized = phones
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .map(normalizePhoneForStorage)
    .filter(Boolean)
  const uniqueNormalized = [...new Set(normalized)]
  if (!uniqueNormalized.length) return []
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenant, tenant), inArray(users.phone, uniqueNormalized)))
  return rows.map((r) => r.id)
}

/** For referral/referee dropdowns: id, name, phone, username. Optional query filters by ilike on name, phone, username. */
export async function getUsersByIdsBasicDb(
  ids: number[],
  tenant: string,
  query?: string
): Promise<Array<{ id: number; name: string; phone: string | null; username: string | null }>> {
  if (!ids.length) return []
  const conditions = [inArray(users.id, ids), eq(users.tenant, tenant)]
  if (query && query.trim().length >= 1) {
    const q = `%${query.trim()}%`
    const orCondition = or(ilike(users.name, q), ilike(users.phone, q), ilike(users.username, q))
    if (orCondition) conditions.push(orCondition)
  }
  const rows = await db
    .select({ id: users.id, name: users.name, phone: users.phone, username: users.username })
    .from(users)
    .where(and(...conditions))
  return rows
}

export async function ensureAdminUser({ email, name, password, roleName = 'Admin', tenant = 'default' }: { email: string; name: string; password: string; roleName?: string; tenant?: string }): Promise<void> {
  // Since email has a unique constraint (not scoped by tenant), first try to find by email alone
  const existingByEmail = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
  let userId: number | null = existingByEmail.length ? existingByEmail[0].id : null

  // ensure role exists for this tenant
  let roleId: number | null = null
  const r = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.name, roleName), eq(roles.tenant, tenant)))
  if (r.length) {
    roleId = r[0].id
  } else {
    const inserted = await db.insert(roles).values({ name: roleName, tenant }).returning({ id: roles.id })
    roleId = inserted[0].id
  }

  if (userId == null) {
    // create user; ignore if another process created it concurrently
    const passwordHash = await hashPassword(password)
    const insertedUser = await db.insert(users)
      .values({ email, name, passwordHash, tenant })
      .onConflictDoNothing()
      .returning({ id: users.id })
    if (insertedUser.length) {
      userId = insertedUser[0].id
    } else {
      const fetched = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
      userId = fetched.length ? fetched[0].id : null
    }
  }

  // assign role mapping for this tenant
  if (roleId != null && userId != null) {
    await db.insert(userRoles).values({ userId, roleId, tenant }).onConflictDoNothing()
  }
}

// Users repo helpers and CRUD used by resolvers

type PublicUserRowLocal = {
  id: number
  name: string
  email: string | null
  phone: string | null
  username: string | null
  status: 'active' | 'inactive' | 'suspended'
  bonusAllowed: boolean
  requirePasswordReset: boolean
  sportsVisible: boolean
  sportsBetAllowed: boolean
  casinoVisible: boolean
  casinoBetAllowed: boolean
  matkaVisible: boolean
  matkaBetAllowed: boolean
  /** Read so the writers' User replies state the real lock (they said false), and User.access.canWithdraw honours it. */
  withdrawalLock: boolean
  vipTierId: string | null
}

/**
 * The row the player-control writers below hand back. Tenant-scoped like the writes: read by id alone it
 * returned another tenant's player (name, username, phone, email) to a caller whose scoped UPDATE had
 * changed nothing, and the resolver reported success with it.
 */
async function getUserPublicByIdDbLocal(id: number, tenant: string): Promise<PublicUserRowLocal | null> {
  const rows = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    phone: users.phone,
    username: users.username,
    status: users.status,
    bonusAllowed: users.bonusAllowed,
    requirePasswordReset: users.requirePasswordReset,
    sportsVisible: users.sportsVisible,
    sportsBetAllowed: users.sportsBetAllowed,
    casinoVisible: users.casinoVisible,
    casinoBetAllowed: users.casinoBetAllowed,
    matkaVisible: users.matkaVisible,
    matkaBetAllowed: users.matkaBetAllowed,
    withdrawalLock: users.withdrawalLock,
    vipTierId: users.vipTierId,
  vipTierMode: users.vipTierMode,
  }).from(users).where(and(eq(users.id, id), eq(users.tenant, tenant)))
  return rows[0] ?? null
}

/**
 * Player-control writers, all scoped to a tenant.
 *
 * Each of these updated `users` by numeric id alone. A permission gate on the
 * resolver stops a caller who holds nothing, but it says nothing about WHICH
 * player: a whitelabel admin holding `players.profile:update` for their own
 * brand could suspend, unlock, force-logout, re-tier or change the password of a
 * player belonging to a different brand, simply by naming their id.
 *
 * The tenant parameter is required rather than optional. An omitted scope is the
 * bug this closes, and a default would let a new call site reintroduce it
 * silently.
 */
export async function updateUserDomainBetsDb(id: number, update: Partial<{ sportsBetAllowed: boolean; casinoBetAllowed: boolean; matkaBetAllowed: boolean; sportsVisible: boolean; casinoVisible: boolean; matkaVisible: boolean }>, tenant: string): Promise<PublicUserRowLocal | null> {
  if (Object.keys(update).length === 0) return null
  const changed = await db.update(users).set(update as any).where(and(eq(users.id, id), eq(users.tenant, tenant))).returning({ id: users.id })
  if (!changed.length) return null
  return getUserPublicByIdDbLocal(id, tenant)
}

/** Null when the id names no player in this tenant, so the resolver answers "User not found". */
export async function setUserBonusAllowedDb(id: number, allow: boolean, tenant: string): Promise<PublicUserRowLocal | null> {
  const changed = await db.update(users).set({ bonusAllowed: allow }).where(and(eq(users.id, id), eq(users.tenant, tenant))).returning({ id: users.id })
  if (!changed.length) return null
  return getUserPublicByIdDbLocal(id, tenant)
}

export async function setUserVipTierDb(id: number, vipTierId: string | null, tenant: string, actor = 'admin', reason?: string): Promise<PublicUserRowLocal | null> {
  await changePlayerVipTier(db, tenant, id, vipTierId, actor, reason)
  return getUserPublicByIdDbLocal(id, tenant)
}

/** Null when the id names no player in this tenant, so the resolver answers "User not found". */
export async function setUserStatusDb(id: number, status: 'ACTIVE'|'INACTIVE'|'SUSPENDED', tenant: string): Promise<PublicUserRowLocal | null> {
  const changed = await db.update(users).set({ status: status.toLowerCase() as any }).where(and(eq(users.id, id), eq(users.tenant, tenant))).returning({ id: users.id })
  if (!changed.length) return null
  return getUserPublicByIdDbLocal(id, tenant)
}

export async function setRequirePasswordResetDb(id: number, require: boolean, tenant: string): Promise<{ id: number; requirePasswordReset: boolean } | null> {
  await db.update(users).set({ requirePasswordReset: require }).where(and(eq(users.id, id), eq(users.tenant, tenant)))
  const rows = await db.select({ id: users.id, requirePasswordReset: users.requirePasswordReset }).from(users).where(and(eq(users.id, id), eq(users.tenant, tenant)))
  return rows[0] ?? null
}

export async function setWithdrawalLockDb(id: number, lock: boolean, tenant: string): Promise<{ id: number; withdrawalLock: boolean } | null> {
  await db.update(users).set({ withdrawalLock: lock }).where(and(eq(users.id, id), eq(users.tenant, tenant)))
  const rows = await db.select({ id: users.id, withdrawalLock: users.withdrawalLock }).from(users).where(and(eq(users.id, id), eq(users.tenant, tenant)))
  return rows[0] ?? null
}

/** Increment token_version to invalidate all existing JWTs for this user (force logout). */
export async function incrementTokenVersionDb(id: number, tenant: string): Promise<void> {
  await db.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1` }).where(and(eq(users.id, id), eq(users.tenant, tenant)))
}

// Super Admin preferences
export async function updateAdminPreferencesDb(
  userId: number,
  preferences: { directorMode?: 'core' | 'whitelabel'; selectedWhitelabelId?: string | null }
): Promise<{ directorMode: string | null; selectedWhitelabelId: string | null }> {
  const update: any = {}
  if (preferences.directorMode !== undefined) {
    update.directorMode = preferences.directorMode
  }
  if (preferences.selectedWhitelabelId !== undefined) {
    update.directorSelectedWhitelabelId = preferences.selectedWhitelabelId
  }
  
  if (Object.keys(update).length > 0) {
    await db.update(users).set(update).where(eq(users.id, userId))
  }
  
  // Fetch updated values
  const [row] = await db
    .select({
      directorMode: users.directorMode,
      selectedWhitelabelId: users.directorSelectedWhitelabelId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  
  // CRITICAL: Return actual database values, don't default to 'core' if null
  // If directorMode is null, it means it wasn't set, so return the requested value
  const savedDirectorMode = row?.directorMode || preferences.directorMode || 'core'
  
  
  // CRITICAL: Return the saved value, or the requested value if database returned null
  const savedSelectedWhitelabelId = row?.selectedWhitelabelId ?? preferences.selectedWhitelabelId ?? null
  
  
  return {
    directorMode: savedDirectorMode,
    selectedWhitelabelId: savedSelectedWhitelabelId,
  }
}

export async function getAdminPreferencesDb(userId: number): Promise<{ directorMode: string | null; selectedWhitelabelId: string | null }> {
  const [row] = await db
    .select({
      directorMode: users.directorMode,
      selectedWhitelabelId: users.directorSelectedWhitelabelId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  
  // CRITICAL: Return actual database values, preserving null if not set
  // Don't convert empty strings to null - preserve the actual value
  const directorMode = row?.directorMode || 'core'
  const selectedWhitelabelId = row?.selectedWhitelabelId ?? null // Use nullish coalescing to preserve empty strings if needed
  
  
  return {
    directorMode,
    selectedWhitelabelId,
  }
}

/**
 * Sets a password. The sharpest of the id-only writers: it changed the login
 * credential of any row in `users` for a caller who knew the numeric id, with no
 * comparison to the tenant the caller administers. Returns false when the id
 * does not name a row in that tenant, so a caller learns the write did not land.
 */
export async function updateUserPasswordDb(
  id: number,
  passwordHash: string,
  /**
   * The tenant the target must belong to, or `null` for a self-change whose id
   * came from the session rather than from arguments.
   *
   * Required, and explicitly nullable, so the decision is visible at the call
   * site. `null` is not a convenience: a platform Super Admin's own `users` row
   * lives in the `default` tenant while `ctx.tenant` is whichever whitelabel
   * they are operating inside, so scoping a self-change by the context tenant
   * would lock them out of their own password.
   */
  tenant: string | null
): Promise<boolean> {
  const where =
    tenant === null ? eq(users.id, id) : and(eq(users.id, id), eq(users.tenant, tenant))
  const rows = await db.update(users).set({ passwordHash }).where(where).returning({ id: users.id })
  return rows.length > 0
}

/**
 * Deliberately not tenant-scoped.
 *
 * Every caller passes an id taken from the session (`ctx.user.sub`) to verify
 * the caller's OWN password before a sensitive action, so there is no id here
 * that an attacker chooses and nothing a tenant predicate would add. Scoping it
 * would also break a platform Super Admin, whose `users` row lives in the
 * `default` tenant while `ctx.tenant` is whichever whitelabel they are
 * currently operating inside.
 *
 * If a call site ever passes an id from arguments, it needs a scoped variant.
 */
export async function getUserPasswordHashDb(id: number): Promise<string | null> {
  const rows = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, id))
  return rows[0]?.passwordHash ?? null
}

export async function getPlayerLimitsDb(userId: number, tenant: string) {
  const rows = await db.select({
    userId: playerLimitsTable.userId,
    dailyStakeLimit: playerLimitsTable.dailyStakeLimit,
    weeklyStakeLimit: playerLimitsTable.weeklyStakeLimit,
    exposureCapOverride: playerLimitsTable.exposureCapOverride,
    cooldownSeconds: playerLimitsTable.cooldownSeconds,
    maxBetSports: playerLimitsTable.maxBetSports,
    maxBetCasino: playerLimitsTable.maxBetCasino,
    maxBetMatka: playerLimitsTable.maxBetMatka,
  }).from(playerLimitsTable).where(and(eq(playerLimitsTable.userId, userId), eq(playerLimitsTable.tenant, tenant)))
  if (!rows.length) return null
  const r: any = rows[0]
  return {
    userId: String(r.userId),
    dailyStakeLimit: r.dailyStakeLimit != null ? Number(r.dailyStakeLimit) : null,
    weeklyStakeLimit: r.weeklyStakeLimit != null ? Number(r.weeklyStakeLimit) : null,
    exposureCapOverride: r.exposureCapOverride != null ? Number(r.exposureCapOverride) : null,
    cooldownSeconds: r.cooldownSeconds ?? null,
    maxBetSports: r.maxBetSports != null ? Number(r.maxBetSports) : null,
    maxBetCasino: r.maxBetCasino != null ? Number(r.maxBetCasino) : null,
    maxBetMatka: r.maxBetMatka != null ? Number(r.maxBetMatka) : null,
  }
}

export async function upsertPlayerLimitsDb(tenant: string, userId: number, limits: {
  dailyStakeLimit: number | null | undefined
  weeklyStakeLimit: number | null | undefined
  exposureCapOverride: number | null | undefined
  cooldownSeconds: number | null | undefined
  maxBetSports: number | null | undefined
  maxBetCasino: number | null | undefined
  maxBetMatka: number | null | undefined
}) {
  // A limits row is only written for a player of this tenant: an id from another tenant used to get a
  // row of its own here, under the caller's tenant, and the caller was told "Limits updated".
  const [player] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.tenant, tenant))).limit(1)
  if (!player) throw new Error('Player not found')
  const existing = await db.select({ userId: playerLimitsTable.userId }).from(playerLimitsTable).where(and(eq(playerLimitsTable.userId, userId), eq(playerLimitsTable.tenant, tenant)))
  if (existing.length) {
    await db.update(playerLimitsTable).set({
      dailyStakeLimit: limits.dailyStakeLimit != null ? String(limits.dailyStakeLimit) : null,
      weeklyStakeLimit: limits.weeklyStakeLimit != null ? String(limits.weeklyStakeLimit) : null,
      exposureCapOverride: limits.exposureCapOverride != null ? String(limits.exposureCapOverride) : null,
      cooldownSeconds: limits.cooldownSeconds ?? null,
      maxBetSports: limits.maxBetSports != null ? String(limits.maxBetSports) : null,
      maxBetCasino: limits.maxBetCasino != null ? String(limits.maxBetCasino) : null,
      maxBetMatka: limits.maxBetMatka != null ? String(limits.maxBetMatka) : null,
    }).where(and(eq(playerLimitsTable.userId, userId), eq(playerLimitsTable.tenant, tenant)))
  } else {
    await db.insert(playerLimitsTable).values({
      tenant,
      userId,
      dailyStakeLimit: limits.dailyStakeLimit != null ? String(limits.dailyStakeLimit) : null,
      weeklyStakeLimit: limits.weeklyStakeLimit != null ? String(limits.weeklyStakeLimit) : null,
      exposureCapOverride: limits.exposureCapOverride != null ? String(limits.exposureCapOverride) : null,
      cooldownSeconds: limits.cooldownSeconds ?? null,
      maxBetSports: limits.maxBetSports != null ? String(limits.maxBetSports) : null,
      maxBetCasino: limits.maxBetCasino != null ? String(limits.maxBetCasino) : null,
      maxBetMatka: limits.maxBetMatka != null ? String(limits.maxBetMatka) : null,
    })
  }
  return {
    userId: String(userId),
    dailyStakeLimit: limits.dailyStakeLimit ?? null,
    weeklyStakeLimit: limits.weeklyStakeLimit ?? null,
    exposureCapOverride: limits.exposureCapOverride ?? null,
    cooldownSeconds: limits.cooldownSeconds ?? null,
    maxBetSports: limits.maxBetSports ?? null,
    maxBetCasino: limits.maxBetCasino ?? null,
    maxBetMatka: limits.maxBetMatka ?? null,
  }
}

export async function createPlayerDb(args: {
  tenant: string
  name: string
  phone: string
  email: string | null
  username?: string | null
  status: 'active' | 'inactive' | 'suspended'
  bonusAllowed: boolean
  requirePasswordReset: boolean
  sportsVisible: boolean
  sportsBetAllowed: boolean
  casinoVisible: boolean
  casinoBetAllowed: boolean
  matkaVisible: boolean
  matkaBetAllowed: boolean
  riskType?: 'low'|'medium'|'high'
  vipTierId?: string
  /** Who picked the tier, for the VIP history and audit rows. */
  vipActor?: string
  // No initialBalance: the wallet always starts at 0. An opening balance is a deposit (whitelabel pool and
  // ledger rows), which the caller makes on the same transaction; writing it straight into cash minted money.
  currency?: string
  password?: string // Required for player creation (no default for security)
  // Credit player fields
  playerType?: 'REGULAR' | 'AGENT_CREDIT' | 'WHITELABEL_CREDIT' | 'SHARING_AGENT_PLAYER' | 'COMMISSION_AGENT_PLAYER'
  agentId?: string | null
  creditLimit?: number | null
  creditUsed?: number | null
  creditAvailable?: number | null
  limits?: {
    dailyStakeLimit?: number | null
    weeklyStakeLimit?: number | null
    exposureCapOverride?: number | null
    cooldownSeconds?: number | null
    maxBetSports?: number | null
    maxBetCasino?: number | null
    maxBetMatka?: number | null
  }
}, tx?: any) {
  const username = typeof args.username === 'string' && args.username.trim() !== '' ? args.username.trim() : null
  const rawPassword = typeof args.password === 'string' ? args.password.trim() : ''
  if (!rawPassword || rawPassword.length < 8) {
    throw new Error('Password is required and must be at least 8 characters')
  }
  const passwordHash = await hashPassword(rawPassword)

  // Ensure tenant is always a valid string, never undefined or null
  let tenant: string = 'default'
  if (args.tenant && typeof args.tenant === 'string' && args.tenant.trim() !== '') {
    tenant = args.tenant.trim()
  }
  
  // Final validation - tenant must be a non-empty string
  if (!tenant || tenant.trim() === '' || tenant === 'undefined' || tenant === 'null') {
    throw new Error(`Invalid tenant: tenant value is required for user creation. Received: ${JSON.stringify(args.tenant)}`)
  }
  
  // Explicitly ensure tenant is a string and not undefined
  const tenantValue: string = String(tenant).trim()
  if (!tenantValue || tenantValue === '') {
    throw new Error(`Invalid tenant: tenant must be a non-empty string. Got: ${JSON.stringify(tenant)}`)
  }
  
  
  // Normalize phone number for consistent storage (remove +91 prefix if present)
  const { normalizePhoneForStorage } = await import('@/utils/phoneUtils.js')
  const normalizedPhone = normalizePhoneForStorage(args.phone)
  
  // Helper function to perform the actual creation logic
  const performCreation = async (dbInstance: any) => {
    // Validate phone uniqueness inside transaction/db instance
    if (normalizedPhone && normalizedPhone.trim() !== '') {
      await validatePhoneUniqueness(normalizedPhone, tenantValue, undefined, dbInstance)
    }
    if (username) {
      await validateUsernameUniqueness(username, tenantValue, dbInstance)
    }

    let inserted: Array<{ id: number }>
    try {
      inserted = await dbInstance.insert(users).values({
        tenant: tenantValue,
        name: args.name,
        username,
        email: args.email,
        phone: normalizedPhone,
        status: args.status,
        bonusAllowed: args.bonusAllowed,
        requirePasswordReset: args.requirePasswordReset,
        sportsVisible: args.sportsVisible,
        sportsBetAllowed: args.sportsBetAllowed,
        casinoVisible: args.casinoVisible,
        casinoBetAllowed: args.casinoBetAllowed,
        matkaVisible: args.matkaVisible,
        matkaBetAllowed: args.matkaBetAllowed,
        riskType: args.riskType as any,
        // Inserted on Automatic; a chosen tier is applied below through the
        // shared setter, which also writes its history and audit rows.
        vipTierId: null,
        vipTierMode: 'AUTO',
        passwordHash,
        // Credit player fields
        playerType: (args.playerType || 'REGULAR') as any,
        agentId: args.agentId || null,
        creditLimit: args.creditLimit != null ? String(args.creditLimit) : '0',
        creditUsed: args.creditUsed != null ? String(args.creditUsed) : '0',
        creditAvailable: args.creditAvailable != null ? String(args.creditAvailable) : '0',
      }).returning({ id: users.id })
    } catch (error: any) {
      // Catch unique constraint violations and provide user-friendly error
      if (error?.code === '23505' || error?.message?.includes('unique') || error?.message?.includes('duplicate')) {
        if (error?.constraint === 'users_tenant_phone_unique' || error?.message?.includes('phone')) {
          throw new Error(`Phone number ${args.phone} is already registered for this tenant`)
        }
        throw new Error(error.message || 'A unique constraint violation occurred')
      }
      throw error
    }
    const userIdNum = inserted[0].id

    if (args.vipTierId) {
      await changePlayerVipTier(dbInstance, tenantValue, userIdNum, args.vipTierId, args.vipActor || 'admin', 'Tier selected during player creation')
    }

    // Always create a wallet, at 0 for every player type (see the note on the args: an opening balance is a deposit)
    try {
      await dbInstance.insert(walletsTable).values({
        tenant: tenantValue,
        userId: userIdNum,
        currency: args.currency || 'INR',
        cash: '0',
        bonus: '0',
        exposure: '0'
      }).onConflictDoNothing()
    } catch (error) {
      // Don't throw - wallet creation failure shouldn't prevent user creation
    }

    const l = args.limits
    const hasAnyLimit = !!l && ['dailyStakeLimit','weeklyStakeLimit','exposureCapOverride','cooldownSeconds','maxBetSports','maxBetCasino','maxBetMatka']
      .some((k) => (l as any)[k] !== undefined && (l as any)[k] !== null)
    if (hasAnyLimit) {
      await dbInstance.insert(playerLimitsTable).values({
        tenant: tenantValue,
        userId: userIdNum,
        dailyStakeLimit: l?.dailyStakeLimit != null ? String(l.dailyStakeLimit) : null,
        weeklyStakeLimit: l?.weeklyStakeLimit != null ? String(l.weeklyStakeLimit) : null,
        exposureCapOverride: l?.exposureCapOverride != null ? String(l.exposureCapOverride) : null,
        cooldownSeconds: l?.cooldownSeconds ?? null,
        maxBetSports: l?.maxBetSports != null ? String(l.maxBetSports) : null,
        maxBetCasino: l?.maxBetCasino != null ? String(l.maxBetCasino) : null,
        maxBetMatka: l?.maxBetMatka != null ? String(l.maxBetMatka) : null,
      }).onConflictDoNothing()
    }

    // Auto-generate referral code for new player (only for regular players, not agent players)
    // Agent players (SHARING_AGENT_PLAYER, COMMISSION_AGENT_PLAYER) don't need their own referral codes
    // as they're under an agent and use the agent's referral link
    // NOTE: This check prevents orphaned referral links when players are created via agent referral codes
    if ((args.playerType === 'REGULAR' || !args.playerType) && !args.agentId) {
      try {
        const { generateReferralLinkDb } = await import('@src/repos/referrals/referralsRepo.js')
        await generateReferralLinkDb(tenantValue, userIdNum, null, undefined, undefined, dbInstance)
      } catch (err) {
        // Log but don't fail player creation if referral code generation fails
      }
    }

    return { id: String(userIdNum), username: username ?? null, name: args.name }
  }
  
  // If no transaction provided, wrap in a transaction for atomicity
  if (!tx) {
    return await db.transaction(async (transactionTx) => {
      return await performCreation(transactionTx)
    })
  }
  
  // Otherwise, use the provided transaction
  return await performCreation(tx)
}

const usersSelectFieldsBase = {
  id: users.id,
  name: users.name,
  email: users.email,
  username: users.username,
  phone: users.phone,
  status: users.status,
  bonusAllowed: users.bonusAllowed,
  requirePasswordReset: users.requirePasswordReset,
  sportsVisible: users.sportsVisible,
  sportsBetAllowed: users.sportsBetAllowed,
  casinoVisible: users.casinoVisible,
  casinoBetAllowed: users.casinoBetAllowed,
  matkaVisible: users.matkaVisible,
  matkaBetAllowed: users.matkaBetAllowed,
  withdrawalLock: (users as any).withdrawalLock,
  riskType: users.riskType,
  vipTierId: users.vipTierId,
  vipTierMode: users.vipTierMode,
  flags: users.flags,
  createdAt: users.createdAt,
  agentId: users.agentId,
  playerType: users.playerType,
  creditLimit: users.creditLimit,
  creditUsed: users.creditUsed,
  creditAvailable: users.creditAvailable,
  settlementBalance: users.settlementBalance,
  settlementBalanceSports: users.settlementBalanceSports,
  settlementBalanceCasino: users.settlementBalanceCasino,
  settlementBalanceMatka: users.settlementBalanceMatka,
  lastLoginAt: users.lastLoginAt,
}
function normalizeUserRow(r: any) {
  return {
    ...r,
    agentId: (r as any).agentId ?? null,
    playerType: (r as any).playerType ?? 'REGULAR',
    creditLimit: Number((r as any).creditLimit ?? 0),
    creditUsed: Number((r as any).creditUsed ?? 0),
    creditAvailable: Number((r as any).creditAvailable ?? 0),
    settlementBalance: Number((r as any).settlementBalance ?? 0),
    settlementBalanceSports: Number((r as any).settlementBalanceSports ?? 0),
    settlementBalanceCasino: Number((r as any).settlementBalanceCasino ?? 0),
    settlementBalanceMatka: Number((r as any).settlementBalanceMatka ?? 0),
  }
}

type ListUsersDbFilter = {
  query?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  registeredFrom?: string;
  registeredTo?: string;
  agentId?: string;
  agentIds?: string[];
  parentType?: string; // ALL, DIRECT, SHARING, CREDIT, COMMISSION
  playerType?: string; // 'WHITELABEL_CREDIT' = only whitelabel credit players, 'REGULAR' = only regular players
  balanceMin?: number;
  balanceMax?: number;
}

/**
 * Staff accounts are not players. A user holding any role in its tenant is an admin or a support admin (rbac's
 * deleteSupportAdmin: an id that holds no role in the tenant is a player, not an admin). The resolvers' admin
 * exclusion list only covered roles whose name contains "admin", so a support admin on a role such as "Finance
 * Manager" was listed and counted as a player.
 */
const notStaffAccount = sql`NOT EXISTS (SELECT 1 FROM ${userRoles} WHERE ${userRoles.userId} = ${users.id} AND ${userRoles.tenant} = ${users.tenant})`

/** The player-type filter of the players list. REGULAR used to mean "not whitelabel credit", which on the All tab kept agent players. */
function playerTypeClause(playerType: string | undefined) {
  if (playerType === 'WHITELABEL_CREDIT') return eq(users.playerType, 'WHITELABEL_CREDIT')
  if (playerType === 'REGULAR') return eq(users.playerType, 'REGULAR')
  return undefined
}

/** A registration date filter. An unparseable value used to become an Invalid Date that matched no player. */
function registeredDate(value: string, parse: (dateStr: string, timezone: string) => Date, tz: string, label: string): Date {
  const date = parse(value, tz)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${label} date: ${value}`)
  return date
}

type ListUsersDbOptions = {
  excludeUserIds?: number[];
  onlyUserIds?: number[];
  offset?: number;
  limit?: number;
  returnWithTotal?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Query helpers for playersStore
export async function listUsersDb(
  filter: ListUsersDbFilter,
  tenant: string,
  options: ListUsersDbOptions & { returnWithTotal: true }
): Promise<{ rows: any[]; total: number }>
export async function listUsersDb(
  filter: ListUsersDbFilter,
  tenant: string,
  options?: ListUsersDbOptions
): Promise<any[]>
export async function listUsersDb(
  filter: ListUsersDbFilter,
  tenant: string,
  options?: ListUsersDbOptions
): Promise<{ rows: any[]; total: number } | any[]> {
  const whereClauses: any[] = [eq(users.tenant, tenant), notStaffAccount]
  if (options?.excludeUserIds?.length) {
    whereClauses.push(notInArray(users.id, options.excludeUserIds))
  }
  if (options?.onlyUserIds?.length) {
    whereClauses.push(inArray(users.id, options.onlyUserIds))
  }
  if (filter.status) {
    const statusLc = filter.status.toLowerCase() as 'active'|'inactive'|'suspended'
    whereClauses.push(eq(users.status, statusLc))
  }
  // From 2 characters, the length the players page sends a query at: a 3-character floor here returned the
  // whole list under a 2-character query.
  const searchText = filter.query?.trim() ?? ''
  if (searchText.length >= 2) {
    const q = `%${searchText}%`
    const matches = [ilike(users.name, q), ilike(users.email, q), ilike(users.phone, q), ilike(users.username, q)]
    // "Search name, email, phone or ID": an all-digit query also finds the player with that id (users.id is int4).
    if (/^\d{1,10}$/.test(searchText) && Number(searchText) <= 2147483647) matches.push(eq(users.id, Number(searchText)))
    whereClauses.push(or(...matches))
  }
  if (filter.agentIds && filter.agentIds.length > 0) {
    whereClauses.push(inArray(users.agentId, filter.agentIds))
  } else if (filter.agentId) {
    whereClauses.push(eq(users.agentId, filter.agentId))
  }
  if (filter.parentType === 'DIRECT') {
    whereClauses.push(sql`${users.agentId} IS NULL`)
  }
  if (filter.registeredFrom || filter.registeredTo) {
    const tz = await getWhitelabelTimezone(tenant)
    if (filter.registeredFrom) {
      whereClauses.push(gte(users.createdAt, registeredDate(filter.registeredFrom, parseDateFrom, tz, 'registeredFrom')))
    }
    if (filter.registeredTo) {
      whereClauses.push(lte(users.createdAt, registeredDate(filter.registeredTo, parseDateTo, tz, 'registeredTo')))
    }
  }
  const typeClause = playerTypeClause(filter.playerType)
  if (typeClause) whereClauses.push(typeClause)

  const useSchemeJoin = filter.parentType === 'SHARING' || filter.parentType === 'CREDIT' || filter.parentType === 'COMMISSION'
  const schemeTypeFilter = useSchemeJoin ? (filter.parentType as 'SHARING' | 'CREDIT' | 'COMMISSION') : undefined
  const sortByBalance = options?.sortBy === 'balance'
  const useBalanceJoin = filter.balanceMin != null || filter.balanceMax != null || sortByBalance
  const userWhere = and(...whereClauses)
  const offset = options?.offset ?? 0
  const limit = options?.limit
  const sortOrder = options?.sortOrder ?? 'desc'

  const buildWhere = () => {
    const parts: any[] = [userWhere]
    if (useSchemeJoin) parts.push(eq(agents.schemeType, schemeTypeFilter!))
    if (filter.balanceMin != null || filter.balanceMax != null) {
      if (filter.balanceMin != null) parts.push(gte(walletsTable.cash, String(filter.balanceMin)))
      if (filter.balanceMax != null) parts.push(lte(walletsTable.cash, String(filter.balanceMax)))
    }
    return and(...parts)
  }

  const balanceSortExpr = sql`CASE WHEN ${users.playerType} IN ('AGENT_CREDIT', 'WHITELABEL_CREDIT') THEN COALESCE(${users.creditAvailable}::numeric, 0) ELSE COALESCE(${walletsTable.cash}::numeric, 0) END`

  const runSelect = (orderAndLimit?: boolean) => {
    let base = db.select(usersSelectFieldsBase).from(users) as any
    if (useSchemeJoin) base = base.innerJoin(agents, eq(users.agentId, agents.id))
    if (useBalanceJoin) base = base.leftJoin(walletsTable, and(eq(users.id, walletsTable.userId), eq(users.tenant, walletsTable.tenant)))
    base = base.where(buildWhere())
    const orderExpr = sortByBalance
      ? (sortOrder === 'asc' ? sql`${balanceSortExpr} ASC` : sql`${balanceSortExpr} DESC`)
      : desc(users.createdAt)
    if (orderAndLimit && limit != null && limit > 0) {
      return base.orderBy(orderExpr, desc(users.id)).limit(limit).offset(offset)
    }
    return base.orderBy(orderExpr, desc(users.id))
  }

  const mergeRemarks = async (rows: any[]) => {
    if (rows.length === 0) return rows
    const ids = rows.map((r: any) => r.id).filter((id: number) => Number.isFinite(id))
    if (ids.length === 0) return rows.map((r: any) => ({ ...normalizeUserRow(r), remark: null }))
    try {
      const result = await pool.query<{ id: number; remark: string | null }>(
        'SELECT id, remark FROM users WHERE tenant = $1 AND id = ANY($2::int[])',
        [tenant, ids]
      )
      const rawRows = result.rows ?? []
      const remarkById = new Map(rawRows.map((r) => [r.id, r.remark ?? null]))
      return rows.map((r: any) => {
        const normalized = normalizeUserRow(r)
        return { ...normalized, remark: remarkById.get(r.id) ?? null }
      })
    } catch (err: any) {
      console.warn('[listUsersDb] mergeRemarks failed:', err?.message ?? err)
      return rows.map((r: any) => ({ ...normalizeUserRow(r), remark: null }))
    }
  }

  if (limit != null && limit > 0) {
    const rows = await runSelect(true)
    const normalized = await mergeRemarks(rows)
    if (options?.returnWithTotal) {
      const useBalanceJoinForCount = filter.balanceMin != null || filter.balanceMax != null
      let countBase = db.select({ count: count() }).from(users) as any
      if (useSchemeJoin) countBase = countBase.innerJoin(agents, eq(users.agentId, agents.id))
      if (useBalanceJoinForCount) countBase = countBase.innerJoin(walletsTable, and(eq(users.id, walletsTable.userId), eq(users.tenant, walletsTable.tenant)))
      const [{ count: total }] = await countBase.where(buildWhere())
      return { rows: normalized, total: Number(total) }
    }
    return normalized
  }

  const rows = await runSelect(false)
  return mergeRemarks(rows)
}

export type PlayersListStatsRow = {
  totalPlayers: number
  activePlayers: number
  suspendedPlayers: number
  inactivePlayers: number
  totalBalance: number
  totalBonus: number
  totalExposure: number
  totalCreditLimit: number
  totalCreditUsed: number
  highUtilizationCount: number
}

/** Lightweight aggregate stats for players list (same filters as listUsersDb, no user rows). */
export async function getPlayersListStatsDb(
  filter: { parentType?: string; agentId?: string; playerType?: string },
  tenant: string,
  options?: { excludeUserIds?: number[]; onlyUserIds?: number[] }
): Promise<PlayersListStatsRow> {
  const whereClauses: any[] = [eq(users.tenant, tenant), notStaffAccount]
  if (options?.excludeUserIds?.length) {
    whereClauses.push(notInArray(users.id, options.excludeUserIds))
  }
  if (options?.onlyUserIds?.length) {
    whereClauses.push(inArray(users.id, options.onlyUserIds))
  }
  if (filter.agentId) {
    whereClauses.push(eq(users.agentId, filter.agentId))
  }
  if (filter.parentType === 'DIRECT') {
    whereClauses.push(sql`${users.agentId} IS NULL`)
  }
  const typeClause = playerTypeClause(filter.playerType)
  if (typeClause) whereClauses.push(typeClause)
  const useJoin = filter.parentType === 'SHARING' || filter.parentType === 'CREDIT' || filter.parentType === 'COMMISSION'
  const schemeTypeFilter = useJoin ? (filter.parentType as 'SHARING' | 'CREDIT' | 'COMMISSION') : undefined
  const userWhere = and(...whereClauses)
  const w = walletsTable

  const sel = {
    totalPlayers: sql<number>`COUNT(${users.id})::int`.as('total_players'),
    activePlayers: sql<number>`COUNT(*) FILTER (WHERE ${users.status} = 'active')::int`.as('active_players'),
    suspendedPlayers: sql<number>`COUNT(*) FILTER (WHERE ${users.status} = 'suspended')::int`.as('suspended_players'),
    inactivePlayers: sql<number>`COUNT(*) FILTER (WHERE ${users.status} = 'inactive')::int`.as('inactive_players'),
    totalBalance: sql<number>`COALESCE(SUM(${w.cash}), 0)::float`.as('total_balance'),
    totalBonus: sql<number>`COALESCE(SUM(${w.bonus}), 0)::float`.as('total_bonus'),
    totalExposure: sql<number>`COALESCE(SUM(${w.exposure}), 0)::float`.as('total_exposure'),
    totalCreditLimit: sql<number>`COALESCE(SUM(${users.creditLimit}), 0)::float`.as('total_credit_limit'),
    totalCreditUsed: sql<number>`COALESCE(SUM(${users.creditUsed}), 0)::float`.as('total_credit_used'),
    highUtilizationCount: sql<number>`COUNT(*) FILTER (WHERE (${users.creditLimit}::float > 0) AND (${users.creditUsed}::float / NULLIF(${users.creditLimit}::float, 0) > 0.8))::int`.as('high_utilization_count'),
  }

  const schemeTypeVal = filter.parentType as 'COMMISSION' | 'SHARING' | 'CREDIT'
  const rows = useJoin
    ? await db.select(sel).from(users).innerJoin(agents, eq(users.agentId, agents.id)).leftJoin(w, and(eq(users.id, w.userId), eq(users.tenant, w.tenant))).where(and(userWhere, eq(agents.schemeType, schemeTypeFilter!)))
    : await db.select(sel).from(users).leftJoin(w, and(eq(users.id, w.userId), eq(users.tenant, w.tenant))).where(userWhere)

  const r = rows[0] as any
  return {
    totalPlayers: Number(r?.totalPlayers ?? r?.total_players ?? 0),
    activePlayers: Number(r?.activePlayers ?? r?.active_players ?? 0),
    suspendedPlayers: Number(r?.suspendedPlayers ?? r?.suspended_players ?? 0),
    inactivePlayers: Number(r?.inactivePlayers ?? r?.inactive_players ?? 0),
    totalBalance: Number(r?.totalBalance ?? r?.total_balance ?? 0),
    totalBonus: Number(r?.totalBonus ?? r?.total_bonus ?? 0),
    totalExposure: Number(r?.totalExposure ?? r?.total_exposure ?? 0),
    totalCreditLimit: Number(r?.totalCreditLimit ?? r?.total_credit_limit ?? 0),
    totalCreditUsed: Number(r?.totalCreditUsed ?? r?.total_credit_used ?? 0),
    highUtilizationCount: Number(r?.highUtilizationCount ?? r?.high_utilization_count ?? 0),
  }
}

const getUserDbSelectFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  username: users.username,
  phone: users.phone,
  status: users.status,
  bonusAllowed: users.bonusAllowed,
  requirePasswordReset: users.requirePasswordReset,
  sportsVisible: users.sportsVisible,
  sportsBetAllowed: users.sportsBetAllowed,
  casinoVisible: users.casinoVisible,
  casinoBetAllowed: users.casinoBetAllowed,
  matkaVisible: users.matkaVisible,
  matkaBetAllowed: users.matkaBetAllowed,
  withdrawalLock: (users as any).withdrawalLock,
  riskType: users.riskType,
  vipTierId: users.vipTierId,
  vipTierMode: users.vipTierMode,
  flags: users.flags,
  createdAt: users.createdAt,
  playerType: users.playerType,
  agentId: users.agentId,
  creditLimit: users.creditLimit,
  creditUsed: users.creditUsed,
  creditAvailable: users.creditAvailable,
  settlementBalance: users.settlementBalance,
  settlementBalanceSports: users.settlementBalanceSports,
  settlementBalanceCasino: users.settlementBalanceCasino,
  settlementBalanceMatka: users.settlementBalanceMatka,
  lastLoginAt: users.lastLoginAt,
  remark: (users as any).remark,
}
const getUserDbSelectFieldsWithoutRemark = { ...getUserDbSelectFields } as any
delete getUserDbSelectFieldsWithoutRemark.remark

/** Type of a full user row returned by getUserDb. Explicit so both try/catch branches and all callers type correctly. */
export type GetUserDbResult = {
  id: number
  name: string
  email: string | null
  username: string | null
  phone: string | null
  status: 'active' | 'inactive' | 'suspended'
  bonusAllowed: boolean
  requirePasswordReset: boolean
  sportsVisible: boolean
  sportsBetAllowed: boolean
  casinoVisible: boolean
  casinoBetAllowed: boolean
  matkaVisible: boolean
  matkaBetAllowed: boolean
  withdrawalLock?: boolean
  riskType: string | null
  vipTierId: string | null
  vipTierMode: string
  flags: Array<{ flag: string; reason?: string; setBy?: string; setAt?: string }> | null
  createdAt: Date | null
  playerType: string | null
  agentId: string | null
  creditLimit: string | null
  creditUsed: string | null
  creditAvailable: string | null
  settlementBalance: string | null
  settlementBalanceSports: string | null
  settlementBalanceCasino: string | null
  settlementBalanceMatka: string | null
  lastLoginAt: Date | null
  remark: string | null
}

export async function getUserDb(id: number, tenant: string): Promise<GetUserDbResult | null> {
  try {
    const rows = await db.select(getUserDbSelectFields).from(users).where(and(eq(users.id, id), eq(users.tenant, tenant)))
    return rows[0] ?? null
  } catch (err: any) {
    if (err?.message?.includes('remark') || err?.code === '42703') {
      const rows = await db.select(getUserDbSelectFieldsWithoutRemark).from(users).where(and(eq(users.id, id), eq(users.tenant, tenant)))
      const row = rows[0]
      return row ? ({ ...row, remark: null } as GetUserDbResult) : null
    }
    throw err
  }
}

/** Update player remark (admin/whitelabel note). Returns true if a row was updated. */
export async function setPlayerRemarkDb(userId: number, tenant: string, remark: string | null): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ remark: remark ?? null } as any)
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
  return (result.rowCount ?? 0) > 0
}

/**
 * Get tenant (whitelabel id) for a user by id. Used when context tenant is missing (e.g. Whitelabel Admin) so we can fallback to the user's tenant.
 */
export async function getTenantByUserId(userId: number): Promise<string | null> {
  const rows = await db.select({ tenant: users.tenant }).from(users).where(eq(users.id, userId)).limit(1)
  return rows[0]?.tenant?.trim() ?? null
}

export type PublicUserRow = NonNullable<Awaited<ReturnType<typeof getUserDb>>>
export async function getUserPublicByIdDb(id: number): Promise<PublicUserRow | null> {
  const tenant = await getTenantByUserId(id)
  if (!tenant) return null
  return getUserDb(id, tenant)
}

export async function createAdminUser(args: {
  tenant: string
  name: string
  email: string
  password: string
  phone?: string | null
}): Promise<number> {
  const passwordHash = await hashPassword(args.password)
  
  // Normalize phone if provided
  let normalizedPhone: string | null = null
  if (args.phone) {
    const { normalizePhoneForStorage } = await import('@/utils/phoneUtils.js')
    normalizedPhone = normalizePhoneForStorage(args.phone)
  }
  
  // Wrap validation and insert in transaction to prevent race conditions
  return await db.transaction(async (tx) => {
    // Validate phone uniqueness inside transaction if phone is provided
    if (normalizedPhone && normalizedPhone.trim() !== '') {
      await validatePhoneUniqueness(normalizedPhone, args.tenant, undefined, tx)
    }
    
    let inserted: Array<{ id: number }>
    try {
      inserted = await tx.insert(users).values({
        tenant: args.tenant,
        name: args.name,
        email: args.email,
        phone: normalizedPhone,
        passwordHash,
        status: 'active',
        bonusAllowed: false,
        requirePasswordReset: false,
        sportsVisible: false,
        sportsBetAllowed: false,
        casinoVisible: false,
        casinoBetAllowed: false,
        matkaVisible: false,
        matkaBetAllowed: false,
      }).returning({ id: users.id })
    } catch (error: any) {
      const pgError = error?.cause ?? error
      const code = pgError?.code ?? error?.code
      const detail = pgError?.detail ?? error?.detail ?? ''
      const pgMessage = pgError?.message ?? error?.message ?? 'Unknown database error'

      if (code === '23505' || pgMessage.includes('unique') || pgMessage.includes('duplicate')) {
        if (pgError?.constraint === 'users_tenant_phone_unique' || pgMessage.includes('phone')) {
          throw new Error(`Phone number ${args.phone} is already registered for this tenant`)
        }
        // The raw Postgres detail ("Key (tenant, email)=(...) already exists.") reached the admin's toast.
        if (pgError?.constraint === 'users_tenant_email_unique' || /\(tenant, email\)|email/i.test(`${detail} ${pgMessage}`)) {
          throw new Error('An account with this e-mail already exists')
        }
        throw new Error('Could not create the admin account: it duplicates an existing account')
      }

      throw new Error(`Database error [${code || 'UNKNOWN'}]: ${pgMessage}${detail ? ` — ${detail}` : ''}`)
    }
    return inserted[0].id
  })
}

export async function deleteUserDb(id: number, tenant: string): Promise<boolean> {
  // Delete user roles first (foreign key constraint)
  await db.delete(userRoles).where(and(eq(userRoles.userId, id), eq(userRoles.tenant, tenant)))
  // Delete user
  const deleted = await db.delete(users).where(and(eq(users.id, id), eq(users.tenant, tenant))).returning({ id: users.id })
  return deleted.length > 0
}

// Credit player management functions
export async function createCreditPlayerDb(args: {
  tenant: string
  name: string
  phone: string
  email: string | null
  username?: string | null
  playerType: 'AGENT_CREDIT' | 'WHITELABEL_CREDIT'
  agentId?: string | null  // Required for AGENT_CREDIT, null for WHITELABEL_CREDIT
  creditLimit: number
  status?: 'active' | 'inactive' | 'suspended'
  currency?: string
  password?: string // Optional; if not provided a random password is generated (no hardcoded default)
}, tx?: any) {
  if (args.playerType === 'AGENT_CREDIT' && !args.agentId) {
    throw new Error('agentId is required for AGENT_CREDIT players')
  }
  if (args.playerType === 'WHITELABEL_CREDIT' && args.agentId) {
    throw new Error('agentId must be null for WHITELABEL_CREDIT players')
  }

  const username = args.username ?? null
  const rawPassword = typeof args.password === 'string' ? args.password.trim() : ''
  const passwordToUse = rawPassword && rawPassword.length >= 8
    ? rawPassword
    : (await import('crypto')).randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 16)
  const passwordHash = await hashPassword(passwordToUse)
  
  const tenant: string = args.tenant || 'default'
  
  // Normalize phone number for consistent storage (remove +91 prefix if present)
  const { normalizePhoneForStorage } = await import('@/utils/phoneUtils.js')
  const normalizedPhone = normalizePhoneForStorage(args.phone)
  
  // Helper function to perform the actual creation logic
  const performCreation = async (dbInstance: any) => {
    // Validate phone uniqueness inside transaction/db instance
    if (normalizedPhone && normalizedPhone.trim() !== '') {
      await validatePhoneUniqueness(normalizedPhone, tenant, undefined, dbInstance)
    }
    // The username rule of every player creation (createPlayerDb, the player signup).
    if (username && username.trim() !== '') {
      await validateUsernameUniqueness(username, tenant, dbInstance)
    }

    let inserted: Array<{ id: number }>
    try {
      inserted = await dbInstance.insert(users).values({
        tenant,
        name: args.name,
        username,
        email: args.email,
        phone: normalizedPhone,
        status: args.status || 'active',
        bonusAllowed: false,
        requirePasswordReset: false,
        sportsVisible: true,
        sportsBetAllowed: true,
        casinoVisible: true,
        casinoBetAllowed: true,
        matkaVisible: true,
        matkaBetAllowed: true,
        passwordHash,
        playerType: args.playerType as any,
        agentId: args.agentId || null,
        creditLimit: args.creditLimit.toString(),
        creditUsed: '0',
        creditAvailable: args.creditLimit.toString(),
      }).returning({ id: users.id })
    } catch (error: any) {
      // Catch unique constraint violations and provide user-friendly error
      if (error?.code === '23505' || error?.message?.includes('unique') ||
          error?.message?.includes('duplicate') || error?.message?.includes('already exists')) {
        throw new Error(`Phone number ${args.phone} is already registered for this tenant`)
      }
      throw error
    }
    const userIdNum = inserted[0].id

    // Create wallet with zero balance for credit players
    try {
      await dbInstance.insert(walletsTable).values({
        tenant,
        userId: userIdNum,
        currency: args.currency || 'INR',
        cash: '0',
      }).onConflictDoNothing()
    } catch {}

    return { id: String(userIdNum) }
  }
  
  // If no transaction provided, wrap in a transaction for atomicity
  if (!tx) {
    return await db.transaction(async (transactionTx) => {
      return await performCreation(transactionTx)
    })
  }
  
  // Otherwise, use the provided transaction
  return await performCreation(tx)
}

export async function updatePlayerTypeDb(
  userId: number,
  tenant: string,
  playerType: 'REGULAR' | 'AGENT_CREDIT' | 'WHITELABEL_CREDIT',
  agentId?: string | null
): Promise<void> {
  const updates: any = {
    playerType: playerType as any,
  }

  if (playerType === 'AGENT_CREDIT') {
    if (!agentId) {
      throw new Error('agentId is required when setting playerType to AGENT_CREDIT')
    }
    updates.agentId = agentId
  } else {
    updates.agentId = null
  }

  // Credit players have no VIP tier.
  if (playerType !== 'REGULAR') {
    updates.vipTierId = null
    updates.vipTierMode = 'AUTO'
  }

  // Reset credit fields if changing to REGULAR
  if (playerType === 'REGULAR') {
    updates.creditLimit = '0'
    updates.creditUsed = '0'
    updates.creditAvailable = '0'
  }

  await db
    .update(users)
    .set(updates)
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
}

export async function movePlayerAgentDb(
  userId: number,
  tenant: string,
  newAgentId: string
): Promise<void> {
  await db
    .update(users)
    .set({ agentId: newAgentId })
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
}

export async function getPlayersByAgentDb(
  agentId: string,
  tenant: string
): Promise<Array<{
  id: number
  name: string
  email: string | null
  phone: string | null
  playerType: string
  creditLimit: number
  creditUsed: number
  creditAvailable: number
}>> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      playerType: users.playerType,
      creditLimit: users.creditLimit,
      creditUsed: users.creditUsed,
      creditAvailable: users.creditAvailable,
    })
    .from(users)
    .where(
      and(
        eq(users.agentId, agentId),
        eq(users.tenant, tenant)
      )
    )

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    playerType: r.playerType || 'REGULAR',
    creditLimit: Number(r.creditLimit || 0),
    creditUsed: Number(r.creditUsed || 0),
    creditAvailable: Number(r.creditAvailable || 0),
  }))
}

export async function updatePlayerBalanceDb(
  userId: number,
  tenant: string,
  balanceDelta: number,
  exposureDelta: number
): Promise<void> {
  // Get current values
  const [current] = await db
    .select({
      settlementBalance: users.settlementBalance,
      creditLimit: users.creditLimit,
      creditUsed: users.creditUsed,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    .limit(1)

  if (!current) {
    throw new Error('Player not found')
  }

  // Update settlementBalance (not wallet balance for credit players)
  const currentSettlementBalance = Number(current.settlementBalance || 0)
  const newSettlementBalance = currentSettlementBalance + balanceDelta
  
  // Update exposure (creditUsed tracks exposure for credit players)
  const currentCreditUsed = Number(current.creditUsed || 0)
  const newCreditUsed = Math.max(0, currentCreditUsed + exposureDelta)
  
  // Calculate creditAvailable using new formula: creditLimit - creditUsed + settlementBalance
  const creditLimit = Number(current.creditLimit || 0)
  const newCreditAvailable = Math.max(0, creditLimit - newCreditUsed + newSettlementBalance)

  await db
    .update(users)
    .set({
      settlementBalance: newSettlementBalance.toString(),
      creditUsed: newCreditUsed.toString(),
      creditAvailable: newCreditAvailable.toString(),
    })
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
}

/**
 * Get credit fields for a user/player
 */
export async function getUserCreditFields(
  userId: number,
  tenant: string,
  executor: any = db
): Promise<{
  creditLimit: number;
  creditUsed: number;
  creditAvailable: number;
  agentId: string | null;
  playerType: string;
} | null> {
  const [row] = await executor
    .select({
      creditLimit: users.creditLimit,
      creditUsed: users.creditUsed,
      creditAvailable: users.creditAvailable,
      agentId: users.agentId,
      playerType: users.playerType,
    })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    creditLimit: Number(row.creditLimit || 0),
    creditUsed: Number(row.creditUsed || 0),
    creditAvailable: Number(row.creditAvailable || 0),
    agentId: row.agentId || null,
    playerType: row.playerType || 'REGULAR',
  };
}

// Phone validation methods
export async function findUserByPhone(
  phone: string,
  tenant: string,
  excludeUserId?: number,
  tx?: any
): Promise<PublicUserRow | null> {
  // Normalize phone before query
  const { normalizePhoneForStorage } = await import('@/utils/phoneUtils.js')
  const normalizedPhone = normalizePhoneForStorage(phone)
  
  // Handle null/empty phone gracefully
  if (!normalizedPhone || normalizedPhone.trim() === '') {
    return null
  }
  
  const dbInstance = tx || db
  
  // Build where conditions
  const conditions = [
    eq(users.tenant, tenant),
    eq(users.phone, normalizedPhone)
  ]
  
  // Exclude current user if provided
  if (excludeUserId !== undefined && excludeUserId !== null) {
    conditions.push(ne(users.id, excludeUserId))
  }
  
  const rows = await dbInstance
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      username: users.username,
      status: users.status,
      bonusAllowed: users.bonusAllowed,
      requirePasswordReset: users.requirePasswordReset,
      sportsVisible: users.sportsVisible,
      sportsBetAllowed: users.sportsBetAllowed,
      casinoVisible: users.casinoVisible,
      casinoBetAllowed: users.casinoBetAllowed,
      matkaVisible: users.matkaVisible,
      matkaBetAllowed: users.matkaBetAllowed,
      vipTierId: users.vipTierId,
  vipTierMode: users.vipTierMode,
    })
    .from(users)
    .where(and(...conditions))
    .limit(1)
  
  return rows[0] ?? null
}

export async function checkPhoneAvailable(
  phone: string,
  tenant: string,
  excludeUserId?: number,
  tx?: any
): Promise<boolean> {
  // Null/empty phone is considered available (skip validation)
  if (!phone || phone.trim() === '') {
    return true
  }
  
  const existing = await findUserByPhone(phone, tenant, excludeUserId, tx)
  return existing === null
}

export async function validatePhoneUniqueness(
  phone: string,
  tenant: string,
  excludeUserId?: number,
  tx?: any
): Promise<void> {
  // Skip validation if phone is null/empty
  if (!phone || phone.trim() === '') {
    return
  }
  
  const existing = await findUserByPhone(phone, tenant, excludeUserId, tx)
  if (existing) {
    throw new Error(`Phone number ${phone} is already registered for this tenant`)
  }
}

/**
 * Usernames are unique per tenant, ignoring case and surrounding spaces. The player app logs in by username and
 * takes one row for it, so a second player created with a taken username could not log in with it (the player
 * signup already refused a taken username). There is no unique index yet: existing duplicates have to be
 * renamed first. Until then the check runs under a transaction-scoped advisory lock on the normalised name, so
 * two creations of the same name serialise here and the second one sees the first. user-backend's createUser
 * takes the same lock (same key), so a signup and an admin creation serialise too.
 *
 * Must run inside a transaction: the lock is released when it ends.
 */
export async function validateUsernameUniqueness(username: string, tenant: string, tx: any): Promise<void> {
  const normalized = username.trim().toLowerCase()
  if (!normalized) return
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`users.username:${tenant}:${normalized}`}))`)
  const [taken] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenant, tenant), sql`lower(btrim(${users.username})) = ${normalized}`))
    .limit(1)
  if (taken) {
    throw new Error(`Username ${username.trim()} is already taken`)
  }
}

