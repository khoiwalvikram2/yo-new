import type { MatkaBetsData, MatkaBet } from '../../liveUiModel'
import { Stat } from '@/ui/components/Stat'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../MatkaLiveUi.module.css'
import { useQuery } from '@apollo/client'
import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { gql } from '@apollo/client'
import dayjs from 'dayjs'

const MATKA_BETS_QUERY = gql`
  query MatkaBets($query: MatkaBetsQuery) {
    matkaBets(query: $query) {
      userId
      userName
      betAmount
      actualWin
      potentialWin
      status
      createdAt
      matkaId
      matkaName
    }
  }
`

export const PlayerPerformanceWidget: React.FC = () => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data, loading } = useQuery<MatkaBetsData>(MATKA_BETS_QUERY, {
    variables: {
      query: {
        status: 'pending',
        limit: 5000,
      },
    },
    pollInterval: 10000,
    fetchPolicy: "network-only",
  })

  const performance = useMemo(() => {
    const bets = data?.matkaBets || []
    const playerMap = new Map<string, {
      userId: string
      userName: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
      wins: number
      losses: number
      matkas: Set<string>
      sessions: Set<string>
      firstBet: string
      lastBet: string
      maxBet: number
      minBet: number
    }>()

    bets.forEach((bet: MatkaBet) => {
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
        matkas: new Set(),
        sessions: new Set(),
        firstBet: bet.createdAt,
        lastBet: bet.createdAt,
        maxBet: 0,
        minBet: Infinity,
      }

      const betAmount = Number(bet.betAmount || 0)
      const payout = Number(bet.actualWin || bet.potentialWin || 0)
      
      stats.wagered += betAmount
      stats.payouts += payout
      stats.bets += 1
      
      if (payout > betAmount) {
        stats.wins += 1
      } else if (payout < betAmount) {
        stats.losses += 1
      }
      
      if (bet.matkaId) {
        stats.matkas.add(String(bet.matkaId))
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
      
      if (betAmount > stats.maxBet) stats.maxBet = betAmount
      if (betAmount < stats.minBet) stats.minBet = betAmount
      
      playerMap.set(userId, stats)
    })

    const players = Array.from(playerMap.values()).map(stats => ({
      ...stats,
      ggr: stats.wagered - stats.payouts,
      avgBet: stats.bets > 0 ? stats.wagered / stats.bets : 0,
      winRate: stats.bets > 0 ? (stats.wins / stats.bets) * 100 : 0,
      matkasPlayed: stats.matkas.size,
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
      avgBetSize,
      avgGGRPerPlayer,
      avgBetsPerPlayer,
      overallWinRate,
      highRollers,
      regularPlayers,
      lowStakes,
    }
  }, [data])

  const pending = loading && !data
  return <section className={styles.stack} aria-label="Player Performance">
    <h3 className={styles.heading}>Player Performance</h3><p className={styles.muted}>Comprehensive player analytics</p>
    <section className={styles.stack}><h4 className={styles.heading}>Player Segments</h4><div className={styles.grid3} aria-busy={pending || undefined}><Stat variant="bare" size="compact" label="High Rollers" value={performance.highRollers} hue="vio" loading={pending} /><Stat variant="bare" size="compact" label="Regular" value={performance.regularPlayers} hue="blu" loading={pending} /><Stat variant="bare" size="compact" label="Low Stakes" value={performance.lowStakes} loading={pending} /></div></section>
    {performance.topContributors.length > 0 && <section className={styles.stack}><h4 className={styles.heading}>Top GGR Contributors</h4><ol className={styles.list}>{performance.topContributors.map((player, idx) => <li key={player.userId} className={styles.item}><div className={styles.row}><span className={styles.inline}><span className={styles.rank}>{idx + 1}</span><strong className={styles.heading}>{player.userName}</strong></span><span className={player.ggr >= 0 ? styles.positive : styles.negative}>{formatAmount(convertFromWhitelabelCurrency(player.ggr))}</span></div><DescriptionList items={[{ term: 'Bets', value: player.bets }, { term: 'RTP', value: 'Pending settlement' }, { term: 'Avg', value: formatAmount(convertFromWhitelabelCurrency(player.avgBet)) }]} /></li>)}</ol></section>}
  </section>
}

