import { getEffectiveTenantForDirector } from '@src/domains/common/directorModeUtils.js'
import { paymentWhitelabelSelectionRequired } from '@src/domains/payments/paymentTenant.js'
import { hasPermission } from '@src/domains/common/auth.js'
import { getSportsBets, getSportsBetsCount, getSportsBetsCountAndStake } from '@src/repos/sports/sportsBetsRepo.js'
import { getCasinoBets, getCasinoBetsCount, getCasinoBetsCountAndStake, buildCasinoBetsQuery } from '@src/repos/casino/casinoBetsRepo.js'
import { getMatkaBets, getMatkaBetsCount, getMatkaBetsCountAndStake, buildMatkaBetsQuery } from '@src/repos/matka/matkaBetsRepo.js'
import { PlayerAuthService } from '@src/domains/players/services/PlayerAuthService.js'
import { AgentsRepo } from '@src/repos/agents/AgentsRepo.js'
import { db } from '@src/db/client.js'
import { getWhitelabelCurrency, getWhitelabelTimezone } from '@src/shared/whitelabelConfig.js'
import { parseDateFrom, parseDateTo } from '@src/shared/dateUtils.js'
import { users, bonusAwards, bonusCampaigns, sportsResultsTable, sportsRunnersTable, casinoApiProviders, casinoVendors } from '@shared/db/schema.js'
import { eq, and, inArray, or, ilike, desc, isNull } from 'drizzle-orm'
import { requireReadPermission } from '@src/domains/common/auth.js'
import { getBetPageKeys } from '@src/repos/bets/betsPageRepo.js'

/** GMAG provider code: use casino_vendors.slug (actual provider code). Fallback: vendor name -> code map. */
const GMAG_VENDOR_NAME_TO_CODE: Record<string, string> = {
  pragmatic: 'pt',
  'pragmatic play': 'pt',
  evolution: 'evoplay',
  'evolution gaming': 'evoplay',
  evoplay: 'evoplay',
  ezugi: 'ezugi',
  playtech: 'pt',
  spribe: 'spribe',
}

function getGmagProviderCodeForVendorName(vendorName: string | null | undefined): string | null {
  if (!vendorName?.trim()) return null
  const key = vendorName.trim().toLowerCase()
  const exact = GMAG_VENDOR_NAME_TO_CODE[key]
  if (exact) return exact
  for (const [name, code] of Object.entries(GMAG_VENDOR_NAME_TO_CODE)) {
    if (key.includes(name) || name.includes(key.split(/\s+/)[0] ?? '')) return code
  }
  return null
}

async function getProviderKeyMap(providerIds: number[]): Promise<Map<number, string>> {
  if (providerIds.length === 0) return new Map()
  const rows = await db.select({ id: casinoApiProviders.id, key: casinoApiProviders.key }).from(casinoApiProviders).where(inArray(casinoApiProviders.id, providerIds))
  return new Map(rows.map((r) => [r.id, r.key]))
}

/** Vendor id -> slug (casino_vendors.slug is the actual provider code for GMAG RoundDetail). */
async function getVendorSlugMap(vendorIds: number[]): Promise<Map<number, string>> {
  if (vendorIds.length === 0) return new Map()
  const rows = await db.select({ id: casinoVendors.id, slug: casinoVendors.slug }).from(casinoVendors).where(inArray(casinoVendors.id, vendorIds))
  return new Map(rows.map((r) => [r.id, r.slug]))
}

type BetDomain = 'ALL' | 'SPORTS' | 'CASINO' | 'MATKA'
type BetsPageFilters = { status?: string[]; dateFrom?: string; dateTo?: string; agentUsername?: string; playerSearch?: string; search?: string; walletType?: string; userId?: string; sportId?: string; leagueId?: string; eventId?: string; vendorId?: string; gameId?: string; vendorName?: string; gameName?: string; matkaName?: string; marketName?: string; bidType?: string; stakeMin?: number; stakeMax?: number }

export type BetTableDomain = 'sports' | 'casino' | 'matka'

/**
 * Which bet tables this caller may read.
 *
 * The gate was `sports.bets OR casino.bets OR matka.bets`, after which all three
 * tables were read: holding any one bet permission opened the other two — the
 * OR-ed wrapper shape (see the permission notes). Each table now needs its own
 * `<domain>.bets:view`, and an agent additionally needs the domain in its
 * `allowedDomains` (its players do not bet outside them, and the agent's flat
 * permissions are derived from them, so this only matters if the two drift).
 */
