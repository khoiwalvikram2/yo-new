import { getPlayerTransactionsPage } from '@src/repos/players/playerTransactionsPageRepo.js'
import { getBetPageKeys } from '@src/repos/bets/betsPageRepo.js'
import { isRequestedField } from '@src/domains/common/requestedFields.js'
import { parseDateFrom as _parseDateFrom, parseDateTo as _parseDateTo } from '@src/shared/dateUtils.js'
import { getWhitelabelTimezone as _getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'
import { getUserDb, getPlayerLimitsDb, getUsersByIdsForExclusion, getUsersByIdsBasicDb } from '@/repos/users/usersRepo.js'
import { getReferralAttributionByRefereeDb, getReferralLinkByUserDb, getReferralAttributionsByReferrerDb } from '@/repos/referrals/referralsRepo.js'
import { getReferralEarningsByReferrerDb, getReferralSettlementsByReferrerDb, getReferrerStatsDb } from '@/repos/referrals/referralEarningsRepo.js'
import { getWalletDb, getManualDepositWithdrawalStatsDb, getBonusToCashTransferStatsDb, getReferralToCashTransferStatsDb } from '@/repos/players/walletsRepo.js'
import {
  getSportsBets,
  getSportsBetsCount,
  getPlayerOverviewSettledAggregates as getSportsSettledAggregates,
  getPlayerOverviewAllBetsAggregates as getSportsAllBetsAggregates,
  getPlayerOverviewOpenAggregates as getSportsOpenAggregates,
} from '@/repos/sports/sportsBetsRepo.js'
import {
  getCasinoBets,
  getCasinoBetsCount,
  getPlayerOverviewSettledAggregatesByWallet as getCasinoSettledAggregatesByWallet,
  getPlayerOverviewAllBetsAggregates as getCasinoAllBetsAggregates,
  getPlayerOverviewOpenAggregates as getCasinoOpenAggregates,
} from '@/repos/casino/casinoBetsRepo.js'
import {
  getMatkaBets,
  getMatkaBetsCount,
  getPlayerOverviewSettledAggregates as getMatkaSettledAggregates,
  getPlayerOverviewAllBetsAggregates as getMatkaAllBetsAggregates,
  getPlayerOverviewOpenAggregates as getMatkaOpenAggregates,
} from '@/repos/matka/matkaBetsRepo.js'
import { getVipTierDb, getVipMemberByUserIdDb, listVipTransactionsDb, listVipHistoryDb } from '@/repos/vip/vipRepo.js'
import { listAuditDb } from '@/repos/audit/auditRepo.js'
import { getFirstLedgerEntryByTypeDb, listLedgerEntriesByWalletDb } from '@/repos/players/walletsRepo.js'
import { listWalletLedgerEntriesDb } from '@/repos/players/walletLedgerRepo.js'
import { listBonusAwardsByUserId } from '@/repos/marketing/bonusesRepo.js'
import { isActiveEntityStatus } from '../statusNormalization.js'
import { playerAccess } from '../services/playerAccess.js'
import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { hasPermission, requirePermission } from '@src/domains/common/auth.js'
import { PlayerAuthService } from '../services/PlayerAuthService.js'
import { db } from '@src/db/client.js'
import { bonusAwards, bonusCampaigns, sportsResultsTable, sportsRunnersTable } from '@shared/db/schema.js'
import { eq, inArray, desc, isNull, and } from 'drizzle-orm'
import { requireReadPermission } from '@src/domains/common/auth.js'
import { maySeePlayer } from '@src/domains/players/services/playerVisibility.js'

const playerAuthService = new PlayerAuthService()

async function getDateRange(input: { dateRange?: string; dateFrom?: string; dateTo?: string }, tenant: string) {
  const { getWhitelabelTimezone } = await import('@src/shared/whitelabelConfig.js')
  const { parseDateFrom, parseDateTo, getStartOfDayForDate, getEndOfDayForDate } = await import('@src/shared/dateUtils.js')
  const tz = await getWhitelabelTimezone(tenant)

  if (input.dateFrom && input.dateTo) {
    return { from: parseDateFrom(input.dateFrom, tz), to: parseDateTo(input.dateTo, tz) }
  }
  if (input.dateRange) {
    const { DateTime } = await import('luxon')
    const now = new Date()
    const nowDt = DateTime.now().setZone(tz)
    const todayStart = getStartOfDayForDate(now, tz)
    const todayEnd = getEndOfDayForDate(now, tz)
    const yesterdayStart = nowDt.minus({ days: 1 }).startOf('day').toJSDate()
    const yesterdayEnd = nowDt.minus({ days: 1 }).endOf('day').toJSDate()
    const ranges: Record<string, { from: Date; to: Date }> = {
      all_time: { from: new Date('2000-01-01T00:00:00+05:30'), to: now },
      today: { from: todayStart, to: todayEnd },
      yesterday: { from: yesterdayStart, to: yesterdayEnd },
      last_week: { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now },
      last_month: { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now },
      '24h': { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now },
      '7d': { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), to: now },
      '30d': { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now },
      '90d': { from: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), to: now },
    }
    return ranges[input.dateRange] || ranges['30d']
  }
  const now = new Date()
  return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now }
}

/**
 * Check if agent can access a specific player
 */
async function canAgentAccessPlayer(agentId: string, playerId: number, tenant: string): Promise<boolean> {
  // Use PlayerAuthService for consistent agent-player relationship checking
  const { PlayerAuthService } = await import('../services/PlayerAuthService.js');
  const playerAuthService = new PlayerAuthService();
  return await playerAuthService.canAgentAccessPlayer(agentId, playerId, tenant);
}

type BetCampaignDetailMap = {
  id: string
  name: string
  type: string | null
  distributionType: string | null
  wageringReq: number | null
  validTo: string | null
  validFrom: string | null
  domain: string | null
  status: string | null
  startDate: string | null
  endDate: string | null
  amount: number | null
  percentage: number | null
  amountType: string | null
}

// ── Bet-row builder helpers (shared between per-product and "all" paths) ─────────────────────────

function buildSportsBetRow(
  bet: any,
  stakeVal: number,
  betReturn: number | null,
  netAmount: number,
  eventResultMap: Record<string, string>
): any {
  return {
    id: bet.id,
    product: 'sports',
    userId: String(bet.userId),
    status: bet.status,
    stake: stakeVal,
    liability: Number(bet.liability ?? bet.stake ?? 0),
    return: betReturn,
    netAmount,
    currency: bet.currency || 'USD',
    createdAt: bet.createdAt instanceof Date ? bet.createdAt.toISOString() : (bet.createdAt || new Date().toISOString()),
    settledAt: bet.settledAt instanceof Date ? bet.settledAt.toISOString() : (bet.settledAt || null),
    sportId: bet.sportId,
    sportName: bet.sportName || null,
    leagueId: bet.leagueId,
    leagueName: bet.leagueName || null,
    eventId: bet.eventId,
    eventName: bet.eventName || null,
    marketId: bet.marketId,
    marketName: bet.marketName ?? null,
    selectionId: bet.selectionId,
    selectionName: bet.selectionName ?? null,
    odds: Number(bet.price || 0),
    oddsSize: bet.oddsSize != null ? Number(bet.oddsSize) : null,
    side: bet.side,
    pl: bet.pl != null ? Number(bet.pl) : null,
    result: bet.result ?? null,
    eventResult: bet.marketId ? (eventResultMap[String(bet.marketId)] ?? null) : null,
    ipAddress: bet.ipAddress ?? null,
    deviceInfo: bet.deviceInfo ?? null,
    location: bet.location ?? null,
    country: bet.country ?? null,
    gameId: null, gameName: null, providerId: null, providerName: null,
    vendorName: null, tableId: null, winAmount: null, sessionId: null,
    gameRoundId: null, transactionId: null, matkaId: null, matkaName: null,
    matkaType: null, bidType: null, bidNumbers: null, marketSession: null,
    payoutMultiplier: null, potentialWin: null, actualWin: null, payout: null,
    walletType: 'cash',
    campaign: null,
  }
}

function buildCasinoBetRow(bet: any, isSettled: (s: string) => boolean, campaignMap: Map<number, any>): any {
  const stakeVal = Number(bet.stake || 0)
  const winVal = Number(bet.winAmount || bet.payout || 0)
  const netVal = isSettled(bet.status) ? Number(bet.netAmount || (winVal - stakeVal)) : 0
  return {
    id: bet.id,
    product: 'casino',
    userId: String(bet.userId),
    status: bet.status,
    stake: stakeVal,
    liability: null,
    return: isSettled(bet.status) ? winVal : null,
    netAmount: netVal,
    currency: bet.currency || 'USD',
    createdAt: bet.createdAt instanceof Date ? bet.createdAt.toISOString() : (bet.createdAt || new Date().toISOString()),
    settledAt: bet.settledAt instanceof Date ? bet.settledAt.toISOString() : (bet.settledAt || null),
    sportId: null, sportName: null, leagueId: null, leagueName: null,
    eventId: null, eventName: null, marketId: null, marketName: null,
    selectionId: null, selectionName: null, odds: null, oddsSize: null,
    side: null, pl: null, result: null, eventResult: null,
    ipAddress: null, deviceInfo: null, location: null, country: null,
    gameId: bet.gameId != null ? String(bet.gameId) : null,
    gameName: bet.gameName || null,
    providerId: bet.providerId ? String(bet.providerId) : null,
    providerName: bet.vendorName || null,
    vendorName: bet.vendorName || null,
    tableId: bet.tableId || null,
    winAmount: isSettled(bet.status) ? Number(bet.winAmount || 0) : null,
    sessionId: bet.sessionId || null,
    gameRoundId: bet.gameRoundId || null,
    transactionId: bet.transactionId || null,
    matkaId: null, matkaName: null, matkaType: null, bidType: null, bidNumbers: null,
    marketSession: null, payoutMultiplier: null, potentialWin: null, actualWin: null,
    payout: isSettled(bet.status) ? Number(bet.payout || winVal) : null,
    walletType: bet.walletType || 'cash',
    campaign: bet.bonusAwardId ? (campaignMap.get(bet.bonusAwardId) ?? null) : null,
  }
}

