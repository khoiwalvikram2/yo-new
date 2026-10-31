import { useMemo } from 'react'
import { gql, useQuery } from '@apollo/client'
import dayjs from 'dayjs'
import { nowIST } from '@/shared/utils/date'
import { Card } from '@/ui/components/Card'
import { useCurrency } from '@/shared/core/CurrencyContext'
import type { CasinoBet } from '../../casinoLiveModel'
import styles from '../../CasinoLive.module.css'
import { Stat } from '@/ui/components/Stat'
import { Meter } from '@/ui/components/Meter'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
const CASINO_BETS_QUERY = gql`
  query CasinoBets($query: CasinoBetsQuery) {
    casinoBets(query: $query) {
      userId
      userName
      stake
      payout
      createdAt
    }
  }
`

interface PlayerProfitabilityProps {
  windowMins?: number
}

export function PlayerProfitability({ windowMins = 1440 }: PlayerProfitabilityProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  const dateFrom = useMemo(() => {
    return nowIST().subtract(windowMins, 'minute').toISOString()
  }, [windowMins])

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data, loading } = useQuery<{ casinoBets: CasinoBet[] }>(CASINO_BETS_QUERY, {
    variables: {
      query: {
        dateFrom,
        limit: 10000,
      },
    },
    pollInterval: 30000,
    fetchPolicy: "network-only",
  })

  const profitability = useMemo(() => {
    const bets = data?.casinoBets || []
    const playerMap = new Map<string, {
      userId: string
      userName: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
      sessions: Set<string>
      firstBet: string
      lastBet: string
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
        sessions: new Set<string>(),
        firstBet: bet.createdAt,
        lastBet: bet.createdAt,
      }

      stats.wagered += Number(bet.stake) || 0
      stats.payouts += Number(bet.payout) || 0
      stats.bets += 1

      // Estimate sessions (group by hour)
      const sessionKey = dayjs(bet.createdAt).format('YYYY-MM-DD-HH')
      stats.sessions.add(sessionKey)

      if (dayjs(bet.createdAt).isBefore(dayjs(stats.firstBet))) {
        stats.firstBet = bet.createdAt
      }
      if (dayjs(bet.createdAt).isAfter(dayjs(stats.lastBet))) {
        stats.lastBet = bet.createdAt
      }

      playerMap.set(userId, stats)
    })

    const players = Array.from(playerMap.values()).map(stats => ({
      ...stats,
      ggr: stats.wagered - stats.payouts,
      sessionCount: stats.sessions.size,
      lifetime: dayjs(stats.lastBet).diff(dayjs(stats.firstBet), 'day'),
      ltv: stats.wagered - stats.payouts, // Simple LTV (GGR)
      avgSessionValue: stats.sessions.size > 0 ? (stats.wagered - stats.payouts) / stats.sessions.size : 0,
    }))

    const totalGGR = players.reduce((sum, p) => sum + p.ggr, 0)
    const totalWagered = players.reduce((sum, p) => sum + p.wagered, 0)
    const totalPlayers = players.length

    // Top contributors
    const topContributors = [...players]
      .sort((a, b) => b.ggr - a.ggr)
      .slice(0, 10)
      .map((p, idx) => ({
        ...p,
        rank: idx + 1,
        contribution: totalGGR > 0 ? (p.ggr / totalGGR) * 100 : 0,
      }))

    // Profitability segments
    const profitable = players.filter(p => p.ggr > 0).length
    const breakEven = players.filter(p => p.ggr === 0).length
    const unprofitable = players.filter(p => p.ggr < 0).length

    // Average metrics
    const avgGGR = totalPlayers > 0 ? totalGGR / totalPlayers : 0
    const avgLTV = totalPlayers > 0 ? players.reduce((sum, p) => sum + p.ltv, 0) / totalPlayers : 0
    const avgSessions = totalPlayers > 0 ? players.reduce((sum, p) => sum + p.sessionCount, 0) / totalPlayers : 0

    return {
      totalPlayers,
      totalGGR,
      totalWagered,
      topContributors,
      segments: {
        profitable,
        breakEven,
        unprofitable,
        profitablePercentage: totalPlayers > 0 ? (profitable / totalPlayers) * 100 : 0,
      },
      averages: {
        ggr: avgGGR,
        ltv: avgLTV,
        sessions: avgSessions,
      },
    }
  }, [data])

  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const pending = loading && !data
  return <div className={styles.stack}><div className={styles.grid4} aria-busy={pending || undefined}>
    <Stat label="Total Players" value={profitability.totalPlayers} hue="blu" loading={pending} />
    <Stat label="Total GGR" value={fmt(profitability.totalGGR)} hue="grn" loading={pending} />
    <Stat label="Avg LTV" value={fmt(profitability.averages.ltv)} hue="blu" loading={pending} />
    <Stat label="Avg Sessions" value={profitability.averages.sessions.toFixed(1)} hue="amb" loading={pending} />
  </div><Card title="Profitability Segments"><div className={styles.grid3} aria-busy={pending || undefined}>
    <Stat variant="bare" label="Profitable" value={profitability.segments.profitable} note={`${profitability.segments.profitablePercentage.toFixed(1)}%`} loading={pending} />
    <Stat variant="bare" label="Break Even" value={profitability.segments.breakEven} note={`${profitability.totalPlayers > 0 ? ((profitability.segments.breakEven / profitability.totalPlayers) * 100).toFixed(1) : 0}%`} loading={pending} />
    <Stat variant="bare" label="Unprofitable" value={profitability.segments.unprofitable} note={`${profitability.totalPlayers > 0 ? ((profitability.segments.unprofitable / profitability.totalPlayers) * 100).toFixed(1) : 0}%`} hue="red" loading={pending} />
  </div></Card><Card title="Top GGR Contributors">{pending ? <LoadingState label="Loading profitability data..." /> : !profitability.topContributors.length ? <EmptyState title="No contributor data" /> : <div className={styles.stack}>{profitability.topContributors.map(player => <article key={player.userId} className={styles.details}><div className={styles.feedTop}><strong>#{player.rank} {player.userName}</strong><div className={styles.details}><span>GGR: <strong className={player.ggr >= 0 ? styles.positive : styles.negative}>{fmt(player.ggr)}</strong></span><span>Contribution: {player.contribution.toFixed(1)}%</span></div></div><Meter value={player.contribution} /></article>)}</div>}</Card></div>
}

