import { and, eq, inArray, or } from 'drizzle-orm'

const eqL = eq as any
const andL = and as any
const orL = or as any
const inArrayL = inArray as any
import { db as dbClient } from '../db/client.js'

const pdb = dbClient as any
import {
  sportsBets,
  sportsRunnersTable,
  sportsMarketsTable,
  sportsEventsTable,
  sportsLeaguesTable,
  sportsTable,
  walletLedger,
} from '@shared/db/schema.js'

export type ToolSportsMarketType = 'exchange' | 'bookmaker' | 'fancy'

type Executor = any

const OPEN_STATUSES = ['matched', 'unmatched'] as const

function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

function sanitizeFancyMarketSegment(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .toLowerCase()
    .substring(0, 50)
}

type FancyMarketRow = {
  id: string
  marketCode: string
  eventId: string
  type: string
  status: string
}

/**
 * Aligns with `loadMarketContexts` fancy path in sportsBetService: find or create fancy market + runner for an event.
 * Call when placing a fancy leg via bet-tool (e.g. oddsSize set) so hierarchy does not need to exist upfront.
 */
export async function resolveOrCreateFancyMarketForTool(
  input: {
    sportId: string
    leagueId: string
    eventId: string
    /** Existing fancy market UUID, or a marketCode string, or a placeholder when creating on-the-fly */
    marketId: string
    /** Optional label (like GraphQL marketCode) used when creating a new fancy market */
    marketCode?: string | null
    selectionId: string
    /** May be a placeholder when the runner will be created; real UUID returned */
    runnerId: string
    /** Display name for new market/runner (optional) */
    selectionLabel?: string | null
  },
  executor: Executor = pdb
): Promise<{ marketId: string; runnerId: string }> {
  const ex = executor as any

  const [event] = await ex
    .select({
      id: sportsEventsTable.id,
      leagueId: sportsEventsTable.leagueId,
      status: sportsEventsTable.status,
    })
    .from(sportsEventsTable)
    .where(eqL(sportsEventsTable.id, input.eventId))
    .limit(1)
  if (!event || event.status !== 'active') {
    throw new Error('Event not found or is not active')
  }
  if (String(event.leagueId) !== input.leagueId) {
    throw new Error('League does not match event')
  }

  const [league] = await ex
    .select({
      id: sportsLeaguesTable.id,
      sportId: sportsLeaguesTable.sportId,
      status: sportsLeaguesTable.status,
    })
    .from(sportsLeaguesTable)
    .where(eqL(sportsLeaguesTable.id, input.leagueId))
    .limit(1)
  if (!league || league.status !== 'active') {
    throw new Error('League not found or is not active')
  }
  if (String(league.sportId) !== input.sportId) {
    throw new Error('Sport does not match league')
  }

  const [sport] = await ex
    .select({ id: sportsTable.id, status: sportsTable.status })
    .from(sportsTable)
    .where(eqL(sportsTable.id, input.sportId))
    .limit(1)
  if (!sport || sport.status !== 'active') {
    throw new Error('Sport not found or is not active')
  }

  let market: FancyMarketRow | undefined

  if (isUUID(input.marketId)) {
    const [m] = await ex
      .select({
        id: sportsMarketsTable.id,
        marketCode: sportsMarketsTable.marketCode,
        eventId: sportsMarketsTable.eventId,
        type: sportsMarketsTable.type,
        status: sportsMarketsTable.status,
      })
      .from(sportsMarketsTable)
      .where(andL(eqL(sportsMarketsTable.id, input.marketId), eqL(sportsMarketsTable.eventId, input.eventId)))
      .limit(1)
    market = m
  }

  const idAsCode = input.marketId.trim()
  if (!market && idAsCode) {
    const [m] = await ex
      .select({
        id: sportsMarketsTable.id,
        marketCode: sportsMarketsTable.marketCode,
        eventId: sportsMarketsTable.eventId,
        type: sportsMarketsTable.type,
        status: sportsMarketsTable.status,
      })
      .from(sportsMarketsTable)
      .where(andL(eqL(sportsMarketsTable.marketCode, idAsCode), eqL(sportsMarketsTable.eventId, input.eventId)))
      .limit(1)
    market = m
  }

  const extraCode = input.marketCode?.trim()
  if (!market && extraCode) {
    const [m] = await ex
      .select({
        id: sportsMarketsTable.id,
        marketCode: sportsMarketsTable.marketCode,
        eventId: sportsMarketsTable.eventId,
        type: sportsMarketsTable.type,
        status: sportsMarketsTable.status,
      })
      .from(sportsMarketsTable)
      .where(andL(eqL(sportsMarketsTable.marketCode, extraCode), eqL(sportsMarketsTable.eventId, input.eventId)))
      .limit(1)
    market = m
  }

  if (!market) {
    const rawSource = extraCode || String(input.selectionId).trim()
    const eventPrefix = String(event.id).substring(0, 8)
    let sanitizedName = sanitizeFancyMarketSegment(rawSource)
    if (!sanitizedName) {
      sanitizedName =
        String(input.selectionId)
          .replace(/[^a-zA-Z0-9]/g, '')
          .toLowerCase()
          .substring(0, 30) || 'fancy'
    }
    const sanitizedMarketCode = `f-${eventPrefix}-${sanitizedName}`.substring(0, 64)
    const displayName =
      (input.selectionLabel?.trim() || `Fancy ${sanitizedName || 'market'}`).substring(0, 200)

    try {
      const [created] = await ex
        .insert(sportsMarketsTable)
        .values({
          eventId: event.id,
          marketCode: sanitizedMarketCode,
          name: displayName,
          type: 'fancy',
          status: 'active',
        })
        .returning({
          id: sportsMarketsTable.id,
          marketCode: sportsMarketsTable.marketCode,
          eventId: sportsMarketsTable.eventId,
          type: sportsMarketsTable.type,
          status: sportsMarketsTable.status,
        })
      market = created
    } catch (err: any) {
      if (err?.code === '23505' || String(err?.message ?? '').includes('unique')) {
        const [existing] = await ex
          .select({
            id: sportsMarketsTable.id,
            marketCode: sportsMarketsTable.marketCode,
            eventId: sportsMarketsTable.eventId,
            type: sportsMarketsTable.type,
            status: sportsMarketsTable.status,
          })
          .from(sportsMarketsTable)
          .where(
            andL(eqL(sportsMarketsTable.marketCode, sanitizedMarketCode), eqL(sportsMarketsTable.eventId, event.id))
          )
          .limit(1)
        market = existing
      }
      if (!market) {
        throw new Error(`Failed to create or find fancy market: ${err?.message || 'Unknown error'}`)
      }
    }
  }

  if (!market || market.status !== 'active') {
    throw new Error('Market is not active for this event')
  }
  if (String(market.type) !== 'fancy') {
    throw new Error('Market is not a fancy market')
  }

  const selectionIdStr = String(input.selectionId).trim()
  if (!selectionIdStr) {
    throw new Error('selectionId is required for fancy placement')
  }
  const selCode = selectionIdStr.substring(0, 64)
  const runnerWhere = isUUID(input.runnerId)
    ? andL(
        eqL(sportsRunnersTable.marketId, market.id),
        orL(eqL(sportsRunnersTable.selectionCode, selCode), eqL(sportsRunnersTable.id, input.runnerId))
      )
    : andL(eqL(sportsRunnersTable.marketId, market.id), eqL(sportsRunnersTable.selectionCode, selCode))

  let [runner] = await ex
    .select({ id: sportsRunnersTable.id })
    .from(sportsRunnersTable)
    .where(runnerWhere)
    .limit(1)

  if (!runner) {
    const runnerName = (input.selectionLabel?.trim() || `Selection ${selCode}`).substring(0, 180)
    try {
      ;[runner] = await ex
        .insert(sportsRunnersTable)
        .values({
          marketId: market.id,
          selectionCode: selCode,
          name: runnerName,
          sort: 999,
          status: 'active',
        })
        .returning({ id: sportsRunnersTable.id })
    } catch (err: any) {
      if (err?.code === '23505' || String(err?.message ?? '').includes('unique')) {
        ;[runner] = await ex
          .select({ id: sportsRunnersTable.id })
          .from(sportsRunnersTable)
          .where(andL(eqL(sportsRunnersTable.marketId, market.id), eqL(sportsRunnersTable.selectionCode, selCode)))
          .limit(1)
      }
      if (!runner) {
        throw new Error(`Failed to create or find runner: ${err?.message || 'Unknown error'}`)
      }
    }
  }

  return { marketId: market.id, runnerId: runner.id }
}

