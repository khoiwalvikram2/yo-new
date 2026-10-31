import { useMemo } from 'react'
import { gql, useQuery } from '@apollo/client'
import dayjs from 'dayjs'
import { nowIST } from '@/shared/utils/date'
import { Card } from '@/ui/components/Card'
import { useCurrency } from '@/shared/core/CurrencyContext'
import type { CasinoBet, CasinoPlayerRecord } from '../../casinoLiveModel'
import styles from '../../CasinoLive.module.css'
import { Stat } from '@/ui/components/Stat'
const CASINO_BETS_QUERY = gql`
  query CasinoBets($query: CasinoBetsQuery) {
    casinoBets(query: $query) {
      userId
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
      createdAt
    }
  }
`

interface PlayerOverviewProps {
  windowMins?: number
}

export function PlayerOverview({ windowMins = 60 }: PlayerOverviewProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  const dateFrom = useMemo(() => {
    return nowIST().subtract(windowMins, 'minute').toISOString()
  }, [windowMins])

  const sevenDaysAgo = useMemo(() => {
    return nowIST().subtract(7, 'day').toISOString()
  }, [])

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

  const kpis = useMemo(() => {
    const bets = betsData?.casinoBets || []
    const users = usersData?.users || []

    // Active players in window
    const activePlayerIds = new Set(bets.map((b: CasinoBet) => String(b.userId)))
    const activePlayers = activePlayerIds.size

    // New players (registered in last 7 days)
    const newPlayers = users.filter((u: CasinoPlayerRecord) => 
      dayjs(u.createdAt).isAfter(sevenDaysAgo)
    ).length

    // Total players
    const totalPlayers = users.length

    // Player metrics from bets
    const totalWagered = bets.reduce((sum: number, b: CasinoBet) => sum + Number(b.stake || 0), 0)
    const totalPayouts = bets.reduce((sum: number, b: CasinoBet) => sum + Number(b.payout || 0), 0)
    const totalGGR = totalWagered - totalPayouts
    const avgPlayerValue = activePlayers > 0 ? totalGGR / activePlayers : 0

    // Average bets per player
    const playerBetCounts = new Map<string, number>()
    bets.forEach((bet: CasinoBet) => {
      const userId = String(bet.userId)
      playerBetCounts.set(userId, (playerBetCounts.get(userId) || 0) + 1)
    })
    const totalBets = bets.length
    const avgBetsPerPlayer = activePlayers > 0 ? totalBets / activePlayers : 0

    // Player retention (players who bet in window and were registered before window)
    const windowStart = dayjs(dateFrom)
    const returningPlayers = users.filter((u: CasinoPlayerRecord) => {
      const registeredBefore = dayjs(u.createdAt).isBefore(windowStart)
      return registeredBefore && activePlayerIds.has(String(u.id))
    }).length

    return {
      activePlayers,
      newPlayers,
      totalPlayers,
      returningPlayers,
      totalGGR,
      avgPlayerValue,
      avgBetsPerPlayer,
      retentionRate: totalPlayers > 0 ? (returningPlayers / totalPlayers) * 100 : 0,
    }
  }, [betsData, usersData, dateFrom, sevenDaysAgo])

  return <Card title="Player Overview"><div className={styles.grid4}>
    <Stat variant="bare" label="Avg Player Value" value={formatAmount(convertFromWhitelabelCurrency(kpis.avgPlayerValue))} note="GGR per active player" hue="blu" />
    <Stat variant="bare" label="Retention Rate" value={`${kpis.retentionRate.toFixed(1)}%`} note="Returning players" hue="amb" />
    <Stat variant="bare" label="Avg Bets/Player" value={kpis.avgBetsPerPlayer.toFixed(1)} note="Average activity level" hue="blu" />
    <Stat variant="bare" label="Returning Players" value={kpis.returningPlayers} note="Repeat customers" hue="grn" />
  </div></Card>
}

