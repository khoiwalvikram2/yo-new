import { useMemo, useState } from 'react'
import { gql, useQuery } from '@apollo/client'
import dayjs from 'dayjs'
import { nowIST } from '@/shared/utils/date'
import { Card } from '@/ui/components/Card'
import { useCurrency } from '@/shared/core/CurrencyContext'
import type { CasinoBet } from '../../casinoLiveModel'
import styles from '../../CasinoLive.module.css'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
const CASINO_BETS_QUERY = gql`
  query CasinoBets($query: CasinoBetsQuery) {
    casinoBets(query: $query) {
      id
      userId
      userName
      stake
      payout
      netAmount
      status
      createdAt
      gameName
      vendorName
    }
  }
`

interface TopPlayersTableProps {
  windowMins?: number
  sortBy?: 'wagered' | 'ggr' | 'bets' | 'net'
}

interface PlayerStats {
  userId: string
  userName: string
  wagered: number
  payouts: number
  ggr: number
  bets: number
  netAmount: number
  avgBet: number
  rtp: number
  gamesPlayed: number
  vendorsPlayed: number
  lastActivity: string
  winRate: number
}

export function TopPlayersTable({ windowMins = 60, sortBy = 'wagered' }: TopPlayersTableProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const [sortField, setSortField] = useState(sortBy)

  const dateFrom = useMemo(() => {
    return nowIST().subtract(windowMins, 'minute').toISOString()
  }, [windowMins])

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data, loading } = useQuery<{ casinoBets: CasinoBet[] }>(CASINO_BETS_QUERY, {
    variables: {
      query: {
        dateFrom,
        limit: 5000,
      },
    },
    pollInterval: 10000,
    fetchPolicy: "network-only",
  })

  const playerStats = useMemo(() => {
    const bets = data?.casinoBets || []
    const playerMap = new Map<string, PlayerStats>()
    const gameSetMap = new Map<string, Set<string>>()
    const vendorSetMap = new Map<string, Set<string>>()

    bets.forEach((bet: CasinoBet) => {
      const userId = String(bet.userId)
      const stats = playerMap.get(userId) || {
        userId,
        userName: bet.userName || `User #${userId}`,
        wagered: 0,
        payouts: 0,
        ggr: 0,
        bets: 0,
        netAmount: 0,
        avgBet: 0,
        rtp: 0,
        gamesPlayed: 0,
        vendorsPlayed: 0,
        lastActivity: bet.createdAt,
        winRate: 0,
      }

      stats.wagered += Number(bet.stake) || 0
      stats.payouts += Number(bet.payout) || 0
      stats.bets += 1
      stats.netAmount += Number(bet.netAmount) || (bet.payout ? Number(bet.payout) - Number(bet.stake) : -Number(bet.stake))

      if (bet.gameName) {
        if (!gameSetMap.has(userId)) gameSetMap.set(userId, new Set())
        gameSetMap.get(userId)!.add(bet.gameName)
      }

      if (bet.vendorName) {
        if (!vendorSetMap.has(userId)) vendorSetMap.set(userId, new Set())
        vendorSetMap.get(userId)!.add(bet.vendorName)
      }

      if (dayjs(bet.createdAt).isAfter(dayjs(stats.lastActivity))) {
        stats.lastActivity = bet.createdAt
      }

      playerMap.set(userId, stats)
    })

    // Calculate derived metrics
    const result: PlayerStats[] = Array.from(playerMap.values()).map(stats => {
      stats.ggr = stats.wagered - stats.payouts
      stats.avgBet = stats.bets > 0 ? stats.wagered / stats.bets : 0
      stats.rtp = stats.wagered > 0 ? (stats.payouts / stats.wagered) * 100 : 0
      stats.gamesPlayed = gameSetMap.get(stats.userId)?.size || 0
      stats.vendorsPlayed = vendorSetMap.get(stats.userId)?.size || 0
      stats.winRate = stats.bets > 0 ? ((stats.bets - (stats.bets * (stats.ggr / stats.wagered || 0))) / stats.bets) * 100 : 0

      return stats
    })

    // Sort by selected field
    return result.sort((a, b) => {
      switch (sortField) {
        case 'ggr':
          return b.ggr - a.ggr
        case 'bets':
          return b.bets - a.bets
        case 'net':
          return b.netAmount - a.netAmount
        default:
          return b.wagered - a.wagered
      }
    }).slice(0, 50) // Top 50
  }, [data, sortField])

  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const columns: DataTableColumn<PlayerStats>[] = [
    { key: 'rank', header: 'Rank', cell: (_player, index) => `#${index + 1}`, minWidth: 80 },
    { key: 'player', header: 'Player', cell: player => player.userName || `User #${player.userId}`, minWidth: 150 },
    { key: 'wagered', header: 'Wagered', cell: player => fmt(player.wagered), minWidth: 110 },
    { key: 'ggr', header: 'GGR', cell: player => <span className={player.ggr >= 0 ? styles.positive : styles.negative}>{fmt(player.ggr)}</span>, minWidth: 110 },
    { key: 'bets', header: 'Bets', cell: player => player.bets.toLocaleString(), minWidth: 80 },
    { key: 'net', header: 'Net', cell: player => <span className={player.netAmount >= 0 ? styles.positive : styles.negative}>{player.netAmount >= 0 ? '+' : ''}{fmt(Math.abs(player.netAmount))}</span>, minWidth: 110 },
    { key: 'rtp', header: 'RTP', cell: player => <StatusPill tone={player.rtp < 90 ? 'ok' : player.rtp < 100 ? 'info' : player.rtp < 110 ? 'warn' : 'neg'}>{player.rtp.toFixed(1)}%</StatusPill>, minWidth: 90 },
    { key: 'avg', header: 'Avg Bet', cell: player => fmt(player.avgBet), minWidth: 110 },
    { key: 'games', header: 'Games', cell: player => <Tooltip content={`${player.gamesPlayed} games, ${player.vendorsPlayed} vendors`}><span tabIndex={0}>{player.gamesPlayed}</span></Tooltip>, minWidth: 80 },
    { key: 'activity', header: 'Last Activity', cell: player => <Tooltip content={formatDateTime(player.lastActivity, 'yyyy-MM-dd HH:mm:ss')}><span tabIndex={0}>{formatDateTime(player.lastActivity, 'MM/dd HH:mm')}</span></Tooltip>, minWidth: 130 },
  ]
  return <Card title="Top Players" body="table" tools={<div className={styles.actions}>{(['wagered', 'ggr', 'bets', 'net'] as const).map(field => <Button key={field} size="sm" variant={sortField === field ? 'primary' : 'secondary'} aria-pressed={sortField === field} onClick={() => setSortField(field)}>{field === 'ggr' ? 'GGR' : field[0].toUpperCase() + field.slice(1)}</Button>)}</div>}>
    <DataTable label="Top players" columns={columns} rows={playerStats} rowKey={player => player.userId} state={loading ? 'loading' : 'ready'} empty="No player data available" pagination={false} />
  </Card>
}

