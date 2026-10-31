import { useNavigate } from 'react-router-dom'
import { useQuery, gql } from '@apollo/client'
import { IconUser, IconCoin } from '@tabler/icons-react'
import { formatDistanceToNow } from 'date-fns'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { formatInTimeZone, addDays, startOfDay, DEFAULT_ADMIN_TZ } from '@/shared/utils/date'
import { Stat } from '@/ui/components/Stat'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { StatusPill } from '@/ui/components/StatusPill'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import styles from '../AgentHome.module.css'

const TOP_PLAYERS_QUERY = gql`
  query TopPlayers($agentId: ID!, $periodFrom: String!, $periodTo: String!, $limit: Int!) {
    reporting {
      topPlayers(agentId: $agentId, periodFrom: $periodFrom, periodTo: $periodTo, limit: $limit) {
        playerId
        playerName
        username
        totalGGR
        totalBets
        status
        lastBetAt
      }
    }
  }
`

const RECENT_PLAYERS_QUERY = gql`
  query RecentPlayers($agentId: ID!) {
    agents {
      agentDashboardStats(agentId: $agentId) {
        newPlayersToday
      }
    }
  }
`

interface PlayerQuickViewProps { agentId: string }
interface TopPlayerRow { playerId: string; playerName?: string; username?: string; totalGGR?: number; totalBets?: number; status?: string; lastBetAt?: string }
export default function PlayerQuickView({ agentId }: PlayerQuickViewProps) {
  const navigate = useNavigate()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const now = new Date()
  const tz = DEFAULT_ADMIN_TZ
  const periodFrom = formatInTimeZone(addDays(startOfDay(now, tz), -7), 'yyyy-MM-dd', tz)
  const periodTo = formatInTimeZone(now, 'yyyy-MM-dd', tz)
  const { data: topPlayersData, loading: topPlayersLoading, error } = useQuery<{ reporting?: { topPlayers?: TopPlayerRow[] } }>(TOP_PLAYERS_QUERY, { variables: { agentId, periodFrom, periodTo, limit: 5 }, skip: !agentId })
  const { data: recentData } = useQuery<{ agents?: { agentDashboardStats?: { newPlayersToday?: number } } }>(RECENT_PLAYERS_QUERY, { variables: { agentId }, skip: !agentId })
  const topPlayers = topPlayersData?.reporting?.topPlayers || []
  const newPlayersToday = recentData?.agents?.agentDashboardStats?.newPlayersToday || 0
  const columns: DataTableColumn<TopPlayerRow>[] = [
    { key: 'player', header: 'Player', cell: p => p.playerName || p.username || `Player ${p.playerId}` },
    { key: 'status', header: 'Status', cell: p => <StatusPill tone={p.status === 'ACTIVE' ? 'ok' : p.status === 'SUSPENDED' ? 'warn' : 'neg'}>{p.status ?? 'Unknown'}</StatusPill> },
    { key: 'ggr', header: 'Total GGR', align: 'right', cell: p => formatAmount(convertFromWhitelabelCurrency(p.totalGGR ?? 0)) },
    { key: 'bets', header: 'Total Bets', align: 'right', cell: p => p.totalBets },
    { key: 'last', header: 'Last Bet', cell: p => p.lastBetAt && Number.isFinite(Date.parse(p.lastBetAt)) ? formatDistanceToNow(new Date(p.lastBetAt), { addSuffix: true }) : 'N/A' },
    { key: 'actions', header: 'Actions', cell: p => <Button variant="link" size="xs" onClick={() => navigate(`/players/profile/${p.playerId}`)}>View</Button> },
  ]
  const totalGGR = topPlayers.reduce((sum, p) => sum + (p.totalGGR ?? 0), 0)
  return <div className={styles.stack}>
    <div className={styles.three}>
      <Stat label="New Players Today" value={newPlayersToday} note="Today" icon={<IconUser size={20} />} hue="blu" />
      <Stat label="Top Players" value={topPlayers.length} note="Last 7 Days" icon={<IconUser size={20} />} hue="grn" />
      <Stat label="Total GGR (Top 5)" value={formatAmount(convertFromWhitelabelCurrency(totalGGR ?? 0))} note={`${totalGGR ? (totalGGR / 1000).toFixed(1) + 'K' : '0'} · INR`} icon={<IconCoin size={20} />} hue="vio" />
    </div>
    <Card title="Top Players" body="table"><DataTable columns={columns} rows={topPlayers} rowKey={p => p.playerId} label="Top players" pagination={false} width="wide" state={topPlayersLoading ? 'loading' : error ? 'error' : 'ready'} error={error?.message} /></Card>
  </div>
}