export function allowedBetDomains(ctx: any): Record<BetTableDomain, boolean> {
  const perms = ctx?.permissions ?? []
  const agentDomains: string[] | null =
    ctx?.user?.type === 'agent'
      ? (Array.isArray(ctx?.user?.agentAllowedDomains) ? ctx.user.agentAllowedDomains.map((d: unknown) => String(d).toLowerCase()) : [])
      : null
  const allow = (domain: BetTableDomain) =>
    hasPermission(perms, `${domain}.bets`, 'view') && (agentDomains === null || agentDomains.includes(domain))
  return { sports: allow('sports'), casino: allow('casino'), matka: allow('matka') }
}

function requireBetsAccess(ctx: any) {
  if (!ctx?.user) throw new Error('Unauthorized: authentication required')
  if (!hasPermission(ctx.permissions, 'players.bets', 'view') && !Object.values(allowedBetDomains(ctx)).some(Boolean)) {
    throw new Error('Forbidden: insufficient permissions to view bets')
  }
}

export const SELECT_WHITELABEL_FOR_BETS = 'Select a whitelabel to view bets'

/**
 * Builds filters for betsPage/betsPageTotals/betsFilterOptions. Returns null when no whitelabel or no data (e.g. empty
 * user list). Bets belong to one whitelabel: a Super Admin in core mode, or in whitelabel mode with no site selected,
 * would read the platform's own tenant, which holds none, and see every count at 0 as if there were no bets. That is
 * refused with a clear message, under the same rule the admin UI skips these queries by (paymentScopeOf's
 * selectionRequired). Agents and whitelabel admins are unaffected.
 */
