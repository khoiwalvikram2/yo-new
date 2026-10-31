import { useMemo } from 'react'
import { gql, useQuery } from '@apollo/client'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { nowIST } from '@/shared/utils/date'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import { Meter } from '@/ui/components/Meter'
import type { CasinoBet, CasinoPlayerRecord } from '../../casinoLiveModel'
import styles from '../../CasinoLive.module.css'
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
      createdAt
    }
  }
`

interface PlayerAnalyticsWidgetProps {
  windowMins?: number
}

export function PlayerAnalyticsWidget({ windowMins = 60 }: PlayerAnalyticsWidgetProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

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

  const { data: usersData } = useQuery<{ users: CasinoPlayerRecord[] }>(USERS_QUERY, {
    pollInterval: 30000,
  })

  const analytics = useMemo(() => {
    const bets = betsData?.casinoBets || []
    const users = usersData?.users || []

    const activePlayerIds = new Set(bets.map((b: CasinoBet) => String(b.userId)))
    const activePlayers = users.filter((u: CasinoPlayerRecord) => activePlayerIds.has(String(u.id)))

    // Top players by wagered
    const playerWagered = new Map<string, number>()
    bets.forEach((bet: CasinoBet) => {
      const userId = String(bet.userId)
      playerWagered.set(userId, (playerWagered.get(userId) || 0) + Number(bet.stake || 0))
    })

    // Create a map of userId to userName from bets
    const userIdToNameMap = new Map<string, string>()
    bets.forEach((bet: CasinoBet) => {
      const userId = String(bet.userId)
      if (bet.userName && !userIdToNameMap.has(userId)) {
        userIdToNameMap.set(userId, bet.userName)
      }
    })

    const topPlayers = Array.from(playerWagered.entries())
      .map(([userId, wagered]) => {
        return {
          userId,
          userName: userIdToNameMap.get(userId) || `User #${userId}`,
          wagered,
        }
      })
      .sort((a, b) => b.wagered - a.wagered)
      .slice(0, 5)

    // VIP Tier Distribution
    const vipTiers = new Map<string, number>()
    activePlayers.forEach((u: CasinoPlayerRecord) => {
      const tier = u.vipTierName || 'No Tier'
      vipTiers.set(tier, (vipTiers.get(tier) || 0) + 1)
    })

    const maxWagered = Math.max(...topPlayers.map(p => p.wagered), 1)

    return {
      topPlayers,
      vipTiers: Array.from(vipTiers.entries()).map(([tier, count]) => ({
        tier,
        count,
        percentage: activePlayers.length > 0 ? (count / activePlayers.length) * 100 : 0,
      })),
      maxWagered,
    }
  }, [betsData, usersData])


  return <Card title="Player Analytics" sub="Top players & segments"><div className={styles.grid2}><section className={styles.stack}><h3 className={styles.heading}>Top Players by Wagered</h3>{!analytics.topPlayers.length ? <EmptyState title="No player data" /> : analytics.topPlayers.map((player, index) => <div key={player.userId} className={styles.details}><div className={styles.feedTop}><div className={styles.actions}><StatusPill tone="info">#{index + 1}</StatusPill><strong>{player.userName}</strong></div><strong>{formatAmount(convertFromWhitelabelCurrency(player.wagered))}</strong></div><Meter value={player.wagered / analytics.maxWagered * 100} /></div>)}</section>
    <section className={styles.stack}><h3 className={styles.heading}>VIP Tier Distribution</h3>{!analytics.vipTiers.length ? <EmptyState title="No tier data" /> : analytics.vipTiers.map(({ tier, count, percentage }) => <div key={tier} className={styles.details}><div className={styles.feedTop}><strong>{tier}</strong><strong>{count}</strong></div><Meter value={percentage} /></div>)}</section>
  </div></Card>
}

