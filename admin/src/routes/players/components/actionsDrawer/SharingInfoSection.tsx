import { Notice } from '@/ui/components/Notice'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../PlayersSearch.module.css'
import { useQuery, gql } from '@apollo/client'
import type { Player } from '@/shared/types/player'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

const PLAYER_STATS_QUERY = gql`
  query PlayerStatsForDrawer($playerId: String!) {
    usersPage(query: $playerId, limit: 1, offset: 0) {
      itemsWithStats {
        stats {
          ggr
        }
      }
    }
  }
`

interface SharingInfoSectionProps {
  user: Player
}

export function SharingInfoSection({ user }: SharingInfoSectionProps) {
  const { formatAmount } = useCurrency()
  const permissions = useAuthStore(s => s.permissions)
  const agent = useAuthStore(s => s.agent)
  const canViewWallet = !!agent || hasPermissionWithNested(permissions, 'players.wallet', 'view')
  const mask = '••••'
  const currency = user.wallet?.currency || 'INR'

  const { data: statsData, loading: statsLoading } = useQuery(PLAYER_STATS_QUERY, {
    variables: { playerId: user.id },
    skip: !user.id,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const stats = statsData?.usersPage?.itemsWithStats?.[0]?.stats
  const ggr = stats?.ggr ?? null

  // Get sharing rates from parent agent
  const parentAgent = user.parentAgent as Player['parentAgent'] & { sharingRates?: { domain: string; rate: number }[] }
  const sharingRates = parentAgent?.sharingRates || []

  // Calculate GGR share for each domain
  const calculateGGRShare = (_domain: string, shareRate: number) => {
    if (ggr === null || ggr === undefined) return null
    // Assuming GGR is total, we'd need domain-specific GGR for accurate calculation
    // For now, we'll show the share rate and total GGR
    return Number(ggr) * (Number(shareRate) / 100)
  }

  return <div className={styles.stack}><DescriptionList items={[{ term: 'Total GGR', value: !canViewWallet ? mask : statsLoading || ggr === null ? '—' : formatAmount(Number(ggr), currency) }]} />
    {sharingRates.length ? <div className={styles.rates}><h3 className={styles.name}>Sharing Rates</h3>{sharingRates.map(rate => { const share = calculateGGRShare(rate.domain, rate.rate); return <div key={rate.domain}><div className={styles.row}><span>{rate.domain}</span><strong>{rate.rate ? Number(rate.rate).toFixed(2) + '%' : '—'}</strong></div>{share !== null && <p className={styles.secondary}>Share: {canViewWallet ? formatAmount(share, currency) : mask}</p>}</div> })}</div> : <Notice tone="info" title="No Sharing Rates">Sharing rates are not configured for this player's agent.</Notice>}
    <Notice title="Settlement Information">Settlement is managed through the agent's settlement center. Contact the agent or admin for settlement details.</Notice>
  </div>
}