function buildMatkaBetRow(bet: any, isSettled: (s: string) => boolean, matkaNameMap: Record<string, string>): any {
  const stakeVal = Number(bet.betAmount || 0)
  const winVal = Number(bet.actualWin || 0)
  const settled = isSettled(bet.status)
  return {
    id: bet.id,
    product: 'matka',
    userId: String(bet.userId),
    status: bet.status,
    stake: stakeVal,
    liability: null,
    return: settled ? winVal : null,
    netAmount: settled ? (winVal - stakeVal) : 0,
    currency: bet.currency || 'USD',
    createdAt: bet.createdAt instanceof Date ? bet.createdAt.toISOString() : (bet.createdAt || new Date().toISOString()),
    settledAt: bet.settledAt instanceof Date ? bet.settledAt.toISOString() : (bet.settledAt || null),
    sportId: null, sportName: null, leagueId: null, leagueName: null,
    eventId: null, eventName: null, marketId: null,
    marketName: bet.marketName || null,
    selectionId: null, selectionName: null, odds: null, oddsSize: null,
    side: null, pl: null,
    result: bet.result ?? null,
    eventResult: null,
    ipAddress: null, deviceInfo: null, location: null, country: null,
    gameId: null, gameName: null, providerId: null, providerName: null,
    vendorName: null, tableId: null, winAmount: null, sessionId: null,
    gameRoundId: null, transactionId: null,
    matkaId: bet.matkaId,
    matkaName: matkaNameMap[bet.matkaId] || null,
    matkaType: bet.matkaType || null,
    bidType: bet.bidType || null,
    bidNumbers: bet.betNumbers || null,
    marketSession: bet.marketSession ?? null,
    payoutMultiplier: bet.payoutMultiplier != null ? Number(bet.payoutMultiplier) : null,
    potentialWin: bet.potentialWin != null ? Number(bet.potentialWin) : null,
    actualWin: settled ? Number(bet.actualWin ?? 0) : null,
    payout: Number(bet.potentialWin || bet.actualWin || 0),
    walletType: 'cash',
    campaign: null,
  }
}

