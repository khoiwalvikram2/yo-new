import { playerThemeSetting } from '../services/playerThemeSetting.js'
import { isCryptoDepositAllowedForUser, isWelivepayAllowedForUser } from '../config/env.js'
import { getVipDepositContext, allowedReceivingAccounts, lockVipPlayer, assertVipDepositAllowed, gatewayDepositLimits, type VipDatabase } from '@shared/vip/depositAccess.js'
import { CRYPTO_COIN, cryptoAmountFor, cryptoBonusFor, cryptoTxHashError, normalizeCryptoTxHash, parseCryptoBonusPercent, parseCryptoRate } from '@shared/utils/cryptoDeposit.js'
import { intersectDepositLimits } from '@shared/vip/depositPolicy.js'
import { loadPlayerDomains } from '@shared/access/playerDomains.js'
import { DateTime } from 'luxon'
import { settledSportsBetProfit } from '../domains/userApp/services/sportsBetDisplay.js'
import { sportsEventIdentifier } from '../domains/userApp/services/sportsEventIdentifier.js'
import { DEPOSIT_PROOF_INLINE } from '../domains/userApp/services/depositProof.js'
import { displayableAsset } from '@shared/utils/dataUri.js'
import { and, asc, desc, eq, ne, gte, lte, ilike, inArray, or, isNull, isNotNull, sql, sum, getTableColumns } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  ledgerEntries,
  depositRequests,
  welivepayOrders,
  depositMethodEnum,
  whitelabelPaymentMethods,
  whitelabelPgSettings,
  casinoGames,
  casinoVendors,
  casinoCategoryTypeEnum,
  casinoCategories,
  casinoCategoryGames,
  whitelabelCasinoVendorSettings,
  whitelabelCasinoGameSettings,
  whitelabelCasinoProviderSettings,
  whitelabelCasinoVendorSuperAdminOverride,
  whitelabelCasinoGameSuperAdminOverride,
  bonusAwards,
  bonusCampaigns,
  bonusCodes,
  bonusTiers,
  appConfigs,
  whitelabels,
  sportsTable,
  sportsLeaguesTable,
  sportsEventsTable,
  sportsMarketsTable,
  sportsRunnersTable,
  sportsBets,
  sportsResultsTable,
  casinoBets,
  sportsSettingsTable,
  leagueSettingsTable,
  eventSettingsTable,
  referralPrograms,
  referralRules,
  referralEarnings,
  referralSettlements,
  users,
  userOtps,
  userPayoutAccounts,
  withdrawalRequests,
  payoutStatusEnum,
  casinoLikes,
  casinoRecent,
  sportsBookmarks,
  sportsRecent,
  referralAttributions,
  cmsPages,
  referralClicks,
  referralLinks,
  wallets,
  advertisements,
  agents,
  notifications,
  playerLimits,
} from '@shared/db/schema.js'
import type { InferModel } from 'drizzle-orm'
import { ensureWallet, findUserById } from './userRepo.js'
import { activateBonusAwardCore } from '@shared/services/bonusAwardActivation.js'
import { switchBonusAwardCore } from '@shared/services/bonusAwardSwitch.js'
import { nanoid } from 'nanoid'
import { createWalletLedgerEntry } from '@shared/services/walletLedgerService.js'
import { getWhitelabelCurrency, getCurrencySymbol, getWhitelabelTimezone } from '../shared/whitelabelConfig.js'
import { formatInTimeZone } from '../shared/dateUtils.js'
import { assertPlayerCanFund } from '@shared/services/rgEnforcement.js'

type DepositRequestRow = InferModel<typeof depositRequests>
type PayoutAccountRow = InferModel<typeof userPayoutAccounts>
type WithdrawalRow = InferModel<typeof withdrawalRequests>
type WithdrawalWithAccount = WithdrawalRow & {
  account?: {
    id: number
    method: 'BANK' | 'UPI'
    accountNumber?: string | null
    accountHolderName?: string | null
    ifscCode?: string | null
  }
}

export async function getUserDetail(userId: number, tenant: string) {
  const user = await findUserById(userId, tenant)
  if (!user) return null
  const currency = await getWhitelabelCurrency(tenant)
  const wallet = await ensureWallet(user.id, tenant, currency)
  return {
    id: String(user.id),
    name: user.name || user.username || 'User',
    username: user.username || user.name || 'User',
    mobileNo: user.phone || '',
    balance: Number(wallet.cash ?? 0),
    bonus: Number(wallet.bonus ?? 0),
    wallet: '1',
    affiliateCode: user.username || undefined,
    refBonus: Number(wallet.referralBalance ?? 0),
    referralBalance: Number(wallet.referralBalance ?? 0),
    referralBonusBalance: Number(wallet.referralBonus ?? 0),
  }
}

/**
 * Map ledger meta.type / row.type and amount to user-facing transaction type for statements.
 * statementPageRepo's walletType SQL labels the same rows for the Wallet type filter, so the two must give the
 * same label (exported for userAppRepo.transactionType.test.ts).
 */
export function getTransactionTypeFromMeta(metaType: string | undefined, ledgerType: string, amount: number): string {
  const raw = String(metaType ?? '').trim().toLowerCase()
  // Admin adjustments should show as Manual Deposit / Manual Withdrawal based on direction
  if (raw === 'admin_adjustment') {
    return amount >= 0 ? 'Manual Deposit' : 'Manual Withdrawal'
  }
  const typeMap: Record<string, string> = {
    matka_bet: 'Matka Stake', matka_win: 'Matka Settlement', matka_refund: 'Matka Refund', matka_result_reversal: 'Matka Result Reversal',
    // Credit players' Deposit/Withdraw chips from their upline (statementPageRepo labels them the same way).
    chip_deposit: 'Chip Deposit', chip_withdraw: 'Chip Withdrawal',
    deposit: 'Deposit',
    withdrawal: 'Withdrawal',
    withdrawal_pending: 'Withdrawal',
    withdrawal_refund: 'Withdrawal Refund',
    bonus: 'Bonus Credit',
    bonus_release: 'Bonus Release to Cash',
    bonus_instant_cash: 'Instant Cash',
    bonus_instant_cash_transfer: 'Bonus to Cash Transfer',
    bonus_to_cash: 'Bonus to Cash',
    bonus_forfeit: 'Bonus Forfeit',
    bonus_switch_debit: 'Bonus Switch',
    crypto_deposit_bonus: 'Crypto Deposit Bonus',
    referral_earning: 'Referral Earning',
    referral_balance_to_cash: 'Referral to Cash',
    referral_balance_backfill: 'Referral',
  }
  if (typeMap[raw]) return typeMap[raw]
  // Ledger row.type can be withdrawal_pending when meta.type is not set (e.g. user withdrawal request)
  const ledgerNorm = String(ledgerType ?? '').trim().toLowerCase()
  if (ledgerNorm === 'withdrawal_pending') return 'Withdrawal'
  if (typeMap[ledgerNorm]) return typeMap[ledgerNorm]
  // Fallback: positive = credit-like, negative = debit-like
  if (amount >= 0) return ledgerType === 'credit' ? 'Credit' : 'Deposit'
  return ledgerType === 'debit' ? 'Withdrawal' : 'Debit'
}

export async function getLedgerItems(userId: number, tenant: string, start?: Date, end?: Date, rowIds?: string[]) {
  if (rowIds?.length === 0) return []
  const currency = await getWhitelabelCurrency(tenant)
  const wallet = await ensureWallet(userId, tenant, currency)
  const conditions = [eq(ledgerEntries.walletId, wallet.id), eq(ledgerEntries.tenant, tenant)]
  if (rowIds) conditions.push(inArray(ledgerEntries.id, rowIds.map(Number)))
  if (start) conditions.push(gte(ledgerEntries.createdAt, start))
  if (end) conditions.push(lte(ledgerEntries.createdAt, end))
  
  // Filter out betting-related entries from Wallet tab (settlements, cancel, void, casino)
  conditions.push(
    sql`(${ledgerEntries.meta}->>'type' IS NULL OR ${ledgerEntries.meta}->>'type' NOT IN ('sports_bet_settlement', 'sports_bet_settlement_reversal', 'sports_bet_cancel', 'sports_bet_void', 'casino_bet', 'casino_win', 'casino_rollback', 'matka_bet', 'matka_win', 'matka_refund', 'matka_result_reversal'))`
  )
  
  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(and(...conditions))
    .orderBy(desc(ledgerEntries.createdAt))

  // Collect campaign IDs from bonus-related entries for batch lookup
  const campaignIds = new Set<number>()
  for (const row of rows) {
    const meta = (row.meta as any) || {}
    const metaType = meta.type
    const id = meta.campaignId != null ? Number(meta.campaignId) : NaN
    if (id && Number.isFinite(id) && /^bonus|referral/.test(String(metaType || '').toLowerCase())) {
      campaignIds.add(id)
    }
  }

  let campaignMap: Map<number, { name: string; type: string }> = new Map()
  if (campaignIds.size > 0) {
    const list = await db
      .select({
        id: bonusCampaigns.id,
        name: bonusCampaigns.name,
        type: bonusCampaigns.type,
      })
      .from(bonusCampaigns)
      .where(and(eq(bonusCampaigns.tenant, tenant), inArray(bonusCampaigns.id, Array.from(campaignIds))))
    for (const c of list) {
      campaignMap.set(c.id, { name: c.name ?? 'Bonus', type: c.type ?? 'bonus' })
    }
  }

  return rows.map((row) => {
    const meta = (row.meta as any) || {}
    const ledgerType = row.type || 'ledger'
    const originalAmount = meta.originalAmount !== undefined
      ? Number(meta.originalAmount)
      : (row.amount != null ? Number(row.amount) : 0)
    const amount = Number.isFinite(originalAmount) ? originalAmount : 0
    const metaType = meta.type

    const transactionType = getTransactionTypeFromMeta(metaType, ledgerType, amount)

    const campaignId = meta.campaignId != null ? Number(meta.campaignId) : null
    const campaign = campaignId != null && Number.isFinite(campaignId) ? campaignMap.get(campaignId) : null

    return {
      id: String(row.id),
      amount,
      type: ledgerType,
      transactionType,
      description: meta.description ?? null,
      createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
      status: meta.status ?? 'completed',
      bonusCampaignName: campaign?.name ?? null,
      bonusCampaignType: campaign?.type ?? null,
    }
  })
}

export async function getCasinoAndSportsBets(userId: number, tenant: string, start?: Date, end?: Date, rows?: { sportsIds: string[]; casinoIds: string[] }) {
  const conditions = [eq(sportsBets.userId, userId), eq(sportsBets.tenant, tenant)]
  const casinoConditions = [eq(casinoBets.userId, userId), eq(casinoBets.tenant, tenant)]
  if (rows?.sportsIds.length) conditions.push(inArray(sportsBets.id, rows.sportsIds))
  if (rows?.casinoIds.length) casinoConditions.push(inArray(casinoBets.id, rows.casinoIds))
  
  if (start) {
    conditions.push(gte(sportsBets.createdAt, start))
    casinoConditions.push(gte(casinoBets.createdAt, start))
  }
  if (end) {
    conditions.push(lte(sportsBets.createdAt, end))
    casinoConditions.push(lte(casinoBets.createdAt, end))
  }

  // Get sports bets with joins to get event, market, league, sport, and runner names
  const sportsBetsRows = rows?.sportsIds.length === 0 ? [] : await db
    .select({
      id: sportsBets.id,
      stake: sportsBets.stake,
      price: sportsBets.price,
      side: sportsBets.side,
      oddsSize: sportsBets.oddsSize,
      liability: sportsBets.liability,
      createdAt: sportsBets.createdAt,
      eventId: sportsBets.eventId,
      marketId: sportsBets.marketId,
      runnerId: sportsBets.runnerId,
      status: sportsBets.status,
      result: sportsBets.result,
      storedPl: sportsBets.pl,
      eventName: sportsEventsTable.name,
      marketName: sportsMarketsTable.name,
      marketType: sportsMarketsTable.type,
      leagueName: sportsLeaguesTable.name,
      sportName: sportsTable.name,
      runnerName: sportsRunnersTable.name,
    })
    .from(sportsBets)
    .leftJoin(sportsEventsTable, eq(sportsBets.eventId, sportsEventsTable.id))
    .leftJoin(sportsMarketsTable, eq(sportsBets.marketId, sportsMarketsTable.id))
    .leftJoin(sportsLeaguesTable, eq(sportsBets.leagueId, sportsLeaguesTable.id))
    .leftJoin(sportsTable, eq(sportsBets.sportId, sportsTable.id))
    .leftJoin(sportsRunnersTable, eq(sportsBets.runnerId, sportsRunnersTable.id))
    .where(and(...conditions))
    .orderBy(desc(sportsBets.createdAt))
    .limit(1000)

  // Fetch declared sports results for these markets (for "Result" column in account statements)
  const marketIds = [...new Set(sportsBetsRows.map((r) => r.marketId).filter(Boolean))] as string[]
  let resultDisplayByMarketId: Record<string, string> = {}
  if (marketIds.length > 0) {
    const resultRows = await db
      .select({
        marketId: sportsResultsTable.marketId,
        marketType: sportsResultsTable.marketType,
        runnerId: sportsResultsTable.runnerId,
        selectionName: sportsResultsTable.selectionName,
        result: sportsResultsTable.result,
      })
      .from(sportsResultsTable)
      .where(
        and(
          inArray(sportsResultsTable.marketId, marketIds),
          isNull(sportsResultsTable.rolledBackAt)
        )
      )
      .orderBy(desc(sportsResultsTable.declaredAt))

    // One result per market (latest declared)
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
        resultDisplayByMarketId[mid] = row.result != null ? String(row.result) : (row.selectionName ?? '-')
      } else if (row.selectionName) {
        resultDisplayByMarketId[mid] = row.selectionName
      } else if (row.runnerId && runnerNameById[row.runnerId]) {
        resultDisplayByMarketId[mid] = runnerNameById[row.runnerId]
      } else if (row.result != null) {
        resultDisplayByMarketId[mid] = String(row.result)
      } else {
        resultDisplayByMarketId[mid] = '-'
      }
    }
  }

  // Get casino bets
  const casinoBetsRows = rows?.casinoIds.length === 0 ? [] : await db
    .select({
      id: casinoBets.id,
      stake: casinoBets.stake,
      createdAt: casinoBets.createdAt,
      gameName: casinoBets.gameName,
      vendorName: casinoBets.vendorName,
      status: casinoBets.status,
      netAmount: casinoBets.netAmount,
      winAmount: casinoBets.winAmount,
      walletType: casinoBets.walletType,
    })
    .from(casinoBets)
    .where(and(...casinoConditions))
    .orderBy(desc(casinoBets.createdAt))
    .limit(1000)

  // Combine and format for frontend
  const allBets: any[] = []

  // Format sports bets
  sportsBetsRows.forEach((bet) => {
    const stake = Number(bet.stake || 0)
    const price = Number(bet.price || 0)
    const oddsSize = bet.oddsSize != null ? Number(bet.oddsSize) : 0
    const isFancy = oddsSize > 0

    // Use stored PL from database if available (set at settlement time), else fallback to calculation
    const liability = bet.liability != null ? Number(bet.liability) : 0
    let pl = 0
    const isVoid = bet.status === 'void' || bet.status === 'cancelled'
    if (isVoid) {
      pl = 0
    } else if ((bet as any).storedPl != null) {
      pl = Number((bet as any).storedPl)
    } else if (!isVoid && (bet.status === 'won' || bet.result === 'won')) {
      if (bet.side === 'back') {
        pl = isFancy ? stake * (oddsSize / 100) : stake * (price - 1)
      } else {
        pl = stake
      }
    } else if (!isVoid && (bet.status === 'lost' || bet.result === 'lost')) {
      if (bet.side === 'back') {
        pl = -stake
      } else {
        pl = isFancy ? -stake * (oddsSize / 100) : -liability
      }
    }

    const resultStatus = bet.status === 'cancelled' ? 'cancelled' : isVoid ? 'void' : (bet.status === 'won' || bet.result === 'won') ? 'won' : (bet.status === 'lost' || bet.result === 'lost') ? 'lost' : 'pending'

    allBets.push({
      id: String(bet.id),
      amount: stake,
      stake: stake,
      price: Number(bet.price || 0),
      side: bet.side || null,
      oddsSize: bet.oddsSize != null ? Number(bet.oddsSize) : null,
      liability: bet.liability != null ? Number(bet.liability) : 0,
      selectionName: bet.runnerName || null,
      /** DB lifecycle: matched | unmatched | cancelled | settled | won | lost | void */
      status: bet.status ?? null,
      createdAt: bet.createdAt?.toISOString?.() || new Date().toISOString(),
      marketId: bet.marketId ? {
        id: String(bet.marketId),
        marketName: bet.marketName || 'Sports Market',
        marketType: bet.marketType || null
      } : null,
      eventId: bet.eventId ? {
        id: String(bet.eventId),
        name: bet.eventName || 'Sports Event'
      } : null,
      sportName: bet.sportName || null,
      leagueName: bet.leagueName || null,
      pl: pl,
      result: resultStatus,
      description: bet.eventName || 'Sports Bet',
      provider: null,
      type: 'sports',
      walletType: 'cash',
      eventResult: bet.marketId ? (resultDisplayByMarketId[String(bet.marketId)] ?? null) : null,
    })
  })

  // Format casino bets
  casinoBetsRows.forEach((bet) => {
    const stake = Number(bet.stake || 0)
    const netAmount = Number(bet.netAmount || 0)
    const winAmount = Number(bet.winAmount || 0)
    
    // PL is the net amount (winAmount - stake) or netAmount if available
    // netAmount is already calculated as (winAmount - stake) in the database
    const unsettled = bet.status === 'pending' || bet.status === 'active'
    const refunded = bet.status === 'void' || bet.status === 'cancelled'
    const pl = unsettled ? null : refunded ? 0 : netAmount !== 0 ? netAmount : winAmount - stake

    allBets.push({
      id: String(bet.id),
      amount: stake,
      stake: stake,
      price: null,
      createdAt: bet.createdAt?.toISOString?.() || new Date().toISOString(),
      marketId: null,
      eventId: null,
      pl: pl,
      status: bet.status,
      result: bet.status === 'won' || bet.status === 'lost' || bet.status === 'void' || bet.status === 'cancelled' ? bet.status : 'pending',
      description: bet.gameName || 'Casino Game',
      provider: bet.vendorName || null,
      type: 'casino',
      walletType: bet.walletType || 'cash',
    })
  })

  // Sort by createdAt descending
  allBets.sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return dateB - dateA
  })

  return allBets
}

/** Tenants that get Live TV and Score Card URL APIs (mobile + desktop). Only grandwinn-com; kondareddi-com and others do not. */
export const LIVE_TV_SCORE_CARD_TENANTS = ['grandwinn-com'] as const

export function isLiveTvScoreCardEnabledForTenant(tenant: string): boolean {
  const normalized = (tenant || '').toLowerCase().trim()
  return LIVE_TV_SCORE_CARD_TENANTS.includes(normalized as (typeof LIVE_TV_SCORE_CARD_TENANTS)[number])
}

/** Returns per-tenant feature flags for sports/casino. Used to enforce whitelabel access in resolvers. */
export async function getWhitelabelFeatureFlags(tenant: string, userId?: number): Promise<{ sportsEnabled: boolean; casinoEnabled: boolean }> {
  if (userId) {
    const access = await loadPlayerDomains(db, tenant, userId)
    return { sportsEnabled: access.sports.visible, casinoEnabled: access.casino.visible }
  }
  const cfg = await db.query.appConfigs.findFirst({
    where: eq(appConfigs.whitelabelId, tenant),
    columns: { sportsEnabled: true, casinoEnabled: true },
  })
  return {
    sportsEnabled: cfg?.sportsEnabled ?? true,
    casinoEnabled: cfg?.casinoEnabled ?? true,
  }
}

/** Whether new-user registration is enabled for a whitelabel (default true). */
export async function isRegisterEnabledForTenant(tenant: string): Promise<boolean> {
  const cfg = await db.query.appConfigs.findFirst({
    where: eq(appConfigs.whitelabelId, tenant),
    columns: { registerEnabled: true },
  })
  return cfg?.registerEnabled ?? true
}

