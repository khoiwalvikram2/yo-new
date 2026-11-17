import { db } from '@/db/client.js'
import { sql } from 'drizzle-orm'
import { normalizeBid, normalizeSelection, type MatkaBid } from '@shared/matka/rules.js'
import { buildAgentFilterCTE } from '../common/AgentFilterUtils.js'
import type {
  MatkaLiveDashboard,
  MatkaLiveKpis,
  MatkaLiveBreakdown,
  MatkaTypeStat,
  MatkaMarketStat,
  MatkaBidTypeStat,
  MatkaEntityStat,
  MatkaSessionStat,
  MatkaDigitStat,
  MatkaSelectionStat,
  MatkaSelectionTotals,
} from '@/domains/matka/services/LiveAnalyticsService.js'

export interface MatkaLiveDashboardFilter {
  tenant: string
  whitelabelId: string
  agentId?: string
}

/**
 * What the open bets pay if they all win: each bet's potential win, or stake x rate for a legacy bet stored without
 * one. The KPI tile and the byMatka / bySession breakdowns use this one expression over the same open-bet rows, so
 * the breakdowns add up to the tile (MAT-13). `payouts` (actual_win) stays 0 until a bet settles.
 */
const POTENTIAL_PAYOUTS_SUM = sql`COALESCE(SUM(CAST(COALESCE(mb.potential_win, mb.bet_amount * mb.payout_multiplier) AS DECIMAL)), 0)`

/** The bids placed on one digit 0-9 (shared/matka/rules): Single Digit (the session's digit) and A / B (a result's first or second digit). */
const DIGIT_BIDS: ReadonlySet<MatkaBid> = new Set<MatkaBid>(['SINGLE', 'A', 'B'])
/**
 * The digit a bet is placed on, by the rules bets are placed and settled with, or null when its bid is not on one digit:
 * a Jodi or AB is on two, a Pana on three and a Sangam on a pair, and none of them wins on a digit alone, so splitting
 * their stake across digits would invent a figure. An unsupported legacy bid or selection is on no digit either.
 */
export function betDigit(bidType: string, selection: string): string | null {
  try {
    const bid = normalizeBid(bidType, selection)
    return DIGIT_BIDS.has(bid) ? normalizeSelection(bid, selection) : null
  } catch {
    return null
  }
}
/** The bySelection list sent with each frame: its riskiest selections (the Exposure Book also keeps 200 per market).
 *  selectionTotals counts every selection, so the page can say when the list is cut. */
const SELECTION_ROWS = 200
const cents = (value: number) => Math.round(value * 100) / 100

/**
 * Get live matka dashboard using SQL aggregation with agent filtering
 * Filters by open bets (pending/active status) instead of time window
 */
