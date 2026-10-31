import type { MatkaBetsData, MatkaBet } from '../../liveUiModel'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { Tooltip } from '@/ui/components/Tooltip'
import styles from '../../MatkaLiveUi.module.css'
import { useQuery } from '@apollo/client'
import { useMemo, useState } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { gql } from '@apollo/client'
import dayjs from 'dayjs'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

const MATKA_BETS_QUERY = gql`
  query MatkaBets($query: MatkaBetsQuery) {
    matkaBets(query: $query) {
      id
      userId
      userName
      betAmount
      potentialWin
      status
      createdAt
      matkaType
      marketName
      bidType
    }
  }
`

interface TopPlayersTableProps {
  sortBy?: 'wagered' | 'exposure' | 'bets' | 'payouts'
}

interface PlayerStats {
  userId: string
  userName: string
  wagered: number
  payouts: number
  exposure: number
  bets: number
  avgBet: number
  matkasPlayed: number
  marketsPlayed: number
  bidTypesPlayed: number
  lastActivity: string
}

export const TopPlayersTable: React.FC<TopPlayersTableProps> = ({ sortBy = 'wagered' }) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const [sortField, setSortField] = useState(sortBy)
  const permissions = useAuthStore(s => s.permissions)
  const hasFinanceView = hasPermissionWithNested(permissions, 'settlements.center', 'view')
  const { formatDateTime } = useFormatDate()

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data, loading } = useQuery<MatkaBetsData>(MATKA_BETS_QUERY, {
    variables: {
      query: {
        statuses: ['pending', 'active'],
        limit: 5000,
      },
    },
    pollInterval: 10000,
    fetchPolicy: "network-only",
  })

  const playerStats = useMemo(() => {
    const bets = data?.matkaBets || []
    const playerMap = new Map<string, PlayerStats>()
    const matkaSetMap = new Map<string, Set<string>>()
    const marketSetMap = new Map<string, Set<string>>()
    const bidTypeSetMap = new Map<string, Set<string>>()

    bets.forEach((bet: MatkaBet) => {
      const userId = String(bet.userId)
      const stats = playerMap.get(userId) || {
        userId,
        userName: bet.userName || `User #${userId}`,
        wagered: 0,
        payouts: 0,
        exposure: 0,
        bets: 0,
        avgBet: 0,
        matkasPlayed: 0,
        marketsPlayed: 0,
        bidTypesPlayed: 0,
        lastActivity: bet.createdAt,
      }

      stats.wagered += Number(bet.betAmount) || 0
      stats.payouts += Number(bet.potentialWin) || 0
      stats.bets += 1

      if (bet.matkaType) {
        if (!matkaSetMap.has(userId)) matkaSetMap.set(userId, new Set())
        matkaSetMap.get(userId)!.add(bet.matkaType)
      }

      if (bet.marketName) {
        if (!marketSetMap.has(userId)) marketSetMap.set(userId, new Set())
        marketSetMap.get(userId)!.add(bet.marketName)
      }

      if (bet.bidType) {
        if (!bidTypeSetMap.has(userId)) bidTypeSetMap.set(userId, new Set())
        bidTypeSetMap.get(userId)!.add(bet.bidType)
      }

      if (dayjs(bet.createdAt).isAfter(dayjs(stats.lastActivity))) {
        stats.lastActivity = bet.createdAt
      }

      playerMap.set(userId, stats)
    })

    // Calculate derived metrics
    const result: PlayerStats[] = Array.from(playerMap.values()).map(stats => {
      stats.exposure = Math.max(0, stats.wagered - stats.payouts)
      stats.avgBet = stats.bets > 0 ? stats.wagered / stats.bets : 0
      stats.matkasPlayed = matkaSetMap.get(stats.userId)?.size || 0
      stats.marketsPlayed = marketSetMap.get(stats.userId)?.size || 0
      stats.bidTypesPlayed = bidTypeSetMap.get(stats.userId)?.size || 0

      return stats
    })

    // Sort by selected field
    return result.sort((a, b) => {
      switch (sortField) {
        case 'exposure':
          return b.exposure - a.exposure
        case 'bets':
          return b.bets - a.bets
        case 'payouts':
          return b.payouts - a.payouts
        default:
          return b.wagered - a.wagered
      }
    }).slice(0, 50) // Top 50
  }, [data, sortField])

  const maskAmount = (amount: number) => {
    return hasFinanceView ? formatAmount(convertFromWhitelabelCurrency(amount)) : '••••'
  }

  const columns: DataTableColumn<PlayerStats>[] = [
    { key: 'rank', header: 'Rank', minWidth: 90, cell: (_row, index) => <span className={styles.rank}>{index + 1}</span> },
    { key: 'player', header: 'Player', minWidth: 180, cell: player => player.userName || `User #${player.userId}` },
    { key: 'wagered', header: 'Wagered', align: 'right', minWidth: 140, cell: player => maskAmount(player.wagered) },
    { key: 'payouts', header: 'Potential Payouts', align: 'right', minWidth: 160, cell: player => maskAmount(player.payouts) },
    { key: 'exposure', header: 'Exposure', align: 'right', minWidth: 140, cell: player => <span className={styles.negative}>{maskAmount(player.exposure)}</span> },
    { key: 'bets', header: 'Bets', align: 'right', minWidth: 90, cell: player => player.bets.toLocaleString() },
    { key: 'average', header: 'Avg Bet', align: 'right', minWidth: 140, cell: player => maskAmount(player.avgBet) },
    { key: 'markets', header: 'Markets', minWidth: 100, cell: player => <Tooltip content={`${player.matkasPlayed} matkas, ${player.marketsPlayed} markets, ${player.bidTypesPlayed} bid types`}><span tabIndex={0}>{player.marketsPlayed}</span></Tooltip> },
    { key: 'activity', header: 'Last Activity', minWidth: 155, cell: player => <Tooltip content={player.lastActivity ? formatDateTime(player.lastActivity, 'yyyy-MM-dd HH:mm:ss') : ''}><span tabIndex={0}>{player.lastActivity ? formatDateTime(player.lastActivity, 'MM/dd HH:mm') : '—'}</span></Tooltip> },
  ]
  return <Card title="Top Players" sub={`Ranked by ${sortField === 'exposure' ? 'Exposure' : sortField === 'bets' ? 'Bets' : sortField === 'payouts' ? 'Potential Payouts' : 'Wagered'}`} body="table" tools={<SegmentedControl label="Player ranking" value={sortField} onChange={value => setSortField(value as typeof sortField)} options={[{ value: 'wagered', label: 'Wagered' }, { value: 'exposure', label: 'Exposure' }, { value: 'bets', label: 'Bets' }, { value: 'payouts', label: 'Payouts' }]} />}>
    <DataTable columns={columns} rows={playerStats} rowKey={player => player.userId} label="Top Matka players" width="wide" state={loading ? 'loading' : 'ready'} />
  </Card>
}

