import { useState } from 'react'
import clsx from 'clsx'
import { useQuery, gql } from '@apollo/client'
import { Link } from 'react-router-dom'
import { IconUserCheck, IconUserOff, IconUsers } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useBreakpoint } from '@/shared/hooks/useBreakpoint'
import { AccountListMetric } from '@/modules/account-lists/AccountList'
import { chipTone, signedChips, useChipFormat, type ChipAccount } from '@/modules/chips'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import styles from './AgentProfileComponents.module.css'
dayjs.extend(relativeTime)

const AGENT_PLAYERS_QUERY = gql`
  query AgentPlayers($agentId: ID!, $includeDownline: Boolean, $offset: Int, $limit: Int, $sortBy: String, $sortOrder: String) {
    usersPage(
      agentId: $agentId
      includeDownline: $includeDownline
      offset: $offset
      limit: $limit
      sortBy: $sortBy
      sortOrder: $sortOrder
    ) {
      itemsWithStats {
        player {
          id
          name
          email
          phone
          username
          status
          playerType
          agentId
          parentAgent {
            id
            username
          }
          chips {
            accountType
            id
            username
            name
            status
            parentAgentId
            playerType
            currency
            creditReference
            balance
            exposure
            available
            downlineBalance
            refPnl
            downlineCount
          }
          referredBy {
            id
            username
            name
            phone
          }
          wallet {
            balance
            exposure
            currency
          }
        }
        stats {
          lastLogin
          lastActivityAt
          lastBetAt
          daysSinceLastBet
          ggr
          totalExposure
        }
      }
      total
    }
  }
`

// The list holds one page, so its rows cannot be counted: the whole downline's active players come from the
// same scope with a status filter (only the total is read).
const AGENT_PLAYER_COUNTS_QUERY = gql`
  query AgentPlayerCounts($agentId: ID!) {
    active: usersPage(agentId: $agentId, includeDownline: true, status: ACTIVE, limit: 1) {
      total
    }
  }
`

interface PlayersTabProps {
  agentId: string
}

/** A credit player's chips: the balance, with its Ref P/L under it (green: the upline owes it; rose: it owes). */
function ChipBalance({ chips, visible, mask }: { chips: ChipAccount; visible: boolean; mask: string }) {
  const format = useChipFormat(chips.currency)
  const tone = chipTone(chips.refPnl)
  return <div className={clsx(styles.rowDetails, styles.cellEnd)}>
    <span>{visible ? format(chips.balance) : mask}</span>
    <span className={styles.muted}>Ref P/L <span className={tone && visible ? styles[tone] : undefined}>{visible ? signedChips(chips.refPnl, format) : mask}</span></span>
  </div>
}