async function buildBetsPageFilters(ctx: any, filters: BetsPageFilters): Promise<{ sportsFilter: any; casinoFilter: any; matkaFilter: any; allowed: Record<BetTableDomain, boolean> } | null> {
  if (paymentWhitelabelSelectionRequired(ctx)) throw new Error(SELECT_WHITELABEL_FOR_BETS)
  const allowed = allowedBetDomains(ctx)
  if (!allowed.sports && !allowed.casino && !allowed.matka) return null
  const directorTenant = getEffectiveTenantForDirector(ctx)
  const tenant = directorTenant ?? ctx?.tenant ?? 'default'
  const whitelabelId = (directorTenant ?? ctx?.whitelabel?.id) as string | undefined
  if (!whitelabelId) return null

  let userIds: number[] | undefined
  if (ctx?.user?.type === 'agent' && ctx?.user?.agentId) {
    const playerAuthService = new PlayerAuthService()
    const agentsRepo = new AgentsRepo()
    let effectiveAgentId = ctx.user.agentId as string
    if (filters.agentUsername?.trim()) {
      const agent = await agentsRepo.findByUsername(filters.agentUsername.trim(), undefined, undefined, tenant)
      if (!agent || (agent as { tenantId?: string }).tenantId !== tenant) return null
      const loggedInId = ctx.user.agentId as string
      if (agent.id === loggedInId) {
        effectiveAgentId = loggedInId
      } else {
        const getAllDescendantIds = async (parentId: string): Promise<string[]> => {
          const children = await agentsRepo.listChildren(parentId)
          const ids = (children as { id: string }[]).map((c) => c.id)
          for (const c of children as { id: string }[]) {
            ids.push(...(await getAllDescendantIds(c.id)))
          }
          return ids
        }
        const descendantIds = await getAllDescendantIds(loggedInId)
        if (!descendantIds.includes(agent.id)) return null
        effectiveAgentId = agent.id
      }
    }
    userIds = await playerAuthService.getAgentPlayerIds(effectiveAgentId, tenant)
    if (userIds.length === 0) return null
    // Apply player search filter (username/name/phone) within agent's drilldown
    if (filters.playerSearch?.trim()) {
      const rawPlayerSearch = filters.playerSearch.trim()
      const q = `%${rawPlayerSearch}%`
      const numericPlayerId = Number(rawPlayerSearch)
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.tenant, tenant),
            or(
              ilike(users.username, q),
              ilike(users.name, q),
              ilike(users.phone, q),
              Number.isFinite(numericPlayerId) && numericPlayerId > 0 && numericPlayerId <= 2147483647 ? eq(users.id, numericPlayerId) : undefined,
            ),
          ),
        )
      const searchIds = new Set(rows.map((r) => r.id))
      userIds = userIds.filter((id) => searchIds.has(id))
      if (userIds.length === 0) return null
    }
  } else {
    let candidateIds: number[] | undefined
    if (filters.agentUsername?.trim()) {
      const agentsRepo = new AgentsRepo()
      const agent = await agentsRepo.findByUsername(filters.agentUsername.trim(), undefined, undefined, tenant)
      if (!agent || (agent as { tenantId?: string }).tenantId !== tenant) return null
      const playerAuthService = new PlayerAuthService()
      candidateIds = await playerAuthService.getAgentPlayerIds(agent.id, tenant)
      if (candidateIds.length === 0) return null
    }
    if (filters.playerSearch?.trim()) {
      const rawPlayerSearch = filters.playerSearch.trim()
      const q = `%${rawPlayerSearch}%`
      const numericPlayerId = Number(rawPlayerSearch)
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.tenant, tenant),
            or(
              ilike(users.username, q),
              ilike(users.name, q),
              ilike(users.phone, q),
              Number.isFinite(numericPlayerId) && numericPlayerId > 0 && numericPlayerId <= 2147483647 ? eq(users.id, numericPlayerId) : undefined,
            ),
          ),
        )
      const searchIds = rows.map((r) => r.id)
      if (candidateIds !== undefined) {
        const idSet = new Set(searchIds)
        userIds = candidateIds.filter((id) => idSet.has(id))
      } else {
        userIds = searchIds.length > 0 ? searchIds : []
      }
      if (userIds?.length === 0) return null
    } else if (candidateIds !== undefined) {
      userIds = candidateIds
    }
  }

  if (filters.userId != null) {
    const id = Number(filters.userId)
    if (!Number.isInteger(id) || id < 1 || id > 2147483647 || (userIds && !userIds.includes(id))) return null
    userIds = [id]
  }
  const statuses = Array.isArray(filters.status) && filters.status.length ? filters.status : undefined
  const tz = await getWhitelabelTimezone(tenant)
  const dateFrom = filters.dateFrom ? parseDateFrom(filters.dateFrom, tz).toISOString() : filters.dateFrom
  const dateTo = filters.dateTo ? parseDateTo(filters.dateTo, tz).toISOString() : filters.dateTo
  const baseFilter = {
    tenant,
    whitelabelId,
    dateFrom,
    dateTo,
    statuses,
    stakeMin: filters.stakeMin,
    stakeMax: filters.stakeMax,
  }
  const sportsFilter = {
    ...baseFilter,
    statuses: mapStatusesForSports(statuses),
    sportId: filters.sportId,
    leagueId: filters.leagueId,
    eventId: filters.eventId,
    userIds,
    search: filters.search,
    limit: 0,
    offset: 0,
    omitOpenAdminToolBets: true,
  }
  // Casino and matka use enum statuses (won/lost, not 'settled'); map 'settled' -> ['won','lost'] and drop invalid values to avoid DB enum errors
  const casinoStatuses = mapStatusesForCasinoOrMatka(statuses)
  const matkaStatuses = mapStatusesForCasinoOrMatka(statuses)
  const casinoFilter = {
    ...baseFilter,
    vendorId: filters.vendorId ? Number(filters.vendorId) : undefined,
    gameId: filters.gameId ? Number(filters.gameId) : undefined,
    vendorName: filters.vendorName,
    gameName: filters.gameName,
    statuses: casinoStatuses,
    userIds,
    search: filters.search,
    walletType: filters.walletType || undefined,
    limit: 0,
    offset: 0,
    omitOpenAdminToolBets: true,
  }
  const matkaFilter = {
    ...baseFilter,
    matkaName: filters.matkaName,
    marketName: filters.marketName,
    bidType: filters.bidType,
    statuses: matkaStatuses,
    userIds,
    search: filters.search,
    limit: 0,
    offset: 0,
  }
  return { sportsFilter, casinoFilter, matkaFilter, allowed }
}