export async function getAppSettings(tenant: string, userId?: number) {
  const playerAccess = userId ? await loadPlayerDomains(db, tenant, userId) : null
  const withPlayerVisibility = (items: Array<{ key: string; value: string | null }>) => {
    if (!playerAccess) return items
    return items.map(item => {
      const domain = ({ sportsEnabled: 'sports', casinoEnabled: 'casino', matkaEnabled: 'matka' } as const)[item.key as 'sportsEnabled' | 'casinoEnabled' | 'matkaEnabled']
      return domain ? { ...item, value: String(playerAccess[domain].visible) } : item
    })
  }
  const cfg = await db.query.appConfigs.findFirst({
    where: eq(appConfigs.whitelabelId, tenant),
  })

  // Also fetch whitelabel branding/theme data
  // Try by id first, then by domain (tenant might be either)
  let whitelabel = await db.query.whitelabels.findFirst({
    where: eq(whitelabels.id, tenant),
  })
  
  // If not found by id, try by domain
  if (!whitelabel) {
    whitelabel = await db.query.whitelabels.findFirst({
      where: eq(whitelabels.domain, tenant),
    })
  }

  // Helper to safely convert values to strings
  const toValue = (val: any): string | null => {
    if (val === null || val === undefined) return null
    if (typeof val === 'boolean') return String(val)
    if (typeof val === 'number') return String(val)
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  if (!cfg) {
    // If no config, use whitelabel name or defaults
    const entries: Array<{ key: string; value: string | null }> = [
      // App name = whitelabel name. Blank is intentional and must stay blank (no fallback).
      { key: 'appName', value: whitelabel?.name ?? '' },
      { key: 'baseCurrency', value: 'INR' },
      { key: 'sportsEnabled', value: 'true' },
      { key: 'casinoEnabled', value: 'true' },
      { key: 'matkaEnabled', value: 'true' },
      { key: 'agentsEnabled', value: 'true' },
      { key: 'referralsEnabled', value: 'true' },
      { key: 'bonusesEnabled', value: 'true' },
      { key: 'registerEnabled', value: 'true' },
      { key: 'maintenance', value: 'false' },
      { key: 'cashoutEnabled', value: 'true' },
      { key: 'upiPayoutsDisabled', value: 'false' },
      { key: 'bankPayoutsDisabled', value: 'false' },
      { key: 'hideAddUpi', value: 'false' },
      { key: 'hideAddBank', value: 'false' },
    ]
    
    // Add whitelabel branding data if available (even without config)
    if (whitelabel) {
      // Data URIs and external URLs as stored; a legacy S3 key reads as null (no logo rather than a broken one)
      const logoUrl = displayableAsset(whitelabel.logoUrl)
      const faviconUrl = displayableAsset(whitelabel.faviconUrl)

    entries.push(
      { key: 'primaryDomain', value: whitelabel.domain },
      { key: 'logoUrl', value: logoUrl },
      { key: 'faviconUrl', value: faviconUrl },
    )
    }
    
    return withPlayerVisibility(entries.filter((e) => e.value !== null && e.value !== undefined))
  }

  const entries: Array<{ key: string; value: string | null }> = [
    // App identity (use whitelabel name as appName; blank stays blank, no fallback)
    { key: 'appName', value: whitelabel?.name ?? '' },
    { key: 'supportEmail', value: cfg.supportEmail },
    { key: 'supportPhone', value: cfg.supportPhone },
    { key: 'whatsappSupportPhone', value: cfg.whatsappSupportPhone },
    { key: 'defaultLocale', value: cfg.defaultLocale },
    { key: 'timeZone', value: cfg.timeZone },
    { key: 'baseCurrency', value: cfg.baseCurrency },
    
    // SEO & Social
    { key: 'seoTitle', value: cfg.seoTitle },
    { key: 'seoDescription', value: cfg.seoDescription },
    { key: 'ogImageUrl', value: cfg.ogImageUrl },
    { key: 'socialLinks', value: toValue(cfg.socialLinks) },
    
    // Analytics
    { key: 'analytics', value: toValue(cfg.analytics) },
    
    // Maintenance
    { key: 'maintenance', value: String(cfg.maintenance ?? false) },
    { key: 'maintenanceMessage', value: cfg.maintenanceMessage },
    { key: 'newsTicker', value: cfg.newsTicker ?? null },
    
    // Feature toggles
    { key: 'sportsEnabled', value: String(cfg.sportsEnabled ?? true) },
    { key: 'casinoEnabled', value: String(cfg.casinoEnabled ?? true) },
    { key: 'matkaEnabled', value: String(cfg.matkaEnabled ?? true) },
    { key: 'agentsEnabled', value: String(cfg.agentsEnabled ?? true) },
    { key: 'referralsEnabled', value: String(cfg.referralsEnabled ?? true) },
    { key: 'bonusesEnabled', value: String(cfg.bonusesEnabled ?? true) },
    { key: 'registerEnabled', value: String(cfg.registerEnabled ?? true) },
    
    // Payment configuration
    { key: 'depositMin', value: cfg.depositMin != null ? String(cfg.depositMin) : null },
    { key: 'depositMax', value: cfg.depositMax != null ? String(cfg.depositMax) : null },
    { key: 'withdrawalMin', value: cfg.withdrawalMin != null ? String(cfg.withdrawalMin) : null },
    { key: 'withdrawalMax', value: cfg.withdrawalMax != null ? String(cfg.withdrawalMax) : null },
    { key: 'depositFeePercent', value: cfg.depositFeePercent != null ? String(cfg.depositFeePercent) : null },
    { key: 'withdrawalFeePercent', value: cfg.withdrawalFeePercent != null ? String(cfg.withdrawalFeePercent) : null },
    { key: 'kycRequiredToWithdraw', value: cfg.kycRequiredToWithdraw !== undefined ? String(cfg.kycRequiredToWithdraw) : null },
    { key: 'roundingStrategy', value: cfg.roundingStrategy },
    { key: 'upiPayoutsDisabled', value: String(cfg.upiPayoutsDisabled ?? false) },
    { key: 'bankPayoutsDisabled', value: String(cfg.bankPayoutsDisabled ?? false) },
    { key: 'hideAddUpi', value: String(cfg.hideAddUpi ?? false) },
    { key: 'hideAddBank', value: String(cfg.hideAddBank ?? false) },
    {
      key: 'maxDailyWithdrawalRequests',
      value:
        cfg.maxDailyWithdrawalRequests != null && Number(cfg.maxDailyWithdrawalRequests) > 0
          ? String(cfg.maxDailyWithdrawalRequests)
          : null,
    },
    
    // Risk defaults
    { key: 'overallExposureCap', value: cfg.overallExposureCap != null ? String(cfg.overallExposureCap) : null },
    { key: 'dailyStakeLimit', value: cfg.dailyStakeLimit != null ? String(cfg.dailyStakeLimit) : null },
    { key: 'weeklyStakeLimit', value: cfg.weeklyStakeLimit != null ? String(cfg.weeklyStakeLimit) : null },
    { key: 'cashoutEnabled', value: cfg.cashoutEnabled !== undefined ? String(cfg.cashoutEnabled) : 'true' },
    
    // Domains config - get from whitelabels table, not app_configs
    { key: 'domains', value: whitelabel?.domain ? JSON.stringify([whitelabel.domain]) : null },
    
    // PWA config
    { key: 'pwa', value: toValue(cfg.pwa) },
    
    // Note: sportsGlobalConfig and casinoGlobalConfig are backend-only
    // They are used for filtering but not sent to user-side
  ]

  // Add whitelabel branding data if available
  if (whitelabel) {
    // Data URIs and external URLs as stored; a legacy S3 key reads as null (no logo rather than a broken one)
    const logoUrl = displayableAsset(whitelabel.logoUrl)
    const faviconUrl = displayableAsset(whitelabel.faviconUrl)

    entries.push(
      { key: 'primaryDomain', value: whitelabel.domain },
      { key: 'logoUrl', value: logoUrl },
      { key: 'faviconUrl', value: faviconUrl },
    )
  }

  // Add banner images from app_config (null entries are dropped below, so the app shows no banner)
  if (cfg?.preLoginBannerUrl) {
    const preLoginBannerUrl = displayableAsset(cfg.preLoginBannerUrl)
    entries.push({ key: 'preLoginBannerUrl', value: preLoginBannerUrl })
  }
  if (cfg?.postLoginBannerUrl) {
    const postLoginBannerUrl = displayableAsset(cfg.postLoginBannerUrl)
    entries.push({ key: 'postLoginBannerUrl', value: postLoginBannerUrl })
  }

  // The player theme (App Configuration → Branding & Theme). Absent = the Matchbook default.
  // The public settings payload must never fail because of the theme.
  let playerTheme: ReturnType<typeof playerThemeSetting> = null
  try { playerTheme = playerThemeSetting(cfg?.playerTheme, tenant) } catch { playerTheme = null }
  if (playerTheme) entries.push({ key: 'playerTheme', value: JSON.stringify(playerTheme) })

  // Add theme from app_config (not whitelabel)
  if (cfg?.theme) {
    entries.push(
      { key: 'whitelabelTheme', value: toValue(cfg.theme) },
    )
  } else {
    // No theme in app_config, provide default theme matching CSS defaults (index.css)
    const defaultTheme = {
      primary: '#FF3B30',  // Match current brand red
      success: '#059669',
      warning: '#d97706',
      danger: '#dc2626',
      dark: {
        bgPage: '#0B0B0D',  // Match index.css --background (neutral dark, not blue)
        textPrimary: '#E7E7EA',  // Match index.css --text
        textSecondary: '#9EA0A8',  // Match index.css --subtle
        border: '#2E2E36',  // Match index.css --border
      },
      light: {
        bgPage: '#F5F5F5',  // Match index.css --background-light (off-white)
        textPrimary: '#111827',  // Match index.css --text-light
        textSecondary: '#6B7280',  // Match index.css --subtle-light
        border: '#E5E7EB',  // Match index.css --border-light
      }
    }
    
    entries.push(
      { key: 'whitelabelTheme', value: toValue(defaultTheme) },
    )
  }

  // Check if user belongs to a CREDIT agent - if yes, hide D/W
  let hideDW = false
  if (userId) {
    try {
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { agentId: true },
      })
      
      if (user?.agentId) {
        const agent = await db.query.agents.findFirst({
          where: eq(agents.id, user.agentId),
          columns: { schemeType: true },
        })
        
        if (agent?.schemeType === 'CREDIT') {
          hideDW = true
        }
      }
    } catch (error) {
      // If check fails, don't hide D/W (fail open)
    }
  }

  // Add hideDW flag
  entries.push({ key: 'hideDW', value: String(hideDW) })

  // Live TV & Score Card: only for grandwinn-com (mobile + desktop); kondareddi-com and others get false
  entries.push({
    key: 'liveTvAndScoreCardEnabled',
    value: isLiveTvScoreCardEnabledForTenant(tenant) ? 'true' : 'false',
  })

  return withPlayerVisibility(entries.filter((e) => e.value !== null && e.value !== undefined))
}

/**
 * Receiving accounts a player may deposit to now. USDT wallets (type 'crypto') are opt-in: a client that
 * does not know the type would show a wallet as a bank account, so only clients that ask get them.
 */
export async function getWhitelabelAccounts(tenant: string, userId?: number | null, opts: { includeCrypto?: boolean } = {}) {
  if (!userId) return []
  const context = await getVipDepositContext(db, tenant, userId).catch(error => {
    if (String(error?.message).includes('credit-agent')) return null
    throw error
  })
  if (!context) return []
  // TEMP test gate: CRYPTO_DEPOSIT_ALLOWED_USER_IDS restricts crypto wallets to specific players (unset = all).
  const includeCrypto = opts.includeCrypto === true && isCryptoDepositAllowedForUser(userId)
  const cryptoRate = parseCryptoRate(context.payments?.cryptoRate)
  const cryptoBonusPercent = parseCryptoBonusPercent(context.payments?.cryptoBonusPercent)
  const accounts: any[] = allowedReceivingAccounts(context).filter(account => account.type !== 'crypto' || includeCrypto).map(account => account.type === 'crypto' ? {
    id: String(account.id), type: 'crypto',
    accountNumber: account.walletAddress, walletAddress: account.walletAddress, network: account.network || null,
    displayName: account.displayName || `${CRYPTO_COIN} (${account.network})`, qrKey: account.qrKey || null,
    qrUrl: null, cryptoRate, cryptoBonusPercent, minAmount: account.limits.min, maxAmount: account.limits.max,
    weight: account.weight ?? 0, enabled: true,
  } : {
    id: String(account.id), type: account.type,
    accountNumber: account.type === 'upi' ? account.upiId || account.vpa : account.accountNumber || account.accountNo,
    ifscCode: account.ifsc, bankName: account.bankName, branch: account.branch,
    accountHolderName: account.accountName, upiId: account.upiId || account.vpa,
    displayName: account.displayName || account.bankName || 'UPI', qrKey: account.qrKey || null,
    qrUrl: account.qrUrl || null, minAmount: account.limits.min, maxAmount: account.limits.max,
    weight: account.weight ?? 0, enabled: true,
  })
  if (isWelivepayAllowedForUser(userId) && context.policy.enabled && context.policy.methods.includes('GATEWAY') && context.user.status === 'active') {
    const [gateway] = await db.select().from(whitelabelPgSettings).where(eq(whitelabelPgSettings.tenant, tenant)).limit(1)
    // WeLivePay collects INR only: a gateway offered on another currency's site would refuse every deposit.
    if (gateway?.enabled && gateway.secretSiteKeyEncrypted && await getWhitelabelCurrency(tenant) === 'INR') {
      const limits = intersectDepositLimits([context.baseLimits, gatewayDepositLimits(gateway)])
      if (limits.available) accounts.push({ id: 'gateway-WELIVEPAY', type: 'gateway', displayName: gateway.displayName,
        minAmount: limits.min, maxAmount: limits.max, weight: 0, enabled: true })
    }
  }
  return accounts.sort((a, b) => (b.weight || 0) - (a.weight || 0))
}

/**
 * Does an edit change where a payout account's money goes? Compared ignoring case and surrounding spaces, so
 * re-saving the same details (or changing only the label) is not a change.
 */
export function payoutDestinationChanged(
  current: Pick<PayoutAccountRow, 'method' | 'accountNumber' | 'ifscCode' | 'bankName' | 'accountHolderName'>,
  next: { method: 'BANK' | 'UPI'; accountNumber: string; ifscCode?: string | null; bankName?: string | null; accountHolderName: string },
): boolean {
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase()
  return current.method !== next.method
    || !same(current.accountNumber, next.accountNumber)
    || !same(current.ifscCode, next.ifscCode)
    || !same(current.bankName, next.bankName)
    || !same(current.accountHolderName, next.accountHolderName)
}

/**
 * Refuses while a withdrawal to the account is still being paid (PENDING or PROCESSING). A withdrawal stores only
 * the account id, so changing or deleting the account under it would change where, or whether, the admin can pay it.
 * Call it inside the transaction that holds the account row FOR UPDATE.
 */
async function assertNoWithdrawalInFlight(executor: Pick<typeof db, 'select'>, accountId: number, tenant: string, action: 'changed' | 'deleted') {
  const [inFlight] = await executor
    .select({ id: withdrawalRequests.id })
    .from(withdrawalRequests)
    .where(and(
      eq(withdrawalRequests.payoutAccountId, accountId),
      eq(withdrawalRequests.tenant, tenant),
      inArray(withdrawalRequests.status, ['PENDING', 'PROCESSING']),
    ))
    .limit(1)
  if (inFlight) {
    throw new Error(`This account has a withdrawal in progress. It can be ${action} once that withdrawal is completed or cancelled.`)
  }
}

/** The player's live payout accounts. A deleted account (deleted_at set) is kept only to count toward auto-approval. */
export async function listPayoutAccounts(userId: number, tenant: string): Promise<PayoutAccountRow[]> {
  return db
    .select()
    .from(userPayoutAccounts)
    .where(and(eq(userPayoutAccounts.userId, userId), eq(userPayoutAccounts.tenant, tenant), isNull(userPayoutAccounts.deletedAt)))
    .orderBy(desc(userPayoutAccounts.isPrimary), desc(userPayoutAccounts.createdAt))
}

