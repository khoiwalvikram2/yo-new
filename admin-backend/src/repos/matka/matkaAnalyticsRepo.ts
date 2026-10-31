import { db } from '@/db/client.js'
import { sql } from 'drizzle-orm'
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
} from '@/domains/matka/services/LiveAnalyticsService.js'

export interface MatkaLiveDashboardFilter {
  tenant: string
  whitelabelId: string
  agentId?: string
}

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
  
  // By Matka breakdown
  const byMatkaResult = await db.execute(sql`
    ${cte}
    SELECT
      mb.matka_id,
      COALESCE(SUM(CAST(mb.bet_amount AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(mb.actual_win, 0) AS DECIMAL)), 0) as payouts,
      COUNT(*) as bets
    FROM matka_bets mb
    WHERE mb.tenant = ${tenant}
      AND mb.whitelabel_id = ${whitelabelId}
      AND mb.status IN ('pending', 'active')
      ${userCondition}
    GROUP BY mb.matka_id
    ORDER BY wagered DESC
    LIMIT 100
  `)
  
  const byMatka: MatkaEntityStat[] = (byMatkaResult.rows || []).map((row: any) => ({
    matkaId: row.matka_id,
    matkaName: null, // Would need join with matkas table
    wagered: Number(row.wagered || 0),
    payouts: Number(row.payouts || 0),
    ggr: Number(row.wagered || 0) - Number(row.payouts || 0),
    bets: Number(row.bets || 0),
  }))
  
  // By Session breakdown
  const bySessionResult = await db.execute(sql`
    ${cte}
    SELECT
      mb.market_session,
      COALESCE(SUM(CAST(mb.bet_amount AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(mb.actual_win, 0) AS DECIMAL)), 0) as payouts,
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
    bets: Number(row.bets || 0),
  }))
  
  // Simplified breakdowns - byDigit and bySelection would need more complex logic
  const breakdown: MatkaLiveBreakdown = {
    byType,
    byMarket,
    byBidType,
    byMatka,
    bySession,
    byDigit: [], // Can be added later if needed
    bySelection: [], // Can be added later if needed
  }
  
  return { kpis, breakdown }
}

