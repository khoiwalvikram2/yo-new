import type { MatkaBetsData, MatkaUsersData, MatkaBet, MatkaUser } from '../../liveUiModel'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import styles from '../../MatkaLiveUi.module.css'
import { useQuery } from '@apollo/client'
import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { gql } from '@apollo/client'
import dayjs from 'dayjs'
import { nowIST } from '@/shared/utils/date'

const MATKA_BETS_QUERY = gql`
  query MatkaBets($query: MatkaBetsQuery) {
    matkaBets(query: $query) {
      userId
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
      createdAt
    }
  }
`

export const PlayerOverview: React.FC = () => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  const sevenDaysAgo = useMemo(() => {
    return nowIST().subtract(7, 'day').toISOString()
  }, [])

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

  const kpis = useMemo(() => {
    const bets = betsData?.matkaBets || []
    const users = usersData?.users || []

    // Active players (with open bets)
    const activePlayerIds = new Set(bets.map((b: MatkaBet) => String(b.userId)))
    const activePlayers = activePlayerIds.size

    // New players (registered in last 7 days)
    const newPlayers = users.filter((u: MatkaUser) => 
      dayjs(u.createdAt).isAfter(sevenDaysAgo)
    ).length

    // Total players
    const totalPlayers = users.length

    // Player metrics from bets
    const totalWagered = bets.reduce((sum: number, b: MatkaBet) => sum + Number(b.betAmount || 0), 0)
    const totalPotentialPayouts = bets.reduce((sum: number, b: MatkaBet) => sum + Number(b.potentialWin || 0), 0)
    const totalExposure = totalWagered - totalPotentialPayouts
    const avgWageredPerPlayer = activePlayers > 0 ? totalWagered / activePlayers : 0
    const avgExposurePerPlayer = activePlayers > 0 ? totalExposure / activePlayers : 0

    // Average bets per player
    const playerBetCounts = new Map<string, number>()
    bets.forEach((bet: MatkaBet) => {
      const userId = String(bet.userId)
      playerBetCounts.set(userId, (playerBetCounts.get(userId) || 0) + 1)
    })
    const totalBets = bets.length
    const avgBetsPerPlayer = activePlayers > 0 ? totalBets / activePlayers : 0

    // Player retention (players with open bets who were registered before 7 days ago)
    const returningPlayers = users.filter((u: MatkaUser) => {
      const registeredBefore = dayjs(u.createdAt).isBefore(sevenDaysAgo)
      return registeredBefore && activePlayerIds.has(String(u.id))
    }).length

    return {
      activePlayers,
      newPlayers,
      totalPlayers,
      returningPlayers,
      totalWagered,
      totalExposure,
      avgWageredPerPlayer,
      avgExposurePerPlayer,
      avgBetsPerPlayer,
      retentionRate: totalPlayers > 0 ? (returningPlayers / totalPlayers) * 100 : 0,
    }
  }, [betsData, usersData, sevenDaysAgo])

  return <Card title="Player Overview" sub="Key player metrics (open bets)"><div className={styles.grid2}>
    <Stat variant="bare" label="Avg Wagered/Player" value={formatAmount(convertFromWhitelabelCurrency(kpis.avgWageredPerPlayer))} note="Average wagered per active player" hue="vio" />
    <Stat variant="bare" label="Retention Rate" value={`${kpis.retentionRate.toFixed(1)}%`} note="Returning players" hue="amb" />
    <Stat variant="bare" label="Avg Bets/Player" value={kpis.avgBetsPerPlayer.toFixed(1)} note="Average activity level" />
    <Stat variant="bare" label="Returning Players" value={kpis.returningPlayers} note="Repeat customers" hue="grn" />
  </div></Card>
}