/** Fetch campaign details for bonus-funded bets via bonusAwards -> bonusCampaigns join */
async function getCampaignDetailsByBonusAwardIds(awardIds: number[]): Promise<Map<number, BetCampaignDetailMap>> {
  const map = new Map<number, BetCampaignDetailMap>()
  if (!awardIds.length) return map
  const rows = await db
    .select({
      awardId: bonusAwards.id,
      awardDistributionType: bonusAwards.distributionType,
      campaignId: bonusCampaigns.id,
      name: bonusCampaigns.name,
      type: bonusCampaigns.type,
      distributionTypeCampaign: bonusCampaigns.distributionType,
      wagering: bonusCampaigns.wagering,
      wageringReq: bonusAwards.wageringReq,
      validTo: bonusCampaigns.validTo,
      validFrom: bonusCampaigns.validFrom,
      domain: bonusCampaigns.domain,
      status: bonusCampaigns.status,
      startDate: bonusCampaigns.startDate,
      endDate: bonusCampaigns.endDate,
      amount: bonusCampaigns.amount,
      percentage: bonusCampaigns.percentage,
      amountType: bonusCampaigns.amountType,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, eq(bonusAwards.campaignId, bonusCampaigns.id))
    .where(inArray(bonusAwards.id, awardIds))
  for (const r of rows) {
    const wageringReq = r.wageringReq != null ? Number(r.wageringReq) : (r.wagering != null ? Number(r.wagering) : null)
    map.set(r.awardId, {
      id: String(r.campaignId),
      name: r.name,
      type: r.type,
      distributionType: (r.awardDistributionType ?? r.distributionTypeCampaign) ?? null,
      wageringReq,
      validTo: r.validTo ? new Date(r.validTo).toISOString() : null,
      validFrom: r.validFrom ? new Date(r.validFrom).toISOString() : null,
      domain: r.domain ?? null,
      status: r.status ?? null,
      startDate: r.startDate ? new Date(r.startDate).toISOString() : null,
      endDate: r.endDate ? new Date(r.endDate).toISOString() : null,
      amount: r.amount != null ? Number(r.amount) : null,
      percentage: r.percentage != null ? Number(r.percentage) : null,
      amountType: r.amountType ?? null,
    })
  }
  return map
}

async function getEventResultsByMarketIds(marketIds: string[]): Promise<Record<string, string>> {
  const resultMap: Record<string, string> = {}
  if (!marketIds.length) return resultMap
  const resultRows = await db
    .select({
      marketId: sportsResultsTable.marketId,
      marketType: sportsResultsTable.marketType,
      runnerId: sportsResultsTable.runnerId,
      selectionName: sportsResultsTable.selectionName,
      result: sportsResultsTable.result,
    })
    .from(sportsResultsTable)
    .where(and(inArray(sportsResultsTable.marketId, marketIds), isNull(sportsResultsTable.rolledBackAt)))
    .orderBy(desc(sportsResultsTable.declaredAt))
  const latestByMarket = new Map<string, typeof resultRows[0]>()
  for (const row of resultRows) {
    if (row.marketId && !latestByMarket.has(row.marketId)) {
      latestByMarket.set(row.marketId, row)
    }
  }
  const runnerIds = [...new Set([...latestByMarket.values()].map((r) => r.runnerId).filter(Boolean))] as string[]
  let runnerNameById: Record<string, string> = {}
  if (runnerIds.length > 0) {
    const runners = await db
      .select({ id: sportsRunnersTable.id, name: sportsRunnersTable.name })
      .from(sportsRunnersTable)
      .where(inArray(sportsRunnersTable.id, runnerIds))
    runnerNameById = Object.fromEntries(runners.map((r) => [r.id, r.name || '']))
  }
  for (const [mid, row] of latestByMarket) {
    const isFancy = row.marketType === 'fancy'
    if (isFancy) {
      // Fancy: show actual numeric result, not selection name
      resultMap[mid] = row.result != null ? String(row.result) : (row.selectionName ?? '—')
    } else if (row.selectionName) {
      resultMap[mid] = row.selectionName
    } else if (row.runnerId && runnerNameById[row.runnerId]) {
      resultMap[mid] = runnerNameById[row.runnerId]
    } else if (row.result != null) {
      resultMap[mid] = String(row.result)
    }
  }
  return resultMap
}

export const playersQueryResolvers = {
  playerProfile: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'players.profile', 'view')
    const userId = Number(args.id)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')
    
    // CRITICAL: For agents, use agent's tenantId from database
    // For Director Admin, use effective tenant based on mode
    // For others, use context tenant
    let tenant: string
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      // Get agent's tenantId from database
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (!agent || !agent.tenantId) {
        throw new Error('Agent not found or tenant not configured')
      }
      tenant = agent.tenantId.trim()
      
      // Check if agent can access this player
      const canAccess = await canAgentAccessPlayer(ctx.user.agentId, userId, tenant)
      if (!canAccess) {
        throw new Error('Unauthorized: You can only access your own players')
      }
    } else {
      // For Director Admin, use effective tenant based on mode
      // For others, use context tenant
      const directorTenant = getEffectiveTenantForDirector(ctx)
      tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    }
    
    const user = await getUserDb(userId, tenant)
    if (!user) throw new Error('Player not found')
    
    const wallet = await getWalletDb(userId, tenant)
    const limits = await getPlayerLimitsDb(userId, tenant)
    const firstDepositAt = wallet
      ? await getFirstLedgerEntryByTypeDb({ tenant, walletId: wallet.id, type: 'deposit' })
      : null
    let vipTierName = null
    if (user.vipTierId) {
      try {
        const tier = await getVipTierDb(user.vipTierId, tenant)
        vipTierName = tier?.name ?? null
      } catch {}
    }
    
    // Last login from users.lastLoginAt (updated on each successful login in user-backend)
    const lastLogin = (user as any).lastLoginAt ? new Date((user as any).lastLoginAt).toISOString() : null
    const lastBet = null // TODO: implement from bets if needed for profile
    
    return {
      id: String(user.id),
      name: user.name,
      email: user.email,
      phone: user.phone,
      username: user.username,
      status: user.status.toUpperCase(),
      tenant: tenant,
      createdAt: user.createdAt?.toISOString() || null,
      lastLogin,
      lastBet,
      firstDeposit: firstDepositAt ? firstDepositAt.toISOString() : null,
      riskType: user.riskType?.toUpperCase() || null,
      kycLevel: null, // TODO: implement KYC
      kycStatus: null,
      kycLastUpdate: null,
      vipTierId: user.vipTierId,
      vipTierName,
      wallet: wallet ? {
        userId: String(userId),
        currency: wallet.currency,
        balance: Number(wallet.cash || 0),
        bonus: Number(wallet.bonus || 0),
        exposure: Number(wallet.exposure || 0),
        referralBalance: (wallet as any).referralBalance != null ? Number((wallet as any).referralBalance) : 0,
        referralBonusBalance: (wallet as any).referralBonus != null ? Number((wallet as any).referralBonus) : 0,
        updatedAt: new Date().toISOString(),
      } : null,
      limits: limits || null,
      // The player API logs in only an active player ("Account is not active"); an inactive one cannot log in.
      // User.access answers from the same rule.
      access: playerAccess(user),
      playerType: user.playerType || null,
      agentId: user.agentId ? String(user.agentId) : null,
      creditLimit: user.creditLimit ? Number(user.creditLimit) : null,
      creditUsed: user.creditUsed ? Number(user.creditUsed) : null,
      creditAvailable: user.creditAvailable ? Number(user.creditAvailable) : null,
      referredBy: await (async () => {
        const attr = await getReferralAttributionByRefereeDb(userId, tenant)
        if (!attr || attr.referrerId <= 0 || attr.status !== 'confirmed') return null
        const referrers = await getUsersByIdsForExclusion([attr.referrerId], tenant)
        const ref = referrers[0]
        if (!ref) return null
        return { id: String(ref.id), username: ref.username ?? null, name: ref.name, phone: ref.phone ?? null }
      })(),
    }
  },

  playerOverview: async (_: any, args: any, ctx: any, info?: any) => {
    requireReadPermission(ctx, 'players.profile', 'view')
    const userId = Number(args.input.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')
    
    // CRITICAL: For agents, use agent's tenantId from database
    // For Director Admin, use effective tenant based on mode
    // For others, use context tenant
    let tenant: string
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      // Get agent's tenantId from database
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (!agent || !agent.tenantId) {
        throw new Error('Agent not found or tenant not configured')
      }
      tenant = agent.tenantId.trim()
      
      // Check if agent can access this player
      const canAccess = await canAgentAccessPlayer(ctx.user.agentId, userId, tenant)
      if (!canAccess) {
        throw new Error('Unauthorized: You can only access your own players')
      }
    } else {
      // For Director Admin, use effective tenant based on mode
      // For others, use context tenant
      const directorTenant = getEffectiveTenantForDirector(ctx)
      tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    }
    
    // The profile header has its own query. Enrich profile only for callers that select it;
    // still check existence in this tenant after the original permission/agent checks.
    const needsProfile = !info || isRequestedField(info, 'profile')
    const profile = needsProfile
      ? await playersQueryResolvers.playerProfile(_, { id: String(userId) }, ctx)
      : null
    if (needsProfile ? !profile : !(await getUserDb(userId, tenant))) throw new Error('Player not found')

    const [dateRange, wallet] = await Promise.all([
      getDateRange(args.input, tenant), getWalletDb(userId, tenant),
    ])
    const bonus = Number(wallet?.bonus || 0)
    
    // Also fetch deposit and withdrawal requests for accurate stats
    const { listDepositRequests } = await import('@/repos/deposits/depositRequestsRepo.js')
    const { listWithdrawalRequests } = await import('@/repos/payments/withdrawalRequestsRepo.js')
    
    // Get deposits for the date range
    const [rangeDeposits, lifetimeDeposits] = await Promise.all([
      listDepositRequests(
        { userId, fromDate: dateRange.from, toDate: dateRange.to },
        tenant,
        { offset: 0, limit: 10000 }
      ),
      listDepositRequests(
        { userId },
        tenant,
        { offset: 0, limit: 10000 }
      ),
    ])
    
    // Get withdrawals for the date range
    const [rangeWithdrawals, lifetimeWithdrawals] = await Promise.all([
      listWithdrawalRequests(
        { userId, fromDate: dateRange.from, toDate: dateRange.to },
        tenant,
        { offset: 0, limit: 10000 }
      ),
      listWithdrawalRequests(
        { userId },
        tenant,
        { offset: 0, limit: 10000 }
      ),
    ])
    
    // Calculate deposit volumes (sum of approved deposits) - amounts already in local currency (INR)
    const rangeDepositCount = rangeDeposits.items.filter((d: any) => d.status === 'APPROVED').length
    const rangeDepositVolume = rangeDeposits.items
      .filter((d: any) => d.status === 'APPROVED')
      .reduce((sum: number, d: any) => sum + Number(d.amount || 0), 0)
    const lifetimeDepositCount = lifetimeDeposits.items.filter((d: any) => d.status === 'APPROVED').length
    const lifetimeDepositVolume = lifetimeDeposits.items
      .filter((d: any) => d.status === 'APPROVED')
      .reduce((sum: number, d: any) => sum + Number(d.amount || 0), 0)
    
    // Calculate withdrawal volumes (sum of completed withdrawals) - amounts already in local currency (INR)
    const rangeWithdrawalCount = rangeWithdrawals.items.filter((w: any) => w.status === 'COMPLETED').length
    const rangeWithdrawalVolume = rangeWithdrawals.items
      .filter((w: any) => w.status === 'COMPLETED')
      .reduce((sum: number, w: any) => sum + Number(w.amount || 0), 0)
    const lifetimeWithdrawalCount = lifetimeWithdrawals.items.filter((w: any) => w.status === 'COMPLETED').length
    const lifetimeWithdrawalVolume = lifetimeWithdrawals.items
      .filter((w: any) => w.status === 'COMPLETED')
      .reduce((sum: number, w: any) => sum + Number(w.amount || 0), 0)
    
    // Use deposit/withdrawal request data ONLY (NO combination with ledger stats to avoid double-counting)
    // depositRequests and withdrawalRequests tables already store amounts in local currency (INR)
    const rangeStats = {
      depositCount: rangeDepositCount,
      depositVolume: rangeDepositVolume,
      withdrawalCount: rangeWithdrawalCount,
      withdrawalVolume: rangeWithdrawalVolume,
    }
    
    const lifetimeStats = {
      depositCount: lifetimeDepositCount,
      depositVolume: lifetimeDepositVolume,
      withdrawalCount: lifetimeWithdrawalCount,
      withdrawalVolume: lifetimeWithdrawalVolume,
    }

    // Get manual deposit/withdrawal stats from ledger (whitelabel admin adjustments)
    let manualDepositCount = 0
    let manualDepositVolume = 0
    let manualWithdrawalCount = 0
    let manualWithdrawalVolume = 0
    if (wallet?.id) {
      const manualStats = await getManualDepositWithdrawalStatsDb({
        tenant,
        walletId: wallet.id,
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
      })
      manualDepositCount = manualStats.manualDepositCount
      manualWithdrawalCount = manualStats.manualWithdrawalCount
      // Repo sums meta.originalAmount = exact amount entered (already in wallet/local currency)
      manualDepositVolume = manualStats.manualDepositVolume
      manualWithdrawalVolume = manualStats.manualWithdrawalVolume
    }

    // Net Deposits = (user deposits + manual deposits) − (user withdrawals + manual withdrawals) for the period
    const netDeposits =
      (rangeStats.depositVolume + manualDepositVolume) -
      (rangeStats.withdrawalVolume + manualWithdrawalVolume)

    // Wagering completion % from active bonus awards (for Bonus segment cards)
    let wageringCompletionPercent = 0
    const bonusAwardsList = await listBonusAwardsByUserId(userId, tenant)
    const activeBonusAwards = bonusAwardsList.filter((a: { status: string }) => a.status === 'active')
    const totalWageringRequired = activeBonusAwards.reduce((sum: number, a: { wageringRequirement: number }) => sum + (a.wageringRequirement || 0), 0)
    const totalWageringCompleted = activeBonusAwards.reduce((sum: number, a: { wageringCompleted: number }) => sum + (a.wageringCompleted || 0), 0)
    if (totalWageringRequired > 0) {
      wageringCompletionPercent = Math.min(100, Math.round((totalWageringCompleted / totalWageringRequired) * 100))
    }
    
    // Aggregated stats from DB (no row limit) for the date range
    const [
      sportsSettled,
      sportsAll,
      sportsOpen,
      casinoSettled,
      casinoAll,
      casinoOpen,
      matkaSettled,
      matkaAll,
      matkaOpen,
    ] = await Promise.all([
      getSportsSettledAggregates(tenant, userId, dateRange.from, dateRange.to),
      getSportsAllBetsAggregates(tenant, userId, dateRange.from, dateRange.to),
      getSportsOpenAggregates(tenant, userId, dateRange.from, dateRange.to),
      getCasinoSettledAggregatesByWallet(tenant, userId, dateRange.from, dateRange.to),
      getCasinoAllBetsAggregates(tenant, userId, dateRange.from, dateRange.to),
      getCasinoOpenAggregates(tenant, userId, dateRange.from, dateRange.to),
      getMatkaSettledAggregates(tenant, userId, dateRange.from, dateRange.to),
      getMatkaAllBetsAggregates(tenant, userId, dateRange.from, dateRange.to),
      getMatkaOpenAggregates(tenant, userId, dateRange.from, dateRange.to),
    ])

    const ggrByWalletType = {
      cash: sportsSettled.ggr + matkaSettled.ggr + casinoSettled.cash.ggr,
      bonus: casinoSettled.bonus.ggr,
      referralBonus: casinoSettled.referralBonus.ggr,
    }
    const plByWalletType = {
      cash: sportsSettled.pl + matkaSettled.pl + casinoSettled.cash.pl,
      bonus: casinoSettled.bonus.pl,
      referralBonus: casinoSettled.referralBonus.pl,
    }
    const betCountByWalletType = {
      cash: sportsSettled.settledCount + matkaSettled.settledCount + casinoSettled.cash.count,
      bonus: casinoSettled.bonus.count,
      referralBonus: casinoSettled.referralBonus.count,
    }
    const totalGgr = ggrByWalletType.cash + ggrByWalletType.bonus + ggrByWalletType.referralBonus
    const totalProfitLoss = plByWalletType.cash + plByWalletType.bonus + plByWalletType.referralBonus
    const safeKpiNum = (n: number) => (Number.isFinite(n) ? n : 0)
    const safeKpiInt = (n: number) => Math.max(0, Math.floor(Number(n)) || 0)

    const totalStake = sportsAll.totalStakeSum + casinoAll.totalStakeSum + matkaAll.totalStakeSum
    const totalReturn =
      (sportsSettled.settledStakeSum - sportsSettled.ggr) +
      (matkaSettled.settledStakeSum - matkaSettled.ggr) +
      (casinoSettled.cash.settledStakeSum - casinoSettled.cash.ggr + casinoSettled.bonus.settledStakeSum - casinoSettled.bonus.ggr + casinoSettled.referralBonus.settledStakeSum - casinoSettled.referralBonus.ggr)
    // NGR from actual GGR so it stays correct when totalStake uses liability for sports
    const netGamingRevenue = totalGgr
    const totalBetCount = sportsAll.totalCount + casinoAll.totalCount + matkaAll.totalCount
    const averageBetSize = totalBetCount > 0 ? totalStake / totalBetCount : 0
    const settledBetsCount = betCountByWalletType.cash + betCountByWalletType.bonus + betCountByWalletType.referralBonus
    const openBetsCount = sportsOpen.openCount + casinoOpen.openCount + matkaOpen.openCount

    const currency = wallet?.currency || 'INR'
    const exposureByProduct = [
      { product: 'Sports', exposure: safeKpiNum(sportsOpen.openStakeSum), currency },
      { product: 'Casino', exposure: safeKpiNum(casinoOpen.openStakeSum), currency },
      { product: 'Matka', exposure: safeKpiNum(matkaOpen.openStakeSum), currency },
    ].filter(e => e.exposure > 0)

    const productDisplayNames: Record<string, string> = { sports: 'Sports Exchange', casino: 'Casino', matka: 'Matka' }
    const topProducts = [
      { product: 'sports', betCount: sportsAll.totalCount, totalStake: sportsAll.totalStakeSum, totalReturn: sportsSettled.settledStakeSum - sportsSettled.ggr },
      { product: 'casino', betCount: casinoAll.totalCount, totalStake: casinoAll.totalStakeSum, totalReturn: (casinoSettled.cash.settledStakeSum - casinoSettled.cash.ggr) + (casinoSettled.bonus.settledStakeSum - casinoSettled.bonus.ggr) + (casinoSettled.referralBonus.settledStakeSum - casinoSettled.referralBonus.ggr) },
      { product: 'matka', betCount: matkaAll.totalCount, totalStake: matkaAll.totalStakeSum, totalReturn: matkaSettled.settledStakeSum - matkaSettled.ggr },
    ]
      .map((p) => {
        const stake = safeKpiNum(p.totalStake)
        const ret = safeKpiNum(p.totalReturn)
        return {
          product: String(p.product),
          identifier: String(p.product),
          name: productDisplayNames[p.product] || String(p.product),
          betCount: safeKpiInt(p.betCount),
          totalStake: stake,
          totalReturn: ret,
          netAmount: safeKpiNum(stake - ret),
        }
      })
      .sort((a, b) => b.totalStake - a.totalStake)

    // Recent activity: fetch last 20 bets per product (for timeline only), then merge with deposits/withdrawals
    const [recentSports, recentCasino, recentMatka] = await Promise.all([
      getSportsBets({
        tenant,
        userId,
        dateFrom: dateRange.from.toISOString(),
        dateTo: dateRange.to.toISOString(),
        limit: 20,
        omitOpenAdminToolBets: true,
      }),
      getCasinoBets({
        tenant,
        userId,
        dateFrom: dateRange.from.toISOString(),
        dateTo: dateRange.to.toISOString(),
        limit: 20,
        omitOpenAdminToolBets: true,
      }),
      getMatkaBets({ tenant, userId, dateFrom: dateRange.from.toISOString(), dateTo: dateRange.to.toISOString(), limit: 20 }),
    ])
    const safeNum = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
    const normalizeBet = (b: any, product: string) => {
      const stakeVal = safeNum(b.stake || b.betAmount || 0)
      let winVal = 0
      if (product === 'sports') winVal = safeNum(b.result || 0)
      else if (product === 'casino') winVal = safeNum(b.winAmount || b.payout || 0)
      else if (product === 'matka') winVal = safeNum(b.actualWin || 0)
      return { ...b, product, _stake: stakeVal, _winAmount: winVal, _createdAt: b.createdAt || b.created_at || null }
    }
    const recentBets = [
      ...(Array.isArray(recentSports) ? recentSports : []).map((b: any) => normalizeBet(b, 'sports')),
      ...(Array.isArray(recentCasino) ? recentCasino : []).map((b: any) => normalizeBet(b, 'casino')),
      ...(Array.isArray(recentMatka) ? recentMatka : []).map((b: any) => normalizeBet(b, 'matka')),
    ]
      .filter((b: any) => b._createdAt)
      .sort((a: any, b: any) => new Date(b._createdAt).getTime() - new Date(a._createdAt).getTime())
      .slice(0, 20)

    const recentActivity: Array<{ id: string; type: string; timestamp: string; description: string; metadata: string | null }> = []
    for (const bet of recentBets) {
      const productLabel = productDisplayNames[bet.product] || bet.product
      recentActivity.push({
        id: `bet-${bet.id}`,
        type: 'BET',
        timestamp: new Date(bet._createdAt).toISOString(),
        description: `${productLabel} bet - ${bet.status} - Stake: ${bet._stake.toFixed(2)}`,
        metadata: JSON.stringify({ product: bet.product, stake: bet._stake, status: bet.status }),
      })
    }
    for (const dep of rangeDeposits.items.filter((d: any) => d.status === 'APPROVED').slice(0, 10)) {
      const ts = dep.createdAt || dep.reviewedAt
      if (!ts) continue
      recentActivity.push({
        id: `dep-${dep.id}`,
        type: 'DEPOSIT',
        timestamp: new Date(ts).toISOString(),
        description: `Deposit - ${Number(dep.amount || 0).toFixed(2)} ${currency}`,
        metadata: JSON.stringify({ amount: dep.amount, method: dep.method }),
      })
    }
    for (const wd of rangeWithdrawals.items.filter((w: any) => w.status === 'COMPLETED').slice(0, 10)) {
      const ts = wd.createdAt || wd.reviewedAt
      if (!ts) continue
      recentActivity.push({
        id: `wd-${wd.id}`,
        type: 'WITHDRAWAL',
        timestamp: new Date(ts).toISOString(),
        description: `Withdrawal - ${Number(wd.amount || 0).toFixed(2)} ${currency}`,
        metadata: JSON.stringify({ amount: wd.amount }),
      })
    }
    recentActivity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    const recentActivityTrimmed = recentActivity.slice(0, 20)

    // Bonus-to-cash transfer sum (ledger credits: bonus_release, bonus_instant_cash_transfer, bonus_instant_cash)
    let bonusToCashTransfer = 0
    let referralToCashTransfer = 0
    if (wallet?.id) {
      const [bonusTransfer, referralTransfer] = await Promise.all([
        getBonusToCashTransferStatsDb({
          tenant,
          walletId: wallet.id,
          dateFrom: dateRange.from,
          dateTo: dateRange.to,
        }),
        getReferralToCashTransferStatsDb({
          tenant,
          walletId: wallet.id,
          dateFrom: dateRange.from,
          dateTo: dateRange.to,
        }),
      ])
      bonusToCashTransfer = bonusTransfer.amount
      referralToCashTransfer = referralTransfer.amount
    }

    // ALL amounts are already in local currency (INR):
    // - Bet stakes: stored in wallet currency (INR) in bets tables
    // - Deposits/Withdrawals: stored in INR in deposit/withdrawal request tables
    // - Manual deposit/withdrawal: meta.originalAmount is in INR
    // - Wallet bonus: stored in INR
    // NO conversion needed - everything is INR end-to-end.
    // All Float! / Int! fields use safeKpiNum/safeKpiInt so we never return null/undefined/NaN.
    const kpis = {
      lifetimeValue: safeKpiNum(lifetimeStats.depositVolume),
      totalWagered: safeKpiNum(totalStake),
      totalWinnings: safeKpiNum(totalReturn),
      netGamingRevenue: safeKpiNum(netGamingRevenue),
      netDeposits: safeKpiNum(netDeposits),
      depositCount: safeKpiInt(rangeStats.depositCount),
      depositVolume: safeKpiNum(rangeStats.depositVolume),
      withdrawalCount: safeKpiInt(rangeStats.withdrawalCount),
      withdrawalVolume: safeKpiNum(rangeStats.withdrawalVolume),
      manualDepositCount: safeKpiInt(manualDepositCount),
      manualDepositVolume: safeKpiNum(manualDepositVolume),
      manualWithdrawalCount: safeKpiInt(manualWithdrawalCount),
      manualWithdrawalVolume: safeKpiNum(manualWithdrawalVolume),
      chargebackCount: safeKpiInt(0),
      chargebackVolume: safeKpiNum(0),
      openBetsCount: safeKpiInt(openBetsCount),
      settledBetsCount: safeKpiInt(settledBetsCount),
      averageBetSize: safeKpiNum(averageBetSize),
      bonusBalance: safeKpiNum(bonus),
      activeBonusesCount: safeKpiInt(activeBonusAwards.length),
      wageringCompletionPercent: safeKpiNum(wageringCompletionPercent),
      casinoRTP: null,
      casinoHitRate: null,
      activeDays: safeKpiInt(0),
      sessionsCount: safeKpiInt(0),
      averageSessionLength: safeKpiNum(0),
      ggr: safeKpiNum(totalGgr),
      profitLoss: safeKpiNum(totalProfitLoss),
      ggrByWalletType: {
        cash: safeKpiNum(ggrByWalletType.cash),
        bonus: safeKpiNum(ggrByWalletType.bonus),
        referralBonus: safeKpiNum(ggrByWalletType.referralBonus),
      },
      plByWalletType: {
        cash: safeKpiNum(plByWalletType.cash),
        bonus: safeKpiNum(plByWalletType.bonus),
        referralBonus: safeKpiNum(plByWalletType.referralBonus),
      },
      bonusToCashTransfer: safeKpiNum(bonusToCashTransfer),
      referralToCashTransfer: safeKpiNum(referralToCashTransfer),
      settledBetCountByWalletType: {
        cash: Math.max(0, Math.floor(Number(betCountByWalletType.cash)) || 0),
        bonus: Math.max(0, Math.floor(Number(betCountByWalletType.bonus)) || 0),
        referralBonus: Math.max(0, Math.floor(Number(betCountByWalletType.referralBonus)) || 0),
      },
      plByProduct: {
        sports: safeKpiNum(sportsSettled.pl),
        casino: safeKpiNum(casinoSettled.cash.pl + casinoSettled.bonus.pl + casinoSettled.referralBonus.pl),
        matka: safeKpiNum(matkaSettled.pl),
      },
      ggrByProduct: {
        sports: safeKpiNum(sportsSettled.ggr),
        casino: safeKpiNum(casinoSettled.cash.ggr + casinoSettled.bonus.ggr + casinoSettled.referralBonus.ggr),
        matka: safeKpiNum(matkaSettled.ggr),
      },
      totalSportsStake: safeKpiNum(sportsSettled.settledStakeSum),
      totalSportsOpenStake: safeKpiNum(sportsOpen.openStakeSum),
      totalCasinoStake: safeKpiNum(casinoAll.totalStakeSum),
      totalMatkaStake: safeKpiNum(matkaAll.totalStakeSum),
    }
    
    return {
      profile,
      kpis,
      recentActivity: recentActivityTrimmed,
      exposureByProduct,
      topProducts,
    }
  },

  playerBets: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'players.bets', 'view')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const userId = Number(args.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')

    
    // If agent is logged in, check if they can access this player
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const canAccess = await canAgentAccessPlayer(ctx.user.agentId, userId, tenant)
      if (!canAccess) {
        throw new Error('Unauthorized: You can only access your own players')
      }
    }
    
    const filter = args.filter || {}
    // For per-product queries: honour the client limit/offset directly (DB-level pagination).
    // For "all" queries: cap limit at 100 for the merged/sorted view; use offset too.
    const limit = Math.min(Math.max(1, filter.limit || 50), 500)
    const offset = Math.max(0, filter.offset || 0)

    const tz = await _getWhitelabelTimezone(tenant)
    const base = {
      tenant, userId,
      dateFrom: filter.dateFrom ? _parseDateFrom(filter.dateFrom, tz).toISOString() : undefined,
      dateTo: filter.dateTo ? _parseDateTo(filter.dateTo, tz).toISOString() : undefined,
      search: filter.search?.trim() || undefined,
      stakeMin: filter.stakeMin, stakeMax: filter.stakeMax,
    }
    const product = String(filter.product || 'all').toLowerCase()
    if (!['all','sports','casino','matka'].includes(product)) throw new Error('Invalid bet product')
    const wallet = String(filter.walletType || '').toLowerCase().replace(/_/g, '')
    const cash = !wallet || wallet === 'cash'
    const status = String(filter.status || '').toLowerCase()
    const statuses = (domain: string): string[] | undefined | null => {
      if (!status) return undefined
      if (status === 'settled') return domain === 'sports' ? ['settled','won','lost'] : ['won','lost']
      const valid = domain === 'sports' ? ['matched','unmatched','cancelled','settled','won','lost','void'] : ['pending','active','won','lost','cancelled','void']
      return valid.includes(status) ? [status] : null
    }
    const include = (domain: string) => (product === 'all' || product === domain) && statuses(domain) !== null
    const sportsFilter = cash && include('sports') ? { ...base, statuses: statuses('sports')!, sportId: filter.sportId, leagueId: filter.leagueId, omitOpenAdminToolBets: true } : undefined
    const casinoFilter = include('casino') ? { ...base, statuses: statuses('casino')!, gameId: filter.gameId ? Number(filter.gameId) : undefined, walletType: wallet === 'referralbonus' ? 'referralBonus' : wallet || undefined, omitOpenAdminToolBets: true } : undefined
    const matkaFilter = cash && include('matka') ? { ...base, statuses: statuses('matka')!, matkaId: filter.matkaId } : undefined
    const [keys, sportsTotal, casinoTotal, matkaTotal] = await Promise.all([
      getBetPageKeys({ sports: sportsFilter, casino: casinoFilter, matka: matkaFilter }, offset, limit),
      sportsFilter ? getSportsBetsCount(sportsFilter) : 0,
      casinoFilter ? getCasinoBetsCount(casinoFilter) : 0,
      matkaFilter ? getMatkaBetsCount(matkaFilter) : 0,
    ])
    const ids = (domain: string) => keys.filter(key => key.domain === domain).map(key => key.id)
    const sportsIds = ids('SPORTS'), casinoIds = ids('CASINO'), matkaIds = ids('MATKA')
    const [sportsRows, casinoRows, matkaRows] = await Promise.all([
      sportsIds.length ? getSportsBets({ ...sportsFilter!, betIds: sportsIds, limit }) : [],
      casinoIds.length ? getCasinoBets({ ...casinoFilter!, betIds: casinoIds, limit }) : [],
      matkaIds.length ? getMatkaBets({ ...matkaFilter!, betIds: matkaIds, limit }) : [],
    ])
    const [eventResults, campaignMap] = await Promise.all([
      getEventResultsByMarketIds([...new Set(sportsRows.map(row => row.marketId))]),
      getCampaignDetailsByBonusAwardIds([...new Set(casinoRows.map(row => row.bonusAwardId).filter((id): id is number => id != null))]),
    ])
    const isSettled = (value: string) => ['settled','won','lost'].includes(value)
    const matkaNames = Object.fromEntries(matkaRows.map(row => [row.matkaId, row.matkaName || row.marketName]))
    const rows = [
      ...sportsRows.map(bet => {
        const stake = Number(bet.stake || 0), win = isSettled(bet.status) ? Number(bet.result || 0) : 0
        return buildSportsBetRow(bet, stake, bet.status === 'won' ? win : bet.status === 'lost' ? 0 : null, bet.status === 'won' ? win - stake : bet.status === 'lost' ? -stake : 0, eventResults)
      }),
      ...casinoRows.map(bet => buildCasinoBetRow(bet, isSettled, campaignMap)),
      ...matkaRows.map(bet => buildMatkaBetRow(bet, isSettled, matkaNames)),
    ]
    const byKey = new Map(rows.map(row => [`${row.product.toUpperCase()}:${row.id}`, row]))
    const items = keys.map(key => byKey.get(`${key.domain}:${key.id}`)).filter(Boolean)
    const total = sportsTotal + casinoTotal + matkaTotal
    return { items, total, hasMore: offset + limit < total }
  },

  playerTransactions: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'players.transactions', 'view')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const userId = Number(args.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')
    
    // If agent is logged in, check if they can access this player
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const canAccess = await canAgentAccessPlayer(ctx.user.agentId, userId, tenant)
      if (!canAccess) {
        throw new Error('Unauthorized: You can only access your own players')
      }
    }
    
    return getPlayerTransactionsPage(tenant, userId, args.filter || {}, hasPermission(ctx.permissions, 'players.credit', 'view'))
  },

  playerWalletLedger: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'players.ledger', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view player ledger')
    }
    const userId = Number(args.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')

    let tenant: string
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (!agent?.tenantId) throw new Error('Agent not found or tenant not configured')
      tenant = agent.tenantId.trim()
      const canAccess = await canAgentAccessPlayer(ctx.user.agentId, userId, tenant)
      if (!canAccess) throw new Error('Unauthorized: You can only access your own players')
    } else {
      const directorTenant = getEffectiveTenantForDirector(ctx)
      tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    }

    const wallet = await getWalletDb(userId, tenant)
    if (!wallet) return { items: [], total: 0, hasMore: false }

    const filter = args.filter || {}
    const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 100)
    const offset = Math.max(0, Number(filter.offset) || 0)
    const allowedWalletTypes = ['cash', 'bonus', 'referralBonus', 'referralBalance'] as const
    const walletType = allowedWalletTypes.includes((filter.walletType ?? 'cash') as (typeof allowedWalletTypes)[number])
      ? (filter.walletType ?? 'cash')
      : 'cash'

    const rawCategories = filter.categories
    const categories: string[] | undefined =
      Array.isArray(rawCategories) && rawCategories.length > 0
        ? rawCategories.filter((c: unknown) => typeof c === 'string' && c.length > 0)
        : undefined
    const direction: string | undefined =
      typeof filter.direction === 'string' && (filter.direction === 'credit' || filter.direction === 'debit')
        ? filter.direction
        : undefined
    const includeAdjustmentDirection: string | undefined =
      typeof filter.includeAdjustmentDirection === 'string' && (filter.includeAdjustmentDirection === 'credit' || filter.includeAdjustmentDirection === 'debit')
        ? filter.includeAdjustmentDirection
        : undefined

    const result = await listWalletLedgerEntriesDb({
      tenant,
      walletId: wallet.id,
      walletType,
      category: categories ? undefined : (filter.category ?? undefined),
      categories,
      direction,
      includeAdjustmentDirection,
      dateFrom: filter.dateFrom ?? undefined,
      dateTo: filter.dateTo ?? undefined,
      limit,
      offset,
    })

    return {
      items: result.items,
      total: result.total,
      hasMore: result.hasMore,
    }
  },

  playerBonuses: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'players.bonuses', 'view')
    const userId = Number(args.playerId)
    if (!Number.isFinite(userId)) return []

    let tenant: string
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (!agent?.tenantId) throw new Error('Agent not found or tenant not configured')
      tenant = agent.tenantId.trim()
      const canAccess = await canAgentAccessPlayer(ctx.user.agentId, userId, tenant)
      if (!canAccess) throw new Error('Unauthorized: You can only access your own players')
    } else {
      const directorTenant = getEffectiveTenantForDirector(ctx)
      tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    }

    const rows = await listBonusAwardsByUserId(userId, tenant)
    return rows.map((r) => ({
      id: String(r.id),
      campaignId: r.campaignId,
      type: r.type,
      name: r.name,
      domain: r.domain,
      amount: Number(r.amount),
      currency: r.currency,
      status: r.status,
      distributionType: r.distributionType,
      grantedAt: r.grantedAt?.toISOString?.() ?? new Date().toISOString(),
      completedAt: r.completedAt?.toISOString?.() ?? null,
      expiresAt: r.expiresAt,
      triggerAmount: r.triggerAmount,
      wageringRequirement: r.wageringRequirement,
      wageringCompleted: r.wageringCompleted,
      wageringRemaining: r.wageringRemaining,
      firstDepositRequired: r.firstDepositRequired,
      firstDepositUnlocked: r.firstDepositUnlocked,
      contributionRules: r.contributionRules,
    }))
  },

  playerVip: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'players.vip', 'view')
    const tenant = ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default'
    const userId = String(args.playerId)
    
    // If agent is logged in, check if they can access this player
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const canAccess = await canAgentAccessPlayer(ctx.user.agentId, Number(userId), tenant)
      if (!canAccess) {
        throw new Error('Unauthorized: You can only access your own players')
      }
    }
    
    const member = await getVipMemberByUserIdDb(userId, tenant)
    if (!member) return null

    const tier = await getVipTierDb(member.tierId, member.tenant ?? tenant)
    const transactions = await listVipTransactionsDb(member.tenant ?? tenant, member.id, 50)
    // History rows carry tier names: toTierName is non-null, and one unnamed row used to
    // fail the whole query, while every tier change now writes a history row.
    const history = await listVipHistoryDb(member.tenant ?? tenant, member.id)

    return {
      tierId: member.tierId,
      tierName: member.tierName,
      tierLevel: member.tierLevel,
      currentPoints: member.currentPoints,
      lifetimePoints: member.lifetimePoints,
      monthlyDeposits: member.monthlyDeposits,
      nextTierId: member.nextTierId || null,
      nextTierName: member.nextTierName || null,
      pointsToNextTier: member.pointsToNextTier ?? null,
      benefits: tier?.benefits || [],
      perks: tier?.perks || [],
      history: history.map((h: any) => ({
        id: h.id,
        fromTierId: h.fromTierId || null,
        fromTierName: h.fromTierName,
        toTierId: h.toTierId,
        toTierName: h.toTierName,
        reason: h.reason,
        pointsAtChange: h.pointsAtChange,
        createdAt: h.createdAt?.toISOString() || new Date().toISOString(),
      })),
      transactions: transactions.map((t: any) => ({
        id: t.id,
        type: t.type,
        points: t.points,
        description: t.description,
        balanceBefore: t.balanceBefore,
        balanceAfter: t.balanceAfter,
        createdAt: t.createdAt?.toISOString() || new Date().toISOString(),
      })),
    }
  },

  // Devices and sessions are not tracked: a player's login is a JWT and nothing records devices or sessions,
  // so these two always answer an empty list. An empty list here means "not tracked", not "none": the profile's
  // Devices & Sessions tab says so instead of showing zeros (logins with IP and device are in the Activity Log).
  playerDevices: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'players.devices', 'view')
    return []
  },

  playerSessions: async (_: any, args: any, ctx: any) => {
    requireReadPermission(ctx, 'players.sessions', 'view')
    return []
  },

  playerSecurityAudit: async (_: any, args: any, ctx: any) => (await loadPlayerSecurityAudit(args, ctx)).items,
  playerSecurityAuditPage: async (_: any, args: any, ctx: any) => loadPlayerSecurityAudit(args, ctx),

  // Served by the CRM module, which has been removed pending a rebuild as a
  // standalone application. Returns nothing rather than failing, so the profile
  // screen still renders — the same shape playerCommLog has always had.
  /**
   * Notes on a player, for the admin panel.
   *
   * Deliberately separate from the CRM's `crmPlayerNotes` even though both
   * read one store: the two applications scope a player differently, and a
   * resolver serving both would have to guess which caller it had. A CRM
   * session cannot reach this field at all — the surface guard refuses it.
   */
  playerNotes: async (_: any, args: { playerId: string }, ctx: any) => {
    // A read: requireReadPermission, not requirePermission, which also refuses a
    // read-only (INACTIVE) agent — that agent may still read its own players.
    requireReadPermission(ctx, 'players.notes', 'view')
    const playerId = Number(args?.playerId)
    if (!Number.isFinite(playerId)) return []

    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    // An agent may only read notes on their own players. The helper is a
    // no-op for admins, which is why the tenant filter below is not optional.
    const { PlayerAuthService } = await import('@src/domains/players/services/PlayerAuthService.js')
    await new PlayerAuthService().validateAgentPlayerAccess(ctx, playerId, 'read notes for')

    const { db } = await import('@src/db/client.js')
    const { users } = await import('@shared/db/schema.js')
    const { and, eq } = await import('drizzle-orm')
    const [player] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, playerId), eq(users.tenant, tenant)))
      .limit(1)
    if (!player) return []

    const { listPlayerNotes } = await import('@src/repos/crm/CrmNotesRepo.js')
    const notes = await listPlayerNotes(tenant, playerId, 'admin')
    return notes.map((n) => ({
      id: n.id,
      content: n.body,
      category: n.category,
      tags: n.labels,
      isPinned: n.isPinned,
      createdBy: n.authorName,
      createdAt: n.createdAt.toISOString(),
      updatedAt: null,
    }))
  },

  /**
   * What was tried to reach this player.
   *
   * The `PlayerCommLog` type was shaped for sends — it has deliveredAt,
   * openedAt, clickedAt and bounced. This platform has no player-messaging
   * path from this process, so what it actually has to show is *attempts*: an
   * agent picking up the phone. The delivery fields are therefore null rather
   * than invented, because "bounced: false" on a phone call means nothing and
   * a false zero reads as a real one.
   *
   * When a sender exists this widens to include real sends; the shape is
   * already right for them.
   */
  playerCommLog: async (_: any, args: { playerId: string }, ctx: any) => {
    // A read: a read-only (INACTIVE) agent may still read its own players.
    requireReadPermission(ctx, 'players', 'view')
    const playerId = Number(args?.playerId)
    if (!Number.isFinite(playerId)) return []

    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const { PlayerAuthService } = await import('@src/domains/players/services/PlayerAuthService.js')
    await new PlayerAuthService().validateAgentPlayerAccess(ctx, playerId, 'read the contact log for')

    const { db } = await import('@src/db/client.js')
    const { users } = await import('@shared/db/schema.js')
    const { and, eq } = await import('drizzle-orm')
    const [player] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, playerId), eq(users.tenant, tenant)))
      .limit(1)
    if (!player) return []

    const { listContactAttempts } = await import('@src/repos/crm/CrmContactRepo.js')
    const attempts = await listContactAttempts(tenant, playerId)
    return attempts.map((a) => ({
      id: a.id,
      type: a.direction === 'in' ? 'inbound_contact' : 'outbound_contact',
      channel: a.channel,
      template: null,
      status: a.outcome,
      sentAt: a.occurredAt.toISOString(),
      deliveredAt: null,
      openedAt: null,
      clickedAt: null,
      bounced: false,
      metadata: a.notes ? JSON.stringify({ notes: a.notes, by: a.byName }) : null,
    }))
  },

  playerReferralProfile: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'players.referral-bonus', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view player referral profile')
    }
    const userId = Number(args.playerId)
    if (!Number.isFinite(userId)) throw new Error('Invalid player ID')

    // Resolve tenant (same pattern as playerProfile)
    let tenant: string
    if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
      const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findById(ctx.user.agentId)
      if (!agent || !agent.tenantId) {
        throw new Error('Agent not found or tenant not configured')
      }
      tenant = agent.tenantId.trim()
      const canAccess = await canAgentAccessPlayer(ctx.user.agentId, userId, tenant)
      if (!canAccess) {
        throw new Error('Unauthorized: You can only access your own players')
      }
    } else {
      const directorTenant = getEffectiveTenantForDirector(ctx)
      tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')
    }

    // Run all repo calls concurrently
    const [stats, referralLink, attributions, earnings, settlements, attribution] = await Promise.all([
      getReferrerStatsDb(userId, tenant, {}).catch(() => ({
        referrerId: userId,
        totalEarnings: 0,
        grossEarnings: 0,
        totalReferrals: 0,
        activeReferrals: 0,
        totalTransactions: 0,
        totalClicks: 0,
        totalAttributions: 0,
        conversionRate: 0,
        earningsByRuleType: [],
      })),
      getReferralLinkByUserDb(userId, tenant).catch(() => null),
      getReferralAttributionsByReferrerDb(userId, tenant).catch(() => []),
      getReferralEarningsByReferrerDb(userId, tenant, {}).catch(() => []),
      getReferralSettlementsByReferrerDb(userId, tenant, {}).catch(() => []),
      getReferralAttributionByRefereeDb(userId, tenant).catch(() => null),
    ])

    // Fetch referee user details
    const refereeIds = [...new Set(attributions.map((a: any) => a.refereeId))]
    const refereeUsers = refereeIds.length > 0
      ? await getUsersByIdsBasicDb(refereeIds, tenant).catch(() => [])
      : []

    // Fetch referredBy user details
    let referredBy = null
    if (attribution && attribution.referrerId > 0 && attribution.status === 'confirmed') {
      const referrers = await getUsersByIdsForExclusion([attribution.referrerId], tenant).catch(() => [])
      const ref = referrers[0]
      if (ref) {
        referredBy = { id: String(ref.id), username: ref.username ?? null, name: ref.name, phone: ref.phone ?? null }
      }
    }

    // Enrich earnings with user names
    const allUserIds = [...new Set([
      ...earnings.map((e: any) => e.referrerId),
      ...earnings.map((e: any) => e.refereeId),
    ])]
    const earningsUsers = allUserIds.length > 0
      ? await getUsersByIdsBasicDb(allUserIds, tenant).catch(() => [])
      : []
    const earningsUserMap = new Map(earningsUsers.map((u: any) => [u.id, { name: u.name ?? '', phone: u.phone ?? '' }]))

    return {
      // Stats
      totalEarnings: stats.totalEarnings,
      grossEarnings: stats.grossEarnings,
      totalReferrals: stats.totalReferrals,
      activeReferrals: stats.activeReferrals,
      totalClicks: stats.totalClicks,
      totalAttributions: stats.totalAttributions,
      conversionRate: stats.conversionRate,
      earningsByRuleType: (stats.earningsByRuleType || [])
        .filter((e: any) => e.ruleType !== 'REVSHARE')
        .map((e: any) => ({
          ruleType: e.ruleType,
          totalEarnings: e.totalEarnings,
          count: e.count,
        })),

      // Referral link
      referralLink: referralLink ? {
        ...referralLink,
        id: String(referralLink.id),
        agentId: referralLink.agentId || null,
        userId: referralLink.userId || null,
        utmParams: referralLink.utmParams || {},
        createdAt: referralLink.createdAt instanceof Date ? referralLink.createdAt.toISOString() : String(referralLink.createdAt),
        updatedAt: referralLink.updatedAt instanceof Date ? referralLink.updatedAt.toISOString() : String(referralLink.updatedAt),
      } : null,

      // Referred by
      referredBy,

      // Referees
      referees: refereeUsers.map((u: any) => ({
        id: String(u.id),
        name: u.name,
        phone: u.phone ?? undefined,
        username: u.username ?? undefined,
      })),

      // Earnings
      earnings: earnings.map((e: any) => ({
        ...e,
        id: String(e.id),
        grossAmount: Number(e.grossAmount),
        netAmount: Number(e.netAmount),
        eventData: e.eventData || {},
        calculatedAt: e.calculatedAt instanceof Date ? e.calculatedAt.toISOString() : String(e.calculatedAt),
        referrerName: earningsUserMap.get(e.referrerId)?.name ?? null,
        referrerPhone: earningsUserMap.get(e.referrerId)?.phone ?? null,
        refereeName: earningsUserMap.get(e.refereeId)?.name ?? null,
        refereePhone: earningsUserMap.get(e.refereeId)?.phone ?? null,
      })),

      // Settlements
      settlements: settlements.map((s: any) => ({
        ...s,
        id: String(s.id),
        cashAmount: Number(s.cashAmount),
        bonusAmount: Number(s.bonusAmount),
        settledAt: s.settledAt ? (s.settledAt instanceof Date ? s.settledAt.toISOString() : String(s.settledAt)) : null,
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
      })),
    }
  },

  movePlayerToAgentPreCheck: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'players.move-agent', 'view')) {
      throw new Error('Forbidden: insufficient permissions')
    }

    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const playerId = Number(args.playerId)
    if (!Number.isFinite(playerId)) throw new Error('Invalid player ID')
    const targetAgentId = args.targetAgentId as string

    const blockers: string[] = []
    const warnings: string[] = []

    const player = await getUserDb(playerId, tenant)
    if (!player) throw new Error('Player not found')

    const playerInfo = {
      id: String(player.id),
      name: player.name,
      username: player.username,
      phone: player.phone,
      status: player.status,
    }

    if ((player as any).playerType !== 'COMMISSION_AGENT_PLAYER') {
      blockers.push('Player is not a commission agent player (type: ' + (player as any).playerType + ')')
    }
    if (!isActiveEntityStatus(player.status)) {
      blockers.push('Player is not ACTIVE (status: ' + player.status + ')')
    }

    const sourceAgentId = (player as any).agentId
    if (!sourceAgentId) {
      blockers.push('Player does not have an assigned agent')
      return { canMove: false, blockers, warnings, player: playerInfo, sourceAgent: null, targetAgent: null, openBetsCounts: { sports: 0, casino: 0, matka: 0, total: 0 }, activeBonusCount: 0, walletBalance: null, exposure: null, commissionCycleStatus: null, commissionCycleFrom: null, commissionCycleTo: null }
    }

    if (sourceAgentId === targetAgentId) {
      blockers.push('Player is already assigned to this agent')
    }

    const { AgentsRepo } = await import('@/repos/agents/AgentsRepo.js')
    const { AgentConfigsRepo } = await import('@/repos/agents/AgentConfigsRepo.js')
    const agentsRepo = new AgentsRepo()
    const configsRepo = new AgentConfigsRepo()

    const sourceAgent = await agentsRepo.findById(sourceAgentId)
    const targetAgent = await agentsRepo.findById(targetAgentId)

    let sourceAgentInfo: any = null
    let targetAgentInfo: any = null

    const domains = ['sports', 'casino', 'matka'] as const
    const nowDate = new Date()

    async function getAgentRates(agentId: string) {
      const rates: { domain: string; rate: number }[] = []
      for (const domain of domains) {
        try {
          const cfg = await configsRepo.getCommissionConfig(agentId, domain, nowDate)
          if (cfg) rates.push({ domain, rate: Number(cfg.commissionRate ?? 0) })
        } catch { /* no config for domain */ }
      }
      return rates
    }

    if (sourceAgent) {
      if (sourceAgent.schemeType !== 'COMMISSION') blockers.push('Source agent is not a COMMISSION agent (type: ' + sourceAgent.schemeType + ')')
      if (!isActiveEntityStatus(sourceAgent.status)) blockers.push('Source agent is not ACTIVE (status: ' + sourceAgent.status + ')')
      if (sourceAgent.tenantId !== tenant) blockers.push('Source agent does not belong to this tenant')

      const sourceRates = await getAgentRates(sourceAgentId)
      sourceAgentInfo = {
        id: sourceAgent.id,
        username: (sourceAgent as any).username ?? sourceAgent.id,
        schemeType: sourceAgent.schemeType,
        status: sourceAgent.status,
        allowedDomains: sourceAgent.allowedDomains ?? [],
        commissionRates: sourceRates,
        levelIndex: sourceAgent.levelIndex,
      }
    } else {
      blockers.push('Source agent not found')
    }

    if (targetAgent) {
      if (targetAgent.schemeType !== 'COMMISSION') blockers.push('Target agent is not a COMMISSION agent (type: ' + targetAgent.schemeType + ')')
      if (!isActiveEntityStatus(targetAgent.status)) blockers.push('Target agent is not ACTIVE (status: ' + targetAgent.status + ')')
      if (targetAgent.tenantId !== tenant) blockers.push('Target agent does not belong to this tenant')

      const targetRates = await getAgentRates(targetAgentId)
      targetAgentInfo = {
        id: targetAgent.id,
        username: (targetAgent as any).username ?? targetAgent.id,
        schemeType: targetAgent.schemeType,
        status: targetAgent.status,
        allowedDomains: targetAgent.allowedDomains ?? [],
        commissionRates: targetRates,
        levelIndex: targetAgent.levelIndex,
      }

      if (sourceAgent) {
        const sourceDomains = sourceAgent.allowedDomains ?? []
        const targetDomains = targetAgent.allowedDomains ?? []
        const missing = sourceDomains.filter((d: string) => !targetDomains.includes(d))
        if (missing.length > 0) {
          blockers.push(`Target agent does not support domains: ${missing.join(', ')}`)
        }

        // Rate comparison warnings
        const sourceRatesMap = new Map((sourceAgentInfo?.commissionRates ?? []).map((r: any) => [r.domain, r.rate]))
        for (const tr of (targetAgentInfo?.commissionRates ?? [])) {
          const sr = sourceRatesMap.get(tr.domain)
          if (sr != null && sr !== tr.rate) {
            warnings.push(`Commission rate differs for ${tr.domain}: source ${(Number(sr) * 100).toFixed(1)}% vs target ${(Number(tr.rate) * 100).toFixed(1)}%`)
          }
        }

        if (sourceAgent.levelIndex != null && targetAgent.levelIndex != null && sourceAgent.levelIndex !== targetAgent.levelIndex) {
          warnings.push(`Agent levels differ: source Level-${sourceAgent.levelIndex} vs target Level-${targetAgent.levelIndex}`)
        }
      }
    } else {
      blockers.push('Target agent not found')
    }

    // Commission settlement guard (payout-derived unsettled cycles + snapshot OPEN/BLOCKED)
    let commissionCycleStatus: string | null = null
    let commissionCycleFrom: string | null = null
    let commissionCycleTo: string | null = null

    try {
      if (sourceAgent && sourceAgent.schemeType === 'COMMISSION') {
        const { evaluateCommissionAgentMoveGuard } = await import('../services/commissionAgentMoveGuard.js')
        const commissionMoveGuard = await evaluateCommissionAgentMoveGuard(
          sourceAgentId,
          tenant,
          playerId,
          targetAgent && targetAgent.schemeType === 'COMMISSION' && targetAgent.tenantId === tenant ? targetAgentId : null,
        )
        blockers.push(...commissionMoveGuard.blockers)
        commissionCycleStatus = commissionMoveGuard.commissionCycleStatus
        commissionCycleFrom = commissionMoveGuard.commissionCycleFrom
        commissionCycleTo = commissionMoveGuard.commissionCycleTo
      }
    } catch (_err) {
      // Env without full commission tables / optional failure — do not hard-fail precheck
    }

    // Open bets — check ALL open bets regardless of age
    const now = new Date()
    const epoch = new Date(0)

    const [sportsAgg, casinoAgg, matkaAgg] = await Promise.all([
      getSportsOpenAggregates(tenant, playerId, epoch, now),
      getCasinoOpenAggregates(tenant, playerId, epoch, now),
      getMatkaOpenAggregates(tenant, playerId, epoch, now),
    ])

    const openBetsCounts = {
      sports: sportsAgg.openCount ?? 0,
      casino: casinoAgg.openCount ?? 0,
      matka: matkaAgg.openCount ?? 0,
      total: (sportsAgg.openCount ?? 0) + (casinoAgg.openCount ?? 0) + (matkaAgg.openCount ?? 0),
    }

    if (openBetsCounts.total > 0) {
      blockers.push(`Player has ${openBetsCounts.total} open bet(s). Settle all bets first.`)
    }

    // Active bonus
    const { getActiveBonusCountForPlayer } = await import('@/repos/marketing/bonusesRepo.js')
    const activeBonusCount = await getActiveBonusCountForPlayer(playerId)
    if (activeBonusCount > 0) {
      blockers.push(`Player has ${activeBonusCount} active/pending bonus(es). Complete or cancel bonuses first.`)
    }

    // Wallet
    const wallet = await getWalletDb(playerId, tenant)
    const walletBalance = wallet ? Number(wallet.cash ?? 0) : null
    const exposure = wallet ? Number(wallet.exposure ?? 0) : null

    return {
      canMove: blockers.length === 0,
      blockers,
      warnings,
      player: playerInfo,
      sourceAgent: sourceAgentInfo,
      targetAgent: targetAgentInfo,
      openBetsCounts,
      activeBonusCount,
      walletBalance,
      exposure,
      commissionCycleStatus,
      commissionCycleFrom,
      commissionCycleTo,
    }
  },

  playerAgentTransferHistory: async (_: any, args: any, ctx: any) => {
    if (!hasPermission(ctx?.permissions ?? [], 'players.move-agent', 'view')) {
      throw new Error('Forbidden: insufficient permissions')
    }

    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = directorTenant ?? (ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default')

    const playerId = String(args.playerId)
    const playerIdNum = Number(playerId)
    if (!Number.isFinite(playerIdNum)) return []
    const limit = Math.min(args.limit ?? 50, 100)

    // Agents hold players.move-agent:view (flat players:manage). Without this an
    // agent could read any player's transfer history in the whitelabel. Admins
    // stay scoped by the tenant filter on the audit read below.
    await playerAuthService.validateAgentPlayerAccess(ctx, playerIdNum, 'view the transfer history of')

    const { items: auditLogs } = await listAuditDb({
      tenant,
      domain: 'players',
      action: 'move_player_agent',
      resourceType: 'player',
      resourceId: playerId,
      limit,
    })

    return auditLogs.map((log: any) => {
      const before = typeof log.before === 'string' ? JSON.parse(log.before) : (log.before ?? {})
      const after = typeof log.after === 'string' ? JSON.parse(log.after) : (log.after ?? {})
      return {
        id: log.id,
        timestamp: typeof log.createdAt === 'string' ? log.createdAt : log.createdAt?.toISOString?.() ?? '',
        performedBy: log.actorId,
        fromAgentId: before.agentId ?? '',
        fromAgentUsername: before.agentUsername ?? null,
        toAgentId: after.agentId ?? '',
        toAgentUsername: after.agentUsername ?? null,
        reason: after.reason ?? null,
      }
    })
  },
}