export async function getMatkaLiveDashboard(
  filter: MatkaLiveDashboardFilter
): Promise<MatkaLiveDashboard> {
  const { tenant, whitelabelId, agentId } = filter
  const { cte, userCondition } = buildAgentFilterCTE(agentId, tenant, 'mb.user_id')
  
  // KPIs query - open bets only
  const kpisResult = await db.execute(sql`
    ${cte}
    SELECT
      COUNT(*) as total_bets,
      COALESCE(SUM(CAST(mb.bet_amount AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(mb.actual_win, 0) AS DECIMAL)), 0) as payouts,
      ${POTENTIAL_PAYOUTS_SUM} as potential_payouts,
      COUNT(DISTINCT mb.user_id) as active_players,
      COUNT(*) FILTER (WHERE mb.created_at >= NOW() - INTERVAL '5 minutes') as recent_bets
    FROM matka_bets mb
    WHERE mb.tenant = ${tenant}
      AND mb.whitelabel_id = ${whitelabelId}
      AND mb.status IN ('pending', 'active')
      ${userCondition}
  `)
  
  const kpisRow = (kpisResult.rows?.[0] as any) || {}
  const wagered = Number(kpisRow.wagered || 0)
  const payouts = Number(kpisRow.payouts || 0)
  const ggr = wagered - payouts
  const rtp = wagered > 0 ? payouts / wagered : 0
  const betsPerMin = Number(kpisRow.recent_bets || 0) / 5
  
  const kpis: MatkaLiveKpis = {
    at: new Date().toISOString(),
    betsPerMin,
    wagered,
    payouts,
    ggr,
    rtp,
    // An open bet's actual_win stays NULL until settlement, so `payouts` is 0 here; what the open bets would
    // pay if they all won is their potential win (stake x rate for a legacy bet without one).
    potentialPayouts: Number(kpisRow.potential_payouts || 0),
    activePlayers: Number(kpisRow.active_players || 0),
  }
  
  // By Type breakdown
  const byTypeResult = await db.execute(sql`
    ${cte}
    SELECT
      mb.matka_type,
      COALESCE(SUM(CAST(mb.bet_amount AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(mb.actual_win, 0) AS DECIMAL)), 0) as payouts,
      COUNT(*) as bets
    FROM matka_bets mb
    WHERE mb.tenant = ${tenant}
      AND mb.whitelabel_id = ${whitelabelId}
      AND mb.status IN ('pending', 'active')
      ${userCondition}
    GROUP BY mb.matka_type
    ORDER BY wagered DESC
  `)
  
  const byType: MatkaTypeStat[] = (byTypeResult.rows || []).map((row: any) => ({
    matkaType: row.matka_type,
    wagered: Number(row.wagered || 0),
    payouts: Number(row.payouts || 0),
    ggr: Number(row.wagered || 0) - Number(row.payouts || 0),
    bets: Number(row.bets || 0),
  }))
  
  // By Market breakdown
  const byMarketResult = await db.execute(sql`
    ${cte}
    SELECT
      mb.market_name,
      COALESCE(SUM(CAST(mb.bet_amount AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(mb.actual_win, 0) AS DECIMAL)), 0) as payouts,
      COUNT(*) as bets
    FROM matka_bets mb
    WHERE mb.tenant = ${tenant}
      AND mb.whitelabel_id = ${whitelabelId}
      AND mb.status IN ('pending', 'active')
      ${userCondition}
    GROUP BY mb.market_name
    ORDER BY wagered DESC
    LIMIT 100
  `)
  
  const byMarket: MatkaMarketStat[] = (byMarketResult.rows || []).map((row: any) => ({
    marketName: row.market_name,
    wagered: Number(row.wagered || 0),
    payouts: Number(row.payouts || 0),
    ggr: Number(row.wagered || 0) - Number(row.payouts || 0),
    bets: Number(row.bets || 0),
  }))
  
  // By Bid Type breakdown
  const byBidTypeResult = await db.execute(sql`
    ${cte}
    SELECT
      mb.bid_type,
      COALESCE(SUM(CAST(mb.bet_amount AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(mb.actual_win, 0) AS DECIMAL)), 0) as payouts,
      COUNT(*) as bets
    FROM matka_bets mb
    WHERE mb.tenant = ${tenant}
      AND mb.whitelabel_id = ${whitelabelId}
      AND mb.status IN ('pending', 'active')
      ${userCondition}
    GROUP BY mb.bid_type
    ORDER BY wagered DESC
  `)
  
  const byBidType: MatkaBidTypeStat[] = (byBidTypeResult.rows || []).map((row: any) => ({
    bidType: row.bid_type,
    wagered: Number(row.wagered || 0),
    payouts: Number(row.payouts || 0),
    ggr: Number(row.wagered || 0) - Number(row.payouts || 0),
    bets: Number(row.bets || 0),
  }))
  
  // By Matka breakdown. Each row is named from the bets' own whitelabel (a deleted market keeps its name; its open
  // bets still count). The WHERE holds mb.tenant to one value, so grouping by it too still gives one row per market,
  // and the bets read and summed (FROM .. WHERE) stay exactly the KPI tile's own.
  const byMatkaResult = await db.execute(sql`
    ${cte}
    SELECT
      mb.matka_id,
      (SELECT m.name FROM matkas m WHERE m.id = mb.matka_id AND m.tenant = mb.tenant) as matka_name,
      COALESCE(SUM(CAST(mb.bet_amount AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(mb.actual_win, 0) AS DECIMAL)), 0) as payouts,
      ${POTENTIAL_PAYOUTS_SUM} as potential_payouts,
      COUNT(*) as bets
    FROM matka_bets mb
    WHERE mb.tenant = ${tenant}
      AND mb.whitelabel_id = ${whitelabelId}
      AND mb.status IN ('pending', 'active')
      ${userCondition}
    GROUP BY mb.matka_id, mb.tenant
    ORDER BY wagered DESC
    LIMIT 100
  `)
  
  const byMatka: MatkaEntityStat[] = (byMatkaResult.rows || []).map((row: any) => ({
    matkaId: row.matka_id,
    // It was always null, so the Matka Analytics card named markets by id ("Matka #4ac1da93").
    matkaName: row.matka_name ?? null,
    wagered: Number(row.wagered || 0),
    payouts: Number(row.payouts || 0),
    ggr: Number(row.wagered || 0) - Number(row.payouts || 0),
    potentialPayouts: Number(row.potential_payouts || 0),
    bets: Number(row.bets || 0),
  }))
  
  // By Session breakdown
  const bySessionResult = await db.execute(sql`
    ${cte}
    SELECT
      mb.market_session,
      COALESCE(SUM(CAST(mb.bet_amount AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(mb.actual_win, 0) AS DECIMAL)), 0) as payouts,
      ${POTENTIAL_PAYOUTS_SUM} as potential_payouts,
      COUNT(*) as bets
    FROM matka_bets mb
    WHERE mb.tenant = ${tenant}
      AND mb.whitelabel_id = ${whitelabelId}
      AND mb.status IN ('pending', 'active')
      ${userCondition}
    GROUP BY mb.market_session
    ORDER BY wagered DESC
  `)
  
  const bySession: MatkaSessionStat[] = (bySessionResult.rows || []).map((row: any) => ({
    marketSession: row.market_session,
    wagered: Number(row.wagered || 0),
    payouts: Number(row.payouts || 0),
    ggr: Number(row.wagered || 0) - Number(row.payouts || 0),
    potentialPayouts: Number(row.potential_payouts || 0),
    bets: Number(row.bets || 0),
  }))
  
  // By Selection: each selection's open book, grouped as the Exposure Book groups it (market, session, bid type and the
  // numbers bet), per matka. Exposure is what the selection pays if it wins above what was staked on it, floored at 0
  // (MAT-13). The KPI tile's own rows (FROM .. WHERE); every row is read, so the digit breakdown below is summed from
  // all of them before the list is cut to its riskiest selections.
  const bySelectionResult = await db.execute(sql`
    ${cte}
    SELECT
      mb.matka_id,
      (SELECT m.name FROM matkas m WHERE m.id = mb.matka_id AND m.tenant = mb.tenant) as matka_name,
      mb.market_name,
      mb.market_session,
      mb.bid_type,
      mb.bet_numbers as selection,
      COALESCE(SUM(CAST(mb.bet_amount AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(mb.actual_win, 0) AS DECIMAL)), 0) as payouts,
      ${POTENTIAL_PAYOUTS_SUM} as potential_payouts,
      GREATEST(${POTENTIAL_PAYOUTS_SUM} - COALESCE(SUM(CAST(mb.bet_amount AS DECIMAL)), 0), 0) as exposure,
      COUNT(*) as bets
    FROM matka_bets mb
    WHERE mb.tenant = ${tenant}
      AND mb.whitelabel_id = ${whitelabelId}
      AND mb.status IN ('pending', 'active')
      ${userCondition}
    GROUP BY mb.matka_id, mb.tenant, mb.market_name, mb.market_session, mb.bid_type, mb.bet_numbers
  `)

  const selectionRows = (bySelectionResult.rows || []).map((row: any) => ({
    stat: {
      selection: String(row.selection ?? ''),
      matkaId: row.matka_id,
      matkaName: row.matka_name ?? null,
      marketName: row.market_name,
      marketSession: row.market_session ?? null,
      bidType: row.bid_type,
      wagered: Number(row.wagered || 0),
      payouts: Number(row.payouts || 0),
      exposure: Number(row.exposure || 0),
      bets: Number(row.bets || 0),
    } as MatkaSelectionStat,
    potentialPayouts: Number(row.potential_payouts || 0),
  }))
  const tieBreak = (stat: MatkaSelectionStat) => [stat.marketName, stat.marketSession ?? '', stat.bidType, stat.selection, stat.matkaId].join('\u0000')
  const bySelection: MatkaSelectionStat[] = selectionRows
    .map((row) => row.stat)
    .sort((a, b) => b.exposure - a.exposure || b.wagered - a.wagered || b.bets - a.bets || tieBreak(a).localeCompare(tieBreak(b)))
    .slice(0, SELECTION_ROWS)
  // The Selection Risk card's totals (unique selections, total exposure, the concentration shares) are over every
  // selection, not over the rows sent: it summed bySelection, so past 200 selections its totals came up short (G502).
  const totalsSum = selectionRows.reduce((sum, { stat }) => {
    sum.wagered += stat.wagered; sum.payouts += stat.payouts; sum.exposure += stat.exposure; sum.bets += stat.bets
    return sum
  }, { wagered: 0, payouts: 0, exposure: 0, bets: 0 })
  const selectionTotals: MatkaSelectionTotals = {
    selections: selectionRows.length,
    wagered: cents(totalsSum.wagered),
    payouts: cents(totalsSum.payouts),
    exposure: cents(totalsSum.exposure),
    bets: totalsSum.bets,
  }

  // By Digit: the open bets placed on one digit (Single Digit, A and B), per digit 0-9, summed over every market and
  // session from the same rows. Exposure is what they pay if they win above their stake, floored at 0, as above.
  const digitSums = new Map<string, { wagered: number; payouts: number; potentialPayouts: number; bets: number }>()
  for (const { stat, potentialPayouts } of selectionRows) {
    const digit = betDigit(stat.bidType, stat.selection)
    if (digit === null) continue
    const sum = digitSums.get(digit) ?? { wagered: 0, payouts: 0, potentialPayouts: 0, bets: 0 }
    sum.wagered += stat.wagered; sum.payouts += stat.payouts; sum.potentialPayouts += potentialPayouts; sum.bets += stat.bets
    digitSums.set(digit, sum)
  }
  const byDigit: MatkaDigitStat[] = [...digitSums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([digit, sum]) => ({
      digit,
      wagered: cents(sum.wagered),
      payouts: cents(sum.payouts),
      exposure: cents(Math.max(0, sum.potentialPayouts - sum.wagered)),
      bets: sum.bets,
    }))

  const breakdown: MatkaLiveBreakdown = {
    byType,
    byMarket,
    byBidType,
    byMatka,
    bySession,
    byDigit,
    bySelection,
    selectionTotals,
  }

  return { kpis, breakdown }
}