export async function createOrUpdatePayoutAccount(params: {
  userId: number
  tenant: string
  accountId?: number
  method: 'BANK' | 'UPI'
  accountNumber: string
  ifscCode?: string | null
  bankName?: string | null
  accountHolderName: string
  label?: string | null
  setPrimary?: boolean
}): Promise<PayoutAccountRow> {
  const { userId, tenant, accountId, setPrimary } = params

  async function applyPrimaryIfAllowed(row: PayoutAccountRow) {
    if (!setPrimary || !row) return
    const payoutCfg = await db.query.appConfigs.findFirst({
      where: eq(appConfigs.whitelabelId, tenant),
    })
    const primaryBlocked =
      (row.method === 'UPI' && payoutCfg?.upiPayoutsDisabled) ||
      (row.method === 'BANK' && payoutCfg?.bankPayoutsDisabled)
    if (!primaryBlocked) {
      await setPrimaryPayoutAccount(row.id, userId, tenant)
    }
  }

  if (!accountId) {
    const payoutCfg = await db.query.appConfigs.findFirst({
      where: eq(appConfigs.whitelabelId, tenant),
    })
    if (params.method === 'UPI' && payoutCfg?.hideAddUpi) {
      throw new Error('Adding UPI accounts is currently disabled for this platform.')
    }
    if (params.method === 'BANK' && payoutCfg?.hideAddBank) {
      throw new Error('Adding bank accounts is currently disabled for this platform.')
    }
  }
  if (accountId) {
    // MONEY-CRITICAL: an approved account is where withdrawals are paid, and createWithdrawalRequest trusts its
    // approval_status. An edit that changes where the money goes (method, number, IFSC, bank or holder) used to
    // keep the old APPROVED status, so a player could rewrite a reviewed account to a never-reviewed destination
    // and withdraw to it. Such an edit now goes back to admin review; a label-only edit keeps its status.
    //
    // The read, the in-flight check and the write share one transaction holding the account row FOR UPDATE. A
    // withdrawal being created holds the same row FOR SHARE until its request is stored (createWithdrawalRequest),
    // so this edit either waits for that request and then finds it in flight, or lands first and the withdrawal
    // then sees the account back in review.
    const row = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(userPayoutAccounts)
        .where(and(eq(userPayoutAccounts.id, accountId), eq(userPayoutAccounts.userId, userId), eq(userPayoutAccounts.tenant, tenant), isNull(userPayoutAccounts.deletedAt)))
        .for('update')
        .limit(1)
      // A deleted account is gone for the player: it cannot be edited back to life.
      if (!current) throw new Error('Payout account not found')
      const destinationChanged = payoutDestinationChanged(current, params)
      if (destinationChanged) {
        // A withdrawal stores only the account id, so a request still being paid would follow the new details.
        await assertNoWithdrawalInFlight(tx, accountId, tenant, 'changed')
      }
      const updated = await tx
        .update(userPayoutAccounts)
        .set({
          method: params.method,
          accountNumber: params.accountNumber,
          ifscCode: params.ifscCode ?? null,
          bankName: params.bankName ?? null,
          accountHolderName: params.accountHolderName,
          label: params.label ?? null,
          ...(destinationChanged ? { approvalStatus: 'PENDING' as const, approvedBy: null, approvedAt: null, rejectionReason: null } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(userPayoutAccounts.id, accountId), eq(userPayoutAccounts.userId, userId), eq(userPayoutAccounts.tenant, tenant)))
        .returning()
      return updated[0]
    })
    if (row) {
      await applyPrimaryIfAllowed(row)
    }
    return row!
  }
  // A player's first two accounts are approved without review. Count and insert under a per-player lock, so parallel
  // requests cannot each count fewer than two and all be approved unreviewed. Every account the player ever added
  // counts, deleted ones included (deletePayoutAccount only marks the row): deleting an account and adding another
  // destination must not get the new one approved unreviewed (FIN-05, owner 2026-11-04).
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`payout-account-create:${tenant}:${userId}`}, 0))`)
    const existingCount = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(userPayoutAccounts)
      .where(and(eq(userPayoutAccounts.userId, userId), eq(userPayoutAccounts.tenant, tenant)))
    const currentCount = existingCount[0]?.count ?? 0
    const approvalStatus = currentCount < 2 ? 'APPROVED' : 'PENDING'
    const inserted = await tx
      .insert(userPayoutAccounts)
      .values({
        tenant,
        userId,
        method: params.method,
        accountNumber: params.accountNumber,
        ifscCode: params.ifscCode ?? null,
        bankName: params.bankName ?? null,
        accountHolderName: params.accountHolderName,
        label: params.label ?? null,
        isPrimary: Boolean(setPrimary),
        approvalStatus,
      })
      .returning()
    return inserted[0]
  })
  if (row) {
    await applyPrimaryIfAllowed(row)
  }
  return row!
}

export async function deletePayoutAccount(accountId: number, userId: number, tenant: string) {
  // A soft delete (FIN-05, owner 2026-11-04): the row stays, marked deleted_at, so it still counts toward the
  // "first two accounts are approved without review" rule and past withdrawals keep their destination. It leaves
  // every list and stops being primary (the one-primary index then never sees it).
  //
  // A withdrawal still being paid follows its account by id, so the delete is refused while one is in flight. Lock
  // the row first: a withdrawal being created holds it FOR SHARE until its request is stored, so the check below
  // either sees that request or the withdrawal finds the account gone.
  await db.transaction(async (tx) => {
    const where = and(eq(userPayoutAccounts.id, accountId), eq(userPayoutAccounts.userId, userId), eq(userPayoutAccounts.tenant, tenant), isNull(userPayoutAccounts.deletedAt))
    const [account] = await tx.select({ id: userPayoutAccounts.id }).from(userPayoutAccounts).where(where).for('update').limit(1)
    if (!account) return
    await assertNoWithdrawalInFlight(tx, accountId, tenant, 'deleted')
    const now = new Date()
    await tx.update(userPayoutAccounts).set({ deletedAt: now, isPrimary: false, updatedAt: now }).where(where)
  })
}

export async function setPrimaryPayoutAccount(accountId: number, userId: number, tenant: string) {
  // A deleted account is not offered and cannot become primary.
  const accRows = await db
    .select()
    .from(userPayoutAccounts)
    .where(
      and(
        eq(userPayoutAccounts.id, accountId),
        eq(userPayoutAccounts.userId, userId),
        eq(userPayoutAccounts.tenant, tenant),
        isNull(userPayoutAccounts.deletedAt),
      ),
    )
    .limit(1)
  const accRow = accRows[0]
  if (!accRow) {
    throw new Error('Payout account not found')
  }
  const payoutCfg = await db.query.appConfigs.findFirst({
    where: eq(appConfigs.whitelabelId, tenant),
  })
  if (accRow.method === 'UPI' && payoutCfg?.upiPayoutsDisabled) {
    throw new Error('UPI payout accounts cannot be changed while UPI withdrawals are disabled.')
  }
  if (accRow.method === 'BANK' && payoutCfg?.bankPayoutsDisabled) {
    throw new Error('Bank payout accounts cannot be changed while bank withdrawals are disabled.')
  }
  // Clear other primaries
  await db
    .update(userPayoutAccounts)
    .set({ isPrimary: false })
    .where(and(eq(userPayoutAccounts.userId, userId), eq(userPayoutAccounts.tenant, tenant)))
  await db
    .update(userPayoutAccounts)
    .set({ isPrimary: true })
    .where(and(eq(userPayoutAccounts.id, accountId), eq(userPayoutAccounts.userId, userId), eq(userPayoutAccounts.tenant, tenant), isNull(userPayoutAccounts.deletedAt)))
}

const CRYPTO_UNAVAILABLE = 'Crypto deposits are not available right now. Please choose another method.'
const CRYPTO_TXID_TAKEN = 'This transaction hash has already been submitted. Check your deposit history or contact support.'

/**
 * What a deposit of `amount` to one of the whitelabel's USDT wallets costs, at the rate in force now.
 * Always computed here, inside the player's VIP lock: the USDT a request expects is never taken from the
 * client, and the rate and bonus it was promised are frozen on the request.
 */
async function quoteCryptoDeposit(tx: VipDatabase, tenant: string, accountId: string, amount: number, txHash: string) {
  const [payments] = await tx.select().from(whitelabelPaymentMethods).where(eq(whitelabelPaymentMethods.tenant, tenant)).limit(1)
  const rate = parseCryptoRate(payments?.cryptoRate)
  const wallets: any[] = Array.isArray(payments?.cryptoDetails) ? payments.cryptoDetails as any[] : []
  const wallet = wallets.find((w) => String(w?.id) === accountId && w?.enabled !== false && w?.walletAddress)
  if (rate === null || !wallet) throw new Error(CRYPTO_UNAVAILABLE)
  const [taken] = await tx.select({ id: depositRequests.id }).from(depositRequests).where(and(
    isNotNull(depositRequests.cryptoAmount),
    sql`lower(btrim(${depositRequests.utr})) = lower(${txHash})`,
    inArray(depositRequests.status, ['PENDING', 'APPROVED']),
  )).limit(1)
  if (taken) throw new Error(CRYPTO_TXID_TAKEN)
  const cryptoAmount = cryptoAmountFor(amount, rate)
  if (cryptoAmount === null) throw new Error('Amount must be greater than zero')
  // The whitelabel's bonus is promised now, like the rate: a later change never alters this request.
  const cryptoBonusPercent = parseCryptoBonusPercent(payments?.cryptoBonusPercent)
  return {
    cryptoAmount,
    cryptoRate: rate,
    cryptoNetwork: wallet.network ? String(wallet.network) : null,
    cryptoBonusPercent,
    cryptoBonusAmount: cryptoBonusFor(amount, cryptoBonusPercent),
  }
}

/** Whether `error` is the unique index that allows one live crypto request per transaction hash. */
function isCryptoTxHashConflict(error: unknown): boolean {
  const pgError = (error as { cause?: { code?: string; constraint?: string } } | null)?.cause ?? (error as { code?: string; constraint?: string } | null)
  return pgError?.code === '23505' && pgError?.constraint === 'deposit_requests_crypto_txid_unique'
}

// The created request goes back without proof_data: the player's screenshot (up to 2 MB) is not read back.
const { proofData: _createdProofData, ...depositRequestCreatedColumns } = getTableColumns(depositRequests)

export async function createDepositRequest(params: {
  userId: number
  tenant: string
  amount: number
  method: 'BANK_TRANSFER' | 'UPI' | 'CRYPTO'
  accountId?: string | null
  utr?: string | null
  referenceId?: string | null
  /** 'inline' with proofData, or a sentinel ('manual', 'proof-missing'); see domains/userApp/services/depositProof.ts */
  proofKey?: string | null
  /** The screenshot as a checked base64 image data URI (parseDepositProof). */
  proofData?: string | null
}): Promise<Omit<DepositRequestRow, 'proofData'>> {
  const amount = Number(params.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero')
  }
  const isCrypto = params.method === 'CRYPTO'
  // A crypto transfer can only be checked on-chain by its hash, so a screenshot alone is not enough.
  const txHash = isCrypto ? normalizeCryptoTxHash(params.utr) : null
  if (isCrypto) {
    // TEMP test gate: a player outside CRYPTO_DEPOSIT_ALLOWED_USER_IDS cannot deposit to a wallet by calling this directly either.
    if (!isCryptoDepositAllowedForUser(params.userId)) throw new Error(CRYPTO_UNAVAILABLE)
    const hashError = cryptoTxHashError(txHash)
    if (hashError) throw new Error(hashError)
  }

  const user = await findUserById(params.userId, params.tenant)
  if (!user) {
    throw new Error('User not found')
  }

  // A player under a responsible-gambling block may not add funds. Checked
  // here rather than in a resolver because this is the only door: the player
  // app, the admin panel and anything added later all arrive through it.
  //
  // Note the sibling below, createWithdrawalRequest, has no such check and
  // must never gain one — an excluded player still owns their balance and
  // this is their only route to it.
  await assertPlayerCanFund(params.tenant, params.userId)
  const playerType = (user as any).playerType || 'REGULAR'
  if (playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT') {
    throw new Error('Deposits are disabled for credit players. Please contact your agent.')
  }

  const inserted = await db.transaction(async tx => {
    await lockVipPlayer(tx, params.tenant, params.userId)
    // Quoted first, so a missing rate or a switched-off wallet reads as such, not as a VIP tier refusal.
    const quote = isCrypto ? await quoteCryptoDeposit(tx, params.tenant, String(params.accountId), amount, txHash!) : null
    const snapshot = await assertVipDepositAllowed(tx, params.tenant, params.userId, {
      method: params.method, amount, accountId: params.accountId,
    })
    return tx.insert(depositRequests)
    .values({
      userId: params.userId,
      tenant: params.tenant,
      amount: String(amount),
      method: params.method,
      receivingAccountId: params.accountId,
      vipPolicySnapshot: snapshot,
      utr: isCrypto ? txHash : params.utr ?? null,
      referenceId: isCrypto ? txHash : params.referenceId ?? null,
      // A screenshot lives in proof_data; without one, 'inline' would claim a file that is not there.
      proofKey: params.proofData ? DEPOSIT_PROOF_INLINE : params.proofKey ?? 'proof-missing',
      proofData: params.proofData ?? null,
      currency: 'INR',
      status: 'PENDING',
      cryptoAmount: quote ? String(quote.cryptoAmount) : null,
      cryptoRate: quote ? String(quote.cryptoRate) : null,
      cryptoNetwork: quote?.cryptoNetwork ?? null,
      cryptoBonusPercent: quote?.cryptoBonusAmount ? String(quote.cryptoBonusPercent) : null,
      cryptoBonusAmount: quote?.cryptoBonusAmount ? String(quote.cryptoBonusAmount) : null,
    })
    .returning(depositRequestCreatedColumns)
  }).catch((error: unknown) => {
    // Two submissions of one hash can race past the check in quoteCryptoDeposit; the index decides.
    if (isCrypto && isCryptoTxHashConflict(error)) throw new Error(CRYPTO_TXID_TAKEN)
    throw error
  })

  // Create admin notification for Tasks (filtered by whitelabel/agent)
  try {
    const agentId = (user as { agentId?: string | null })?.agentId ?? null
    const whitelabelId = params.tenant
    const currency = inserted[0].currency ?? 'INR'
    const formattedAmount = Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const userName = (user as any)?.name || (user as any)?.username || `User ID ${params.userId}`
    const userPhone = (user as any)?.phone || 'N/A'
    await db.insert(notifications).values({
      tenant: params.tenant,
      whitelabelId,
      agentId,
      userId: params.userId,
      type: 'DEPOSIT',
      category: 'task',
      title: 'Deposit request pending',
      message: `Deposit of ${formattedAmount} ${currency} (${params.method}) from ${userName} (${userPhone}) requires review.`,
      actionUrl: `/payments/deposits?depositId=${inserted[0].id}`,
      metadata: {
        depositRequestId: inserted[0].id,
        userId: params.userId,
        userName,
        userPhone,
        amount,
        currency,
        method: params.method,
      },
    })
  } catch (err: any) {
  }

  return inserted[0]
}

export type DepositHistoryItem = {
  id: string
  amount: number
  status: string
  createdAt: string
  utr: string | null
  method: string
  provider: string | null
  expiresAt: string | null
  /** CRYPTO only: the quote the request was made at, and the bonus paid on approval */
  cryptoAmount: number | null
  cryptoRate: number | null
  cryptoNetwork: string | null
  cryptoBonusAmount: number | null
}

const WELIVEPAY_STATUS_MAP: Record<string, string> = {
  pending: 'PENDING',
  success: 'APPROVED',
  expired: 'REJECTED',
  invalid: 'REJECTED',
}

/** WeLivePay payment links expire ~15 minutes after creation (per their docs). */
const WELIVEPAY_LINK_TTL_MS = 15 * 60 * 1000

/**
 * Unified deposit history for a player: manual deposit_requests PLUS every WeLivePay
 * order (pending/success/expired/invalid). The welivepay-originated deposit_requests row
 * (proof_key='welivepay', created on webhook success) is excluded so a successful gateway
 * deposit appears once (from welivepay_orders), not twice.
 */
export async function listUserDepositHistory(params: {
  userId: number
  tenant: string
  start?: Date
  end?: Date
}): Promise<DepositHistoryItem[]> {
  const drConds = [
    eq(depositRequests.tenant, params.tenant),
    eq(depositRequests.userId, params.userId),
    ne(depositRequests.proofKey, 'welivepay'),
  ]
  if (params.start) drConds.push(gte(depositRequests.createdAt, params.start))
  if (params.end) drConds.push(lte(depositRequests.createdAt, params.end))

  const woConds = [
    eq(welivepayOrders.tenant, params.tenant),
    eq(welivepayOrders.userId, params.userId),
  ]
  if (params.start) woConds.push(gte(welivepayOrders.createdAt, params.start))
  if (params.end) woConds.push(lte(welivepayOrders.createdAt, params.end))

  const [manual, gateway] = await Promise.all([
    // Only what the history shows: proof_data holds each screenshot inline (up to 2 MB) and is never read here.
    db.select({
      id: depositRequests.id, amount: depositRequests.amount, status: depositRequests.status, createdAt: depositRequests.createdAt,
      utr: depositRequests.utr, method: depositRequests.method, cryptoAmount: depositRequests.cryptoAmount,
      cryptoRate: depositRequests.cryptoRate, cryptoNetwork: depositRequests.cryptoNetwork, cryptoBonusAmount: depositRequests.cryptoBonusAmount,
    }).from(depositRequests).where(and(...drConds)),
    db.select().from(welivepayOrders).where(and(...woConds)),
  ])

  const items: DepositHistoryItem[] = [
    ...manual.map((row) => ({
      id: String(row.id),
      amount: Number(row.amount ?? 0),
      status: row.status,
      createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
      utr: row.utr ?? null,
      method: row.method,
      provider: null as string | null,
      expiresAt: null as string | null,
      cryptoAmount: row.cryptoAmount != null ? Number(row.cryptoAmount) : null,
      cryptoRate: row.cryptoRate != null ? Number(row.cryptoRate) : null,
      cryptoNetwork: row.cryptoNetwork ?? null,
      cryptoBonusAmount: row.cryptoBonusAmount != null ? Number(row.cryptoBonusAmount) : null,
    })),
    ...gateway.map((row) => {
      const createdMs = row.createdAt ? new Date(row.createdAt).getTime() : Date.now()
      const expiryMs = createdMs + WELIVEPAY_LINK_TTL_MS
      // A pending order whose link TTL has passed is effectively expired — show it as such
      // even before WeLivePay's expired webhook arrives (so it isn't stuck "Pending" forever).
      const isExpiredPending = row.status === 'pending' && Date.now() >= expiryMs
      const status = isExpiredPending ? 'REJECTED' : (WELIVEPAY_STATUS_MAP[row.status] ?? 'PENDING')
      return {
        id: `WLP-${row.id}`,
        amount: Number(row.amount ?? 0),
        status,
        createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
        utr: row.txnRef ?? null,
        method: 'UPI',
        provider: 'WELIVEPAY' as string | null,
        // expiresAt only meaningful while still genuinely pending (UI can show a countdown).
        expiresAt: row.status === 'pending' && !isExpiredPending ? new Date(expiryMs).toISOString() : null,
        cryptoAmount: null,
        cryptoRate: null,
        cryptoNetwork: null,
        cryptoBonusAmount: null,
      }
    }),
  ]

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return items
}

export async function toggleCasinoLike(userId: number, tenant: string, gameId: string) {
  const existing = await db
    .select()
    .from(casinoLikes)
    .where(and(eq(casinoLikes.userId, userId), eq(casinoLikes.tenant, tenant), eq(casinoLikes.gameId, gameId)))
    .limit(1)
  if (existing.length > 0) {
    await db.delete(casinoLikes).where(eq(casinoLikes.id, existing[0].id))
    return { liked: false }
  }
  await db.insert(casinoLikes).values({ userId, tenant, gameId })
  return { liked: true }
}

export async function addRecentCasinoGame(userId: number, tenant: string, gameId: string) {
  await db
    .insert(casinoRecent)
    .values({ userId, tenant, gameId })
    .onConflictDoUpdate({
      target: [casinoRecent.userId, casinoRecent.tenant, casinoRecent.gameId],
      set: { createdAt: sql`now()` },
    })
}

export async function listLikedCasinoGames(userId: number, tenant: string) {
  // Vendor filter: whitelabel enabled and no Super Admin override
  const vendorFilter = sql`
    COALESCE(
      (SELECT vcs.enabled 
       FROM whitelabel_casino_vendor_settings vcs 
       WHERE vcs.vendor_id = ${casinoGames.vendorId}
         AND vcs.tenant_id = ${tenant}
       LIMIT 1),
      true
    ) = true
    AND NOT EXISTS (
      SELECT 1 FROM whitelabel_casino_vendor_super_admin_override o
      WHERE o.tenant_id = ${tenant} AND o.vendor_id = ${casinoGames.vendorId} AND o.disabled = true
    )
  `
  // Game filter: whitelabel enabled and no Super Admin override
  const gameFilter = sql`
    COALESCE(
      (SELECT gs.enabled 
       FROM whitelabel_casino_game_settings gs 
       WHERE gs.game_id = ${casinoGames.id}
         AND gs.tenant_id = ${tenant}
       LIMIT 1),
      true
    ) = true
    AND NOT EXISTS (
      SELECT 1 FROM whitelabel_casino_game_super_admin_override o
      WHERE o.tenant_id = ${tenant} AND o.game_id = ${casinoGames.id} AND o.disabled = true
    )
  `
  
  const whereConditions: any[] = [
    eq(casinoLikes.userId, userId),
    eq(casinoLikes.tenant, tenant),
    eq(casinoGames.isActive, true), // Master control check
    vendorFilter,
    gameFilter
  ]
  
  const rows = await db
    .select({
      id: casinoLikes.id,
      gameId: casinoLikes.gameId,
      gameDbId: casinoGames.id,
      title: casinoGames.name,
      provider: casinoVendors.name,
      category: casinoGames.mainCategory,
      thumbnail: casinoGames.thumbnailUrl,
    })
    .from(casinoLikes)
    .leftJoin(casinoGames, eq(casinoLikes.gameId, sql<string>`CAST(${casinoGames.externalId} AS varchar)`))
    .leftJoin(casinoVendors, eq(casinoGames.vendorId, casinoVendors.id))
    .where(and(...whereConditions))
    .orderBy(desc(casinoLikes.createdAt))

  return rows.map((r) => ({
    id: String(r.gameId || r.gameDbId || r.id),
    title: r.title || 'Game',
    provider: r.provider || 'GAP',
    category: r.category || 'casino',
    imageUrl: r.thumbnail || null,
    gameId: r.gameId || (r.gameDbId ? String(r.gameDbId) : null),
  }))
}

export async function listRecentCasinoGames(userId: number, tenant: string, limit = 50) {
  // Vendor filter: whitelabel enabled and no Super Admin override
  const vendorFilter = sql`
    COALESCE(
      (SELECT vcs.enabled 
       FROM whitelabel_casino_vendor_settings vcs 
       WHERE vcs.vendor_id = ${casinoGames.vendorId}
         AND vcs.tenant_id = ${tenant}
       LIMIT 1),
      true
    ) = true
    AND NOT EXISTS (
      SELECT 1 FROM whitelabel_casino_vendor_super_admin_override o
      WHERE o.tenant_id = ${tenant} AND o.vendor_id = ${casinoGames.vendorId} AND o.disabled = true
    )
  `
  // Game filter: whitelabel enabled and no Super Admin override
  const gameFilter = sql`
    COALESCE(
      (SELECT gs.enabled 
       FROM whitelabel_casino_game_settings gs 
       WHERE gs.game_id = ${casinoGames.id}
         AND gs.tenant_id = ${tenant}
       LIMIT 1),
      true
    ) = true
    AND NOT EXISTS (
      SELECT 1 FROM whitelabel_casino_game_super_admin_override o
      WHERE o.tenant_id = ${tenant} AND o.game_id = ${casinoGames.id} AND o.disabled = true
    )
  `
  
  const whereConditions: any[] = [
    eq(casinoRecent.userId, userId),
    eq(casinoRecent.tenant, tenant),
    eq(casinoGames.isActive, true), // Master control check
    vendorFilter,
    gameFilter
  ]
  
  const rows = await db
    .select({
      id: casinoRecent.id,
      gameId: casinoRecent.gameId,
      gameDbId: casinoGames.id,
      title: casinoGames.name,
      provider: casinoVendors.name,
      category: casinoGames.mainCategory,
      thumbnail: casinoGames.thumbnailUrl,
    })
    .from(casinoRecent)
    .leftJoin(casinoGames, eq(casinoRecent.gameId, sql<string>`CAST(${casinoGames.externalId} AS varchar)`))
    .leftJoin(casinoVendors, eq(casinoGames.vendorId, casinoVendors.id))
    .where(and(...whereConditions))
    .orderBy(desc(casinoRecent.createdAt))
    .limit(limit)

  return rows.map((r) => ({
    id: String(r.gameId || r.gameDbId || r.id),
    title: r.title || 'Game',
    provider: r.provider || 'GAP',
    category: r.category || 'casino',
    imageUrl: r.thumbnail || null,
    gameId: r.gameId || (r.gameDbId ? String(r.gameDbId) : null),
  }))
}

/**
 * Add event to recent sports - should only be called when user places a bet
 * Automatically fetches event details from database if meta is not provided
 */
export async function addRecentSportsEvent(userId: number, tenant: string, eventId: string, meta?: Record<string, any>) {
  let eventMeta = meta
  
  // If meta is not provided, fetch event details from database
  if (!eventMeta || !eventMeta.eventName) {
    try {
      const eventRow = await db
        .select({
          id: sportsEventsTable.id,
          name: sportsEventsTable.name,
          startTime: sportsEventsTable.startTime,
          leagueId: sportsEventsTable.leagueId,
          leagueName: sportsLeaguesTable.name,
          sportId: sportsLeaguesTable.sportId,
          sportName: sportsTable.name,
        })
        .from(sportsEventsTable)
        .leftJoin(sportsLeaguesTable, eq(sportsLeaguesTable.id, sportsEventsTable.leagueId))
        .leftJoin(sportsTable, eq(sportsTable.id, sportsLeaguesTable.sportId))
        .where(eq(sportsEventsTable.id, eventId))
        .limit(1)
        .then((rows) => rows[0])

      if (eventRow) {
        eventMeta = {
          eventName: eventRow.name || 'Event',
          league: eventRow.leagueName || '',
          sport: (eventRow.sportName || 'cricket').toLowerCase(),
          startISO: eventRow.startTime ? eventRow.startTime.toISOString() : new Date().toISOString(),
          isLive: false, // Can be determined from event status if needed
          runners: [],
        }
      }
    } catch (_) {
      // If fetch fails, use provided meta or minimal defaults
      eventMeta = meta || {
        eventName: 'Event',
        league: '',
        sport: 'cricket',
        startISO: new Date().toISOString(),
        isLive: false,
        runners: [],
      }
    }
  }

  await db
    .insert(sportsRecent)
    .values({ userId, tenant, eventId, meta: eventMeta ?? {} })
    .onConflictDoUpdate({
      target: [sportsRecent.userId, sportsRecent.tenant, sportsRecent.eventId],
      set: { meta: eventMeta ?? {}, createdAt: sql`now()` },
    })
}

export async function toggleSportsBookmark(userId: number, tenant: string, eventId: string, meta?: Record<string, any>) {
  const existing = await db
    .select()
    .from(sportsBookmarks)
    .where(and(eq(sportsBookmarks.userId, userId), eq(sportsBookmarks.tenant, tenant), eq(sportsBookmarks.eventId, eventId)))
    .limit(1)
  if (existing.length > 0) {
    await db.delete(sportsBookmarks).where(eq(sportsBookmarks.id, existing[0].id))
    return { bookmarked: false }
  }
  await db.insert(sportsBookmarks).values({ userId, tenant, eventId, meta: meta ?? {} })
  return { bookmarked: true }
}

export async function listSportsBookmarks(userId: number, tenant: string) {
  return db
    .select()
    .from(sportsBookmarks)
    .where(and(eq(sportsBookmarks.userId, userId), eq(sportsBookmarks.tenant, tenant)))
    .orderBy(desc(sportsBookmarks.createdAt))
}

export async function listRecentSports(userId: number, tenant: string) {
  return db
    .select()
    .from(sportsRecent)
    .where(and(eq(sportsRecent.userId, userId), eq(sportsRecent.tenant, tenant)))
    .orderBy(desc(sportsRecent.createdAt))
}

export async function createWithdrawalRequest(params: {
  userId: number
  tenant: string
  amount: number
  accountId?: string | null
}) {
  const amount = Number(params.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Amount must be greater than zero')
  }
  const currency = await getWhitelabelCurrency(params.tenant)
  const currencySymbol = getCurrencySymbol(currency)
  const minimumAmount = 200
  if (amount < minimumAmount) {
    throw new Error(`Minimum withdrawal is ${currencySymbol}${minimumAmount}`)
  }

  const user = await findUserById(params.userId, params.tenant)
  if (!user) {
    throw new Error('User not found')
  }
  const playerType = (user as any).playerType || 'REGULAR'
  if (playerType === 'AGENT_CREDIT' || playerType === 'WHITELABEL_CREDIT') {
    throw new Error('Withdrawals are disabled for credit players. Please contact your agent.')
  }
  if (user.withdrawalLock) {
    throw new Error('Withdrawals are locked for this account')
  }

  const wallet = await ensureWallet(params.userId, params.tenant, currency)
  const currentCash = Number(wallet.cash ?? 0)
  const currentExposure = Number(wallet.exposure ?? 0)
  const availableBalance = Math.max(0, currentCash - currentExposure)
  if (amount > availableBalance) {
    throw new Error(
      `Insufficient available balance. Available: ${currencySymbol}${availableBalance.toFixed(2)} (Cash: ${currencySymbol}${currentCash.toFixed(2)}, Exposure: ${currencySymbol}${currentExposure.toFixed(2)}), Requested: ${currencySymbol}${amount.toFixed(2)}`
    )
  }
  if (currentCash < amount) {
    throw new Error('Insufficient wallet balance')
  }

  if (!params.accountId) {
    throw new Error('Payout account is required')
  }

  const payoutAccountId = Number(params.accountId)
  // A deleted account (deleted_at set) is never paid to: it reads as not found.
  const payoutAccount = await db
    .select()
    .from(userPayoutAccounts)
    .where(and(eq(userPayoutAccounts.id, payoutAccountId), eq(userPayoutAccounts.userId, params.userId), eq(userPayoutAccounts.tenant, params.tenant), isNull(userPayoutAccounts.deletedAt)))
    .limit(1)

  const accountRow = payoutAccount[0]
  if (!accountRow) {
    throw new Error('Payout account not found')
  }
  if (accountRow.approvalStatus !== 'APPROVED') {
    throw new Error('This account is not yet approved for withdrawals. Please wait for admin approval.')
  }

  const payoutCfg = await db.query.appConfigs.findFirst({
    where: eq(appConfigs.whitelabelId, params.tenant),
  })
  if (accountRow.method === 'UPI' && payoutCfg?.upiPayoutsDisabled) {
    throw new Error('UPI withdrawals are temporarily disabled. Please try another method or contact support.')
  }
  if (accountRow.method === 'BANK' && payoutCfg?.bankPayoutsDisabled) {
    throw new Error('Bank withdrawals are temporarily disabled. Please try another method or contact support.')
  }

  const dailyLimit =
    payoutCfg?.maxDailyWithdrawalRequests != null && Number(payoutCfg.maxDailyWithdrawalRequests) > 0
      ? Math.floor(Number(payoutCfg.maxDailyWithdrawalRequests))
      : 0
  if (dailyLimit > 0) {
    let tz =
      payoutCfg?.timeZone && String(payoutCfg.timeZone).trim() !== ''
        ? String(payoutCfg.timeZone)
        : await getWhitelabelTimezone(params.tenant)
    let startOfDayUtc: Date
    try {
      const zoned = DateTime.now().setZone(tz)
      if (!zoned.isValid) throw new Error('invalid tz')
      startOfDayUtc = zoned.startOf('day').toUTC().toJSDate()
    } catch {
      tz = 'UTC'
      startOfDayUtc = DateTime.now().setZone('UTC').startOf('day').toUTC().toJSDate()
    }
    const countedStatuses = ['PENDING', 'PROCESSING', 'COMPLETED'] as const
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.userId, params.userId),
          eq(withdrawalRequests.tenant, params.tenant),
          gte(withdrawalRequests.createdAt, startOfDayUtc),
          inArray(withdrawalRequests.status, [...countedStatuses]),
        ),
      )
    const countToday = Number(countRow?.count ?? 0)
    if (countToday >= dailyLimit) {
      throw new Error(`Daily withdrawal limit reached. You can raise up to ${dailyLimit} requests per day.`)
    }
  }

  // Raw cash before/after (for withdrawal_requests and legacy ledger)
  const balanceBefore = currentCash
  const balanceAfter = currentCash - amount
  const ledgerBefore = availableBalance
  const ledgerAfter = Math.max(0, availableBalance - amount)

  // MONEY-CRITICAL (FIN-05): the account was read above without a lock, and an edit that lands between that read
  // and the insert below would turn a reviewed account into a new, unreviewed destination while this request points
  // at it. So the debit, its ledger row and the request are stored in one transaction that first locks the account
  // FOR SHARE and checks it again. An edit or a delete of the account locks the row FOR UPDATE before its in-flight
  // check, so it either waits for this request and then sees it, or has already committed and is seen here.
  const inserted = await db.transaction(async (tx) => {
    const [lockedAccount] = await tx
      .select()
      .from(userPayoutAccounts)
      .where(and(eq(userPayoutAccounts.id, payoutAccountId), eq(userPayoutAccounts.userId, params.userId), eq(userPayoutAccounts.tenant, params.tenant), isNull(userPayoutAccounts.deletedAt)))
      .for('share')
      .limit(1)
    if (!lockedAccount) {
      throw new Error('Payout account not found')
    }
    if (lockedAccount.approvalStatus !== 'APPROVED') {
      throw new Error('This account is not yet approved for withdrawals. Please wait for admin approval.')
    }
    if (payoutDestinationChanged(accountRow, lockedAccount)) {
      throw new Error('This account was just changed. Please check its details and try again.')
    }

    // Update wallet first
    // The sufficiency check happened far above, before the daily-limit count and
    // the payout-account lookup, with no transaction and no row lock. Two
    // withdrawal requests arriving together both passed it and both debited, so
    // a player could withdraw more than they held and drive the wallet negative.
    //
    // The subtraction itself was already atomic; what was missing was the
    // condition. Re-asserting it in the WHERE means the loser matches no row.
    const debited = await tx
      .update(wallets)
      .set({ cash: sql`${wallets.cash} - ${amount}` })
      .where(
        and(
          eq(wallets.id, wallet.id),
          eq(wallets.tenant, params.tenant),
          sql`${wallets.cash} >= ${amount}`
        )
      )
      .returning({ id: wallets.id })
    if (debited.length === 0) {
      throw new Error('Insufficient wallet balance')
    }

    // Create ledger entry with balance information
    const ledgerTxnId = await logLedgerEvent({
      walletId: wallet.id,
      tenant: params.tenant,
      amount: -Math.abs(amount),
      type: 'withdrawal_pending',
      meta: { payoutAccountId, method: accountRow.method, currency },
      balanceBefore: String(balanceBefore),
      balanceAfter: String(balanceAfter),
    }, tx)

    // Create withdrawal request first so we can set referenceId on wallet_ledger
    return tx
      .insert(withdrawalRequests)
      .values({
        tenant: params.tenant,
        userId: params.userId,
        walletId: wallet.id,
        payoutAccountId,
        amount: String(amount),
        status: 'PENDING',
        currency,
        ledgerTxnId: ledgerTxnId,
        balanceBefore: String(balanceBefore),
        balanceAfter: String(balanceAfter),
      })
      .returning()
  })

  // Outside the transaction on purpose: createWalletLedgerEntry swallows its own errors, and a failed statement
  // inside the transaction would turn its COMMIT into a silent rollback of the request just reported as stored.
  await createWalletLedgerEntry(db, {
    tenant: params.tenant,
    walletId: wallet.id,
    userId: params.userId,
    walletType: 'cash',
    category: 'withdrawal_pending',
    direction: 'debit',
    amount,
    balanceBefore: ledgerBefore,
    balanceAfter: ledgerAfter,
    description: 'Withdrawal request',
    referenceType: 'withdrawal_request',
    referenceId: String(inserted[0].id),
    meta: { payoutAccountId, method: accountRow.method },
  })

  // Create admin notification for Tasks (filtered by whitelabel/agent)
  try {
    const agentId = (user as { agentId?: string | null })?.agentId ?? null
    const whitelabelId = params.tenant
    const currency = inserted[0].currency ?? 'INR'
    const formattedAmount = Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const userName = (user as any)?.name || (user as any)?.username || `User ID ${params.userId}`
    const userPhone = (user as any)?.phone || 'N/A'
    await db.insert(notifications).values({
      tenant: params.tenant,
      whitelabelId,
      agentId,
      userId: params.userId,
      type: 'WITHDRAWAL',
      category: 'task',
      title: 'Withdrawal request pending',
      message: `Withdrawal of ${formattedAmount} ${currency} from ${userName} (${userPhone}) requires review.`,
      actionUrl: `/payments/withdrawal-requests?withdrawalId=${inserted[0].id}`,
      metadata: {
        withdrawalRequestId: inserted[0].id,
        userId: params.userId,
        userName,
        userPhone,
        amount,
        currency,
      },
    })
  } catch (err: any) {
  }

  return {
    ...inserted[0],
    account: {
      id: accountRow.id,
      method: accountRow.method,
      accountNumber: accountRow.accountNumber,
      accountHolderName: accountRow.accountHolderName,
      ifscCode: accountRow.ifscCode,
    },
  } satisfies WithdrawalWithAccount
}

export async function listWithdrawalRequests(params: { userId: number; tenant: string; start?: Date; end?: Date }) {
  const conditions = [eq(withdrawalRequests.userId, params.userId), eq(withdrawalRequests.tenant, params.tenant)]
  if (params.start) conditions.push(gte(withdrawalRequests.createdAt, params.start))
  if (params.end) conditions.push(lte(withdrawalRequests.createdAt, params.end))

  const rows = await db
    .select({
      id: withdrawalRequests.id,
      tenant: withdrawalRequests.tenant,
      userId: withdrawalRequests.userId,
      walletId: withdrawalRequests.walletId,
      payoutAccountId: withdrawalRequests.payoutAccountId,
      amount: withdrawalRequests.amount,
      currency: withdrawalRequests.currency,
      status: withdrawalRequests.status,
      reviewerId: withdrawalRequests.reviewerId,
      reviewedAt: withdrawalRequests.reviewedAt,
      note: withdrawalRequests.note,
      balanceBefore: withdrawalRequests.balanceBefore,
      balanceAfter: withdrawalRequests.balanceAfter,
      ledgerTxnId: withdrawalRequests.ledgerTxnId,
      createdAt: withdrawalRequests.createdAt,
      updatedAt: withdrawalRequests.updatedAt,
      accountId: userPayoutAccounts.id,
      accountMethod: userPayoutAccounts.method,
      accountNumber: userPayoutAccounts.accountNumber,
      accountHolderName: userPayoutAccounts.accountHolderName,
      accountIfsc: userPayoutAccounts.ifscCode,
    })
    .from(withdrawalRequests)
    .leftJoin(userPayoutAccounts, eq(userPayoutAccounts.id, withdrawalRequests.payoutAccountId))
    .where(and(...conditions))
    .orderBy(desc(withdrawalRequests.createdAt))

  return rows.map((row) => ({
    id: row.id,
    tenant: row.tenant,
    userId: row.userId,
    walletId: row.walletId,
    payoutAccountId: row.payoutAccountId,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    reviewerId: row.reviewerId,
    reviewedAt: row.reviewedAt,
    note: row.note,
    balanceBefore: row.balanceBefore ?? null,
    balanceAfter: row.balanceAfter ?? null,
    ledgerTxnId: row.ledgerTxnId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    account: row.accountId
      ? {
          id: row.accountId,
          method: row.accountMethod as 'BANK' | 'UPI',
          accountNumber: row.accountNumber,
          accountHolderName: row.accountHolderName,
          ifscCode: row.accountIfsc,
        }
      : undefined,
  })) satisfies WithdrawalWithAccount[]
}

export async function getWithdrawalRequest(params: { requestId: number; tenant: string; userId: number }) {
  const rows = await listWithdrawalRequests({ userId: params.userId, tenant: params.tenant })
  const found = rows.find((r) => r.id === params.requestId)
  return found ?? null
}

export async function updateWithdrawalStatus(params: {
  requestId: number
  tenant: string
  reviewerId?: number | null
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  note?: string | null
}) {
  const [existing] = await db
    .select()
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.id, params.requestId), eq(withdrawalRequests.tenant, params.tenant)))
    .limit(1)
  if (!existing) return null

  // The guard used to apply only to FAILED and CANCELLED. Transitions the other
  // way were unguarded, so a COMPLETED request could be moved back to PROCESSING
  // and the next CANCELLED then saw `wasRefundable` true and credited the wallet
  // for a withdrawal that had already been paid out — repeatably.
  //
  // Of the five statuses, COMPLETED, FAILED and CANCELLED are terminal. Every
  // transition may only move a request that is still live, so the condition is
  // the same for all of them. This mirrors `updateWithdrawalStatusAdmin` in
  // admin-backend, which had the identical hole.
  const isRefundStatus = params.status === 'FAILED' || params.status === 'CANCELLED'
  const updateWhere = and(
    eq(withdrawalRequests.id, params.requestId),
    eq(withdrawalRequests.tenant, params.tenant),
    inArray(withdrawalRequests.status, ['PENDING', 'PROCESSING'])
  )

  const rows = await db
    .update(withdrawalRequests)
    .set({
      status: params.status,
      reviewerId: params.reviewerId ?? null,
      reviewedAt: new Date(),
      note: params.note ?? null,
      updatedAt: new Date(),
    })
    .where(updateWhere)
    .returning()
  const row = rows[0]
  if (!row) {
    // Either the request does not exist, or it is already terminal. Return it as
    // it actually stands so the caller sees the real status rather than a
    // transition that did not happen; a missing row still yields null.
    const [current] = await db
      .select()
      .from(withdrawalRequests)
      .where(and(eq(withdrawalRequests.id, params.requestId), eq(withdrawalRequests.tenant, params.tenant)))
      .limit(1)
    return current ?? null
  }

  // Refund only when transitioning to FAILED/CANCELLED from PENDING/PROCESSING (idempotent with admin path: only first transition refunds)
  const wasRefundable = existing.status === 'PENDING' || existing.status === 'PROCESSING'
  const refundAmount = Number(row.amount ?? 0)
  if (row.walletId && isRefundStatus && wasRefundable && refundAmount > 0) {
    const [wallet] = await db
      .select({ cash: wallets.cash, exposure: wallets.exposure })
      .from(wallets)
      .where(and(eq(wallets.id, row.walletId), eq(wallets.tenant, params.tenant)))
      .limit(1)
    const balanceBefore = wallet ? Number(wallet.cash ?? 0) : 0
    const exposure = wallet ? Number(wallet.exposure ?? 0) : 0
    const balanceAfter = balanceBefore + refundAmount
    const ledgerBefore = Math.max(0, balanceBefore - exposure)
    const ledgerAfter = Math.max(0, balanceAfter - exposure)

    await db
      .update(wallets)
      .set({ cash: sql`${wallets.cash} + ${row.amount}` })
      .where(and(eq(wallets.id, row.walletId), eq(wallets.tenant, params.tenant)))

    await logLedgerEvent({
      walletId: row.walletId,
      tenant: params.tenant,
      amount: refundAmount,
      type: 'withdrawal_refund',
      meta: { withdrawalId: row.id, status: params.status },
      balanceBefore: String(balanceBefore),
      balanceAfter: String(balanceAfter),
    }, db)
    await createWalletLedgerEntry(db, {
      tenant: params.tenant,
      walletId: row.walletId,
      userId: row.userId,
      walletType: 'cash',
      category: 'withdrawal_refund',
      direction: 'credit',
      amount: refundAmount,
      balanceBefore: ledgerBefore,
      balanceAfter: ledgerAfter,
      description: 'Withdrawal refund',
      referenceType: 'withdrawal_request',
      referenceId: String(row.id),
      meta: { withdrawalId: row.id, status: params.status },
    })
  }

  return row
}

export async function listAdvertisements(tenant: string) {
  const rows = await db
    .select()
    .from(advertisements)
    .where(and(
      eq(advertisements.whitelabelId, tenant), 
      eq(advertisements.status, 'ACTIVE'),
      isNotNull(advertisements.imageUrl) // Only return ads with images
    ))
    .orderBy(asc(advertisements.order), desc(advertisements.createdAt))
    .limit(50)
  
  // Images are data URIs (or external URLs); an ad whose image is a legacy S3 key has nothing to show and is left out
  const results = rows.map((r) => {
    const imageUrl = displayableAsset(r.imageUrl)
    // Only return ads with valid image URLs
    if (!imageUrl) return null
    return {
    id: String(r.id),
    title: r.title,
      subtitle: r.subtitle,
      image: imageUrl,
      type: r.type,
      url: r.url,
      order: r.order,
      deviceType: r.deviceType,
    }
  })

  // Filter out null results (ads without valid images)
  return results.filter((r): r is NonNullable<typeof r> => r !== null)
}

export function generateFancyOdds(eventId: string, marketCode: string) {
  const seed = Math.abs((eventId + marketCode).split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0))
  const base = 1.6 + (seed % 30) / 100 // 1.60 - 1.89
  const spread = 0.05 + (seed % 10) / 200 // 0.05 - 0.10
  const yes = Number((base + spread).toFixed(2))
  const no = Number((base - spread).toFixed(2))
  const now = new Date().toISOString()
  return [
    { marketCode, selectionId: 'YES', selection: 'Yes', odds: yes, updatedAt: now },
    { marketCode, selectionId: 'NO', selection: 'No', odds: no, updatedAt: now },
  ]
}

export async function getCasinoGamesList(params: {
  tenant: string
  search?: string
  provider?: string
  providers?: string[]
  category?: string
  categoryType?: string
  limit?: number
  page?: number
  slots?: boolean
  liveOnly?: boolean
}): Promise<
  Array<{ id: string; title: string; provider: string; category?: string | null; imageUrl?: string | null; gameId: string }> & { total?: number; page?: number; hasMore?: boolean }
> {
  // A homepage collection must fail closed: an unknown type must never fall
  // through to the full catalogue or the legacy main-category fallback.
  const requestedCategoryType = params.categoryType == null ? null : params.categoryType.trim().toLowerCase()
  const categoryType = casinoCategoryTypeEnum.enumValues.find(type => type === requestedCategoryType)
  if (requestedCategoryType !== null && !categoryType) return []
  const limit = Math.max(1, Math.min(Math.trunc(params.limit || 50), 100))
  const page = Math.max(params.page ?? 1, 1)
  const offset = (page - 1) * limit
  const filters = [eq(casinoGames.isActive, true)]
  
  // Filter by enabled vendors for this tenant (whitelabel setting) and no Super Admin override
  // Each tenant/subject setting is unique and enabled is non-null. Anti-joins
  // preserve default-enabled visibility without running a scalar lookup per game.
  const vendorFilter = sql`
    NOT EXISTS (
      SELECT 1 FROM whitelabel_casino_vendor_settings vcs
      WHERE vcs.vendor_id = ${casinoGames.vendorId}
        AND vcs.tenant_id = ${params.tenant} AND vcs.enabled = false
    )
    AND NOT EXISTS (
      SELECT 1 FROM whitelabel_casino_vendor_super_admin_override o
      WHERE o.tenant_id = ${params.tenant} AND o.vendor_id = ${casinoGames.vendorId} AND o.disabled = true
    )
  `
  
  filters.push(vendorFilter)

  // Filter by enabled providers for this tenant (Super Admin control)
  const providerFilter = sql`
    NOT EXISTS (
      SELECT 1 FROM whitelabel_casino_provider_settings pcs
      WHERE pcs.provider_id = ${casinoGames.apiProviderId}
        AND pcs.tenant_id = ${params.tenant} AND pcs.enabled = false
    )
  `
  filters.push(providerFilter)
  
  // IMPORTANT: When slots or liveOnly is specified (without a specific category),
  // we must check if the whitelabel has ANY categories for that mainCategory.
  // If the whitelabel hasn't created any categories, return empty results.
  // This ensures games only show when whitelabel has explicitly set up categories.
  if ((params.slots || params.liveOnly) && !categoryType) {
    const mainCategoryToCheck = params.slots ? 'slots' : 'live_casino'
    
    // Check if whitelabel has any categories for this mainCategory
    const tenantCategories = await db
      .select({ id: casinoCategories.id })
      .from(casinoCategories)
      .where(and(
        eq(casinoCategories.tenantId, params.tenant),
        eq(casinoCategories.mainCategory, mainCategoryToCheck),
        ne(casinoCategories.type, 'lounge'),
        eq(casinoCategories.isActive, true)
      ))
      .limit(1)
    
    // If no categories exist for this mainCategory, return empty results
    // Whitelabel must create at least one category to show games
    if (tenantCategories.length === 0) {
      return []
    }
    
    // Add mainCategory filter
    filters.push(eq(casinoGames.mainCategory, mainCategoryToCheck))
  } else if (params.slots || params.liveOnly) {
    filters.push(eq(casinoGames.mainCategory, params.slots ? 'slots' : 'live_casino'))
  }
  let matchedCategoryId: number | null = null
  if (params.category && !categoryType) {
    // Build category filter conditions - must match tenant, name/slug, and be active
    const categoryConditions = [
      eq(casinoCategories.tenantId, params.tenant),
      or(
        eq(casinoCategories.name, params.category),
        ilike(casinoCategories.name, params.category),
        eq(casinoCategories.slug, params.category),
        ilike(casinoCategories.slug, params.category)
      ),
      eq(casinoCategories.isActive, true)
    ]
    
    // Also filter by mainCategory if slots/liveOnly is specified
    // This ensures that when on Slots page, only slot categories are matched
    // and when on Casino page, only live_casino categories are matched
    if (params.slots) {
      categoryConditions.push(eq(casinoCategories.mainCategory, 'slots'))
    } else if (params.liveOnly) {
      categoryConditions.push(eq(casinoCategories.mainCategory, 'live_casino'))
    }
    
    // Try exact match first, then case-insensitive match
    const catRow = await db
      .select({
        id: casinoCategories.id,
        mainCategory: casinoCategories.mainCategory,
        name: casinoCategories.name,
      })
      .from(casinoCategories)
      .where(and(...categoryConditions))
      .limit(1)

    if (catRow[0]) {
      matchedCategoryId = catRow[0].id
    } else {
      // Fallback to mainCategory match when custom category not found
      filters.push(eq(casinoGames.mainCategory, params.category as any))
    }
  }
  
  // Always respect whitelabel per-game enablement (and Super Admin game overrides), even when
  // filtering by category — category membership only controls ordering/grouping, not overriding disable.
  const gameFilter = sql`
    NOT EXISTS (
      SELECT 1 FROM whitelabel_casino_game_settings gs
      WHERE gs.game_id = ${casinoGames.id}
        AND gs.tenant_id = ${params.tenant} AND gs.enabled = false
    )
    AND NOT EXISTS (
      SELECT 1 FROM whitelabel_casino_game_super_admin_override o
      WHERE o.tenant_id = ${params.tenant} AND o.game_id = ${casinoGames.id} AND o.disabled = true
    )
  `
  filters.push(gameFilter)
  if (params.search) {
    // Match the query against game title OR external gameId (e.g. "900001") OR vendor name,
    // so users can paste a gameId from admin/Postman and still find the game.
    const q = `%${params.search}%`
    filters.push(or(ilike(casinoGames.name, q), ilike(casinoGames.externalId, q), ilike(casinoVendors.name, q))!)
  }
  if (params.provider) filters.push(ilike(casinoVendors.name, `%${params.provider}%`))
  if (params.providers && params.providers.length > 0) {
    filters.push(inArray(casinoVendors.name, params.providers))
  }

  // Group before joining so a game assigned to multiple collections appears
  // once, including in pagination totals. The earliest category/membership
  // position controls its order; an unset category order sorts last.
  const typedMembership = categoryType ? db
    .select({
      gameId: casinoCategoryGames.gameId,
      position: sql<number[]>`min(array[coalesce(${casinoCategories.order}, 2147483647), ${casinoCategories.id}, ${casinoCategoryGames.order}])`.as('membership_position'),
    })
    .from(casinoCategoryGames)
    .innerJoin(casinoCategories, eq(casinoCategories.id, casinoCategoryGames.categoryId))
    .where(and(
      eq(casinoCategories.tenantId, params.tenant),
      eq(casinoCategories.isActive, true),
      eq(casinoCategories.type, categoryType),
    ))
    .groupBy(casinoCategoryGames.gameId)
    .as('typed_category_membership') : null
  // Artwork belongs to the winning Lounge membership, not the master game.
  // Pick that same first category/order as typedMembership, including when its
  // image is null: a later collection must not silently supply another image.
  const thumbnailUrl = categoryType === 'lounge' ? sql<string | null>`coalesce((
    SELECT nullif(lounge_art.image_data, '')
    FROM casino_category_games AS lounge_art
    INNER JOIN casino_categories AS lounge_category ON lounge_category.id = lounge_art.category_id
    WHERE lounge_art.game_id = ${casinoGames.id}
      AND lounge_category.tenant_id = ${params.tenant}
      AND lounge_category.type = 'lounge'
      AND lounge_category.is_active = true
    ORDER BY coalesce(lounge_category."order", 2147483647), lounge_category.id, lounge_art."order"
    LIMIT 1
  ), ${casinoGames.thumbnailUrl})` : casinoGames.thumbnailUrl
  const baseSelect = db
    .select({ id: casinoGames.id, name: casinoGames.name, mainCategory: casinoGames.mainCategory,
      vendorId: casinoGames.vendorId, thumbnailUrl, externalId: casinoGames.externalId, vendorName: casinoVendors.name })
    .from(casinoGames).innerJoin(casinoVendors, eq(casinoGames.vendorId, casinoVendors.id))
  const countSelect = db.select({ count: sql<number>`count(*)` }).from(casinoGames)
    .innerJoin(casinoVendors, eq(casinoGames.vendorId, casinoVendors.id))
  const membership = and(eq(casinoCategoryGames.gameId, casinoGames.id), eq(casinoCategoryGames.categoryId, matchedCategoryId ?? -1))
  const listQuery = typedMembership
    ? baseSelect.innerJoin(typedMembership, eq(typedMembership.gameId, casinoGames.id))
    : matchedCategoryId ? baseSelect.innerJoin(casinoCategoryGames, membership) : baseSelect
  const countQuery = typedMembership
    ? countSelect.innerJoin(typedMembership, eq(typedMembership.gameId, casinoGames.id))
    : matchedCategoryId ? countSelect.innerJoin(casinoCategoryGames, membership) : countSelect
  const where = and(...filters)
  const [totals, rows] = await Promise.all([
    countQuery.where(where),
    listQuery.where(where).orderBy(...(typedMembership
      ? [asc(typedMembership.position), asc(casinoGames.id)]
      : matchedCategoryId ? [asc(casinoCategoryGames.order), asc(casinoGames.id)] : [asc(casinoGames.id)])).limit(limit).offset(offset),
  ])
  const total = Number(totals[0]?.count ?? 0)

  return Object.assign(rows.map((row) => ({
    id: String(row.id),
    title: row.name,
    provider: row.vendorName || 'Provider',
    category: row.mainCategory,
    imageUrl: row.thumbnailUrl || null,
    gameId: row.externalId,
    total,
    page,
    hasMore: offset + limit < total,
  })), { total, page, hasMore: offset + limit < total })
}

export async function getCasinoCategoriesList(params: { tenant: string; liveOnly?: boolean; slotsOnly?: boolean }): Promise<Array<{ name: string; type: string | null; slug: string | null; subtitle: string | null; order: number | null; iconData: string | null }>> {
  // Lounge is a homepage collection, rather than a casino/slots navigation tab.
  const conditions = [eq(casinoCategories.tenantId, params.tenant), eq(casinoCategories.isActive, true), ne(casinoCategories.type, 'lounge')]
  if (params.liveOnly) {
    conditions.push(eq(casinoCategories.mainCategory, 'live_casino'))
  } else if (params.slotsOnly) {
    conditions.push(eq(casinoCategories.mainCategory, 'slots'))
  }
  const rows = await db
    .select({ name: casinoCategories.name, type: casinoCategories.type, slug: casinoCategories.slug, subtitle: casinoCategories.subtitle, order: casinoCategories.order, iconData: casinoCategories.iconData })
    .from(casinoCategories)
    .where(and(...conditions))
    .orderBy(casinoCategories.order, casinoCategories.id)
  
  // Icons are data URIs (or external URLs); a legacy S3 key reads as null and the tab shows no icon
  return rows
    .filter((r) => r.name)
    .map((r) => ({
      name: r.name!,
      type: r.type,
      slug: r.slug,
      subtitle: r.subtitle,
      order: r.order,
      iconData: displayableAsset(r.iconData),
    }))
}

export async function getCasinoProvidersList(tenant: string): Promise<Array<{ name: string; slug: string | null }>> {
  // Return vendors enabled for this tenant and not disabled by Super Admin override
  const vendorFilter = sql`
    COALESCE(
      (SELECT vcs.enabled 
       FROM whitelabel_casino_vendor_settings vcs 
       WHERE vcs.vendor_id = ${casinoVendors.id}
         AND vcs.tenant_id = ${tenant}
       LIMIT 1),
      true
    ) = true
    AND NOT EXISTS (
      SELECT 1 FROM whitelabel_casino_vendor_super_admin_override o
      WHERE o.tenant_id = ${tenant} AND o.vendor_id = ${casinoVendors.id} AND o.disabled = true
    )
  `
  
  const rows = await db
    .select({ 
      name: casinoVendors.name, 
      slug: casinoVendors.slug 
    })
    .from(casinoVendors)
    .where(vendorFilter)
    .limit(200)
  return rows.map((r) => ({ name: r.name, slug: r.slug ?? null }))
}

export async function getBonusAwards(userId: number, tenant: string) {
  const rows = await db
    .select({
      id: bonusAwards.id,
      campaignId: bonusAwards.campaignId,
      userId: bonusAwards.userId,
      domain: bonusAwards.domain,
      type: bonusAwards.type,
      amount: bonusAwards.amount,
      currency: bonusAwards.currency,
      wageringReq: bonusAwards.wageringReq,
      currentWagering: bonusAwards.currentWagering,
      status: bonusAwards.status,
      firstDepositRequired: bonusAwards.firstDepositRequired,
      firstDepositUnlocked: bonusAwards.firstDepositUnlocked,
      awardedAt: bonusAwards.awardedAt,
      completedAt: bonusAwards.completedAt,
      triggerAmount: bonusAwards.triggerAmount,
      awardDistributionType: bonusAwards.distributionType,
      awardReleaseType: bonusAwards.releaseType,
      // Campaign details
      campaignName: bonusCampaigns.name,
      campaignType: bonusCampaigns.type,
      campaignDomain: bonusCampaigns.domain,
      campaignStatus: bonusCampaigns.status,
      campaignExpiryBonusDays: bonusCampaigns.expiryBonusDays,
      campaignRulesJson: bonusCampaigns.rulesJson,
      campaignCurrency: bonusCampaigns.currency,
      campaignDistributionType: bonusCampaigns.distributionType,
      campaignAmountType: bonusCampaigns.amountType,
      campaignPercentage: bonusCampaigns.percentage,
      campaignWagering: bonusCampaigns.wagering,
      campaignDepositConditionType: bonusCampaigns.depositConditionType,
      campaignDepositConditionAmount: bonusCampaigns.depositConditionAmount,
      campaignReleaseType: bonusCampaigns.releaseType,
    })
    .from(bonusAwards)
    .leftJoin(bonusCampaigns, and(
      eq(bonusCampaigns.id, bonusAwards.campaignId),
      eq(bonusCampaigns.tenant, tenant)
    ))
    .where(eq(bonusAwards.userId, userId))
    .orderBy(desc(bonusAwards.awardedAt))

  // For "deposit required" bonuses: user can activate once they have a deposit (approved request OR admin manual deposit)
  let hasDeposit = await db
    .select({ id: depositRequests.id })
    .from(depositRequests)
    .where(
      and(
        eq(depositRequests.userId, userId),
        eq(depositRequests.tenant, tenant),
        eq(depositRequests.status, 'APPROVED')
      )
    )
    .limit(1)
    .then((r) => r.length > 0)

  // Fallback: check ledger entries for admin manual deposit or direct deposit credit
  if (!hasDeposit) {
    const wallet = await ensureWallet(userId, tenant)
    hasDeposit = await db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.walletId, wallet.id),
          eq(ledgerEntries.tenant, tenant),
          eq(ledgerEntries.type, 'credit'),
          or(
            sql`${ledgerEntries.meta}->>'type' = 'deposit'`,
            sql`${ledgerEntries.meta}->>'type' = 'admin_adjustment'`
          )
        )
      )
      .limit(1)
      .then((r) => r.length > 0)
  }

  return rows.map((row) => {
    // Bonus expiry = awardedAt + expiryBonusDays (or rulesJson.expiryDays). Campaign validTo/endDate do NOT affect awarded bonus expiry.
    let expiresAt: string | null = null
    const raw = row.campaignExpiryBonusDays ?? (row.campaignRulesJson && typeof row.campaignRulesJson === 'object' ? (row.campaignRulesJson as any).expiryDays : null)
    const expiryDays = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(expiryDays) && expiryDays >= 1 && row.awardedAt) {
      try {
        const awarded = DateTime.fromJSDate(new Date(row.awardedAt), { zone: 'Asia/Kolkata' })
        if (awarded.isValid) {
          expiresAt = awarded.plus({ days: Math.floor(expiryDays) }).toJSDate().toISOString()
        }
      } catch {
        // invalid awardedAt or date math; leave expiresAt null
      }
    }

    // firstDepositMade: true if already unlocked (activated) OR user has a deposit (approved request or admin manual)
    const firstDepositMade =
      (row.firstDepositUnlocked ?? false) ||
      (Boolean(row.firstDepositRequired) && hasDeposit)

    const completedAtIso = row.completedAt?.toISOString?.() ?? null
    const claimedAt =
      row.status === 'completed'
        ? completedAtIso
        : null

    const depositAmount =
      row.triggerAmount != null ? Number(row.triggerAmount) : null

    return {
      id: String(row.id),
      bonusAmount: Number(row.amount ?? 0),
      depositAmount,
      createdAt: row.awardedAt?.toISOString?.() ?? new Date().toISOString(),
      awardedAt: row.awardedAt?.toISOString?.() ?? null,
      completedAt: completedAtIso,
      claimedAt,
      expiresAt,
      wageringAmount: Number(row.wageringReq ?? 0),
      fulfilledAmount: Number(row.currentWagering ?? 0),
      status: row.status,
      firstDepositRequired: row.firstDepositRequired ?? false,
      firstDepositMade,
      currency: row.currency ?? row.campaignCurrency ?? undefined,
      campaignDetails: row.campaignName ? {
        id: String(row.campaignId),
        name: row.campaignName,
        type: row.campaignType,
        domain: row.campaignDomain,
        status: row.campaignStatus,
        currency: row.campaignCurrency ?? row.currency ?? undefined,
        distributionType: (row.awardDistributionType ?? row.campaignDistributionType) ?? undefined,
        amountType: row.campaignAmountType ?? undefined,
        percentage: row.campaignPercentage != null ? Number(row.campaignPercentage) : undefined,
        wagering: row.campaignWagering != null ? Number(row.campaignWagering) : undefined,
        depositConditionType: row.campaignDepositConditionType ?? undefined,
        depositConditionAmount: row.campaignDepositConditionAmount != null ? Number(row.campaignDepositConditionAmount) : undefined,
        releaseType: (row.awardReleaseType ?? row.campaignReleaseType) ?? undefined,
        expiryBonusDays: row.campaignExpiryBonusDays ?? undefined,
      } : null,
      distributionType: (row.awardDistributionType ?? row.campaignDistributionType) ?? undefined,
      domain: row.domain,
      type: row.type,
    }
  })
}

export async function getActiveCasinoBonusAwardId(
  userId: number,
  tenant: string,
  executor: typeof db = db
): Promise<number | null> {
  const rows = await executor
    .select({ id: bonusAwards.id })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, eq(bonusCampaigns.id, bonusAwards.campaignId))
    .where(
      and(
        eq(bonusAwards.userId, userId),
        eq(bonusCampaigns.tenant, tenant),
        eq(bonusAwards.status, 'active'),
        or(eq(bonusAwards.domain, 'casino'), eq(bonusAwards.domain, 'global'))
      )
    )
    .limit(1)
  return rows[0]?.id ?? null
}

// Map frontend filter status to DB enum (bonus_award_status: pending, active, completed, expired, cancelled)
const HISTORY_STATUS_MAP: Record<string, string> = {
  claimed: 'completed',
  forfeited: 'cancelled',
  available: 'pending',
}

export async function getBonusHistory(userId: number, tenant: string, filters?: { status?: string; fromDate?: Date; toDate?: Date }) {
  const conditions = [eq(bonusAwards.userId, userId)]

  if (filters?.status) {
    const dbStatus = HISTORY_STATUS_MAP[filters.status] ?? filters.status
    conditions.push(eq(bonusAwards.status, dbStatus as any))
  }
  
  if (filters?.fromDate) {
    conditions.push(gte(bonusAwards.awardedAt, filters.fromDate))
  }
  
  if (filters?.toDate) {
    conditions.push(lte(bonusAwards.awardedAt, filters.toDate))
  }

  const rows = await db
    .select({
      id: bonusAwards.id,
      campaignId: bonusAwards.campaignId,
      amount: bonusAwards.amount,
      currency: bonusAwards.currency,
      status: bonusAwards.status,
      awardedAt: bonusAwards.awardedAt,
      completedAt: bonusAwards.completedAt,
      domain: bonusAwards.domain,
      type: bonusAwards.type,
      wageringReq: bonusAwards.wageringReq,
      currentWagering: bonusAwards.currentWagering,
      triggerAmount: bonusAwards.triggerAmount,
      awardDistributionType: bonusAwards.distributionType,
      awardReleaseType: bonusAwards.releaseType,
      campaignName: bonusCampaigns.name,
      campaignDistributionType: bonusCampaigns.distributionType,
      campaignAmountType: bonusCampaigns.amountType,
      campaignPercentage: bonusCampaigns.percentage,
      campaignWagering: bonusCampaigns.wagering,
      campaignReleaseType: bonusCampaigns.releaseType,
      campaignExpiryBonusDays: bonusCampaigns.expiryBonusDays,
      campaignRulesJson: bonusCampaigns.rulesJson,
    })
    .from(bonusAwards)
    .leftJoin(bonusCampaigns, and(
      eq(bonusCampaigns.id, bonusAwards.campaignId),
      eq(bonusCampaigns.tenant, tenant)
    ))
    .where(and(...conditions))
    .orderBy(desc(bonusAwards.awardedAt))

  return rows.map((row) => {
    // Compute expiry date
    let expiresAt: string | undefined
    const rawExpiry = row.campaignExpiryBonusDays ?? (row.campaignRulesJson && typeof row.campaignRulesJson === 'object' ? (row.campaignRulesJson as any).expiryDays : null)
    const expiryDays = typeof rawExpiry === 'number' ? rawExpiry : Number(rawExpiry)
    if (Number.isFinite(expiryDays) && expiryDays >= 1 && row.awardedAt) {
      try {
        const awarded = DateTime.fromJSDate(new Date(row.awardedAt), { zone: 'Asia/Kolkata' })
        if (awarded.isValid) {
          expiresAt = awarded.plus({ days: Math.floor(expiryDays) }).toJSDate().toISOString()
        }
      } catch {
        // leave expiresAt undefined
      }
    }

    return {
      id: String(row.id),
      name: row.campaignName || 'Bonus',
      amount: Number(row.amount ?? 0),
      status: row.status,
      currency: row.currency ?? undefined,
      awardedAt: row.awardedAt?.toISOString() ?? new Date().toISOString(),
      completedAt: row.completedAt?.toISOString() ?? undefined,
      claimedAt: row.status === 'completed' ? row.completedAt?.toISOString() : undefined,
      domain: row.domain,
      type: row.type,
      distributionType: (row.awardDistributionType ?? row.campaignDistributionType) ?? undefined,
      depositAmount: row.triggerAmount != null ? Number(row.triggerAmount) : undefined,
      wageringAmount: Number(row.wageringReq ?? 0),
      fulfilledAmount: Number(row.currentWagering ?? 0),
      expiresAt,
      amountType: row.campaignAmountType ?? undefined,
      percentage: row.campaignPercentage != null ? Number(row.campaignPercentage) : undefined,
      wagering: row.campaignWagering != null ? Number(row.campaignWagering) : undefined,
      releaseType: (row.awardReleaseType ?? row.campaignReleaseType) ?? undefined,
      expiryBonusDays: row.campaignExpiryBonusDays ?? undefined,
    }
  })
}

export async function getAvailableBonusCampaigns(userId: number, tenant: string) {
  const now = new Date()
  const rows = await db
    .select()
    .from(bonusCampaigns)
    .where(
      and(
        eq(bonusCampaigns.tenant, tenant),
        eq(bonusCampaigns.status, 'active'),
        or(eq(bonusCampaigns.codeMode, 'auto'), eq(bonusCampaigns.codeMode, 'claim')),
        // Check date validity (use startDate/endDate if available, otherwise validFrom/validTo)
        or(
          isNull(bonusCampaigns.startDate),
          lte(bonusCampaigns.startDate, now)
        ),
        or(
          isNull(bonusCampaigns.endDate),
          gte(bonusCampaigns.endDate, now)
        ),
        or(
          isNull(bonusCampaigns.validFrom),
          lte(bonusCampaigns.validFrom, now)
        ),
        or(
          isNull(bonusCampaigns.validTo),
          gte(bonusCampaigns.validTo, now)
        )
      )
    )
    .orderBy(desc(bonusCampaigns.createdAt))

  // User's registration date for sign-up bonus eligibility
  const userRow = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    .limit(1)
    .then((rows) => rows[0])

  const userCreatedAt = userRow?.createdAt ? new Date(userRow.createdAt) : null

  // Filter by user eligibility and usage limits
  const availableCampaigns = []
  for (const row of rows) {
    // Sign-up bonus: only show to users who registered on or after campaign activation
    if (row.type === 'signup' && row.activatedAt != null && userCreatedAt != null) {
      if (userCreatedAt < new Date(row.activatedAt)) {
        continue // User registered before campaign was activated
      }
    }

    // Check if user has already claimed (claim mode: signup only — one-time; deposit uses usagePerPlayer below)
    if (row.codeMode === 'claim' && row.type === 'signup') {
      const existingAward = await db
        .select()
        .from(bonusAwards)
        .where(
          and(
            eq(bonusAwards.campaignId, row.id),
            eq(bonusAwards.userId, userId)
          )
        )
        .limit(1)
        .then((rows) => rows[0])

      if (existingAward) {
        continue // Skip if already claimed (signup one-time)
      }
    }

    // Check usage per player limit
    const usagePerPlayer = row.usagePerPlayer
    if (usagePerPlayer) {
      const userAwards = await db
        .select()
        .from(bonusAwards)
        .where(
          and(
            eq(bonusAwards.campaignId, row.id),
            eq(bonusAwards.userId, userId)
          )
        )
      if (userAwards.length >= usagePerPlayer) {
        continue // Skip if user has reached usage limit
      }
    }

    // Check number of players limit
    const numberOfPlayers = row.numberOfPlayers
    if (numberOfPlayers) {
      const totalAwards = await db
        .select()
        .from(bonusAwards)
        .where(eq(bonusAwards.campaignId, row.id))
      if (totalAwards.length >= numberOfPlayers) {
        continue // Skip if campaign has reached player limit
      }
    }

    availableCampaigns.push({
      id: String(row.id),
      name: row.name,
      domain: row.domain,
      type: row.type,
      currency: row.currency,
      codeMode: row.codeMode,
      validFrom: row.validFrom?.toISOString() ?? row.startDate?.toISOString() ?? null,
      validTo: row.validTo?.toISOString() ?? row.endDate?.toISOString() ?? null,
      amountType: row.amountType,
      amount: row.amount ? Number(row.amount) : null,
      percentage: row.percentage ? Number(row.percentage) : null,
      distributionType: row.distributionType,
      wagering: row.wagering ? Number(row.wagering) : null,
      depositConditionType: row.depositConditionType,
      depositConditionAmount: row.depositConditionAmount ? Number(row.depositConditionAmount) : null,
      rulesJson: row.rulesJson,
      limitsJson: row.limitsJson,
    })
  }

  return availableCampaigns
}

export async function getSportsList(tenant: string) {
  // Get whitelabel sports config for market type visibility filtering
  const appConfig = await db.query.appConfigs.findFirst({
    where: eq(appConfigs.whitelabelId, tenant),
  })
  
  const sportsConfig = appConfig?.sportsGlobalConfig as any
  const timeZone = await getWhitelabelTimezone(tenant)

  // Global data - no tenant filtering. All whitelabels see the same sports.
  const sports = await db
    .select({
      id: sportsTable.id,
      name: sportsTable.name,
      key: sportsTable.key,
      status: sportsTable.status,
    })
    .from(sportsTable)
    .where(eq(sportsTable.status, 'active'))
    .orderBy(sportsTable.sort)

  if (sports.length === 0) return []

  const sportIds = sports.map((s) => s.id)

  // Global data - no tenant filtering
  const leagues = await db
    .select({
      id: sportsLeaguesTable.id,
      sportId: sportsLeaguesTable.sportId,
      name: sportsLeaguesTable.name,
      key: sportsLeaguesTable.key,
      status: sportsLeaguesTable.status,
    })
    .from(sportsLeaguesTable)
    .where(and(
      inArray(sportsLeaguesTable.sportId, sportIds),
      eq(sportsLeaguesTable.status, 'active')
    ))
    .orderBy(sportsLeaguesTable.sort)

  const leagueIds = leagues.map((l) => l.id)

  // Global data - no tenant filtering
  const events =
    leagueIds.length === 0
      ? []
      : await db
          .select({
            id: sportsEventsTable.id,
            leagueId: sportsEventsTable.leagueId,
            eventCode: sportsEventsTable.eventCode,
            name: sportsEventsTable.name,
            key: sportsEventsTable.key,
            startTime: sportsEventsTable.startTime,
            status: sportsEventsTable.status,
          })
          .from(sportsEventsTable)
          .where(
            and(
              inArray(sportsEventsTable.leagueId, leagueIds),
              eq(sportsEventsTable.status, 'active')
            )
          )
          .orderBy(sportsEventsTable.startTime)

  const eventIds = events.map((e) => e.id)

  // Get market type visibility settings from config
  const showFancy = sportsConfig?.showFancy !== false // Default to true if not set
  const showBookmaker = sportsConfig?.showBookmaker !== false // Default to true if not set
  const showExchange = sportsConfig?.showExchange !== false // Default to true if not set
  
  // Global data - no tenant filtering
  const markets =
    eventIds.length === 0
      ? []
      : await db
          .select({
            id: sportsMarketsTable.id,
            eventId: sportsMarketsTable.eventId,
            marketCode: sportsMarketsTable.marketCode,
            name: sportsMarketsTable.name,
            type: sportsMarketsTable.type,
            status: sportsMarketsTable.status,
          })
          .from(sportsMarketsTable)
          .where(
            and(
              inArray(sportsMarketsTable.eventId, eventIds),
              eq(sportsMarketsTable.status, 'active')
            )
          )

  // Filter markets based on visibility settings
  const filteredMarkets = markets.filter(m => {
    const marketType = m.type?.toLowerCase() || ''
    // Match-odds are exchange markets
    if (marketType === 'match-odds' || marketType === 'exchange') {
      return showExchange
    }
    // Bookmaker markets
    if (marketType === 'bookmaker') {
      return showBookmaker
    }
    // Fancy markets
    if (marketType === 'fancy') {
      return showFancy
    }
    // Default: show all other market types
    return true
  })

  const marketsByEvent = new Map<string, Array<{ marketId: string; marketName: string; type: string | null; marketStatus: string | null; inplay: boolean }>>()
  for (const m of filteredMarkets) {
    const list = marketsByEvent.get(m.eventId) ?? []
    list.push({
      marketId: m.marketCode || m.id,
      marketName: m.name,
      type: m.type,
      marketStatus: m.status,
      inplay: false,
    })
    marketsByEvent.set(m.eventId, list)
  }

  const eventsByLeague = new Map<string, Array<{ id: string; eventCode: string | null; name: string; slugName: string; date: string; dateDisplay: string; markets: any[] }>>()
  for (const ev of events) {
    const list = eventsByLeague.get(ev.leagueId) ?? []
    const date = ev.startTime ? ev.startTime.toISOString() : new Date().toISOString()
    const dateDisplay = ev.startTime ? formatInTimeZone(ev.startTime, timeZone) : ''
    list.push({
      id: ev.id,
      eventCode: ev.eventCode,
      name: ev.name,
      slugName: ev.key,
      date,
      dateDisplay,
      markets: marketsByEvent.get(ev.id) ?? [],
    })
    eventsByLeague.set(ev.leagueId, list)
  }

  const leaguesBySport = new Map<string, Array<{ id: string; name: string; slugName: string; events: any[] }>>()
  for (const lg of leagues) {
    const list = leaguesBySport.get(lg.sportId) ?? []
    list.push({
      id: lg.id,
      name: lg.name,
      slugName: lg.key,
      events: eventsByLeague.get(lg.id) ?? [],
    })
    leaguesBySport.set(lg.sportId, list)
  }

  return sports.map((row) => ({
    id: row.id,
    name: row.name,
    slugName: row.key,
    total: sports.length,
    leagues: leaguesBySport.get(row.id) ?? [],
  }))
}

export async function getSportsEventDetail(eventId: string, tenant: string) {
  const identifier = sportsEventIdentifier(eventId)
  if (!identifier) return null
  // Get whitelabel sports config for market type visibility filtering
  const appConfig = await db.query.appConfigs.findFirst({
    where: eq(appConfigs.whitelabelId, tenant),
  })
  
  const sportsConfig = appConfig?.sportsGlobalConfig as any
  const showFancy = sportsConfig?.showFancy !== false // Default to true if not set
  const showBookmaker = sportsConfig?.showBookmaker !== false // Default to true if not set
  const showExchange = sportsConfig?.showExchange !== false // Default to true if not set
  
  // Global data - no tenant filtering
  const eventRow = await db
    .select({
      id: sportsEventsTable.id,
      leagueId: sportsEventsTable.leagueId,
      name: sportsEventsTable.name,
      key: sportsEventsTable.key,
      startTime: sportsEventsTable.startTime,
      status: sportsEventsTable.status,
      eventCode: sportsEventsTable.eventCode,
      sportId: sportsLeaguesTable.sportId,
      leagueName: sportsLeaguesTable.name,
      sportName: sportsTable.name,
    })
    .from(sportsEventsTable)
    .leftJoin(sportsLeaguesTable, eq(sportsLeaguesTable.id, sportsEventsTable.leagueId))
    .leftJoin(sportsTable, eq(sportsTable.id, sportsLeaguesTable.sportId))
    .where(identifier.kind === 'uuid' ? eq(sportsEventsTable.id, identifier.value) : and(
      eq(sportsEventsTable.status, 'active'), eq(sportsLeaguesTable.status, 'active'), eq(sportsTable.status, 'active'),
      or(eq(sportsEventsTable.eventCode, identifier.value), eq(sportsEventsTable.key, identifier.value),
        sql`regexp_replace(regexp_replace(lower(${sportsEventsTable.name}), '[[:space:]]+', '-', 'g'), '[^a-z0-9-]', '', 'g') = ${identifier.value.toLowerCase()}`)
    ))
    .orderBy(desc(sportsEventsTable.startTime), desc(sportsEventsTable.id))
    .limit(1)
    .then((rows) => rows[0])

  if (!eventRow) return null

  const timeZone = await getWhitelabelTimezone(tenant)
  const dateDisplay = eventRow.startTime ? formatInTimeZone(eventRow.startTime, timeZone) : ''

  // Global data - no tenant filtering
  const markets = await db
    .select({
      id: sportsMarketsTable.id,
      eventId: sportsMarketsTable.eventId,
      marketCode: sportsMarketsTable.marketCode,
      name: sportsMarketsTable.name,
      type: sportsMarketsTable.type,
      status: sportsMarketsTable.status,
    })
    .from(sportsMarketsTable)
    .where(
      and(
        eq(sportsMarketsTable.eventId, eventRow.id),
        eq(sportsMarketsTable.status, 'active')
      )
    )

  // Filter markets based on visibility settings
  const filteredMarkets = markets.filter(m => {
    const marketType = m.type?.toLowerCase() || ''
    // Match-odds are exchange markets
    if (marketType === 'match-odds' || marketType === 'exchange') {
      return showExchange
    }
    // Bookmaker markets
    if (marketType === 'bookmaker') {
      return showBookmaker
    }
    // Fancy markets
    if (marketType === 'fancy') {
      return showFancy
    }
    // Default: show all other market types
    return true
  })

  const marketIds = filteredMarkets.map((m) => m.id)
  // Global data - no tenant filtering
  const runners =
    marketIds.length === 0
      ? []
      : await db
          .select({
            id: sportsRunnersTable.id,
            marketId: sportsRunnersTable.marketId,
            selectionCode: sportsRunnersTable.selectionCode,
            name: sportsRunnersTable.name,
            sort: sportsRunnersTable.sort,
            status: sportsRunnersTable.status,
          })
          .from(sportsRunnersTable)
          .where(
            and(
              inArray(sportsRunnersTable.marketId, marketIds),
              eq(sportsRunnersTable.status, 'active')
            )
          )

  const runnersByMarket = new Map<string, typeof runners>()
  for (const r of runners) {
    const list = runnersByMarket.get(r.marketId) ?? []
    list.push(r)
    runnersByMarket.set(r.marketId, list)
  }

  const leagueEvents = await db.select({ id: sportsEventsTable.id, name: sportsEventsTable.name })
    .from(sportsEventsTable)
    .innerJoin(sportsLeaguesTable, eq(sportsLeaguesTable.id, sportsEventsTable.leagueId))
    .innerJoin(sportsTable, eq(sportsTable.id, sportsLeaguesTable.sportId))
    .where(and(eq(sportsEventsTable.leagueId, eventRow.leagueId), eq(sportsEventsTable.status, 'active'), eq(sportsLeaguesTable.status, 'active'), eq(sportsTable.status, 'active')))
    .orderBy(asc(sportsEventsTable.startTime), asc(sportsEventsTable.id))

  return {
    leagueEvents,
    event: {
      id: eventRow.id,
      name: eventRow.name,
      slugName: eventRow.key,
      date: eventRow.startTime ? eventRow.startTime.toISOString() : new Date().toISOString(),
      dateDisplay,
      leagueId: eventRow.leagueId,
      leagueName: eventRow.leagueName,
      sportId: eventRow.sportId,
      sportName: eventRow.sportName,
      eventCode: eventRow.eventCode,
    },
    markets: filteredMarkets.map((m) => ({
      marketId: m.marketCode || m.id,
      marketCode: m.marketCode || m.id,
      name: m.name,
      type: m.type,
      marketStatus: m.status,
      inplay: false,
      runners:
        runnersByMarket
          .get(m.id)
          ?.map((r) => ({
            selectionId: r.selectionCode || r.id,
            name: r.name,
            sort: r.sort,
            status: r.status,
          })) ?? [],
    })),
  }
}

export async function logLedgerEvent(
  params: { walletId: number; tenant: string; amount: number; type: string; meta?: Record<string, any>; balanceBefore?: number | string | null; balanceAfter?: number | string | null },
  executor: any = db
) {
  // Ensure amount is a valid finite number (never null/NaN/undefined)
  const validAmount = Number.isFinite(params.amount) ? params.amount : 0
  
  if (!Number.isFinite(params.amount)) {
  }
  
  const result = await executor.insert(ledgerEntries).values({
    walletId: params.walletId,
    tenant: params.tenant,
    amount: String(validAmount), // Convert to string for numeric field
    type: params.type,
    meta: params.meta ?? {},
    balanceBefore: params.balanceBefore != null ? String(params.balanceBefore) : null,
    balanceAfter: params.balanceAfter != null ? String(params.balanceAfter) : null,
  }).returning({ id: ledgerEntries.id })
  
  return result[0]?.id || null
}

export async function getReferralUsers(userId: number, tenant: string) {
  const rows = await db
    .select({
      refId: referralAttributions.id,
      refereeId: referralAttributions.refereeId,
      createdAt: referralAttributions.attributedAt,
      status: referralAttributions.status,
      reason: referralAttributions.reason,
      tier: referralAttributions.tier,
      clickId: referralAttributions.clickId,
      code: referralLinks.code,
      linkId: referralLinks.id,
      clickAt: referralClicks.clickedAt,
      utmSource: referralClicks.utmSource,
      utmCampaign: referralClicks.utmCampaign,
      utmMedium: referralClicks.utmMedium,
      userName: users.name,
      userUsername: users.username,
      userPhone: users.phone,
    })
    .from(referralAttributions)
    .leftJoin(referralLinks, and(eq(referralLinks.userId, referralAttributions.referrerId), eq(referralLinks.tenant, referralAttributions.tenant)))
    .leftJoin(referralClicks, eq(referralClicks.id, referralAttributions.clickId))
    .leftJoin(users, and(eq(users.id, referralAttributions.refereeId), eq(users.tenant, referralAttributions.tenant)))
    .where(and(eq(referralAttributions.referrerId, userId), eq(referralAttributions.tenant, tenant)))
    .orderBy(desc(referralAttributions.attributedAt))

  return rows.map((r) => ({
    id: String(r.refereeId),
    name: r.userName || r.userUsername || null,
    mobileNo: r.userPhone || null,
    createdAt: r.createdAt?.toISOString?.() ?? new Date().toISOString(),
    totalPl: 0,
    pl: 0,
    percentage: null,
    status: r.status,
    reason: r.reason,
    tier: r.tier,
    referralCode: r.code || null,
    firstClickAt: r.clickAt?.toISOString?.() ?? null,
    utmSource: r.utmSource || null,
    utmCampaign: r.utmCampaign || null,
    utmMedium: r.utmMedium || null,
  }))
}

/** Generate 8-char alphanumeric referral code (no ambiguous chars). */
function generateReferralCode(length: number = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

/** Get referral link for a user (user-as-referrer); returns null if none. */
export async function getReferralLinkByUserId(userId: number, tenant: string) {
  const rows = await db
    .select()
    .from(referralLinks)
    .where(and(eq(referralLinks.userId, userId), eq(referralLinks.tenant, tenant)))
    .limit(1)
  return rows[0] ?? null
}

/** Get or create the current user's referral link; returns { code, url }. */
export async function getOrCreateMyReferralLink(
  userId: number,
  tenant: string,
  baseUrl?: string
): Promise<{ code: string; url: string }> {
  let link = await getReferralLinkByUserId(userId, tenant)
  if (link) {
    const path = `/r?ref=${link.code}`
    const url = baseUrl ? (baseUrl.replace(/\/$/, '') + path) : path
    return { code: link.code, url }
  }
  let attempts = 0
  const maxAttempts = 20
  while (attempts < maxAttempts) {
    const code = generateReferralCode(8)
    try {
      const inserted = await db
        .insert(referralLinks)
        .values({
          tenant,
          userId,
          code,
          isActive: true,
        })
        .returning()
      const row = inserted[0]
      if (row) {
        const path = `/r?ref=${row.code}`
        const url = baseUrl ? (baseUrl.replace(/\/$/, '') + path) : path
        return { code: row.code, url }
      }
    } catch (err: any) {
      if (err?.code === '23505' || err?.message?.includes('unique')) {
        attempts++
        continue
      }
      throw err
    }
    attempts++
  }
  throw new Error('Failed to generate unique referral code after multiple attempts')
}

/**
 * Create a referral attribution (user referrer → referee). Used when referee signs up with user's code.
 * One attribution per referee (schema unique on refereeId); on conflict skip.
 */
export async function createReferralAttribution(
  tenant: string,
  referrerId: number,
  refereeId: number,
  tier: number = 1,
  clickId?: number | null
): Promise<{ id: number } | null> {
  try {
    const inserted = await db
      .insert(referralAttributions)
      .values({
        tenant,
        referrerId,
        refereeId,
        tier,
        clickId: clickId ?? null,
        status: 'confirmed',
      })
      .returning({ id: referralAttributions.id })
    return inserted[0] ?? null
  } catch (err: any) {
    if (err?.code === '23505' || err?.message?.includes('unique')) {
      return null
    }
    throw err
  }
}

/**
 * Sum of referral earnings for the user (as referrer) that have not yet been settled.
 * Re-exported from referralRepo for backward compatibility.
 */
export { getUnsettledReferralBalance } from './referralRepo.js'

export async function getReferralTransactions(userId: number, tenant: string) {
  const rows = await db
    .select({
      id: referralEarnings.id,
      refereeId: referralEarnings.refereeId,
      ruleType: referralEarnings.ruleType,
      tier: referralEarnings.tier,
      netAmount: referralEarnings.netAmount,
      calculatedAt: referralEarnings.calculatedAt,
      currency: referralEarnings.currency,
      userName: users.name,
      userUsername: users.username,
      userPhone: users.phone,
    })
    .from(referralEarnings)
    .leftJoin(users, and(eq(users.id, referralEarnings.refereeId), eq(users.tenant, referralEarnings.tenant)))
    .where(and(eq(referralEarnings.referrerId, userId), eq(referralEarnings.tenant, tenant)))
    .orderBy(desc(referralEarnings.calculatedAt))
    .limit(100)
  return rows.map((r) => ({
    id: String(r.id),
    userName: r.userName || r.userUsername || String(r.refereeId),
    mobileNo: r.userPhone || '',
    pl: Number(r.netAmount ?? 0),
    bonusAmount: Number(r.netAmount ?? 0),
    weekStartDate: r.calculatedAt?.toISOString?.() ?? new Date().toISOString(),
    weekEndDate: r.calculatedAt?.toISOString?.() ?? new Date().toISOString(),
    createdAt: r.calculatedAt?.toISOString?.() ?? new Date().toISOString(),
    ruleType: r.ruleType,
    tier: r.tier,
    currency: r.currency,
  }))
}

export async function getWeeklyReferralSummary(userId: number, tenant: string) {
  const rows = await db
    .select({
      id: referralEarnings.id,
      amount: referralEarnings.netAmount,
      createdAt: referralEarnings.calculatedAt,
      ruleType: referralEarnings.ruleType,
      tier: referralEarnings.tier,
      currency: referralEarnings.currency,
    })
    .from(referralEarnings)
    .where(and(eq(referralEarnings.referrerId, userId), eq(referralEarnings.tenant, tenant)))
    .orderBy(desc(referralEarnings.calculatedAt))
    .limit(50)

  return rows.map((r) => ({
    pl: Number(r.amount ?? 0),
    bonusAmount: Number(r.amount ?? 0),
    weekStartDate: r.createdAt?.toISOString?.() ?? new Date().toISOString(),
    weekEndDate: r.createdAt?.toISOString?.() ?? new Date().toISOString(),
    createdAt: r.createdAt?.toISOString?.() ?? new Date().toISOString(),
    ruleType: r.ruleType,
    tier: r.tier,
    currency: r.currency,
  }))
}

/** Bonus cards admin list: last status change (player self-service from app). */
async function stampBonusAwardPlayerStatusMetaDb(awardId: number, userId: number, tenant: string) {
  const user = await findUserById(userId, tenant)
  const displayName =
    (user?.name && String(user.name).trim()) ||
    (user?.username && String(user.username).trim()) ||
    `Player #${userId}`
  const phone = user?.phone && String(user.phone).trim() ? String(user.phone).trim() : null
  const profileRemark =
    user && (user as { remark?: string | null }).remark != null
      ? String((user as { remark?: string | null }).remark).trim()
      : ''
  const remark = profileRemark ? `Player app · ${profileRemark}` : 'Player app'

  await db
    .update(bonusAwards)
    .set({
      adminStatusUpdatedAt: new Date(),
      adminStatusUpdatedByName: displayName,
      adminStatusUpdatedByPhone: phone,
      adminStatusUpdatedByRemark: remark,
    } as Record<string, unknown>)
    .where(and(eq(bonusAwards.id, awardId), eq(bonusAwards.userId, userId)))
}

