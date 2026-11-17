import { db } from '@/db/client.js'
import { sql } from 'drizzle-orm'
import { buildAgentFilterCTE } from '../common/AgentFilterUtils.js'
import type {
  SportsLiveDashboard,
  SportsLiveKpis,
  SportsLiveBreakdown,
  SportsSportStat,
  SportsLeagueStat,
  SportsEventStat,
  SportsMarketTypeStat,
  SportsBetSideStat,
} from '@/domains/sports/services/LiveAnalyticsService.js'

export interface SportsLiveDashboardFilter {
  tenant: string
  whitelabelId: string
  agentId?: string
}

/**
 * Get live dashboard using SQL aggregation with agent filtering
 * Much faster than fetching 50K rows and aggregating in JavaScript
 *
 * Total stake sums the bets' stakes and total liability their liabilities. Every total_stake below used to
 * be a copy of the liability sum, so the page showed Total Stake equal to Liability (20,490 for 19,000 of
 * stakes), drew the two as one line and divided the exposure ratio by the wrong figure.
 */
export async function getSportsLiveDashboard(
  filter: SportsLiveDashboardFilter
): Promise<SportsLiveDashboard> {
  const { tenant, whitelabelId, agentId } = filter
  const { cte, userCondition } = buildAgentFilterCTE(agentId, tenant, 'sb.user_id')
  
  // KPIs query - single aggregation
  const kpisResult = await db.execute(sql`
    ${cte}
    SELECT
      COALESCE(SUM(CAST(sb.stake AS DECIMAL)), 0) as total_stake,
      COALESCE(SUM(CAST(sb.liability AS DECIMAL)), 0) as total_liability,
      COUNT(DISTINCT sb.market_id) as active_markets,
      COUNT(DISTINCT sb.user_id) as active_players,
      COUNT(*) FILTER (WHERE sb.side = 'back') as back_bets,
      COUNT(*) FILTER (WHERE sb.side = 'lay') as lay_bets,
      COALESCE(AVG(CAST(sb.price AS DECIMAL)), 0) as avg_odds,
      COUNT(*) FILTER (WHERE sb.created_at >= NOW() - INTERVAL '5 minutes') as recent_bets
    FROM sports_bets sb
    INNER JOIN sports_markets sm ON sb.market_id = sm.id
    WHERE sb.tenant = ${tenant}
      AND sb.whitelabel_id = ${whitelabelId}
      AND sb.status IN ('matched', 'unmatched')
      AND sm.status = 'active'
      ${userCondition}
  `)
  
  const kpisRow = (kpisResult.rows?.[0] as any) || {}
  
  // Calculate exposures
  const backLiability = await db.execute(sql`
    ${cte}
    SELECT COALESCE(SUM(CAST(sb.liability AS DECIMAL)), 0) as back_liability
    FROM sports_bets sb
    INNER JOIN sports_markets sm ON sb.market_id = sm.id
    WHERE sb.tenant = ${tenant}
      AND sb.whitelabel_id = ${whitelabelId}
      AND sb.status IN ('matched', 'unmatched')
      AND sm.status = 'active'
      AND sb.side = 'back'
      ${userCondition}
  `)
  
  const layLiability = await db.execute(sql`
    ${cte}
    SELECT COALESCE(SUM(CAST(sb.liability AS DECIMAL)), 0) as lay_liability
    FROM sports_bets sb
    INNER JOIN sports_markets sm ON sb.market_id = sm.id
    WHERE sb.tenant = ${tenant}
      AND sb.whitelabel_id = ${whitelabelId}
      AND sb.status IN ('matched', 'unmatched')
      AND sm.status = 'active'
      AND sb.side = 'lay'
      ${userCondition}
  `)
  
  const backLiab = Number((backLiability.rows?.[0] as any)?.back_liability || 0)
  const layLiab = Number((layLiability.rows?.[0] as any)?.lay_liability || 0)
  const netExposure = backLiab - layLiab
  const grossExposure = backLiab + layLiab
  
  const kpis: SportsLiveKpis = {
    at: new Date().toISOString(),
    totalStake: Number(kpisRow.total_stake || 0),
    totalLiability: Number(kpisRow.total_liability || 0),
    netExposure,
    grossExposure,
    activeMarkets: Number(kpisRow.active_markets || 0),
    activePlayers: Number(kpisRow.active_players || 0),
    betsPerMin: Number(kpisRow.recent_bets || 0) / 5,
    avgOdds: Number(kpisRow.avg_odds || 0),
    backBets: Number(kpisRow.back_bets || 0),
    layBets: Number(kpisRow.lay_bets || 0),
  }
  
  // By Sport breakdown
  const bySportResult = await db.execute(sql`
    ${cte}
    SELECT
      sb.sport_id,
      s.name as sport_name,
      COALESCE(SUM(CAST(sb.stake AS DECIMAL)), 0) as total_stake,
      COALESCE(SUM(CAST(sb.liability AS DECIMAL)), 0) as total_liability,
      SUM(CASE 
        WHEN sb.side = 'back' THEN CAST(sb.liability AS DECIMAL)
        ELSE -CAST(sb.liability AS DECIMAL)
      END) as net_exposure,
      COUNT(*) as bets
    FROM sports_bets sb
    INNER JOIN sports_markets sm ON sb.market_id = sm.id
    INNER JOIN sports s ON sb.sport_id = s.id
    WHERE sb.tenant = ${tenant}
      AND sb.whitelabel_id = ${whitelabelId}
      AND sb.status IN ('matched', 'unmatched')
      AND sm.status = 'active'
      ${userCondition}
    GROUP BY sb.sport_id, s.name
    ORDER BY total_stake DESC
    LIMIT 100
  `)
  
  const bySport: SportsSportStat[] = (bySportResult.rows || []).map((row: any) => ({
    sportId: row.sport_id,
    sportName: row.sport_name,
    totalStake: Number(row.total_stake || 0),
    totalLiability: Number(row.total_liability || 0),
    netExposure: Number(row.net_exposure || 0),
    bets: Number(row.bets || 0),
  }))
  
  // By League breakdown
  const byLeagueResult = await db.execute(sql`
    ${cte}
    SELECT
      sb.league_id,
      l.name as league_name,
      COALESCE(SUM(CAST(sb.stake AS DECIMAL)), 0) as total_stake,
      COALESCE(SUM(CAST(sb.liability AS DECIMAL)), 0) as total_liability,
      SUM(CASE 
        WHEN sb.side = 'back' THEN CAST(sb.liability AS DECIMAL)
        ELSE -CAST(sb.liability AS DECIMAL)
      END) as net_exposure,
      COUNT(*) as bets
    FROM sports_bets sb
    INNER JOIN sports_markets sm ON sb.market_id = sm.id
    INNER JOIN sports_leagues l ON sb.league_id = l.id
    WHERE sb.tenant = ${tenant}
      AND sb.whitelabel_id = ${whitelabelId}
      AND sb.status IN ('matched', 'unmatched')
      AND sm.status = 'active'
      ${userCondition}
    GROUP BY sb.league_id, l.name
    ORDER BY total_stake DESC
    LIMIT 100
  `)
  
  const byLeague: SportsLeagueStat[] = (byLeagueResult.rows || []).map((row: any) => ({
    leagueId: row.league_id,
    leagueName: row.league_name,
    totalStake: Number(row.total_stake || 0),
    totalLiability: Number(row.total_liability || 0),
    netExposure: Number(row.net_exposure || 0),
    bets: Number(row.bets || 0),
  }))
  
  // By Event breakdown
  const byEventResult = await db.execute(sql`
    ${cte}
    SELECT
      sb.event_id,
      e.name as event_name,
      COALESCE(SUM(CAST(sb.stake AS DECIMAL)), 0) as total_stake,
      COALESCE(SUM(CAST(sb.liability AS DECIMAL)), 0) as total_liability,
      SUM(CASE 
        WHEN sb.side = 'back' THEN CAST(sb.liability AS DECIMAL)
        ELSE -CAST(sb.liability AS DECIMAL)
      END) as net_exposure,
      COUNT(*) as bets
    FROM sports_bets sb
    INNER JOIN sports_markets sm ON sb.market_id = sm.id
    INNER JOIN sports_events e ON sb.event_id = e.id
    WHERE sb.tenant = ${tenant}
      AND sb.whitelabel_id = ${whitelabelId}
      AND sb.status IN ('matched', 'unmatched')
      AND sm.status = 'active'
      ${userCondition}
    GROUP BY sb.event_id, e.name
    ORDER BY total_stake DESC
    LIMIT 100
  `)
  
  const byEvent: SportsEventStat[] = (byEventResult.rows || []).map((row: any) => ({
    eventId: row.event_id,
    eventName: row.event_name,
    totalStake: Number(row.total_stake || 0),
    totalLiability: Number(row.total_liability || 0),
    netExposure: Number(row.net_exposure || 0),
    bets: Number(row.bets || 0),
  }))
  
  // By Market Type breakdown
  const byMarketTypeResult = await db.execute(sql`
    ${cte}
    SELECT
      CASE 
        WHEN LOWER(sm.type) LIKE '%fancy%' THEN 'fancy'
        WHEN LOWER(sm.type) LIKE '%bookmaker%' OR LOWER(sm.type) LIKE '%book%' THEN 'bookmaker'
        ELSE 'exchange'
      END as market_type,
      COALESCE(SUM(CAST(sb.stake AS DECIMAL)), 0) as total_stake,
      COALESCE(SUM(CAST(sb.liability AS DECIMAL)), 0) as total_liability,
      SUM(CASE 
        WHEN sb.side = 'back' THEN CAST(sb.liability AS DECIMAL)
        ELSE -CAST(sb.liability AS DECIMAL)
      END) as net_exposure,
      COUNT(*) as bets
    FROM sports_bets sb
    INNER JOIN sports_markets sm ON sb.market_id = sm.id
    WHERE sb.tenant = ${tenant}
      AND sb.whitelabel_id = ${whitelabelId}
      AND sb.status IN ('matched', 'unmatched')
      AND sm.status = 'active'
      ${userCondition}
    GROUP BY 
      CASE 
        WHEN LOWER(sm.type) LIKE '%fancy%' THEN 'fancy'
        WHEN LOWER(sm.type) LIKE '%bookmaker%' OR LOWER(sm.type) LIKE '%book%' THEN 'bookmaker'
        ELSE 'exchange'
      END
    ORDER BY total_stake DESC
  `)
  
  const byMarketType: SportsMarketTypeStat[] = (byMarketTypeResult.rows || []).map((row: any) => ({
    marketType: row.market_type as 'exchange' | 'bookmaker' | 'fancy',
    totalStake: Number(row.total_stake || 0),
    totalLiability: Number(row.total_liability || 0),
    netExposure: Number(row.net_exposure || 0),
    bets: Number(row.bets || 0),
  }))
  
  // By Bet Side breakdown
  const byBetSideResult = await db.execute(sql`
    ${cte}
    SELECT
      sb.side,
      COALESCE(SUM(CAST(sb.stake AS DECIMAL)), 0) as total_stake,
      COALESCE(SUM(CAST(sb.liability AS DECIMAL)), 0) as total_liability,
      COUNT(*) as bets
    FROM sports_bets sb
    INNER JOIN sports_markets sm ON sb.market_id = sm.id
    WHERE sb.tenant = ${tenant}
      AND sb.whitelabel_id = ${whitelabelId}
      AND sb.status IN ('matched', 'unmatched')
      AND sm.status = 'active'
      ${userCondition}
    GROUP BY sb.side
  `)
  
  const byBetSide: SportsBetSideStat[] = (byBetSideResult.rows || []).map((row: any) => ({
    side: row.side as 'back' | 'lay',
    totalStake: Number(row.total_stake || 0),
    totalLiability: Number(row.total_liability || 0),
    bets: Number(row.bets || 0),
  }))
  
  const breakdown: SportsLiveBreakdown = {
    bySport,
    byLeague,
    byEvent,
    byMarketType,
    byBetSide,
  }
  
  return { kpis, breakdown }
}