export function PlayersTab({ agentId }: PlayersTabProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const permissions = useAuthStore(s => s.permissions)
  const agent = useAuthStore(s => s.agent)
  const canViewWallet = !!agent || hasPermissionWithNested(permissions, 'players.wallet', 'view')
  const canViewCredit = !!agent || hasPermissionWithNested(permissions, 'players.credit', 'view')
  const mask = '••••'
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sortBy, setSortBy] = useState<string | undefined>(undefined)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | undefined>(undefined)
  // On a phone the table keeps the player and the balance; the status, type and sub-agent go with the name.
  const { isMobile } = useBreakpoint()

  const { data, loading, error, refetch } = useQuery(AGENT_PLAYERS_QUERY, {
    variables: {
      agentId,
      includeDownline: true,
      offset: (currentPage - 1) * pageSize,
      limit: pageSize,
      sortBy,
      sortOrder,
    },
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const { data: countsData, loading: countsLoading, refetch: refetchCounts } = useQuery(AGENT_PLAYER_COUNTS_QUERY, {
    variables: { agentId },
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
    skip: !agentId,
  })

  const players = data?.usersPage?.itemsWithStats || []
  const total = data?.usersPage?.total || 0
  const pending = loading && !data
  const active: number | undefined = countsData?.active?.total
  const countsPending = (countsLoading && !countsData) || pending

  const fmt = (amount: number) => formatAmount(convertFromWhitelabelCurrency(Number(amount || 0)))

  const getPlayerTypeLabel = (playerType?: string | null) => {
    switch (playerType) {
      case 'REGULAR':
        return 'Normal'
      case 'AGENT_CREDIT':
        return 'Credit'
      case 'WHITELABEL_CREDIT':
        return 'Whitelabel Credit'
      case 'SHARING_AGENT_PLAYER':
        return 'Sharing'
      case 'COMMISSION_AGENT_PLAYER':
        return 'Commission'
      default:
        return 'Normal'
    }
  }

  type PlayersTabRow = {
    player?: { id: string; name?: string; username?: string; email?: string; playerType?: string; status?: string; agentId?: string; parentAgent?: { id: string; username?: string }; chips?: ChipAccount | null; wallet?: { balance?: number; exposure?: number }; referredBy?: { id: string; name?: string; username?: string; phone?: string } }
    stats?: { totalExposure?: number; lastActivityAt?: string; lastLogin?: string; lastBetAt?: string; daysSinceLastBet?: number }
  }
  // Under a sub-agent: its name; directly under this agent: Direct.
  const subAgentOf = (row: PlayersTabRow) => !row.player?.parentAgent ? null : row.player.parentAgent.id === agentId ? 'Direct' : row.player.parentAgent.username || null
  const isCreditPlayer = (row: PlayersTabRow) => ['AGENT_CREDIT', 'WHITELABEL_CREDIT'].includes(row.player?.playerType || '')
  const columns: DataTableColumn<PlayersTabRow>[] = [
    { key: 'player', header: 'Player', cell: row => {
      const player = row.player
      if (!player) return '—'
      const secondary = player.email || (player.name && player.username ? player.username : null)
      return <div className={styles.rowDetails}>
        <span className={styles.inlineValue}><Link className={styles.link} to={`/players/profile/${player.id}`}><strong>{player.name || player.username || `Player ${player.id}`}</strong></Link>{isMobile && <StatusPill status={player.status || ''}>{player.status?.toUpperCase() || '—'}</StatusPill>}</span>
        {secondary && <span className={styles.muted}>{secondary}</span>}
        {isMobile && <span className={styles.muted}>{[getPlayerTypeLabel(player.playerType), subAgentOf(row)].filter(Boolean).join(' · ')}</span>}
        {player.referredBy?.id && <span className={styles.positive}>Referred by: {player.referredBy.name || player.referredBy.username || player.referredBy.id}{player.referredBy.phone ? ` (${player.referredBy.phone})` : ''}</span>}
      </div>
    } },
    { key: 'subAgent', header: 'Sub-Agent', hidden: isMobile, cell: row => { const name = subAgentOf(row); return name === 'Direct' ? <span className={styles.muted}>Direct</span> : name || '—' } },
    { key: 'type', header: 'Type', hidden: isMobile, cell: row => <StatusPill tone="info">{getPlayerTypeLabel(row.player?.playerType)}</StatusPill> },
    { key: 'balance', header: 'Balance', sort: true, align: 'right', cell: row => {
      const player = row.player
      if (!player) return '—'
      // A credit player's balance is its chips (spec 2026-11-02 §2), with its Ref P/L under it.
      if (isCreditPlayer(row) && player.chips) return <ChipBalance chips={player.chips} visible={canViewCredit} mask={mask} />
      return canViewWallet ? fmt(player.wallet?.balance || 0) : mask
    } },
    { key: 'exposure', header: 'Exposure', align: 'right', hidden: isMobile, cell: row => { const value = Number(row.stats?.totalExposure || row.player?.wallet?.exposure || 0); return <span className={value > 0 ? styles.warning : undefined}>{canViewWallet ? fmt(value) : mask}</span> } },
    { key: 'activity', header: 'Last Activity', hidden: isMobile, cell: row => {
      const activity = row.stats?.lastActivityAt ?? row.stats?.lastLogin, bet = row.stats?.lastBetAt, days = row.stats?.daysSinceLastBet
      if (!activity && !bet && days == null) return <span className={styles.muted}>Never</span>
      const betText = days != null ? `Last bet ${days === 0 ? 'today' : `${days}d ago`}` : bet ? `Last bet ${formatDateTime(bet, 'dd MMM yyyy')}` : null
      return <div className={styles.rowDetails}>
        {activity ? <span title={formatDateTime(activity, 'dd MMM yyyy, hh:mm a')}>{dayjs(activity).fromNow()}</span> : <span className={styles.muted}>No sign-in</span>}
        {betText && <span className={styles.muted} title={bet ? formatDateTime(bet, 'dd MMM yyyy, hh:mm a') : undefined}>{betText}</span>}
      </div>
    } },
    { key: 'status', header: 'Status', hidden: isMobile, cell: row => <StatusPill status={row.player?.status || ''}>{row.player?.status?.toUpperCase() || '—'}</StatusPill> },
  ]
  const reload = () => { void refetch(); void refetchCounts() }
  return <div className={clsx(styles.stack, styles.tabPanel)}>
    <div className={clsx(styles.tabKpis, styles.tabKpis3)} role="group" aria-label="Player figures">
      <AccountListMetric label="Players" value={total} note="Direct and under sub-agents" icon={<IconUsers size={18} />} hue="blu" loading={pending} />
      <AccountListMetric label="Active" value={active ?? '—'} note={active != null && total > 0 ? `${((active / total) * 100).toFixed(1)}% of players` : 'Status active'} icon={<IconUserCheck size={18} />} hue="grn" loading={countsPending} />
      <AccountListMetric label="Not Active" value={active != null ? Math.max(0, total - active) : '—'} note="Inactive or suspended" icon={<IconUserOff size={18} />} hue="amb" loading={countsPending} />
    </div>
    <Card title="Players" sub="Direct players and the players under sub-agents" body="table" tools={<Button size="sm" onClick={reload}>Refresh</Button>}>
      <DataTable label="Agent downline players" columns={columns} rows={players} rowKey={row => row.player?.id || ''} state={loading ? 'loading' : error ? 'error' : 'ready'} error={error?.message || 'Failed to load players'} onRetry={() => void refetch()} empty={<EmptyState title="No players found for this agent" />}
        density={isMobile ? 'compact' : undefined} width={isMobile ? 'fill' : undefined}
        sort={sortBy && sortOrder ? { key: sortBy, dir: sortOrder } : null} onSortChange={sort => { setSortBy(sort?.key); setSortOrder(sort?.dir); if (sort) setCurrentPage(1) }}
        pagination={{ current: currentPage, pageSize, total, loading, onChange: setCurrentPage, onPageSizeChange: size => { setPageSize(size); setCurrentPage(1) }, pageSizeOptions: [10, 20, 50], itemName: 'players' }} />
    </Card>
  </div>
}
