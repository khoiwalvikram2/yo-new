import { useMemo } from 'react'
import { gql, useQuery } from '@apollo/client'
import dayjs from 'dayjs'
import { nowIST } from '@/shared/utils/date'
import { Card } from '@/ui/components/Card'
import { LoadingState } from '@/ui/components/LoadingState'
import { HeatmapStrip } from '../../components/HeatmapStrip'
import type { CasinoBet } from '../../casinoLiveModel'
const CASINO_BETS_QUERY = gql`
  query CasinoBets($query: CasinoBetsQuery) {
    casinoBets(query: $query) {
      userId
      userName
      createdAt
    }
  }
`


interface PlayerHeatmapWidgetProps { windowMins?: number }
export function PlayerHeatmapWidget({ windowMins = 1440 }: PlayerHeatmapWidgetProps) {
  const dateFrom = useMemo(() => nowIST().subtract(windowMins, 'minute').toISOString(), [windowMins])
  const { data, loading } = useQuery<{ casinoBets: CasinoBet[] }>(CASINO_BETS_QUERY, { variables: { query: { dateFrom, limit: 10000 } }, pollInterval: 30000 })
  const heatmapData = useMemo(() => {
    const bets = data?.casinoBets || []
    
    // Group by player
    const playerActivity = new Map<string, {
      userId: string
      userName: string
      bets: number
      firstBet: string
      lastBet: string
    }>()

    bets.forEach((bet: CasinoBet) => {
      const userId = String(bet.userId)
      const stats = playerActivity.get(userId) || {
        userId,
        userName: bet.userName || `User #${userId}`,
        bets: 0,
        firstBet: bet.createdAt,
        lastBet: bet.createdAt,
      }

      stats.bets += 1
      if (dayjs(bet.createdAt).isBefore(dayjs(stats.firstBet))) {
        stats.firstBet = bet.createdAt
      }
      if (dayjs(bet.createdAt).isAfter(dayjs(stats.lastBet))) {
        stats.lastBet = bet.createdAt
      }

      playerActivity.set(userId, stats)
    })

    const players = Array.from(playerActivity.values())
      .sort((a, b) => b.bets - a.bets)
      .slice(0, 50) // Top 50 most active players

    const maxBets = Math.max(...players.map(p => p.bets), 1)

    return players.map(player => ({
      ...player,
      intensity: (player.bets / maxBets) * 100,
    }))
  }, [data])


  if (loading) return <Card title="Player Activity Heatmap"><LoadingState label="Loading..." /></Card>
  return <HeatmapStrip title="Player Activity Heatmap" empty="No activity data" items={heatmapData.map(player => ({ id: player.userId, name: player.userName, bets: player.bets, intensity: player.intensity, detail: <><span>Bets: {player.bets.toLocaleString()}</span><span>Activity: {player.intensity.toFixed(1)}%</span></> }))} />
}

