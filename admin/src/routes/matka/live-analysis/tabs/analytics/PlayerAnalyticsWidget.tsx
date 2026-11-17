import type { MatkaBetsData, MatkaUsersData, MatkaBet, MatkaUser } from '../../liveUiModel'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Meter } from '@/ui/components/Meter'
import styles from '../../MatkaLiveUi.module.css'
import { useQuery } from '@apollo/client'
import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { gql } from '@apollo/client'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

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

export const PlayerAnalyticsWidget: React.FC = () => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  // The Players tab's rule (TopPlayersTable, PlayerProfitability): amounts only with settlements.center view, masked
  // in the page as there; the intensity bars show shares, not amounts (G503).
  const permissions = useAuthStore(s => s.permissions)
  const hasFinanceView = hasPermissionWithNested(permissions, 'settlements.center', 'view')
  const maskAmount = (amount: number) => (hasFinanceView ? formatAmount(convertFromWhitelabelCurrency(amount)) : '••••')

  // Get open bets (pending/active) for player analytics
  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data: betsData } = useQuery<MatkaBetsData>(MATKA_BETS_QUERY, {
    variables: {
      query: {
        // Open bets only, as the Players tab asks: a placed bet is 'active' until it settles, so 'pending' alone missed them.
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

  const analytics = useMemo(() => {
    const bets = betsData?.matkaBets || []
    const users = usersData?.users || []

    const activePlayerIds = new Set(bets.map((b: MatkaBet) => String(b.userId)))
    const activePlayers = users.filter((u: MatkaUser) => activePlayerIds.has(String(u.id)))

    // Top players by wagered
    const playerWagered = new Map<string, number>()
    bets.forEach((bet: MatkaBet) => {
      const userId = String(bet.userId)
      playerWagered.set(userId, (playerWagered.get(userId) || 0) + Number(bet.betAmount || 0))
    })

    // Create a map of userId to userName from bets
    const userIdToNameMap = new Map<string, string>()
    bets.forEach((bet: MatkaBet) => {
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
    activePlayers.forEach((u: MatkaUser) => {
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

  return <Card title="Player Analytics" sub="Top players & segments"><div className={styles.grid2}>
    <section className={styles.stack}><h3 className={styles.heading}>Top Players by Wagered</h3>{!analytics.topPlayers.length ? <EmptyState title="No player data" /> : <ol className={styles.list}>{analytics.topPlayers.map((player, idx) => <li className={styles.item} key={player.userId}><div className={styles.row}><span className={styles.inline}><span className={styles.rank}>{idx + 1}</span><strong className={styles.heading}>{player.userName}</strong></span><span className={styles.amount}>{maskAmount(player.wagered)}</span></div><Meter value={player.wagered / analytics.maxWagered * 100} label={`Wagered intensity for ${player.userName}`} /></li>)}</ol>}</section>
    <section className={styles.stack}><h3 className={styles.heading}>VIP Tier Distribution</h3>{!analytics.vipTiers.length ? <EmptyState title="No tier data" /> : <ul className={styles.list}>{analytics.vipTiers.map(({ tier, count, percentage }) => <li key={tier} className={styles.item}><div className={styles.row}><strong>{tier}</strong><span>{count}</span></div><Meter value={percentage} label={`Player share for tier ${tier}`} /></li>)}</ul>}</section>
  </div></Card>
}

