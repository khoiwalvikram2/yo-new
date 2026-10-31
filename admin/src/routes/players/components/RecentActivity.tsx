import { useQuery, gql } from '@apollo/client'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { startOfDay, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Link } from 'react-router-dom'
import type { Player } from '@/shared/types/player'
import { AccountListPanel } from '@/modules/account-lists/AccountList'
import { Button } from '@/ui/components/Button'
import { Avatar } from '@/ui/components/Avatar'
import { StatusPill } from '@/ui/components/StatusPill'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import styles from '../PlayersSearch.module.css'
dayjs.extend(relativeTime)
const RECENT_REGISTRATIONS_QUERY = gql`
  query RecentRegistrations($registeredFrom: String!, $limit: Int!) {
    usersPage(
      registeredFrom: $registeredFrom
      limit: $limit
    ) {
      items {
        id
        name
        username
        email
        phone
        status
        createdAt
        vipTierName
        wallet {
          balance
          currency
        }
      }
    }
  }
`

const HIGH_VALUE_PLAYERS_QUERY = gql`
  query HighValuePlayers($limit: Int!) {
    usersPage(
      balanceMin: 1000
      limit: $limit
    ) {
      items {
        id
        name
        username
        email
        phone
        status
        vipTierName
        wallet {
          balance
          currency
        }
      }
    }
  }
`

type RecentActivityProps = {
  defer?: boolean;
}

export function RecentActivity({ defer = false }: RecentActivityProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const permissions = useAuthStore(s => s.permissions)
  const agent = useAuthStore(s => s.agent)
  const canViewWallet = !!agent || hasPermissionWithNested(permissions, 'players.wallet', 'view')
  const mask = '••••'
  
  const todayStart = startOfDay(new Date(), DEFAULT_ADMIN_TZ).toISOString()

  const { data: recentData, loading: recentLoading } = useQuery(RECENT_REGISTRATIONS_QUERY, {
    variables: {
      registeredFrom: todayStart,
      limit: 5,
    },
    skip: defer,
    errorPolicy: 'all',
  })

  const { data: highValueData, loading: highValueLoading } = useQuery(HIGH_VALUE_PLAYERS_QUERY, {
    variables: {
      limit: 5,
    },
    skip: defer,
    errorPolicy: 'all',
  })

  const recentRegistrations = recentData?.usersPage?.items || []
  const allPlayers = highValueData?.usersPage?.items || []
  
  // Filter and sort high value players (VIP tier or high balance >= 1000)
  const highValuePlayers = allPlayers
    .filter((p: Player) => {
      const balance = p.wallet?.balance || 0
      const convertedBalance = convertFromWhitelabelCurrency(balance)
      return p.vipTierId || convertedBalance >= 1000
    })
    .sort((a: Player, b: Player) => {
      // Sort by VIP tier first, then by balance
      if (a.vipTierId && !b.vipTierId) return -1
      if (!a.vipTierId && b.vipTierId) return 1
      const balanceA = a.wallet?.balance || 0
      const balanceB = b.wallet?.balance || 0
      return balanceB - balanceA
    })
    .slice(0, 5)
  
  // Count today's registrations
  const todayCount = recentRegistrations.filter((p: Player) => {
    if (!p.createdAt) return false
    return dayjs(p.createdAt).isAfter(dayjs(startOfDay(new Date(), DEFAULT_ADMIN_TZ).toISOString()))
  }).length

  // Get unique VIP tier names from high value players
  const vipTiers = Array.from(new Set(highValuePlayers
    .filter((p: Player) => p.vipTierName)
    .map((p: Player) => p.vipTierName)
  ))

  const formatTimeAgo = (dateString?: string) => {
    if (!dateString) return '—'
    return dayjs(dateString).fromNow()
  }


  return <div className={styles.two}>
    <AccountListPanel body="padded" title="Recent Registrations" tools={todayCount > 0 && <StatusPill tone="ok">+{todayCount} today</StatusPill>}>
      {recentLoading ? <LoadingState label="Loading recent registrations" /> : recentRegistrations.length === 0 ? <EmptyState title="No recent registrations" /> : <div className={styles.stack}>
        {recentRegistrations.slice(0, 3).map((player: Player) => <div key={player.id} className={styles.row}><div className={styles.person}><Avatar name={player.name} hue="auto" /><div><div className={styles.name}>{player.name || '—'}</div><p className={styles.secondary}>{player.username || player.id?.substring(0, 8) || '—'}</p></div></div><div><p className={styles.secondary}>{formatTimeAgo(player.createdAt)}</p><StatusPill tone={player.status === 'ACTIVE' ? 'ok' : 'neutral'}>{player.status === 'ACTIVE' ? 'Active' : player.status === 'SUSPENDED' ? 'Suspended' : 'Inactive'}</StatusPill></div></div>)}
        <Link to="/players"><Button variant="link">View All Registrations</Button></Link>
      </div>}
    </AccountListPanel>
    <AccountListPanel body="padded" title="High Value Players" tools={vipTiers.length > 0 && <StatusPill tone="info">{String(vipTiers[0] || 'VIP Tier')}</StatusPill>}>
      {highValueLoading ? <LoadingState label="Loading high value players" /> : highValuePlayers.length === 0 ? <EmptyState title="No high value players found" /> : <div className={styles.stack}>
        {highValuePlayers.sort((a: Player, b: Player) => (b.wallet?.balance || 0) - (a.wallet?.balance || 0)).slice(0, 3).map((player: Player) => <div key={player.id} className={styles.row}><div className={styles.person}><Avatar name={player.name} hue="auto" /><div><div className={styles.name}>{player.name || '—'}</div><p className={styles.secondary}>{canViewWallet ? formatAmount(convertFromWhitelabelCurrency(player.wallet?.balance || 0)) : mask} balance</p></div></div><div><div className={styles.name}>{player.vipTierName || '—'}</div><p className={styles.secondary}>{player.vipTierName ? 'VIP Tier' : 'High Balance'}</p></div></div>)}
        <Link to="/players"><Button variant="link">View All VIP Players</Button></Link>
      </div>}
    </AccountListPanel>
  </div>
}
