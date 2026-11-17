import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { DateTime } from 'luxon'
import { appConfigs, depositRequests, users, vipAuditTable, vipMemberHistoryTable, vipMembersTable, vipTiersTable, vipTransactionsTable, whitelabels } from '../db/schema.js'
import { getVipDepositContext, lockVipPlayer, whitelabelTimeZone, type VipDatabase, type VipDepositContext } from './depositAccess.js'

async function ensureMember(tx: VipDatabase, context: VipDepositContext) {
  const now = new Date()
  const [member] = await tx.insert(vipMembersTable).values({
    tenant: context.user.tenant, userId: String(context.user.id), userName: context.user.name,
    userEmail: context.user.email, tierId: context.tier.id, joinedAt: now, lastActivityAt: now, status: 'active',
  }).onConflictDoNothing({ target: [vipMembersTable.tenant, vipMembersTable.userId] }).returning()
  if (member) return member
  const [existing] = await tx.select().from(vipMembersTable).where(and(eq(vipMembersTable.tenant, context.user.tenant),
    eq(vipMembersTable.userId, String(context.user.id)))).for('update').limit(1)
  if (!existing) throw new Error('Unable to load VIP membership')
  return existing
}

/** One atomic write for all admin entry points. No partial user/member state. */
export async function changePlayerVipTier(database: VipDatabase, tenant: string, userId: number,
  tierId: string | null, actor = 'admin', reason = 'VIP tier changed by admin') {
  return database.transaction(async tx => {
    await lockVipPlayer(tx, tenant, userId)
    const [before] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.tenant, tenant))).for('update').limit(1)
    if (!before) throw new Error('Player not found')
    // Resolve the requested mode in-transaction; invalid/cross-tenant/inactive
    // tiers or credit players cause the complete transaction to roll back.
    await tx.update(users).set({ vipTierId: tierId, vipTierMode: tierId ? 'MANUAL' : 'AUTO' })
      .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    const context = await getVipDepositContext(tx, tenant, userId, undefined, { strictManual: true })
    const member = await ensureMember(tx, context)
    await tx.update(users).set({ vipTierId: context.tier.id }).where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    await tx.update(vipMembersTable).set({ tierId: context.tier.id, status: 'active', lastActivityAt: new Date() })
      .where(and(eq(vipMembersTable.id, member.id), eq(vipMembersTable.tenant, tenant)))
    if (before.vipTierId !== context.tier.id || before.vipTierMode !== context.user.vipTierMode || member.status !== 'active') {
      await tx.insert(vipMemberHistoryTable).values({ memberId: member.id, fromTierId: member.tierId,
        toTierId: context.tier.id, reason, pointsAtChange: member.currentPoints, createdAt: new Date() })
      await tx.insert(vipAuditTable).values({ tenant, actor, action: 'assign_player_tier', tierId: context.tier.id,
        message: `Player ${userId}: ${before.vipTierId || 'Automatic'} -> ${context.tier.name} (${context.user.vipTierMode}). ${reason}`, at: new Date() })
    }
    return { ...context.user, vipTierId: context.tier.id, vipTierName: context.tier.name }
  })
}

/** Idempotent post-approval hook shared by manual and gateway deposits.
 * Existing reward balances remain; automatic qualification uses only the new
 * program's approved monthly deposits, never the historical points balance.
 * The hook runs after the approval commits and its failures are only logged,
 * so it also awards any earlier approved deposit of this player that was missed. */
export async function awardVipApprovedDeposit(database: VipDatabase, tenant: string, userId: number, depositId: number) {
  return database.transaction(async tx => {
    await lockVipPlayer(tx, tenant, userId)
    // Only the row's existence matters; a full select would also read the player's screenshot (proof_data).
    const [deposit] = await tx.select({ id: depositRequests.id }).from(depositRequests).where(and(eq(depositRequests.id, depositId),
      eq(depositRequests.userId, userId), eq(depositRequests.tenant, tenant), eq(depositRequests.status, 'APPROVED'))).limit(1)
    if (!deposit) return false
    const context = await getVipDepositContext(tx, tenant, userId)
    // A pre-activation gateway attempt keeps its original initiation timestamp.
    const unawarded = await tx.select({ id: depositRequests.id, amount: depositRequests.amount }).from(depositRequests)
      .leftJoin(vipTransactionsTable, eq(vipTransactionsTable.depositRequestId, depositRequests.id))
      .where(and(eq(depositRequests.tenant, tenant), eq(depositRequests.userId, userId), eq(depositRequests.status, 'APPROVED'),
        gte(depositRequests.createdAt, context.startsAt), isNull(vipTransactionsTable.id)))
      .orderBy(asc(depositRequests.id))
    if (!unawarded.length) return false
    const member = await ensureMember(tx, context)
    let balance = member.currentPoints
    let awarded = 0
    let inserted = 0
    for (const row of unawarded) {
      const points = Math.floor(Number(row.amount))
      const [transaction] = await tx.insert(vipTransactionsTable).values({ memberId: member.id, depositRequestId: row.id,
        type: 'credit', points, description: `Deposit #${row.id} - ${points} points awarded`,
        balanceBefore: balance, balanceAfter: balance + points, createdAt: new Date(),
      }).onConflictDoNothing({ target: vipTransactionsTable.depositRequestId, where: sql`${vipTransactionsTable.depositRequestId} IS NOT NULL` }).returning()
      if (!transaction) continue
      balance += points
      awarded += points
      inserted++
    }
    if (!inserted) return false
    // The membership status is the admin's; a deposit must not lift a suspension.
    await tx.update(vipMembersTable).set({ currentPoints: balance,
      lifetimePoints: member.lifetimePoints + awarded, tierId: context.tier.id, lastActivityAt: new Date() })
      .where(and(eq(vipMembersTable.id, member.id), eq(vipMembersTable.tenant, tenant)))
    // A manual assignment is the admin's to change; only the automatic tier is cached here.
    if (context.user.vipTierMode !== 'MANUAL') await tx.update(users).set({ vipTierId: context.tier.id }).where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    if (member.tierId !== context.tier.id) await tx.insert(vipMemberHistoryTable).values({ memberId: member.id,
      fromTierId: member.tierId, toTierId: context.tier.id, reason: `Monthly deposit qualification: ${context.monthlyDeposits}`,
      pointsAtChange: balance, createdAt: new Date() })
    return unawarded.some(row => row.id === depositId)
  })
}