/**
 * Sports enum: matched, unmatched, cancelled, settled, won, lost, void. Settlement writes won or lost, so
 * 'settled' -> won+lost (and the rare stored 'settled'); the casino/matka open statuses pending and active
 * -> matched+unmatched; drop other invalid statuses. The raw list went to the sports table, so "settled"
 * matched no sports bet at all and, under Domain All, silently dropped every sports bet from the list and
 * the totals; an 'active' status there was an enum error.
 */
export function mapStatusesForSports(statuses: string[] | undefined): string[] | undefined {
  if (!statuses?.length) return undefined
  const valid = new Set(['matched', 'unmatched', 'cancelled', 'settled', 'won', 'lost', 'void'])
  const out = new Set<string>()
  for (const s of statuses) {
    if (s === 'settled') {
      out.add('won')
      out.add('lost')
      out.add('settled')
    } else if (s === 'pending' || s === 'active') {
      out.add('matched')
      out.add('unmatched')
    } else if (valid.has(s)) {
      out.add(s)
    }
  }
  return out.size ? [...out] : undefined
}

/** Casino/matka enums: pending, active, won, lost, cancelled, void. Map 'settled' -> won+lost; sports 'matched' (admin "Open") -> pending+active; drop other invalid statuses. */
function mapStatusesForCasinoOrMatka(statuses: string[] | undefined): string[] | undefined {
  if (!statuses?.length) return undefined
  const valid = new Set(['pending', 'active', 'won', 'lost', 'cancelled', 'void'])
  const out = new Set<string>()
  for (const s of statuses) {
    if (s === 'settled') {
      out.add('won')
      out.add('lost')
    } else if (s === 'matched') {
      // Admin bet list shows sports `matched` as "Open"; same intent for in-flight casino/matka bets
      out.add('pending')
      out.add('active')
    } else if (valid.has(s)) {
      out.add(s)
    }
  }
  return out.size ? [...out] : undefined
}