export async function getSportsMarketType(
  marketId: string,
  executor: Executor = pdb
): Promise<ToolSportsMarketType | null> {
  const [row] = await (executor as any)
    .select({ type: sportsMarketsTable.type })
    .from(sportsMarketsTable)
    .where(eqL(sportsMarketsTable.id, marketId))
    .limit(1)
  if (!row?.type) return null
  const t = String(row.type)
  if (t === 'fancy' || t === 'exchange' || t === 'bookmaker') return t
  if (t === 'match_odds') return 'bookmaker'
  return 'bookmaker'
}

/** Validates runner belongs to market/event/league/sport chain. */
export async function validateSportsBetHierarchy(
  input: {
    sportId: string
    leagueId: string
    marketId: string
    eventId: string
    runnerId: string
    selectionId: string
  },
  executor: Executor = pdb
): Promise<{ ok: true } | { ok: false; message: string }> {
  const rows = await (executor as any)
    .select({
      runnerSelection: sportsRunnersTable.selectionCode,
      marketId: sportsMarketsTable.id,
      eventId: sportsEventsTable.id,
      leagueId: sportsLeaguesTable.id,
      sportId: sportsTable.id,
    })
    .from(sportsRunnersTable)
    .innerJoin(sportsMarketsTable, eqL(sportsRunnersTable.marketId, sportsMarketsTable.id))
    .innerJoin(sportsEventsTable, eqL(sportsMarketsTable.eventId, sportsEventsTable.id))
    .innerJoin(sportsLeaguesTable, eqL(sportsEventsTable.leagueId, sportsLeaguesTable.id))
    .innerJoin(sportsTable, eqL(sportsLeaguesTable.sportId, sportsTable.id))
    .where(eqL(sportsRunnersTable.id, input.runnerId))
    .limit(1)

  const row = rows[0]
  if (!row) {
    return { ok: false, message: 'Runner not found' }
  }
  if (String(row.marketId) !== input.marketId) {
    return { ok: false, message: 'Market does not match runner' }
  }
  if (String(row.eventId) !== input.eventId) {
    return { ok: false, message: 'Event does not match market' }
  }
  if (String(row.leagueId) !== input.leagueId) {
    return { ok: false, message: 'League does not match event' }
  }
  if (String(row.sportId) !== input.sportId) {
    return { ok: false, message: 'Sport does not match league' }
  }
  if (String(row.runnerSelection) !== input.selectionId) {
    return { ok: false, message: 'selectionId does not match runner.selectionCode' }
  }
  return { ok: true }
}

