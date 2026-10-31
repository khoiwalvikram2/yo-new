import { useState } from 'react'
import { useQuery, gql } from '@apollo/client'
import type { Player } from '@/shared/types/player'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { MovePlayerToAgentModal } from '../MovePlayerToAgentModal'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from '../../PlayersSearch.module.css'
const PLAYER_STATS_QUERY = gql`
  query PlayerStatsForDrawer($playerId: String!) {
    usersPage(query: $playerId, limit: 1, offset: 0) {
      itemsWithStats {
        stats {
          turnover
          commissionEarned
          commissionTrend
        }
      }
    }
  }
`

interface CommissionInfoSectionProps {
  user: Player
  onRefetch?: () => void
  onMove?: () => void
}


export function CommissionInfoSection({ user, onRefetch, onMove }: CommissionInfoSectionProps) {
  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const { formatAmount } = useCurrency()
  const permissions = useAuthStore(s => s.permissions)
  const agent = useAuthStore(s => s.agent)
  const canViewWallet = !!agent || hasPermissionWithNested(permissions, 'players.wallet', 'view')
  const currency = user.wallet?.currency || 'INR'
  const { data, loading } = useQuery(PLAYER_STATS_QUERY, { variables: { playerId: user.id }, skip: !user.id, fetchPolicy: 'cache-and-network', errorPolicy: 'all' })
  const stats = data?.usersPage?.itemsWithStats?.[0]?.stats
  const parent = user.parentAgent as Player['parentAgent'] & { commissionRates?: { domain: string; rate: number }[] }
  const rates = parent?.commissionRates || []
  const format = (value: number | null | undefined) => !canViewWallet ? '••••' : loading || value == null ? '—' : formatAmount(Number(value), currency)
  return <div className={styles.stack}><h3 className={styles.name}>Commission Statistics</h3><DescriptionList items={[{ term: 'Turnover', value: format(stats?.turnover) }, { term: 'Commission Earned', value: <div className={styles.actions}>{format(stats?.commissionEarned)}{stats?.commissionTrend && <StatusPill tone={stats.commissionTrend === 'up' ? 'ok' : stats.commissionTrend === 'down' ? 'neg' : 'neutral'}>{stats.commissionTrend === 'up' ? 'Up' : stats.commissionTrend === 'down' ? 'Down' : 'Neutral'}</StatusPill>}</div> }]} />
    {rates.length ? <div className={styles.rates}><h3 className={styles.name}>Commission Rates</h3>{rates.map(rate => <div key={rate.domain} className={styles.row}><span>{rate.domain}</span><strong>{rate.rate ? Number(rate.rate).toFixed(2) + '%' : '—'}</strong></div>)}</div> : <Notice tone="info" title="No Commission Rates">Commission rates are not configured for this player's agent.</Notice>}
    {user.playerType === 'COMMISSION_AGENT_PLAYER' && !agent && hasPermissionWithNested(permissions, 'players.move-agent', 'execute') && <><Button block size="sm" onClick={() => onMove ? onMove() : setMoveModalOpen(true)}>Move to Another Agent</Button>{!onMove && <MovePlayerToAgentModal open={moveModalOpen} playerId={user.id} currentAgentId={user.agentId} playerType={user.playerType} onClose={() => setMoveModalOpen(false)} onSuccess={() => { setMoveModalOpen(false); onRefetch?.() }} />}</>}
  </div>
}