/** Re-resolves one automatic player under the player lock, by the rules deposits use. */
async function settleAutomaticTier(database: VipDatabase, tenant: string, userId: number, now: Date) {
  return database.transaction(async tx => {
    await lockVipPlayer(tx, tenant, userId)
    const context = await getVipDepositContext(tx, tenant, userId, now)
    // An admin may have pinned a tier after the sweep read this player.
    if (context.user.vipTierMode !== 'AUTO' || context.user.vipTierId === context.tier.id) return false
    await tx.update(users).set({ vipTierId: context.tier.id }).where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    const [member] = await tx.select().from(vipMembersTable).where(and(eq(vipMembersTable.tenant, tenant),
      eq(vipMembersTable.userId, String(userId)))).for('update').limit(1)
    if (member && member.tierId !== context.tier.id) {
      await tx.update(vipMembersTable).set({ tierId: context.tier.id }).where(eq(vipMembersTable.id, member.id))
      await tx.insert(vipMemberHistoryTable).values({ memberId: member.id, fromTierId: member.tierId, toTierId: context.tier.id,
        reason: `Monthly re-qualification: ${context.monthlyDeposits}`, pointsAtChange: member.currentPoints, createdAt: new Date() })
    }
    return true
  })
}

/** Keeps the cached automatic tier in step with the current tenant month.
 * users.vip_tier_id is what bet settings, the player list and exports read, and
 * an approval only ever raises it, so without this sweep an automatic player
 * kept last month's tier after the month rolled over. A cheap scan finds the
 * players whose tier is due to change; each one is then re-resolved under its
 * lock. Credit players lose any stray tier. */
export async function refreshAutomaticVipTiers(database: VipDatabase, now = new Date(), options: { tenants?: string[] } = {}) {
  const only = options.tenants
  const cleared = await database.update(users).set({ vipTierId: null, vipTierMode: 'AUTO' }).where(and(isNotNull(users.vipTierId),
    only ? inArray(users.tenant, only) : undefined,
    sql`(${users.playerType} IN ('AGENT_CREDIT','WHITELABEL_CREDIT') OR EXISTS (SELECT 1 FROM agents a
      WHERE a.id = ${users.agentId} AND a.tenant_id = ${users.tenant} AND a.scheme_type = 'CREDIT'))`)).returning({ id: users.id })
  let changed = 0
  let failed = 0
  const brands = await database.select({ id: whitelabels.id, startsAt: whitelabels.vipStartedAt, timeZone: appConfigs.timeZone, baseCurrency: appConfigs.baseCurrency })
    .from(whitelabels).leftJoin(appConfigs, eq(appConfigs.whitelabelId, whitelabels.id))
    .where(only ? inArray(whitelabels.id, only) : undefined)
  for (const brand of brands) {
    const local = DateTime.fromJSDate(now).setZone(whitelabelTimeZone(brand))
    if (!local.isValid) continue
    const tiers = await database.select().from(vipTiersTable).where(and(eq(vipTiersTable.tenant, brand.id),
      eq(vipTiersTable.status, 'active'))).orderBy(asc(vipTiersTable.level))
    if (!tiers.length) continue
    const sums = database.select({ userId: depositRequests.userId, total: sql<string>`SUM(${depositRequests.amount})`.as('total') })
      .from(depositRequests).where(and(eq(depositRequests.tenant, brand.id), eq(depositRequests.status, 'APPROVED'),
        gte(depositRequests.createdAt, brand.startsAt),
        gte(sql`COALESCE(${depositRequests.reviewedAt},${depositRequests.createdAt})`, local.startOf('month').toJSDate())))
      .groupBy(depositRequests.userId).as('sums')
    const players = await database.select({ id: users.id, cached: users.vipTierId, total: sums.total }).from(users)
      .leftJoin(sums, eq(sums.userId, users.id))
      .where(and(eq(users.tenant, brand.id), eq(users.vipTierMode, 'AUTO'), isNotNull(users.vipTierId)))
    for (const player of players) {
      const total = Number(player.total || 0)
      const due = tiers.filter(tier => total >= tier.minMonthlyDeposit).slice().reverse()[0] || tiers[0]
      if (due.id === player.cached) continue
      try {
        if (await settleAutomaticTier(database, brand.id, player.id, now)) changed++
      } catch (error) {
        failed++
        console.error('[vip] automatic tier refresh failed', { tenant: brand.id, userId: player.id,
          error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return { changed, cleared: cleared.length, failed }
}
