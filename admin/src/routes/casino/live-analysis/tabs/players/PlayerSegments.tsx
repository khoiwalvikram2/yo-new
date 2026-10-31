import { useMemo } from 'react'
import { gql, useQuery } from '@apollo/client'
import dayjs from 'dayjs'
import { nowIST } from '@/shared/utils/date'
import { Card } from '@/ui/components/Card'
import type { CasinoBet, CasinoPlayerRecord } from '../../casinoLiveModel'
import styles from '../../CasinoLive.module.css'
import { Meter } from '@/ui/components/Meter'
import { EmptyState } from '@/ui/components/EmptyState'
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

interface PlayerSegmentsProps {
  windowMins?: number
}

export function PlayerSegments({ windowMins = 60 }: PlayerSegmentsProps) {

  const dateFrom = useMemo(() => {
    return nowIST().subtract(windowMins, 'minute').toISOString()
  }, [windowMins])

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data: betsData } = useQuery<{ casinoBets: CasinoBet[] }>(CASINO_BETS_QUERY, {
    variables: {
      query: {
        dateFrom,
        limit: 5000,
      },
    },
    pollInterval: 10000,
    fetchPolicy: "network-only",
  })

  const { data: usersData } = useQuery<{ users: Array<CasinoPlayerRecord & { status?: string | null }> }>(USERS_QUERY, {
    pollInterval: 30000,
  })

  const segments = useMemo(() => {
    const bets = betsData?.casinoBets || []
    const users = usersData?.users || []

    // Get unique active players
    const activePlayerIds = new Set(bets.map((b: CasinoBet) => String(b.userId)))
    const activePlayers = users.filter((u: CasinoPlayerRecord & { status?: string | null }) => activePlayerIds.has(String(u.id)))

    // VIP Tier Distribution
    const vipTiers = new Map<string, number>()
    activePlayers.forEach((u: CasinoPlayerRecord & { status?: string | null }) => {
      const tier = u.vipTierName || 'No Tier'
      vipTiers.set(tier, (vipTiers.get(tier) || 0) + 1)
    })

    // Status Distribution
    const statusMap = new Map<string, number>()
    activePlayers.forEach((u: CasinoPlayerRecord & { status?: string | null }) => {
      const status = u.status || 'UNKNOWN'
      statusMap.set(status, (statusMap.get(status) || 0) + 1)
    })

    // New vs Returning Players (registered in last 7 days vs older)
    const sevenDaysAgo = nowIST().subtract(7, 'day')
    const newPlayers = activePlayers.filter((u: CasinoPlayerRecord & { status?: string | null }) => 
      dayjs(u.createdAt).isAfter(sevenDaysAgo)
    ).length
    const returningPlayers = activePlayers.length - newPlayers

    // High Rollers (players with high average bet)
    const playerWagered = new Map<string, number>()
    const playerBets = new Map<string, number>()
    bets.forEach((bet: CasinoBet) => {
      const userId = String(bet.userId)
      playerWagered.set(userId, (playerWagered.get(userId) || 0) + Number(bet.stake))
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
    const totalWagered = bets.reduce((sum: number, b: CasinoBet) => sum + Number(b.stake || 0), 0)
    const totalPayouts = bets.reduce((sum: number, b: CasinoBet) => sum + Number(b.payout || 0), 0)
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

  return <div className={styles.stack}><Card title="VIP Tier Distribution">{!segments.vipTiers.length ? <EmptyState title="No VIP tier data" /> : <div className={styles.stack}>{segments.vipTiers.map(({ tier, count, percentage }) => <div key={tier} className={styles.details}><div className={styles.feedTop}><strong>{tier}</strong><span>{count} players ({percentage.toFixed(1)}%)</span></div><Meter value={percentage} /></div>)}</div>}</Card>
    <div className={styles.grid2}><Card title="New vs Returning"><div className={styles.stack}>
      <div className={styles.details}><div className={styles.feedTop}><span>New Players (Last 7 days)</span><strong>{segments.newVsReturning.new}</strong></div><Meter value={segments.newVsReturning.newPercentage} /></div>
      <div className={styles.details}><div className={styles.feedTop}><span>Returning Players</span><strong>{segments.newVsReturning.returning}</strong></div><Meter value={100 - segments.newVsReturning.newPercentage} /></div>
    </div></Card><Card title="Player Types"><div className={styles.stack}>
      <div className={styles.details}><div className={styles.feedTop}><span>High Rollers</span><strong>{segments.playerTypes.highRollers}</strong></div><Meter value={segments.playerTypes.highRollerPercentage} tone="warn" /></div>
      <div className={styles.details}><div className={styles.feedTop}><span>Regular Players</span><strong>{segments.playerTypes.regular}</strong></div><Meter value={100 - segments.playerTypes.highRollerPercentage} /></div>
    </div></Card></div>
  </div>
}

