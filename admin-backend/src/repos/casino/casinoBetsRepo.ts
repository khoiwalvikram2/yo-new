import { db } from '@src/db/client.js'
import { mapGrossSettlementToCredit } from '@src/domains/agents/services/creditSettlementMapping.js'
import { eq, and, or, not, gte, lte, desc, inArray, sql, ilike } from 'drizzle-orm'
import { casinoBets, users } from '@shared/db/schema.js'
import { getWhitelabelCurrency, getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'

export type CreateCasinoBetInput = {
  tenant: string
  whitelabelId: string
  userId: number
  gameId: number
  gameName?: string
  providerId?: number
  sessionId?: string
  vendorId: number
  vendorName: string
  tableId?: string
  stake: number
  payout?: number
  winAmount?: number
  netAmount?: number
  status?: string
  gameRoundId?: string
  transactionId?: string
  currency?: string
  metadata?: Record<string, any>
}

export type CasinoBetFilter = {
  betIds?: string[]
  stakeMin?: number
  stakeMax?: number
  vendorName?: string
  gameName?: string
  tenant?: string
  whitelabelId?: string
  userId?: number
  userIds?: number[] // For agent filtering - filter by multiple user IDs
  gameId?: number
  vendorId?: number
  tableId?: string
  status?: string
  statuses?: string[] // For BetsPage multi-select
  walletType?: string
  dateFrom?: string
  dateTo?: string
  search?: string // Free-text: gameName, vendorName, user name/username/phone
  limit?: number
  offset?: number
  /**
   * When true, hide pending/active bets placed via bet-tool / integration (`excludeFromAdminRunning`);
   * settled rows still appear.
   */
  omitOpenAdminToolBets?: boolean
}

export async function createCasinoBet(input: CreateCasinoBetInput) {
  const tenant = input.tenant ?? input.whitelabelId;
  const currency = input.currency ?? await getWhitelabelCurrency(tenant);
  const [bet] = await db.insert(casinoBets).values({
    tenant: input.tenant,
    whitelabelId: input.whitelabelId,
    userId: input.userId,
    gameId: input.gameId,
    gameName: input.gameName,
    providerId: input.providerId,
    sessionId: input.sessionId,
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    tableId: input.tableId,
    stake: String(input.stake),
    payout: input.payout ? String(input.payout) : null,
    winAmount: input.winAmount ? String(input.winAmount) : null,
    netAmount: input.netAmount ? String(input.netAmount) : null,
    status: (input.status || 'pending') as any,
    gameRoundId: input.gameRoundId,
    transactionId: input.transactionId,
    currency,
    metadata: input.metadata || null,
  }).returning()
  return bet
}

async function buildCasinoBetConditions(filter: CasinoBetFilter) {
  const conditions: any[] = []
  if (filter.betIds) conditions.push(inArray(casinoBets.id, filter.betIds))
  if (filter.vendorName) conditions.push(eq(casinoBets.vendorName, filter.vendorName))
  if (filter.gameName) conditions.push(eq(casinoBets.gameName, filter.gameName))
  if (filter.stakeMin != null) conditions.push(gte(casinoBets.stake, String(filter.stakeMin)))
  if (filter.stakeMax != null) conditions.push(lte(casinoBets.stake, String(filter.stakeMax)))
  if (filter.tenant) {
    conditions.push(eq(casinoBets.tenant, filter.tenant))
  }
  if (filter.whitelabelId) {
    conditions.push(eq(casinoBets.whitelabelId, filter.whitelabelId))
  }
  if (filter.userIds && filter.userIds.length > 0) {
    conditions.push(inArray(casinoBets.userId, filter.userIds))
  } else if (filter.userId !== undefined) {
    conditions.push(eq(casinoBets.userId, filter.userId))
  }
  if (filter.gameId) {
    conditions.push(eq(casinoBets.gameId, filter.gameId))
  }
  if (filter.vendorId) {
    conditions.push(eq(casinoBets.vendorId, filter.vendorId))
  }
  if (filter.tableId) {
    conditions.push(eq(casinoBets.tableId, filter.tableId))
  }
  if (filter.statuses && filter.statuses.length > 0) {
    conditions.push(inArray(casinoBets.status, filter.statuses as any))
  } else if (filter.status) {
    conditions.push(eq(casinoBets.status, filter.status as any))
  }
  if (filter.walletType) {
    // Match both camelCase and snake_case for referralBonus (legacy/alternate DB values)
    if (filter.walletType === 'referralBonus') {
      conditions.push(or(
        eq(casinoBets.walletType, 'referralBonus'),
        eq(casinoBets.walletType, 'referral_bonus'),
      ) as any)
    } else {
      conditions.push(eq(casinoBets.walletType, filter.walletType as any))
    }
  }
  if (filter.dateFrom || filter.dateTo) {
    const tz = await getWhitelabelTimezone(filter.tenant ?? 'default')
    if (filter.dateFrom) conditions.push(gte(casinoBets.createdAt, parseDateFrom(filter.dateFrom, tz)))
    if (filter.dateTo) conditions.push(lte(casinoBets.createdAt, parseDateTo(filter.dateTo, tz)))
  }
  if (filter.omitOpenAdminToolBets) {
    conditions.push(
      or(
        eq(casinoBets.excludeFromAdminRunning, false),
        not(inArray(casinoBets.status, ['pending', 'active'] as any))
      )
    )
  }
  return conditions
}

export async function buildCasinoBetsQuery(filter: CasinoBetFilter) {
  const conditions = await buildCasinoBetConditions(filter)
  const search = filter.search?.trim()
  if (search && filter.tenant) {
    const q = `%${search}%`
    const searchUserRows = await db.select({ id: users.id }).from(users).where(and(eq(users.tenant, filter.tenant), or(ilike(users.name, q), ilike(users.username, q), ilike(users.phone, q))))
    const searchUserIds = searchUserRows.map((r) => r.id)
    conditions.push(or(
      searchUserIds.length > 0 ? inArray(casinoBets.userId, searchUserIds) : sql`false`,
      ilike(casinoBets.gameName, q),
      ilike(casinoBets.vendorName, q),
      ilike(casinoBets.transactionId, q), ilike(casinoBets.gameRoundId, q)
    ) as any)
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined
  return { query: db
    .select()
    .from(casinoBets)
    .where(whereClause)
  }
}

export async function getCasinoBets(filter: CasinoBetFilter) {
  const { query } = await buildCasinoBetsQuery(filter)
  return query.orderBy(desc(casinoBets.createdAt), desc(casinoBets.id))
    .limit(filter.limit || 100).offset(filter.offset || 0)
}

/** Aggregated GGR and P&L by wallet type for given user IDs (won/lost only). No row limit; use for agent dashboard. */
export async function getAggregatedGGRPlByWalletTypeForUserIds(
  tenant: string,
  userIds: number[]
): Promise<{ cash: { ggr: number; pl: number }; bonus: { ggr: number; pl: number }; referralBonus: { ggr: number; pl: number } }> {
  const out = { cash: { ggr: 0, pl: 0 }, bonus: { ggr: 0, pl: 0 }, referralBonus: { ggr: 0, pl: 0 } }
  if (!tenant || !userIds?.length) return out
  const rows = await db
    .select({
      walletType: casinoBets.walletType,
      ggr: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0)), 0)`,
      pl: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0) - ${casinoBets.stake}::numeric), 0)`,
    })
    .from(casinoBets)
    .where(
      and(
        eq(casinoBets.tenant, tenant),
        inArray(casinoBets.userId, userIds),
        inArray(casinoBets.status, ['won', 'lost'])
      )
    )
    .groupBy(casinoBets.walletType)
  for (const row of rows) {
    const wt = String(row.walletType || 'cash').toLowerCase().replace(/_/g, '')
    const key = wt === 'referralbonus' ? 'referralBonus' : wt === 'bonus' ? 'bonus' : 'cash'
    out[key].ggr += Number(row.ggr ?? 0)
    out[key].pl += Number(row.pl ?? 0)
  }
  return out
}