export async function activateBonusAward(bonusId: number, userId: number, tenant: string) {
  const r = await activateBonusAwardCore({
    bonusId,
    userId,
    tenant,
    db,
    ensureWallet,
    getWhitelabelCurrency,
  })
  if (r.kind === 'not_found') return []
  try {
    await stampBonusAwardPlayerStatusMetaDb(bonusId, userId, tenant)
  } catch {
    // Until shared migration adds admin_status_* columns, ignore stamp errors
  }
  return getBonusAwards(userId, tenant)
}

export async function claimBonusAward(userId: number, tenant: string) {
  // Find the first completed bonus that can be claimed (wagering complete)
  const completedBonus = await db
    .select({
      id: bonusAwards.id,
      campaignId: bonusAwards.campaignId,
      amount: bonusAwards.amount,
      currency: bonusAwards.currency,
      wageringReq: bonusAwards.wageringReq,
      currentWagering: bonusAwards.currentWagering,
      status: bonusAwards.status,
      distributionTypeAward: bonusAwards.distributionType,
      distributionTypeCampaign: bonusCampaigns.distributionType,
    })
    .from(bonusAwards)
    .innerJoin(bonusCampaigns, and(
      eq(bonusCampaigns.id, bonusAwards.campaignId),
      eq(bonusCampaigns.tenant, tenant)
    ))
    .where(
      and(
        eq(bonusAwards.userId, userId),
        or(
          eq(bonusAwards.status, 'completed'),
          eq(bonusAwards.status, 'active')
        )
      )
    )
    .orderBy(desc(bonusAwards.awardedAt))
    .limit(1)
    .then((rows) => rows[0])

  if (!completedBonus) {
    return getBonusAwards(userId, tenant)
  }

  // Check if wagering is complete (for active bonuses)
  const wageringReq = Number(completedBonus.wageringReq ?? 0)
  const currentWagering = Number(completedBonus.currentWagering ?? 0)
  const isWageringComplete = currentWagering >= wageringReq || wageringReq === 0

  if (completedBonus.status === 'active' && !isWageringComplete) {
    return getBonusAwards(userId, tenant) // Wagering not complete yet
  }

  const claimDistributionType =
    completedBonus.distributionTypeAward ?? completedBonus.distributionTypeCampaign

  // If distribution is roll_over and wagering complete, release to cash (uses shared logic: Bonus Amount Only = card amount to cash + zero bonus; Total = full bonus wallet to cash)
  if (claimDistributionType === 'roll_over' && isWageringComplete) {
    const { releaseRollOverBonusToCash } = await import('@shared/services/bonusService.js')
    await db.transaction(async (tx) => {
      await releaseRollOverBonusToCash(userId, tenant, completedBonus.id, tx)
    })
  } else if (completedBonus.status === 'active' && isWageringComplete) {
    // Just mark as completed (already in bonus wallet for instant_otp)
    await db
      .update(bonusAwards)
      .set({
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(bonusAwards.id, completedBonus.id))
  }

  return getBonusAwards(userId, tenant)
}

export async function forfeitBonusAward(userId: number, tenant: string) {
  // Forfeit only the active bonus and set bonus wallet to 0
  const activeAward = await db
    .select({
      id: bonusAwards.id,
      amount: bonusAwards.amount,
      currency: bonusAwards.currency,
      campaignId: bonusAwards.campaignId,
    })
    .from(bonusAwards)
    .where(
      and(
        eq(bonusAwards.userId, userId),
        eq(bonusAwards.status, 'active')
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!activeAward) {
    return getBonusAwards(userId, tenant)
  }

  const wallet = await ensureWallet(userId, tenant)
  const currentBonusBalance = Number(wallet.bonus || 0)

  await db.transaction(async (tx) => {
    if (currentBonusBalance > 0) {
      await tx
        .update(wallets)
        .set({ bonus: '0' })
        .where(eq(wallets.id, wallet.id))

      await tx.insert(ledgerEntries).values({
        tenant,
        walletId: wallet.id,
        type: 'debit',
        amount: String(currentBonusBalance),
        balanceBefore: String(currentBonusBalance),
        balanceAfter: '0',
        meta: {
          type: 'bonus_forfeit',
          bonusAwardId: activeAward.id,
          campaignId: activeAward.campaignId,
          currency: activeAward.currency || 'INR',
        } as any,
      })
      await createWalletLedgerEntry(tx, {
        tenant,
        walletId: wallet.id,
        userId,
        walletType: 'bonus',
        category: 'bonus_forfeit',
        direction: 'debit',
        amount: currentBonusBalance,
        balanceBefore: currentBonusBalance,
        balanceAfter: 0,
        description: 'Bonus forfeit',
        referenceType: 'bonus_award',
        referenceId: String(activeAward.id),
        meta: { bonusAwardId: activeAward.id, campaignId: activeAward.campaignId },
      })
    }

    await tx
      .update(bonusAwards)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(eq(bonusAwards.id, activeAward.id))
  })

  return getBonusAwards(userId, tenant)
}

export async function switchBonusAward(newBonusId: number, userId: number, tenant: string) {
  await switchBonusAwardCore({
    newBonusId,
    userId,
    tenant,
    db,
    ensureWallet,
    getWhitelabelCurrency,
  })
  try {
    await stampBonusAwardPlayerStatusMetaDb(newBonusId, userId, tenant)
  } catch {
    // Until shared migration adds admin_status_* columns, ignore stamp errors
  }
  return getBonusAwards(userId, tenant)
}

export async function getReferralProgramForUser(tenant: string) {
  const row = await db
    .select({
      id: referralPrograms.id,
      name: referralPrograms.name,
      enabledModes: referralPrograms.enabledModes,
      maxDepth: referralPrograms.maxDepth,
      flags: referralPrograms.flags,
      minReferralBalanceForCashTransfer: referralPrograms.minReferralBalanceForCashTransfer,
    })
    .from(referralPrograms)
    .where(eq(referralPrograms.tenant, tenant))
    .limit(1)
    .then((rows) => rows[0])

  if (!row) return null

  return {
    id: String(row.id),
    name: row.name,
    enabledRewardTypes: Array.isArray(row.enabledModes) ? row.enabledModes : [],
    maxTierDepth: row.maxDepth ?? 4,
    attributionModel: (row.flags as any)?.attributionModel || 'last_click',
    status: (row.flags as any)?.status || 'active',
    minReferralBalanceForCashTransfer: row.minReferralBalanceForCashTransfer != null ? Number(row.minReferralBalanceForCashTransfer) : undefined,
  }
}

export async function getActiveReferralRules(tenant: string) {
  const rows = await db
    .select({
      id: referralRules.id,
      ruleType: referralRules.ruleType,
      tierRates: referralRules.tierRates,
      fixedAmounts: referralRules.fixedAmounts,
      payoutType: referralRules.payoutType,
      splitRatio: referralRules.splitRatio,
      isActive: referralRules.isActive,
      thresholds: referralRules.thresholds,
      caps: referralRules.caps,
      reloadDepositsCount: referralRules.reloadDepositsCount,
    })
    .from(referralRules)
    .where(
      and(
        eq(referralRules.tenant, tenant),
        eq(referralRules.isActive, true)
      )
    )
    .orderBy(asc(referralRules.ruleType))

  return rows.map((row) => ({
    id: String(row.id),
    ruleType: row.ruleType,
    description: null, // Description not in schema, can be added later if needed
    tierRates: row.tierRates ?? {},
    fixedAmount: row.fixedAmounts && typeof row.fixedAmounts === 'object' && 'default' in row.fixedAmounts 
      ? Number((row.fixedAmounts as any).default || 0) 
      : (row.fixedAmounts && typeof row.fixedAmounts === 'number' ? row.fixedAmounts : null),
    cap: row.caps && typeof row.caps === 'object' && 'default' in row.caps
      ? Number((row.caps as any).default || 0)
      : (row.caps && typeof row.caps === 'number' ? row.caps : null),
    threshold: row.thresholds && typeof row.thresholds === 'object' && 'default' in row.thresholds
      ? Number((row.thresholds as any).default || 0)
      : (row.thresholds && typeof row.thresholds === 'number' ? row.thresholds : null),
    status: row.isActive ? 'active' : 'inactive',
  }))
}

export async function getReferralAggregate(userId: number, tenant: string) {
  const rows = await db
    .select({
      ruleType: referralEarnings.ruleType,
      tier: referralEarnings.tier,
      currency: referralEarnings.currency,
      totalAmount: sql<number>`sum(${referralEarnings.netAmount})`,
      count: sql<number>`count(*)`,
    })
    .from(referralEarnings)
    .where(and(eq(referralEarnings.referrerId, userId), eq(referralEarnings.tenant, tenant)))
    .groupBy(referralEarnings.ruleType, referralEarnings.tier, referralEarnings.currency)
    .orderBy(desc(referralEarnings.ruleType), desc(referralEarnings.tier))

  return rows.map((r) => ({
    ruleType: r.ruleType,
    tier: r.tier,
    currency: r.currency,
    totalPl: Number(r.totalAmount ?? 0),
    totalBonus: Number(r.totalAmount ?? 0),
    count: Number(r.count ?? 0),
  }))
}

export async function getUserStakeLimits(userId: number, tenant: string) {
  // Use calendar day and week (Sunday start) in tenant timezone to match sports bet placement enforcement
  const { getWhitelabelTimezone } = await import('../shared/whitelabelConfig.js')
  const { getStartOfDay, getStartOfWeek } = await import('../shared/dateUtils.js')
  const tz = await getWhitelabelTimezone(tenant)
  const todayStart = getStartOfDay(tz)
  const weekStart = getStartOfWeek(tz)

  // Daily total: sports + casino stake from start of today
  const [sportsDailyBets] = await db
    .select({ total: sql<number>`COALESCE(SUM(${sportsBets.stake})::numeric, 0)`.as('total') })
    .from(sportsBets)
    .where(and(eq(sportsBets.userId, userId), eq(sportsBets.tenant, tenant), gte(sportsBets.createdAt, todayStart)))

  const [casinoDailyBets] = await db
    .select({ total: sql<number>`COALESCE(SUM(${casinoBets.stake})::numeric, 0)`.as('total') })
    .from(casinoBets)
    .where(and(eq(casinoBets.userId, userId), eq(casinoBets.tenant, tenant), gte(casinoBets.createdAt, todayStart)))

  const dailyTotal = Number(sportsDailyBets?.total || 0) + Number(casinoDailyBets?.total || 0)

  // Weekly total: sports + casino stake from start of week (Sunday)
  const [sportsWeeklyBets] = await db
    .select({ total: sql<number>`COALESCE(SUM(${sportsBets.stake})::numeric, 0)`.as('total') })
    .from(sportsBets)
    .where(and(eq(sportsBets.userId, userId), eq(sportsBets.tenant, tenant), gte(sportsBets.createdAt, weekStart)))

  const [casinoWeeklyBets] = await db
    .select({ total: sql<number>`COALESCE(SUM(${casinoBets.stake})::numeric, 0)`.as('total') })
    .from(casinoBets)
    .where(and(eq(casinoBets.userId, userId), eq(casinoBets.tenant, tenant), gte(casinoBets.createdAt, weekStart)))

  const weeklyTotal = Number(sportsWeeklyBets?.total || 0) + Number(casinoWeeklyBets?.total || 0)

  // Prefer player-specific limits when set; otherwise use app config
  const [plRow] = await db
    .select({
      dailyStakeLimit: playerLimits.dailyStakeLimit,
      weeklyStakeLimit: playerLimits.weeklyStakeLimit,
    })
    .from(playerLimits)
    .where(and(eq(playerLimits.userId, userId), eq(playerLimits.tenant, tenant)))
    .limit(1)

  const cfg = await db.query.appConfigs.findFirst({
    where: eq(appConfigs.whitelabelId, tenant),
  })

  const dailyLimit =
    plRow?.dailyStakeLimit != null
      ? Number(plRow.dailyStakeLimit)
      : cfg?.dailyStakeLimit != null
        ? Number(cfg.dailyStakeLimit)
        : null
  const weeklyLimit =
    plRow?.weeklyStakeLimit != null
      ? Number(plRow.weeklyStakeLimit)
      : cfg?.weeklyStakeLimit != null
        ? Number(cfg.weeklyStakeLimit)
        : null

  const dailyRemaining = dailyLimit != null ? Math.max(0, dailyLimit - dailyTotal) : null
  const weeklyRemaining = weeklyLimit != null ? Math.max(0, weeklyLimit - weeklyTotal) : null

  return {
    dailyTotal,
    weeklyTotal,
    dailyLimit,
    weeklyLimit,
    dailyRemaining,
    weeklyRemaining,
  }
}

/** Returns all player-specific limits for enforcement across products. */
export async function getPlayerLimitsForUser(userId: number, tenant: string): Promise<{
  dailyStakeLimit: number | null
  weeklyStakeLimit: number | null
  exposureCapOverride: number | null
  cooldownSeconds: number | null
  maxBetCasino: number | null
  maxBetSports: number | null
  maxBetMatka: number | null
} | null> {
  const [row] = await db
    .select()
    .from(playerLimits)
    .where(and(eq(playerLimits.userId, userId), eq(playerLimits.tenant, tenant)))
    .limit(1)
  if (!row) return null
  return {
    dailyStakeLimit: row.dailyStakeLimit != null ? Number(row.dailyStakeLimit) : null,
    weeklyStakeLimit: row.weeklyStakeLimit != null ? Number(row.weeklyStakeLimit) : null,
    exposureCapOverride: row.exposureCapOverride != null ? Number(row.exposureCapOverride) : null,
    cooldownSeconds: row.cooldownSeconds != null ? Number(row.cooldownSeconds) : null,
    maxBetCasino: row.maxBetCasino != null ? Number(row.maxBetCasino) : null,
    maxBetSports: row.maxBetSports != null ? Number(row.maxBetSports) : null,
    maxBetMatka: row.maxBetMatka != null ? Number(row.maxBetMatka) : null,
  }
}

export async function getUserBets(
  userId: number,
  tenant: string,
  eventId?: string | null,
  marketIds?: string[] | null,
  openOnly = false
) {
  const conditions = [
    eq(sportsBets.userId, userId),
    eq(sportsBets.tenant, tenant),
  ]

  if (openOnly) conditions.push(sql`${sportsBets.status}::text IN ('matched', 'unmatched', 'pending', 'open')`)

  // Handle eventId - could be UUID or eventCode
  if (eventId) {
    // Check if eventId is a UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)
    if (isUuid) {
      conditions.push(eq(sportsBets.eventId, eventId))
    } else {
      // If not UUID, treat as eventCode and join with events table
      const event = await db
        .select({ id: sportsEventsTable.id })
        .from(sportsEventsTable)
        .where(
          and(
            eq(sportsEventsTable.eventCode, eventId)
          )
        )
        .limit(1)
        .then((rows) => rows[0])
      
      if (event) {
        conditions.push(eq(sportsBets.eventId, event.id))
      } else {
        // If event not found, return empty array
        return []
      }
    }
  }

  // Handle marketIds - could be UUIDs or marketCodes
  if (marketIds && marketIds.length > 0) {
    const marketUuids: string[] = []
    const marketCodes: string[] = []
    
    for (const marketId of marketIds) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(marketId)
      if (isUuid) {
        marketUuids.push(marketId)
      } else {
        marketCodes.push(marketId)
      }
    }

    const allMarketUuids: string[] = [...marketUuids]
    
    if (marketCodes.length > 0) {
      // Join with markets table to find UUIDs for market codes
      const markets = await db
        .select({ id: sportsMarketsTable.id })
        .from(sportsMarketsTable)
        .where(
          and(
            inArray(sportsMarketsTable.marketCode, marketCodes)
          )
        )
      
      allMarketUuids.push(...markets.map((m) => m.id))
    }

    if (allMarketUuids.length > 0) {
      conditions.push(inArray(sportsBets.marketId, allMarketUuids))
    } else {
      // If no valid markets found, return empty array
      return []
    }
  }

  const bets = await db
    .select({
      id: sportsBets.id,
      eventId: sportsBets.eventId,
      eventName: sportsEventsTable.name,
      marketId: sportsBets.marketId,
      selectionId: sportsBets.selectionId,
      side: sportsBets.side,
      price: sportsBets.price,
      stake: sportsBets.stake,
      status: sportsBets.status,
      result: sportsBets.result,
      storedPl: sportsBets.pl,
      createdAt: sportsBets.createdAt,
      liability: sportsBets.liability,
      currency: sportsBets.currency,
      oddsSize: sportsBets.oddsSize, // Include oddsSize for fancy bets
    })
    .from(sportsBets)
    .leftJoin(sportsEventsTable, eq(sportsBets.eventId, sportsEventsTable.id))
    .where(and(...conditions))
    .orderBy(desc(sportsBets.createdAt))

  // Join with markets and runners to get additional info
  const betMarketIds = Array.from(new Set(bets.map((b) => b.marketId)))
  const markets = betMarketIds.length > 0
    ? await db
        .select({
          id: sportsMarketsTable.id,
          name: sportsMarketsTable.name,
          marketCode: sportsMarketsTable.marketCode,
          type: sportsMarketsTable.type,
        })
        .from(sportsMarketsTable)
        .where(
          and(
            inArray(sportsMarketsTable.id, betMarketIds)
          )
        )
    : []

  const runnerIds = Array.from(new Set(bets.map((b) => b.selectionId)))
  const runners = runnerIds.length > 0
    ? await db
        .select({
          id: sportsRunnersTable.id,
          selectionCode: sportsRunnersTable.selectionCode,
          name: sportsRunnersTable.name,
        })
        .from(sportsRunnersTable)
        .where(
          and(
            inArray(sportsRunnersTable.selectionCode, runnerIds)
          )
        )
    : []

  const marketMap = new Map(markets.map((m) => [m.id, m]))
  const runnerMap = new Map(runners.map((r) => [r.selectionCode, r]))

  return bets.map((bet) => {
    const market = marketMap.get(bet.marketId)
    const runner = runnerMap.get(bet.selectionId)
    
    const pl = settledSportsBetProfit({ ...bet, pl: bet.storedPl, marketType: market?.type })

    const stake = Number(bet.stake)
    const odds = Number(bet.price)
    const isFancy = (market?.type || '').toLowerCase() === 'fancy'
    const oddsSize = bet.oddsSize ? Number(bet.oddsSize) : 100

    // Liability: how much you risk
    const liability = bet.liability != null
      ? Number(bet.liability)
      : bet.side === 'back'
        ? stake
        : isFancy
          ? stake * (oddsSize / 100)
          : stake * (odds - 1)

    // Payout: potential winnings if bet wins
    const payout = bet.side === 'back'
      ? isFancy
        ? stake * (oddsSize / 100)
        : stake * (odds - 1)
      : stake

    return {
      id: bet.id,
      eventId: bet.eventId,
      eventName: bet.eventName || null,
      marketId: bet.marketId,
      marketName: market?.name || null,
      marketType: market?.type || null,
      market: market?.name || null,
      selectionId: bet.selectionId,
      selection: runner?.name || bet.selectionId,
      side: bet.side,
      type: bet.side, // For backward compatibility
      odds: Number(bet.price),
      stake: Number(bet.stake),
      status: bet.status,
      createdAt: bet.createdAt?.toISOString() || new Date().toISOString(),
      pl: pl,
      liability,
      payout,
      currency: bet.currency,
      oddsSize: bet.oddsSize ? Number(bet.oddsSize) : null, // Include oddsSize for fancy bets
    }
  })
}

export async function redeemBonusCode(code: string, userId: number, tenant: string) {
  // Check if user is eligible for bonuses
  const userRow = await db
    .select({ bonusAllowed: users.bonusAllowed })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    .limit(1)
    .then((rows) => rows[0])
  if (!userRow) throw new Error('User not found')
  if (!userRow.bonusAllowed) throw new Error('Bonuses are not available for your account')

  // Get bonus code scoped to this tenant (code must belong to a campaign of this tenant)
  const bonusCodeRow = await db
    .select({
      id: bonusCodes.id,
      campaignId: bonusCodes.campaignId,
      code: bonusCodes.code,
      status: bonusCodes.status,
      maxUses: bonusCodes.maxUses,
      usedCount: bonusCodes.usedCount,
      perUserLimit: bonusCodes.perUserLimit,
      expiresAt: bonusCodes.expiresAt,
      createdAt: bonusCodes.createdAt,
    })
    .from(bonusCodes)
    .innerJoin(bonusCampaigns, and(
      eq(bonusCampaigns.id, bonusCodes.campaignId),
      eq(bonusCampaigns.tenant, tenant)
    ))
    .where(eq(bonusCodes.code, code))
    .limit(1)
    .then((rows) => rows[0])

  const bonusCode = bonusCodeRow ?? null
  if (!bonusCode) {
    throw new Error('Invalid bonus code')
  }

  if (bonusCode.status !== 'active') {
    throw new Error('Bonus code is not active')
  }

  const expiresAt = bonusCode.expiresAt ? new Date(bonusCode.expiresAt) : null
  if (expiresAt && expiresAt < new Date()) {
    throw new Error('Bonus code has expired')
  }

  const maxUses = bonusCode.maxUses != null ? Number(bonusCode.maxUses) : null
  const usedCount = Number(bonusCode.usedCount ?? 0)
  if (maxUses != null && maxUses > 0 && usedCount >= maxUses) {
    throw new Error('Bonus code usage limit reached')
  }

  // Check per-user limit
  const campaignId = Number(bonusCode.campaignId)
  const userAwards = await db
    .select()
    .from(bonusAwards)
    .where(
      and(
        eq(bonusAwards.campaignId, campaignId),
        eq(bonusAwards.userId, userId)
      )
    )

  const perUserLimit = Number(bonusCode.perUserLimit ?? 1)
  if (userAwards.length >= perUserLimit) {
    throw new Error('You have already used this bonus code')
  }

  // Get campaign
  const campaign = await db
    .select()
    .from(bonusCampaigns)
    .where(
      and(
        eq(bonusCampaigns.id, campaignId),
        eq(bonusCampaigns.tenant, tenant),
        eq(bonusCampaigns.status, 'active')
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!campaign) {
    throw new Error('Bonus campaign not found or inactive')
  }

  // Check date validity (use startDate/endDate if available, otherwise validFrom/validTo)
  const now = new Date()
  const startDate = campaign.startDate || campaign.validFrom
  const endDate = campaign.endDate || campaign.validTo
  
  if (startDate && new Date(startDate) > now) {
    throw new Error('Bonus campaign has not started yet')
  }
  if (endDate && new Date(endDate) < now) {
    throw new Error('Bonus campaign has expired')
  }

  // Increment usage count
  const bonusCodeId = Number(bonusCode.id)
  await db
    .update(bonusCodes)
    .set({ usedCount: sql`${bonusCodes.usedCount} + 1` })
    .where(eq(bonusCodes.id, bonusCodeId))

  // Use bonus service to award bonus (handles distribution types properly)
  const { awardBonus } = await import('@shared/services/bonusService.js')
  const result = await awardBonus({
    userId,
    tenant,
    campaignId: campaign.id,
  })

  if (!result.success) {
    throw new Error(result.message || 'Failed to award bonus')
  }

  return getBonusAwards(userId, tenant)
}

export async function claimBonusCampaign(campaignId: number, userId: number, tenant: string) {
  // Check if user is eligible for bonuses
  const bonusUser = await db
    .select({ bonusAllowed: users.bonusAllowed })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
    .limit(1)
    .then((rows) => rows[0])
  if (!bonusUser) throw new Error('User not found')
  if (!bonusUser.bonusAllowed) throw new Error('Bonuses are not available for your account')

  // Get campaign - allow 'claim' mode OR 'auto' mode for signup type (for users who missed auto-award)
  const campaign = await db
    .select()
    .from(bonusCampaigns)
    .where(
      and(
        eq(bonusCampaigns.id, campaignId),
        eq(bonusCampaigns.tenant, tenant),
        eq(bonusCampaigns.status, 'active'),
        or(
          eq(bonusCampaigns.codeMode, 'claim'),
          // Allow signup type with auto mode to be claimed (for users who didn't get auto-award)
          and(eq(bonusCampaigns.type, 'signup'), eq(bonusCampaigns.codeMode, 'auto'))
        )
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!campaign) {
    throw new Error('Campaign not found or not claimable')
  }

  // Check date validity (use startDate/endDate if available, otherwise validFrom/validTo)
  const now = new Date()
  const startDate = campaign.startDate || campaign.validFrom
  const endDate = campaign.endDate || campaign.validTo
  
  if (startDate && new Date(startDate) > now) {
    throw new Error('Campaign has not started yet')
  }
  if (endDate && new Date(endDate) < now) {
    throw new Error('Campaign has expired')
  }

  // Check usage per player limit
  if (campaign.usagePerPlayer) {
    const userAwards = await db
      .select()
      .from(bonusAwards)
      .where(
        and(
          eq(bonusAwards.campaignId, campaignId),
          eq(bonusAwards.userId, userId)
        )
      )
    if (userAwards.length >= campaign.usagePerPlayer) {
      throw new Error('You have reached the usage limit for this bonus')
    }
  }

  // Check if user already claimed (signup only — one-time; deposit uses usagePerPlayer above)
  if (campaign.type === 'signup') {
    const existingAward = await db
      .select()
      .from(bonusAwards)
      .where(
        and(
          eq(bonusAwards.campaignId, campaignId),
          eq(bonusAwards.userId, userId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])

    if (existingAward) {
      throw new Error('You have already claimed this bonus')
    }
  }

  // Sign-up bonus: only users who registered on or after campaign activation are eligible
  if (campaign.type === 'signup' && campaign.activatedAt != null) {
    const userRow = await db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenant, tenant)))
      .limit(1)
      .then((rows) => rows[0])
    if (!userRow) throw new Error('User not found')
    if (new Date(userRow.createdAt) < new Date(campaign.activatedAt)) {
      throw new Error('This sign-up bonus is only for users who registered after the campaign was activated.')
    }
  }

  // Use bonus service to award bonus (creates award only; wallet credit only when user activates on bonus page)
  const { awardBonus } = await import('@shared/services/bonusService.js')
  const result = await awardBonus({
    userId,
    tenant,
    campaignId: campaign.id,
  })

  if (!result.success) {
    throw new Error(result.message || 'Failed to award bonus')
  }

  return getBonusAwards(userId, tenant)
}

export async function getSportsSettings(eventId: string, tenant: string, tierId: string = 'default') {
  // Get event details to find sportId, leagueId, and whitelabelId
  const eventRow = await db
    .select({
      id: sportsEventsTable.id,
      leagueId: sportsEventsTable.leagueId,
      sportId: sportsLeaguesTable.sportId,
    })
    .from(sportsEventsTable)
    .leftJoin(sportsLeaguesTable, eq(sportsLeaguesTable.id, sportsEventsTable.leagueId))
    .where(eq(sportsEventsTable.id, eventId))
    .limit(1)
    .then((rows) => rows[0])

  if (!eventRow || !eventRow.leagueId || !eventRow.sportId) {
    return null
  }

  // Use tenant as whitelabelId for global sports tables
  const whitelabelId = tenant

  // Import the settings loading function
  const { loadEffectiveSettingsWithRaw } = await import('../domains/userApp/services/sportsBetService.js')
  
  const { effectiveSettings, rawSettings } = await loadEffectiveSettingsWithRaw({
    whitelabelId: whitelabelId,
    sportId: eventRow.sportId,
    leagueId: eventRow.leagueId,
    eventId: eventRow.id,
    tierId,
  })

  return effectiveSettings
}

export async function getCashoutConfig(eventId: string, tenant: string, tierId: string = 'default'): Promise<boolean> {
  // Get event details to find sportId and leagueId
  const eventRow = await db
    .select({
      id: sportsEventsTable.id,
      leagueId: sportsEventsTable.leagueId,
      sportId: sportsLeaguesTable.sportId,
    })
    .from(sportsEventsTable)
    .leftJoin(sportsLeaguesTable, eq(sportsLeaguesTable.id, sportsEventsTable.leagueId))
    .where(eq(sportsEventsTable.id, eventId))
    .limit(1)
    .then((rows) => rows[0])

  if (!eventRow || !eventRow.leagueId || !eventRow.sportId) {
    return false
  }

  // Get appConfig cashoutEnabled (global)
  const appConfig = await db.query.appConfigs.findFirst({
    where: eq(appConfigs.whitelabelId, tenant),
  })

  // Check hierarchy: appConfig -> sport -> league -> event
  // Sport level is the primary config level for cashout
  // If any level explicitly enables it, return true
  // If any level explicitly disables it, return false

  // Check global appConfig first
  if (appConfig?.cashoutEnabled !== null && appConfig?.cashoutEnabled !== undefined) {
    return appConfig.cashoutEnabled
  }

  // Check sport settings (primary level for cashout config)
  const sportSettings = await db
    .select()
    .from(sportsSettingsTable)
    .where(
      and(
        eq(sportsSettingsTable.whitelabelId, tenant),
        eq(sportsSettingsTable.sportId, eventRow.sportId),
        eq(sportsSettingsTable.tierId, tierId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  // Also check default tier for sport settings
  const defaultSportSettings = tierId !== 'default' ? await db
    .select()
    .from(sportsSettingsTable)
    .where(
      and(
        eq(sportsSettingsTable.whitelabelId, tenant),
        eq(sportsSettingsTable.sportId, eventRow.sportId),
        eq(sportsSettingsTable.tierId, 'default')
      )
    )
    .limit(1)
    .then((rows) => rows[0]) : null

  const effectiveSportSettings = sportSettings || defaultSportSettings
  if (effectiveSportSettings?.cashoutActive !== null && effectiveSportSettings?.cashoutActive !== undefined) {
    return effectiveSportSettings.cashoutActive
  }

  // Check league settings (if available)
  const leagueSettings = await db
    .select()
    .from(leagueSettingsTable)
    .where(
      and(
        eq(leagueSettingsTable.whitelabelId, tenant),
        eq(leagueSettingsTable.leagueId, eventRow.leagueId),
        eq(leagueSettingsTable.tierId, tierId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (leagueSettings?.cashoutActive !== null && leagueSettings?.cashoutActive !== undefined) {
    return leagueSettings.cashoutActive
  }

  // Check event settings (if available)
  const eventSettings = await db
    .select()
    .from(eventSettingsTable)
    .where(
      and(
        eq(eventSettingsTable.whitelabelId, tenant),
        eq(eventSettingsTable.eventId, eventId),
        eq(eventSettingsTable.tierId, tierId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (eventSettings?.cashoutActive !== null && eventSettings?.cashoutActive !== undefined) {
    return eventSettings.cashoutActive
  }

  // Default to false if all are null/undefined
  // Cashout must be explicitly enabled at sport level
  return false
}

