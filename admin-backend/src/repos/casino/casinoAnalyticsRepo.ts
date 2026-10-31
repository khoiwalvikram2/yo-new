import { db } from '@/db/client.js'
import { sql } from 'drizzle-orm'
import { buildAgentFilterCTE } from '../common/AgentFilterUtils.js'
import type {
  CasinoLiveDashboard,
  CasinoLiveKpis,
  CasinoLiveBreakdown,
  CasinoGameStat,
  CasinoProviderStat,
  CasinoVendorStat,
} from '@/domains/casino/services/LiveAnalyticsService.js'

export interface CasinoLiveDashboardFilter {
  tenant: string
  whitelabelId: string
  windowMins?: number
  agentId?: string
}

/**
 * Get live casino dashboard using SQL aggregation with agent filtering
 */
export async function getCasinoLiveDashboard(
  filter: CasinoLiveDashboardFilter
): Promise<CasinoLiveDashboard> {
  const { tenant, whitelabelId, windowMins = 5, agentId } = filter
  const { cte, userCondition } = buildAgentFilterCTE(agentId, tenant, 'cb.user_id')
  
  const from = new Date(Date.now() - windowMins * 60_000)
  
  // KPIs query
  const kpisResult = await db.execute(sql`
    ${cte}
    SELECT
      COUNT(*) as total_bets,
      COALESCE(SUM(CAST(cb.stake AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(cb.payout, cb.win_amount, 0) AS DECIMAL)), 0) as payouts,
      COUNT(DISTINCT cb.user_id) as active_players
    FROM casino_bets cb
    WHERE cb.tenant = ${tenant}
      AND cb.whitelabel_id = ${whitelabelId}
      AND cb.created_at >= ${from.toISOString()}
      ${userCondition}
  `)
  
  const kpisRow = (kpisResult.rows?.[0] as any) || {}
  const wagered = Number(kpisRow.wagered || 0)
  const payouts = Number(kpisRow.payouts || 0)
  const ggr = wagered - payouts
  const rtp = wagered > 0 ? payouts / wagered : 0
  const betsPerMin = windowMins > 0 ? Number(kpisRow.total_bets || 0) / windowMins : Number(kpisRow.total_bets || 0)
  
  const kpis: CasinoLiveKpis = {
    at: new Date().toISOString(),
    betsPerMin,
    wagered,
    payouts,
    ggr,
    rtp,
    activePlayers: Number(kpisRow.active_players || 0),
  }
  
  // By Game breakdown
  const byGameResult = await db.execute(sql`
    ${cte}
    SELECT
      cb.game_id,
      cb.game_name,
      COALESCE(SUM(CAST(cb.stake AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(cb.payout, cb.win_amount, 0) AS DECIMAL)), 0) as payouts,
      COUNT(*) as bets
    FROM casino_bets cb
    WHERE cb.tenant = ${tenant}
      AND cb.whitelabel_id = ${whitelabelId}
      AND cb.created_at >= ${from.toISOString()}
      ${userCondition}
    GROUP BY cb.game_id, cb.game_name
    ORDER BY wagered DESC
    LIMIT 100
  `)
  
  // Get game thumbnails for top games
  const topGameIds = (byGameResult.rows || [])
    .slice(0, 100)
    .map((row: any) => Number(row.game_id))
    .filter((id: number) => !isNaN(id))
  
  const gameDetailsMap = new Map<number, { thumbnailUrl?: string | null }>()
  if (topGameIds.length > 0) {
    try {
      const { getCasinoGamesByIdsDb } = await import('./casinoRepo.js')
      const gameDetails = await getCasinoGamesByIdsDb(tenant, topGameIds)
      for (const game of gameDetails) {
        gameDetailsMap.set(game.id, { thumbnailUrl: game.thumbnailUrl || null })
      }
    } catch (error) {
    }
  }
  
  const byGame: CasinoGameStat[] = (byGameResult.rows || []).map((row: any) => {
    const gameIdNum = Number(row.game_id)
    const details = gameDetailsMap.get(gameIdNum)
    return {
      gameId: String(row.game_id),
      gameName: row.game_name || null,
      thumbnailUrl: details?.thumbnailUrl || null,
      wagered: Number(row.wagered || 0),
      payouts: Number(row.payouts || 0),
      ggr: Number(row.wagered || 0) - Number(row.payouts || 0),
      bets: Number(row.bets || 0),
    }
  })
  
  // By Provider breakdown
  const byProviderResult = await db.execute(sql`
    ${cte}
    SELECT
      cb.provider_id,
      COALESCE(SUM(CAST(cb.stake AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(cb.payout, cb.win_amount, 0) AS DECIMAL)), 0) as payouts,
      COUNT(*) as bets
    FROM casino_bets cb
    WHERE cb.tenant = ${tenant}
      AND cb.whitelabel_id = ${whitelabelId}
      AND cb.created_at >= ${from.toISOString()}
      AND cb.provider_id IS NOT NULL
      ${userCondition}
    GROUP BY cb.provider_id
    ORDER BY wagered DESC
    LIMIT 100
  `)
  
  const byProvider: CasinoProviderStat[] = (byProviderResult.rows || []).map((row: any) => ({
    providerId: String(row.provider_id),
    providerName: null, // Would need join with casino_api_providers
    wagered: Number(row.wagered || 0),
    payouts: Number(row.payouts || 0),
    ggr: Number(row.wagered || 0) - Number(row.payouts || 0),
    bets: Number(row.bets || 0),
  }))
  
  // By Vendor breakdown
  const byVendorResult = await db.execute(sql`
    ${cte}
    SELECT
      cb.vendor_id,
      cb.vendor_name,
      COALESCE(SUM(CAST(cb.stake AS DECIMAL)), 0) as wagered,
      COALESCE(SUM(CAST(COALESCE(cb.payout, cb.win_amount, 0) AS DECIMAL)), 0) as payouts,
      COUNT(*) as bets
    FROM casino_bets cb
    WHERE cb.tenant = ${tenant}
      AND cb.whitelabel_id = ${whitelabelId}
      AND cb.created_at >= ${from.toISOString()}
      ${userCondition}
    GROUP BY cb.vendor_id, cb.vendor_name
    ORDER BY wagered DESC
    LIMIT 100
  `)
  
  const byVendor: CasinoVendorStat[] = (byVendorResult.rows || []).map((row: any) => ({
    vendorId: String(row.vendor_id),
    vendorName: row.vendor_name || null,
    wagered: Number(row.wagered || 0),
    payouts: Number(row.payouts || 0),
    ggr: Number(row.wagered || 0) - Number(row.payouts || 0),
    bets: Number(row.bets || 0),
  }))
  
  const breakdown: CasinoLiveBreakdown = {
    byGame,
    byProvider,
    byVendor,
  }
  
  return { kpis, breakdown }
}