/** Total count with same filters as getCasinoBets (no limit/offset). */
export async function getCasinoBetsCount(filter: CasinoBetFilter): Promise<number> {
  const conditions = await buildCasinoBetConditions(filter)
  const search = filter.search?.trim()
  if (search && filter.tenant) {
    const q = `%${search}%`
    const searchUserRows = await db.select({ id: users.id }).from(users).where(and(eq(users.tenant, filter.tenant), or(ilike(users.name, q), ilike(users.username, q), ilike(users.phone, q))))
    const searchUserIds = searchUserRows.map((r) => r.id)
    conditions.push(or(
      searchUserIds.length > 0 ? inArray(casinoBets.userId, searchUserIds) : sql`false`,
      ilike(casinoBets.gameName, q),
      ilike(casinoBets.vendorName, q),
      ilike(casinoBets.transactionId, q), ilike(casinoBets.gameRoundId, q)
    ) as any)
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(casinoBets).where(whereClause)
  return row?.count ?? 0
}

/** Total count + total stake sum with same filters as getCasinoBetsCount. */
export async function getCasinoBetsCountAndStake(filter: CasinoBetFilter): Promise<{ count: number; stakeSum: number }> {
  const conditions = await buildCasinoBetConditions(filter)
  const search = filter.search?.trim()
  if (search && filter.tenant) {
    const q = `%${search}%`
    const searchUserRows = await db.select({ id: users.id }).from(users).where(and(eq(users.tenant, filter.tenant), or(ilike(users.name, q), ilike(users.username, q), ilike(users.phone, q))))
    const searchUserIds = searchUserRows.map((r) => r.id)
    conditions.push(or(
      searchUserIds.length > 0 ? inArray(casinoBets.userId, searchUserIds) : sql`false`,
      ilike(casinoBets.gameName, q),
      ilike(casinoBets.vendorName, q),
      ilike(casinoBets.transactionId, q), ilike(casinoBets.gameRoundId, q)
    ) as any)
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined
  const [row] = await db.select({
    count: sql<number>`count(*)::int`,
    stakeSum: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
  }).from(casinoBets).where(whereClause)
  return { count: row?.count ?? 0, stakeSum: Number(row?.stakeSum ?? 0) }
}

export async function getCasinoBetById(id: string) {
  const [bet] = await db.select().from(casinoBets)
    .where(eq(casinoBets.id, id))
    .limit(1)
  return bet || null
}

export async function updateCasinoBetStatus(
  id: string,
  status: string,
  winAmount?: number,
  netAmount?: number,
  settledAt?: Date
) {
  const betBefore = await getCasinoBetById(id)
  if (!betBefore) return null
  const tenant = betBefore.tenant

  const updateData: any = {
    status: status as any,
    updatedAt: new Date(),
    ...(status === 'won' || status === 'lost' || status === 'void'
      ? { excludeFromAdminRunning: false }
      : {}),
  }
  if (winAmount !== undefined) {
    updateData.winAmount = String(winAmount)
    updateData.payout = String(winAmount)
  }
  if (netAmount !== undefined) updateData.netAmount = String(netAmount)
  if (settledAt !== undefined) updateData.settledAt = settledAt

  const bet = await db.transaction(async (tx): Promise<Awaited<ReturnType<typeof getCasinoBetById>>> => {
    const [updated] = await tx.update(casinoBets).set(updateData).where(eq(casinoBets.id, id)).returning()
    const row = updated ?? null
    if (!row || (status !== 'won' && status !== 'lost' && status !== 'void')) return row

    try {
      const [player] = await tx
        .select({ playerType: users.playerType, agentId: users.agentId })
        .from(users)
        .where(and(eq(users.id, row.userId), eq(users.tenant, tenant)))
        .limit(1)

      if (player?.playerType !== 'AGENT_CREDIT' && player?.playerType !== 'WHITELABEL_CREDIT') return row

      const { BetCreditValidationService } = await import('@src/domains/agents/services/BetCreditValidationService.js')
      const { AgentsRepo } = await import('@src/repos/agents/AgentsRepo.js')
      const { AgentPlayerCreditsRepo } = await import('@src/repos/agents/AgentPlayerCreditsRepo.js')
      const agentsRepo = new AgentsRepo()
      const playerCreditsRepo = new AgentPlayerCreditsRepo()
      const betCreditService = new BetCreditValidationService(agentsRepo, playerCreditsRepo)

      const stake = Number(betBefore?.stake || 0)
      // Stored returns include the stake; credit balances book only the net result.
      const { betResult, payoutAmount } = status === 'won' || status === 'lost'
        ? mapGrossSettlementToCredit(stake, Number(winAmount ?? row.payout ?? 0))
        : { betResult: 'void' as const, payoutAmount: 0 }
      await betCreditService.releaseCreditForBet(row.userId, stake, betResult, payoutAmount, tenant, row.id, 'casino', tx)
    } catch (creditError: any) {
    }
    return row
  })

  if (bet && (status === 'won' || status === 'lost') && netAmount !== undefined && betBefore) {
    try {
      const { referralIntegrationService } = await import('@src/services/referrals/referralIntegrationService.js')
      await referralIntegrationService.handleBetSettlement(tenant, bet.userId, netAmount, (bet.currency || 'INR') as any, 'casino')
    } catch (err) {
    }
  }
  return bet ?? null
}

export type PlayerOverviewSettledByWallet = {
  cash: { ggr: number; pl: number; count: number; settledStakeSum: number }
  bonus: { ggr: number; pl: number; count: number; settledStakeSum: number }
  referralBonus: { ggr: number; pl: number; count: number; settledStakeSum: number }
}

/** Player overview: settled GGR/PL/count by wallet type for one user in date range (no row limit). */
export async function getPlayerOverviewSettledAggregatesByWallet(
  tenant: string,
  userId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<PlayerOverviewSettledByWallet> {
  const out: PlayerOverviewSettledByWallet = {
    cash: { ggr: 0, pl: 0, count: 0, settledStakeSum: 0 },
    bonus: { ggr: 0, pl: 0, count: 0, settledStakeSum: 0 },
    referralBonus: { ggr: 0, pl: 0, count: 0, settledStakeSum: 0 },
  }
  const rows = await db
    .select({
      walletType: casinoBets.walletType,
      ggr: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric - COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0)), 0)`,
      pl: sql<number>`COALESCE(SUM(COALESCE(${casinoBets.payout}::numeric, ${casinoBets.winAmount}::numeric, 0) - ${casinoBets.stake}::numeric), 0)`,
      count: sql<number>`COUNT(*)::int`,
      settledStakeSum: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
    })
    .from(casinoBets)
    .where(
      and(
        eq(casinoBets.tenant, tenant),
        eq(casinoBets.userId, userId),
        inArray(casinoBets.status, ['won', 'lost']),
        gte(casinoBets.createdAt, dateFrom),
        lte(casinoBets.createdAt, dateTo)
      )
    )
    .groupBy(casinoBets.walletType)
  for (const row of rows) {
    const wt = String(row.walletType || 'cash').toLowerCase().replace(/_/g, '')
    const key = wt === 'referralbonus' ? 'referralBonus' : wt === 'bonus' ? 'bonus' : 'cash'
    out[key].ggr += Number(row.ggr ?? 0)
    out[key].pl += Number(row.pl ?? 0)
    out[key].count += Number(row.count ?? 0)
    out[key].settledStakeSum += Number((row as any).settledStakeSum ?? 0)
  }
  return out
}

/** Player overview: all casino bets in date range (count + total stake). */
export async function getPlayerOverviewAllBetsAggregates(
  tenant: string,
  userId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<{ totalCount: number; totalStakeSum: number }> {
  const conditions = [
    eq(casinoBets.tenant, tenant),
    eq(casinoBets.userId, userId),
    gte(casinoBets.createdAt, dateFrom),
    lte(casinoBets.createdAt, dateTo),
  ]
  const [row] = await db
    .select({
      totalCount: sql<number>`COUNT(*)::int`,
      totalStakeSum: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
    })
    .from(casinoBets)
    .where(and(...conditions))
  return {
    totalCount: Number(row?.totalCount ?? 0),
    totalStakeSum: Number(row?.totalStakeSum ?? 0),
  }
}

/** Player overview: open casino bets in date range. */
export async function getPlayerOverviewOpenAggregates(
  tenant: string,
  userId: number,
  dateFrom: Date,
  dateTo: Date
): Promise<{ openCount: number; openStakeSum: number }> {
  const conditions = [
    eq(casinoBets.tenant, tenant),
    eq(casinoBets.userId, userId),
    inArray(casinoBets.status, ['pending', 'active']),
    gte(casinoBets.createdAt, dateFrom),
    lte(casinoBets.createdAt, dateTo),
  ]
  const [row] = await db
    .select({
      openCount: sql<number>`COUNT(*)::int`,
      openStakeSum: sql<number>`COALESCE(SUM(${casinoBets.stake}::numeric), 0)`,
    })
    .from(casinoBets)
    .where(and(...conditions))
  return {
    openCount: Number(row?.openCount ?? 0),
    openStakeSum: Number(row?.openStakeSum ?? 0),
  }
}

