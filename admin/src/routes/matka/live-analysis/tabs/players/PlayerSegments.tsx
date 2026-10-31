import type { MatkaBetsData, MatkaUsersData, MatkaBet, MatkaUser } from '../../liveUiModel'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Meter } from '@/ui/components/Meter'
import styles from '../../MatkaLiveUi.module.css'
import { useQuery } from '@apollo/client'
import { useMemo } from 'react'
import { gql } from '@apollo/client'
import dayjs from 'dayjs'
import { nowIST } from '@/shared/utils/date'

const MATKA_BETS_QUERY = gql`
  query MatkaBets($query: MatkaBetsQuery) {
    matkaBets(query: $query) {
      userId
      userName
      betAmount
      potentialWin
      createdAt
    }
  }
`

const USERS_QUERY = gql`
  query Users {
    users {
      id
      vipTierName
      status
      createdAt
    }
  }
`

export const PlayerSegments: React.FC = () => {
  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data: betsData } = useQuery<MatkaBetsData>(MATKA_BETS_QUERY, {
    variables: {
      query: {
        statuses: ['pending', 'active'],
        limit: 5000,
      },
    },
    pollInterval: 10000,
    fetchPolicy: "network-only",
  })

  const { data: usersData } = useQuery<MatkaUsersData>(USERS_QUERY, {
    pollInterval: 30000,
  })

  const segments = useMemo(() => {
    const bets = betsData?.matkaBets || []
    const users = usersData?.users || []

    // Get unique active players
    const activePlayerIds = new Set(bets.map((b: MatkaBet) => String(b.userId)))
    const activePlayers = users.filter((u: MatkaUser) => activePlayerIds.has(String(u.id)))

    // VIP Tier Distribution
    const vipTiers = new Map<string, number>()
    activePlayers.forEach((u: MatkaUser) => {
      const tier = u.vipTierName || 'No Tier'
      vipTiers.set(tier, (vipTiers.get(tier) || 0) + 1)
    })

    // Status Distribution
    const statusMap = new Map<string, number>()
    activePlayers.forEach((u: MatkaUser) => {
      const status = u.status || 'UNKNOWN'
      statusMap.set(status, (statusMap.get(status) || 0) + 1)
    })

    // New vs Returning Players (registered in last 7 days vs older)
    const sevenDaysAgo = nowIST().subtract(7, 'day')
    const newPlayers = activePlayers.filter((u: MatkaUser) => 
      dayjs(u.createdAt).isAfter(sevenDaysAgo)
    ).length
    const returningPlayers = activePlayers.length - newPlayers

    // High Rollers (players with high average bet)
    const playerWagered = new Map<string, number>()
    const playerBets = new Map<string, number>()
    bets.forEach((bet: MatkaBet) => {
      const userId = String(bet.userId)
      playerWagered.set(userId, (playerWagered.get(userId) || 0) + Number(bet.betAmount))
      playerBets.set(userId, (playerBets.get(userId) || 0) + 1)
    })

    let highRollers = 0
    let regularPlayers = 0
    playerWagered.forEach((wagered, userId) => {
      const betCount = playerBets.get(userId) || 1
      const avgBet = wagered / betCount
      if (avgBet > 100) { // Threshold for high roller
        highRollers++
      } else {
        regularPlayers++
      }
    })

    // Calculate totals
    const totalWagered = bets.reduce((sum: number, b: MatkaBet) => sum + Number(b.betAmount || 0), 0)
    const totalPayouts = bets.reduce((sum: number, b: MatkaBet) => sum + Number(b.potentialWin || 0), 0)
    const totalGGR = totalWagered - totalPayouts

    return {
      totalActive: activePlayers.length,
      vipTiers: Array.from(vipTiers.entries()).map(([tier, count]) => ({
        tier,
        count,
        percentage: activePlayers.length > 0 ? (count / activePlayers.length) * 100 : 0,
      })),
      statusDistribution: Array.from(statusMap.entries()).map(([status, count]) => ({
        status,
        count,
        percentage: activePlayers.length > 0 ? (count / activePlayers.length) * 100 : 0,
      })),
      newVsReturning: {
        new: newPlayers,
        returning: returningPlayers,
        newPercentage: activePlayers.length > 0 ? (newPlayers / activePlayers.length) * 100 : 0,
      },
      playerTypes: {
        highRollers,
        regular: regularPlayers,
        highRollerPercentage: (highRollers + regularPlayers) > 0 ? (highRollers / (highRollers + regularPlayers)) * 100 : 0,
      },
      totals: {
        wagered: totalWagered,
        ggr: totalGGR,
      },
    }
  }, [betsData, usersData])

  return <div className={styles.stack}>
    <Card title="VIP Tier Distribution" sub="Active players by tier">{!segments.vipTiers.length ? <EmptyState title="No VIP tier data" /> : <ul className={styles.list}>{segments.vipTiers.map(({ tier, count, percentage }) => <li key={tier} className={styles.item}><div className={styles.row}><strong>{tier}</strong><span>{count} players ({percentage.toFixed(1)}%)</span></div><Meter value={percentage} label={`Active players in ${tier}`} /></li>)}</ul>}</Card>
    <div className={styles.grid2}>
      <Card title="New vs Returning" sub="Player acquisition"><div className={styles.stack}>{[{ label: 'New Players (Last 7 days)', count: segments.newVsReturning.new, share: segments.newVsReturning.newPercentage }, { label: 'Returning Players', count: segments.newVsReturning.returning, share: 100 - segments.newVsReturning.newPercentage }].map(item => <div key={item.label} className={styles.stack}><div className={styles.row}><span>{item.label}</span><strong>{item.count}</strong></div><Meter value={item.share} label={item.label} /></div>)}</div></Card>
      <Card title="Player Types" sub="High rollers vs regular"><div className={styles.stack}>{[{ label: 'High Rollers', count: segments.playerTypes.highRollers, share: segments.playerTypes.highRollerPercentage }, { label: 'Regular Players', count: segments.playerTypes.regular, share: 100 - segments.playerTypes.highRollerPercentage }].map(item => <div key={item.label} className={styles.stack}><div className={styles.row}><span>{item.label}</span><strong>{item.count}</strong></div><Meter value={item.share} tone={item.label === 'High Rollers' ? 'warn' : 'acc'} label={item.label} /></div>)}</div></Card>
    </div>
  </div>
}

