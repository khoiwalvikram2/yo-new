import { useMemo } from 'react'
import { gql, useQuery } from '@apollo/client'
import dayjs from 'dayjs'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { nowIST } from '@/shared/utils/date'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import type { CasinoBet } from '../../casinoLiveModel'
import styles from '../../CasinoLive.module.css'
const CASINO_BETS_QUERY = gql`
  query CasinoBets($query: CasinoBetsQuery) {
    casinoBets(query: $query) {
      userId
      userName
      stake
      payout
      createdAt
      gameId
      gameName
      status
    }
  }
`

interface PlayerPerformanceWidgetProps {
  windowMins?: number
}

export function PlayerPerformanceWidget({ windowMins = 60 }: PlayerPerformanceWidgetProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  const dateFrom = useMemo(() => {
    return nowIST().subtract(windowMins, 'minute').toISOString()
  }, [windowMins])

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data, loading } = useQuery<{ casinoBets: CasinoBet[] }>(CASINO_BETS_QUERY, {
    variables: {
      query: {
        dateFrom,
        limit: 5000,
      },
    },
    pollInterval: 10000,
    fetchPolicy: "network-only",
  })

  const performance = useMemo(() => {
    const bets = data?.casinoBets || []
    const playerMap = new Map<string, {
      userId: string
      userName: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
      wins: number
      losses: number
      games: Set<string>
      sessions: Set<string>
      firstBet: string
      lastBet: string
      maxBet: number
      minBet: number
    }>()

    bets.forEach((bet: CasinoBet) => {
      const userId = String(bet.userId)
      const stats = playerMap.get(userId) || {
        userId,
        userName: bet.userName || `User #${userId}`,
        wagered: 0,
        payouts: 0,
        ggr: 0,
        bets: 0,
        wins: 0,
        losses: 0,
        games: new Set<string>(),
        sessions: new Set<string>(),
        firstBet: bet.createdAt,
        lastBet: bet.createdAt,
        maxBet: 0,
        minBet: Infinity,
      }

      const stake = Number(bet.stake || 0)
      const payout = Number(bet.payout || 0)
      
      stats.wagered += stake
      stats.payouts += payout
      stats.bets += 1
      
      if (payout > stake) {
        stats.wins += 1
      } else if (payout < stake) {
        stats.losses += 1
      }
      
      if (bet.gameId) {
        stats.games.add(String(bet.gameId))
      }
      
      // Estimate sessions (group by hour)
      const sessionKey = dayjs(bet.createdAt).format('YYYY-MM-DD-HH')
      stats.sessions.add(sessionKey)
      
      if (dayjs(bet.createdAt).isBefore(dayjs(stats.firstBet))) {
        stats.firstBet = bet.createdAt
      }
      if (dayjs(bet.createdAt).isAfter(dayjs(stats.lastBet))) {
        stats.lastBet = bet.createdAt
      }
      
      if (stake > stats.maxBet) stats.maxBet = stake
      if (stake < stats.minBet) stats.minBet = stake
      
      playerMap.set(userId, stats)
    })

    const players = Array.from(playerMap.values()).map(stats => ({
      ...stats,
      ggr: stats.wagered - stats.payouts,
      rtp: stats.wagered > 0 ? (stats.payouts / stats.wagered) * 100 : 0,
      avgBet: stats.bets > 0 ? stats.wagered / stats.bets : 0,
      winRate: stats.bets > 0 ? (stats.wins / stats.bets) * 100 : 0,
      gamesPlayed: stats.games.size,
      sessionCount: stats.sessions.size,
      avgSessionValue: stats.sessions.size > 0 ? stats.ggr / stats.sessions.size : 0,
      minBet: stats.minBet === Infinity ? 0 : stats.minBet,
    }))

    const totalGGR = players.reduce((sum, p) => sum + p.ggr, 0)
    const totalWagered = players.reduce((sum, p) => sum + p.wagered, 0)
    const totalPayouts = players.reduce((sum, p) => sum + p.payouts, 0)
    const totalBets = bets.length
    const totalPlayers = players.length
    const totalWins = players.reduce((sum, p) => sum + p.wins, 0)

    // Top contributors
    const topContributors = [...players]
      .sort((a, b) => b.ggr - a.ggr)
      .slice(0, 5)

    // Top wagered
    const topWagered = [...players]
      .sort((a, b) => b.wagered - a.wagered)
      .slice(0, 3)

    // Profitability
    const profitable = players.filter(p => p.ggr > 0).length
    const unprofitable = players.filter(p => p.ggr < 0).length
    const breakEven = players.filter(p => p.ggr === 0).length

    // Averages
    const avgRTP = totalPlayers > 0 ? players.reduce((sum, p) => sum + p.rtp, 0) / totalPlayers : 0
    const avgBetSize = totalBets > 0 ? totalWagered / totalBets : 0
    const avgGGRPerPlayer = totalPlayers > 0 ? totalGGR / totalPlayers : 0
    const avgBetsPerPlayer = totalPlayers > 0 ? totalBets / totalPlayers : 0
    const overallWinRate = totalBets > 0 ? (totalWins / totalBets) * 100 : 0

    // Player segments
    const highRollers = players.filter(p => p.avgBet >= avgBetSize * 2).length
    const regularPlayers = players.filter(p => p.avgBet < avgBetSize * 2 && p.avgBet >= avgBetSize * 0.5).length
    const lowStakes = players.filter(p => p.avgBet < avgBetSize * 0.5).length

    return {
      totalPlayers,
      totalGGR,
      totalWagered,
      totalPayouts,
      totalBets,
      topContributors,
      topWagered,
      profitable,
      unprofitable,
      breakEven,
      profitablePercentage: totalPlayers > 0 ? (profitable / totalPlayers) * 100 : 0,
      avgRTP,
      avgBetSize,
      avgGGRPerPlayer,
      avgBetsPerPlayer,
      overallWinRate,
      highRollers,
      regularPlayers,
      lowStakes,
    }
  }, [data])


  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const pending = loading && !data
  return <Card title="Player Performance"><div className={styles.stack}><h3 className={styles.heading}>Player Segments</h3><div className={styles.grid3} aria-busy={pending || undefined}><Stat variant="bare" label="High Rollers" value={performance.highRollers} size="compact" loading={pending} /><Stat variant="bare" label="Regular" value={performance.regularPlayers} size="compact" hue="blu" loading={pending} /><Stat variant="bare" label="Low Stakes" value={performance.lowStakes} size="compact" loading={pending} /></div>
    {performance.topContributors.length > 0 && <><h3 className={styles.heading}>Top GGR Contributors</h3>{performance.topContributors.map((player, index) => <article key={player.userId} className={styles.details}><div className={styles.feedTop}><div className={styles.actions}><StatusPill tone="info">#{index + 1}</StatusPill><strong>{player.userName}</strong></div><strong className={player.ggr >= 0 ? styles.positive : styles.negative}>{fmt(player.ggr)}</strong></div><div className={styles.actions}><span className={styles.muted}>{player.bets} bets</span><span className={styles.muted}>RTP: {player.rtp.toFixed(1)}%</span><span className={styles.muted}>Avg: {fmt(player.avgBet)}</span></div></article>)}</>}
  </div></Card>
}