async function loadPlayerSecurityAudit(args: any, ctx: any) {
    if (!hasPermission(ctx?.permissions ?? [], 'players.security-audit', 'view')) {
      throw new Error('Forbidden: insufficient permissions to view player security audit')
    }
    if (args.playerId == null || args.playerId === '') {
      throw new Error('playerId is required')
    }
    const directorTenant = getEffectiveTenantForDirector(ctx)
    const tenant = (directorTenant ?? ctx?.tenant ?? ctx?.whitelabel?.id ?? 'default') || 'default'
    const userId = String(args.playerId)
    // Every other player read in this file asks this; this one did not.
    if (!(await maySeePlayer(ctx, userId, tenant))) return { items: [], total: 0 }
    const limit = Math.min(500, Math.max(1, args.limit || 50))

    const FAILURE_ACTIONS = new Set(['login_failed']);
    const auditEvents = await listAuditDb({
      tenant, actorId: userId, limit, offset: Math.max(0, args.offset ?? 0),
      sort: args.ascending ? 'timestamp:asc' : 'timestamp:desc',
      playerSecurity: { userId, type: args.type, success: args.success },
    });
    const filtered = auditEvents.items;

    let geoLookup: ((ip: string) => any) | null = null
    try {
      const geoip = await import('geoip-lite')
      geoLookup = geoip.default?.lookup ?? geoip.lookup ?? null
    } catch { /* geoip not available */ }

    const items = filtered.map((e: any) => {
      const success = !FAILURE_ACTIONS.has(e.action)
      const ipAddress = e.after?.ipAddress ?? e.before?.ipAddress ?? null
      const userAgent = e.after?.userAgent ?? e.before?.userAgent ?? null
      const displayType = e.action === 'login_failed' ? 'login' : e.action
      let metadata: string | null = null
      if (e.after != null) {
        try {
          metadata = typeof e.after === 'string' ? e.after : JSON.stringify(e.after)
        } catch {
          metadata = null
        }
      }
      let location: string | null = null
      if (ipAddress && ipAddress !== '127.0.0.1' && ipAddress !== '::1' && geoLookup) {
        try {
          const geo = geoLookup(ipAddress)
          if (geo) {
            const parts = [geo.city, geo.region, geo.country].filter(Boolean)
            location = parts.length > 0 ? parts.join(', ') : null
          }
        } catch { /* best-effort */ }
      }

      const afterObj = (typeof e.after === 'object' && e.after !== null) ? e.after : {}

      return {
        id: e.id,
        type: displayType,
        description: `${e.domain}:${e.action}`,
        timestamp: e.timestamp,
        ipAddress,
        userAgent,
        success,
        metadata,
        location,
        language: afterObj.language ?? null,
        screenResolution: afterObj.screenResolution ?? null,
        timezone: afterObj.timezone ?? null,
        platform: afterObj.platform ?? null,
      }
    })

    return { items, total: auditEvents.total };

}