function toSportsBetItem(row: any, fallbackCurrency?: string): any {
  return {
    __typename: 'SportsBet',
    id: row.id,
    tenant: row.tenant ?? null,
    whitelabelId: row.whitelabelId,
    userId: String(row.userId),
    userName: row.userName ?? null,
    userPhone: null,
    userFlags: null,
    sportId: row.sportId,
    sportName: row.sportName ?? null,
    leagueId: row.leagueId,
    leagueName: row.leagueName ?? null,
    marketId: row.marketId,
    marketName: row.marketName ?? null,
    eventId: row.eventId,
    eventName: row.eventName ?? null,
    runnerId: row.runnerId,
    selectionId: row.selectionId,
    selectionName: row.selectionName ?? null,
    side: row.side,
    price: row.price != null ? Number(row.price) : 0,
    size: row.size != null ? Number(row.size) : 0,
    stake: row.stake != null ? Number(row.stake) : 0,
    liability: row.liability != null ? Number(row.liability) : 0,
    status: row.status,
    matchedAt: row.matchedAt ? new Date(row.matchedAt).toISOString() : null,
    settledAt: row.settledAt ? new Date(row.settledAt).toISOString() : null,
    result: row.result ?? null,
    eventResult: null,
    pl: row.pl != null ? Number(row.pl) : null,
    currency: row.currency ?? fallbackCurrency ?? 'INR',
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    location: row.location ?? null,
    country: row.country ?? null,
    deviceInfo: row.deviceInfo ?? null,
    oddsSize: row.oddsSize != null ? Number(row.oddsSize) : null,
    agentInfo: null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    walletType: 'cash',
    campaign: null,
  }
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

function toCasinoBetItem(row: any, userName?: string | null, campaign?: BetCampaignDetailMap | null, userPhone?: string | null, fallbackCurrency?: string, providerCode?: string | null): any {
  return {
    __typename: 'CasinoBet',
    id: row.id,
    tenant: row.tenant ?? null,
    whitelabelId: row.whitelabelId,
    userId: String(row.userId),
    userName: userName ?? null,
    userPhone: userPhone ?? null,
    gameId: String(row.gameId),
    gameName: row.gameName ?? null,
    providerId: row.providerId != null ? String(row.providerId) : null,
    sessionId: row.sessionId ?? null,
    vendorId: String(row.vendorId),
    vendorName: row.vendorName,
    tableId: row.tableId ?? null,
    stake: row.stake != null ? Number(row.stake) : 0,
    payout: row.payout != null ? Number(row.payout) : null,
    winAmount: row.winAmount != null ? Number(row.winAmount) : null,
    netAmount: row.netAmount != null ? Number(row.netAmount) : null,
    status: row.status,
    gameRoundId: row.gameRoundId ?? null,
    transactionId: row.transactionId ?? null,
    settledAt: row.settledAt ? new Date(row.settledAt).toISOString() : null,
    currency: row.currency ?? fallbackCurrency ?? 'INR',
    metadata: row.metadata ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    walletType: row.walletType ?? 'cash',
    campaign: campaign ?? null,
    providerCode: providerCode ?? null,
  }
}

function toMatkaBetItem(row: any, userName?: string | null, userPhone?: string | null, fallbackCurrency?: string): any {
  return {
    __typename: 'MatkaBet',
    id: row.id,
    tenant: row.tenant ?? null,
    whitelabelId: row.whitelabelId,
    userId: String(row.userId),
    userName: userName ?? null,
    userPhone: userPhone ?? null,
    matkaId: row.matkaId,
    matkaName: row.matkaName ?? null,
    matkaType: row.matkaType,
    marketName: row.marketName,
    marketSession: row.marketSession ?? null,
    bidType: row.bidType,
    betNumbers: row.betNumbers,
    betAmount: row.betAmount != null ? Number(row.betAmount) : 0,
    payoutMultiplier: row.payoutMultiplier != null ? Number(row.payoutMultiplier) : 0,
    potentialWin: row.potentialWin != null ? Number(row.potentialWin) : null,
    actualWin: row.actualWin != null ? Number(row.actualWin) : null,
    status: row.status,
    result: row.result ?? null,
    settledAt: row.settledAt ? new Date(row.settledAt).toISOString() : null,
    currency: row.currency ?? fallbackCurrency ?? 'INR',
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
    walletType: 'cash',
    campaign: null,
  }
}

export const betsQueryResolvers = {
  betsFilterOptions: async (_: unknown, args: { domain: BetDomain; filters?: BetsPageFilters }, ctx: any) => {
    requireBetsAccess(ctx)
    const built = await buildBetsPageFilters(ctx, { ...args.filters, search: undefined, vendorName: undefined, gameName: undefined, matkaName: undefined, marketName: undefined, bidType: undefined })
    const empty = { vendorNames: [] as string[], gameNames: [] as string[], matkaNames: [] as string[], marketNames: [] as string[], bidTypes: [] as string[] }
    if (!built) return empty
    const names = (values: (string | null)[]) => [...new Set(values.filter((x): x is string => !!x))].sort()
    if ((args.domain === 'CASINO' || args.domain === 'ALL') && built.allowed.casino) {
      const source = (await buildCasinoBetsQuery(built.casinoFilter)).query.as('bet_option_source')
      const rows = await db.selectDistinct({ vendor: source.vendorName, game: source.gameName }).from(source)
      empty.vendorNames = names(rows.map(x => x.vendor)); empty.gameNames = names(rows.map(x => x.game))
    }
    if ((args.domain === 'MATKA' || args.domain === 'ALL') && built.allowed.matka) {
      const source = (await buildMatkaBetsQuery(built.matkaFilter)).query.as('matka_option_source')
      const rows = await db.selectDistinct({ matka: source.matkaName, market: source.marketName, bid: source.bidType }).from(source)
      empty.matkaNames = names(rows.map(x => x.matka)); empty.marketNames = names(rows.map(x => x.market)); empty.bidTypes = names(rows.map(x => x.bid))
    }
    return empty
  },
  betsPage: async (_: any, args: { domain: BetDomain; filters?: BetsPageFilters | null; offset?: number; limit?: number }, ctx: any) => {
    requireBetsAccess(ctx)
    const built = await buildBetsPageFilters(ctx, args.filters ?? {})
    if (!built) return { items: [], total: 0 }
    const { sportsFilter, casinoFilter, matkaFilter, allowed } = built
    const tenant = built.sportsFilter.tenant
    const filters = args.filters ?? {}
    // PostgreSQL now applies the offset; application memory stays bounded by page size.
    const offset = Math.max(0, args.offset ?? 0)
    const limit = Math.min(500, Math.max(1, args.limit ?? 50))
    const fallbackCurrency = await getWhitelabelCurrency(tenant)
    const walletType = filters.walletType?.trim() || undefined
    const walletWantsCash = walletType === undefined || walletType === 'cash'

    if (args.domain === 'SPORTS') {
      if (!walletWantsCash || !allowed.sports) return { items: [], total: 0 }
      const [items, total] = await Promise.all([
        getSportsBets({ ...sportsFilter, limit, offset }),
        getSportsBetsCount({ ...sportsFilter }),
      ])
      const rows = Array.isArray(items) ? items : []
      const userIdsFromRows = [...new Set(rows.map((r: any) => r.userId).filter(Boolean))]
      let userMap = new Map<number, { name: string | null; phone: string | null }>()
      if (userIdsFromRows.length > 0) {
        const userRows = await db.select({ id: users.id, name: users.name, username: users.username, phone: users.phone }).from(users).where(and(eq(users.tenant, tenant), inArray(users.id, userIdsFromRows)))
        userRows.forEach((u: any) => userMap.set(u.id, { name: u.name || u.username || null, phone: u.phone || null }))
      }
      const sportsMarketIds = [...new Set(rows.map((r: any) => r.marketId).filter(Boolean))] as string[]
      const eventResultMap = await getEventResultsByMarketIds(sportsMarketIds)
      const list = rows.map((r: any) => {
        const out = toSportsBetItem(r, fallbackCurrency)
        const userInfo = userMap.get(Number(r.userId))
        out.userName = userInfo?.name ?? null
        out.userPhone = userInfo?.phone ?? null
        out.eventResult = r.marketId ? (eventResultMap[String(r.marketId)] ?? null) : null
        return out
      })
      return { items: list, total }
    }

    if (args.domain === 'CASINO') {
      if (!allowed.casino) return { items: [], total: 0 }
      const [items, total] = await Promise.all([
        getCasinoBets({ ...casinoFilter, limit, offset }),
        getCasinoBetsCount({ ...casinoFilter }),
      ])
      const rows = Array.isArray(items) ? items : []
      const userIdsFromRows = [...new Set(rows.map((r: any) => Number(r.userId)).filter(Boolean))]
      const providerIdsFromRows = [...new Set(rows.map((r: any) => r.providerId).filter((id: any) => id != null))]
      let userMap = new Map<number, { name: string | null; phone: string | null }>()
      if (userIdsFromRows.length > 0) {
        const userRows = await db.select({ id: users.id, name: users.name, username: users.username, phone: users.phone }).from(users).where(and(eq(users.tenant, tenant), inArray(users.id, userIdsFromRows)))
        userRows.forEach((u: any) => userMap.set(u.id, { name: u.name || u.username || null, phone: u.phone || null }))
      }
      const vendorIdsFromRows = [...new Set(rows.map((r: any) => r.vendorId).filter((id: any) => id != null))]
      const [campaignMap, providerKeyMap, vendorSlugMap] = await Promise.all([
        getCampaignDetailsByBonusAwardIds([...new Set(rows.map((r: any) => r.bonusAwardId).filter((id: any) => id != null))]),
        getProviderKeyMap(providerIdsFromRows),
        getVendorSlugMap(vendorIdsFromRows),
      ])
      const list = rows.map((r: any) => {
        const userInfo = userMap.get(Number(r.userId))
        const providerKey = r.providerId != null ? providerKeyMap.get(r.providerId) : undefined
        const providerCode = providerKey === 'gmagcasino' ? (vendorSlugMap.get(r.vendorId) ?? getGmagProviderCodeForVendorName(r.vendorName)) : null
        return toCasinoBetItem(r, userInfo?.name ?? null, r.bonusAwardId ? campaignMap.get(r.bonusAwardId) ?? null : null, userInfo?.phone ?? null, fallbackCurrency, providerCode)
      })
      return { items: list, total }
    }

    if (args.domain === 'MATKA') {
      if (!walletWantsCash || !allowed.matka) return { items: [], total: 0 }
      const [items, total] = await Promise.all([
        getMatkaBets({ ...matkaFilter, limit, offset }),
        getMatkaBetsCount({ ...matkaFilter }),
      ])
      const rows = Array.isArray(items) ? items : []
      const userIdsFromRows = [...new Set(rows.map((r: any) => Number(r.userId)).filter(Boolean))]
      let userMap = new Map<number, { name: string | null; phone: string | null }>()
      if (userIdsFromRows.length > 0) {
        const userRows = await db.select({ id: users.id, name: users.name, username: users.username, phone: users.phone }).from(users).where(and(eq(users.tenant, tenant), inArray(users.id, userIdsFromRows)))
        userRows.forEach((u: any) => userMap.set(u.id, { name: u.name || u.username || null, phone: u.phone || null }))
      }
      const list = rows.map((r: any) => {
        const userInfo = userMap.get(Number(r.userId))
        return toMatkaBetItem(r, userInfo?.name ?? null, userInfo?.phone ?? null, fallbackCurrency)
      })
      return { items: list, total }
    }

    // Each table only when the caller holds that table's own bet permission.
    const readSports = walletWantsCash && allowed.sports
    const readCasino = allowed.casino
    const readMatka = walletWantsCash && allowed.matka
    const [pageKeys, sportsTotal, casinoTotal, matkaTotal] = await Promise.all([
      getBetPageKeys({
        sports: readSports ? sportsFilter : undefined,
        casino: readCasino ? casinoFilter : undefined,
        matka: readMatka ? matkaFilter : undefined,
      }, offset, limit),
      readSports ? getSportsBetsCount({ ...sportsFilter }) : Promise.resolve(0),
      readCasino ? getCasinoBetsCount({ ...casinoFilter }) : Promise.resolve(0),
      readMatka ? getMatkaBetsCount({ ...matkaFilter }) : Promise.resolve(0),
    ])
    const idsFor = (domain: string) => pageKeys.filter((key) => key.domain === domain).map((key) => key.id)
    const sportsIds = idsFor('SPORTS'), casinoIds = idsFor('CASINO'), matkaIds = idsFor('MATKA')
    const [sportsRows, casinoRows, matkaRows] = await Promise.all([
      sportsIds.length ? getSportsBets({ ...sportsFilter, betIds: sportsIds, limit, offset: 0 }) : Promise.resolve([]),
      casinoIds.length ? getCasinoBets({ ...casinoFilter, betIds: casinoIds, limit, offset: 0 }) : Promise.resolve([]),
      matkaIds.length ? getMatkaBets({ ...matkaFilter, betIds: matkaIds, limit, offset: 0 }) : Promise.resolve([]),
    ])
    const allUserId = new Set<number>()
    ;(Array.isArray(sportsRows) ? sportsRows : []).forEach((r: any) => { if (r.userId) allUserId.add(Number(r.userId)) })
    ;(Array.isArray(casinoRows) ? casinoRows : []).forEach((r: any) => { if (r.userId) allUserId.add(Number(r.userId)) })
    ;(Array.isArray(matkaRows) ? matkaRows : []).forEach((r: any) => { if (r.userId) allUserId.add(Number(r.userId)) })
    let userMap = new Map<number, { name: string | null; phone: string | null }>()
    if (allUserId.size > 0) {
      const userRows = await db.select({ id: users.id, name: users.name, username: users.username, phone: users.phone }).from(users).where(and(eq(users.tenant, tenant), inArray(users.id, [...allUserId])))
      userRows.forEach((u: any) => userMap.set(u.id, { name: u.name || u.username || null, phone: u.phone || null }))
    }

    const casinoRowsArr = Array.isArray(casinoRows) ? casinoRows : []
    const casinoBonusAwardIds = [...new Set(casinoRowsArr.map((r: any) => r.bonusAwardId).filter((id: any) => id != null))]
    const casinoProviderIds = [...new Set(casinoRowsArr.map((r: any) => r.providerId).filter((id: any) => id != null))]
    const casinoVendorIds = [...new Set(casinoRowsArr.map((r: any) => r.vendorId).filter((id: any) => id != null))]
    const allSportsMarketIds = [...new Set((Array.isArray(sportsRows) ? sportsRows : []).map((r: any) => r.marketId).filter(Boolean))] as string[]
    const [allCampaignMap, allEventResultMap, providerKeyMap, vendorSlugMap] = await Promise.all([
      getCampaignDetailsByBonusAwardIds(casinoBonusAwardIds),
      getEventResultsByMarketIds(allSportsMarketIds),
      getProviderKeyMap(casinoProviderIds),
      getVendorSlugMap(casinoVendorIds),
    ])
    const withTs = (arr: any[], typename: string, fn: (r: any, userInfo: { name: string | null; phone: string | null } | undefined) => any) =>
      (Array.isArray(arr) ? arr : []).map((r: any) => ({
        ...fn(r, userMap.get(Number(r.userId))),
        _createdAt: r.createdAt ? new Date(r.createdAt).getTime() : 0,
      }))
    const merged = [
      ...withTs(sportsRows as any[], 'SportsBet', (r, info) => { const x = toSportsBetItem(r, fallbackCurrency); x.userName = info?.name ?? null; x.userPhone = info?.phone ?? null; x.eventResult = r.marketId ? (allEventResultMap[String(r.marketId)] ?? null) : null; return x }),
      ...withTs(casinoRows as any[], 'CasinoBet', (r, info) => {
        const providerKey = r.providerId != null ? providerKeyMap.get(r.providerId) : undefined
        const providerCode = providerKey === 'gmagcasino' ? (vendorSlugMap.get(r.vendorId) ?? getGmagProviderCodeForVendorName(r.vendorName)) : null
        return toCasinoBetItem(r, info?.name ?? null, r.bonusAwardId ? allCampaignMap.get(r.bonusAwardId) ?? null : null, info?.phone ?? null, fallbackCurrency, providerCode)
      }),
      ...withTs(matkaRows as any[], 'MatkaBet', (r, info) => toMatkaBetItem(r, info?.name ?? null, info?.phone ?? null, fallbackCurrency)),
    ]
    const total = (sportsTotal ?? 0) + (casinoTotal ?? 0) + (matkaTotal ?? 0)
    const byKey = new Map(merged.map(({ _createdAt, ...row }) => [`${row.__typename}:${row.id}`, row]))
    const types = { SPORTS: 'SportsBet', CASINO: 'CasinoBet', MATKA: 'MatkaBet' }
    const items = pageKeys.map((key) => byKey.get(`${types[key.domain]}:${key.id}`)).filter(Boolean)
    return { items, total }
  },

  betsPageTotals: async (_: any, args: { filters?: BetsPageFilters | null }, ctx: any) => {
    requireBetsAccess(ctx)
    const built = await buildBetsPageFilters(ctx, args.filters ?? {})
    if (!built) {
      return {
        totalAll: 0,
        totalSports: 0,
        totalCasino: 0,
        totalMatka: 0,
        totalStake: 0,
        totalStakeSports: 0,
        totalStakeCasino: 0,
        totalStakeMatka: 0,
      }
    }
    const { sportsFilter, casinoFilter, matkaFilter, allowed } = built
    const walletType = args.filters?.walletType?.trim() || undefined
    const walletWantsCash = walletType === undefined || walletType === 'cash'
    const none = { count: 0, stakeSum: 0 }
    const [sportsRes, casinoRes, matkaRes] = await Promise.all([
      walletWantsCash && allowed.sports ? getSportsBetsCountAndStake(sportsFilter) : Promise.resolve(none),
      allowed.casino ? getCasinoBetsCountAndStake(casinoFilter) : Promise.resolve(none),
      walletWantsCash && allowed.matka ? getMatkaBetsCountAndStake(matkaFilter) : Promise.resolve(none),
    ])
    const totalAll = sportsRes.count + casinoRes.count + matkaRes.count
    const totalStakeSports = sportsRes.stakeSum
    const totalStakeCasino = casinoRes.stakeSum
    const totalStakeMatka = matkaRes.stakeSum
    const totalStake = totalStakeSports + totalStakeCasino + totalStakeMatka
    return {
      totalAll,
      totalSports: sportsRes.count,
      totalCasino: casinoRes.count,
      totalMatka: matkaRes.count,
      totalStake,
      totalStakeSports,
      totalStakeCasino,
      totalStakeMatka,
    }
  },
}

export const BetItemResolver = {
  __resolveType(obj: any) {
    if (obj?.__typename === 'SportsBet') return 'SportsBet'
    if (obj?.__typename === 'CasinoBet') return 'CasinoBet'
    if (obj?.__typename === 'MatkaBet') return 'MatkaBet'
    return null
  },
}