export async function getSportsBetById(betId: string, executor: Executor = pdb) {
  const [row] = await (executor as any).select().from(sportsBets).where(eqL(sportsBets.id, betId)).limit(1)
  return row ?? null
}

export async function settleSportsBetOpen(
  betId: string,
  status: 'won' | 'lost' | 'void',
  winAmount: number | undefined,
  settledAt: Date,
  pl: number,
  executor: Executor = pdb
) {
  const updateData: Record<string, unknown> = {
    status: status as any,
    updatedAt: new Date(),
    settledAt: settledAt || new Date(),
    /** After settlement, show in admin lists / aggregates like normal bets. */
    excludeFromAdminRunning: false,
  }
  if (winAmount !== undefined && winAmount > 0) {
    updateData.result = String(winAmount)
  }
  updateData.pl = String(pl)

  const [bet] = await (executor as any)
    .update(sportsBets)
    .set(updateData as any)
    .where(andL(eqL(sportsBets.id, betId), inArrayL(sportsBets.status, [...OPEN_STATUSES])))
    .returning()

  return bet ?? null
}

/**
 * Remove the placement `wallet_ledger` exposure line for a single-bet slip (meta.sportsBetIds length 1).
 * Multi-leg rows (multiple IDs) are left intact so shared ledger lines are not dropped incorrectly.
 */
async function deleteWalletLedgerSportsBetExposureRow(
  executor: Executor,
  tenant: string,
  userId: number,
  betId: string
): Promise<void> {
  const rows = await (executor as any)
    .select({ id: walletLedger.id, meta: walletLedger.meta })
    .from(walletLedger)
    .where(
      and(
        eq(walletLedger.tenant, tenant),
        eq(walletLedger.userId, userId),
        eq(walletLedger.category, 'sports_bet')
      )
    )
  for (const r of rows) {
    const m = r.meta as { sportsBetIds?: string[] } | null | undefined
    if (!Array.isArray(m?.sportsBetIds) || m.sportsBetIds.length !== 1 || m.sportsBetIds[0] !== betId) {
      continue
    }
    await (executor as any).delete(walletLedger).where(eq(walletLedger.id, r.id))
  }
}

export async function deleteToolSportsBetHard(
  betId: string,
  tenant: string,
  userId: number,
  executor: Executor = pdb
): Promise<boolean> {
  const [bet] = await (executor as any).select().from(sportsBets).where(eqL(sportsBets.id, betId)).limit(1)
  if (!bet || !bet.excludeFromAdminRunning) {
    return false
  }
  if (bet.userId !== userId || bet.tenant !== tenant) {
    return false
  }
  if (bet.status !== 'matched' && bet.status !== 'unmatched') {
    return false
  }

  await deleteWalletLedgerSportsBetExposureRow(executor, tenant, bet.userId, betId)

  const del = await (executor as any).delete(sportsBets).where(eqL(sportsBets.id, betId)).returning({ id: sportsBets.id })
  return del.length > 0
}
