import { useMemo, useState } from 'react'
import { gql, useQuery } from '@apollo/client'
import { nowIST } from '@/shared/utils/date'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Card } from '@/ui/components/Card'
import { Select } from '@/ui/components/Select'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { DescriptionList } from '@/ui/components/DescriptionList'
import type { CasinoBet } from '../../casinoLiveModel'
import styles from '../../CasinoLive.module.css'
const CASINO_BETS_QUERY = gql`
  query CasinoBets($query: CasinoBetsQuery) {
    casinoBets(query: $query) {
      id
      userId
      userName
      gameId
      gameName
      stake
      payout
      winAmount
      netAmount
      status
      currency
      createdAt
      settledAt
    }
  }
`

interface BigWin {
  id: string
  userId: string | number
  userName?: string | null
  gameId: string | number
  gameName?: string | null
  stake: number
  payout: number
  netWin: number
  multiplier: number
  timestamp: string
  status: string
}

interface BigWinAlertsProps {
  windowMins?: number
}

export function BigWinAlerts({ windowMins = 10 }: BigWinAlertsProps) {
  const { formatAmount, convertFromWhitelabelCurrency, getCurrencySymbol } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const [threshold, setThreshold] = useState(1000) // Default threshold in base currency
  const [minMultiplier, setMinMultiplier] = useState(10) // Minimum win multiplier

  const dateFrom = useMemo(() => {
    return nowIST().subtract(windowMins, 'minute').toISOString()
  }, [windowMins])

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data: betsData, loading, error } = useQuery<{ casinoBets: CasinoBet[] }>(CASINO_BETS_QUERY, {
    variables: {
      query: {
        dateFrom,
        status: 'won', // Only fetch won bets for better performance
        limit: 5000,
      },
    },
    pollInterval: 30000, // Poll every 30 seconds
    fetchPolicy: "network-only",
  })

  // Detect big wins from bets - only use real data from backend
  const bigWins = useMemo(() => {
    if (!betsData?.casinoBets || betsData.casinoBets.length === 0) {
      return []
    }

    const wins: BigWin[] = []

    betsData.casinoBets.forEach((bet: CasinoBet) => {
      // Ensure status is won and we have payout data
      if (bet.status === 'won' && (bet.payout || bet.winAmount)) {
        // Convert to numbers (they might come as strings from GraphQL)
        const stake = Number(bet.stake) || 0
        const payout = Number(bet.payout || bet.winAmount) || 0
        
        // Use netAmount if available, otherwise calculate
        const netWin = bet.netAmount != null ? Number(bet.netAmount) : (payout - stake)
        const multiplier = stake > 0 ? payout / stake : 0

        // Check if it meets threshold criteria (netWin must be positive and meet thresholds)
        if (netWin > 0 && netWin >= threshold && multiplier >= minMultiplier) {
          wins.push({
            id: bet.id,
            userId: bet.userId,
            userName: bet.userName || null,
            gameId: bet.gameId,
            gameName: bet.gameName || null,
            stake,
            payout,
            netWin,
            multiplier,
            timestamp: bet.settledAt || bet.createdAt,
            status: bet.status,
          })
        }
      }
    })

    // Sort by net win (highest first)
    return wins.sort((a, b) => b.netWin - a.netWin)
  }, [betsData, threshold, minMultiplier])

  // Calculate statistics
  const stats = useMemo(() => {
    if (bigWins.length === 0) {
      return {
        totalWins: 0,
        totalNetWin: 0,
        averageWin: 0,
        largestWin: 0,
        averageMultiplier: 0,
      }
    }

    const totalNetWin = bigWins.reduce((sum, win) => sum + win.netWin, 0)
    const averageWin = totalNetWin / bigWins.length
    const largestWin = Math.max(...bigWins.map((w) => w.netWin))
    const averageMultiplier = bigWins.reduce((sum, win) => sum + win.multiplier, 0) / bigWins.length

    return {
      totalWins: bigWins.length,
      totalNetWin,
      averageWin,
      largestWin,
      averageMultiplier,
    }
  }, [bigWins])


  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  return <Card title="Big Win Alerts" sub={`${windowMins}m`} tools={<div className={styles.actions}><Select label="Minimum net win" hideLabel size="sm" value={String(threshold)} onChange={value => setThreshold(Number(value))} options={[500, 1000, 2000, 5000, 10000].map(value => ({ value: String(value), label: `${getCurrencySymbol()}${value < 1000 ? value : `${value / 1000}K`}+` }))} /><Select label="Minimum multiplier" hideLabel size="sm" value={String(minMultiplier)} onChange={value => setMinMultiplier(Number(value))} options={[5, 10, 20, 50, 100].map(value => ({ value: String(value), label: `${value}x+` }))} />{bigWins.length > 0 && <StatusPill tone="info">{bigWins.length} wins</StatusPill>}</div>}>
    {loading ? <LoadingState label="Loading big wins..." /> : error ? <Notice tone="error" title="Error loading data">{error.message}</Notice> : !bigWins.length ? <EmptyState title="No big wins detected" description={`Wins above ${fmt(threshold)} and ${minMultiplier}x+ multiplier`} /> : <div className={styles.stack}><div className={styles.grid4}><Stat variant="bare" label="Total Wins" value={stats.totalWins} size="compact" /><Stat variant="bare" label="Net Win" value={fmt(stats.totalNetWin)} hue="grn" size="compact" /><Stat variant="bare" label="Largest" value={fmt(stats.largestWin)} size="compact" /><Stat variant="bare" label="Avg Mult" value={`${stats.averageMultiplier.toFixed(1)}x`} hue="amb" size="compact" /></div>
      <div className={styles.feedList}>{bigWins.map(win => <article key={win.id} className={styles.feedItem}><div className={styles.actions}><h3 className={styles.heading}>{win.gameName || `Game ${win.gameId}`}</h3><StatusPill tone={win.netWin >= 10000 ? 'neg' : win.netWin >= 2000 ? 'warn' : 'ok'}>{win.netWin >= 10000 ? 'Mega Win' : win.netWin >= 5000 ? 'Big Win' : win.netWin >= 2000 ? 'Large Win' : 'Win'}</StatusPill><StatusPill tone={win.multiplier >= 100 ? 'neg' : win.multiplier >= 20 ? 'warn' : 'ok'}>{win.multiplier.toFixed(1)}x</StatusPill></div>
        <DescriptionList items={[{ term: 'Stake', value: fmt(win.stake) }, { term: 'Payout', value: fmt(win.payout) }, { term: 'Net Win', value: <strong className={styles.positive}>+{fmt(win.netWin)}</strong> }]} />
        <div className={styles.feedBottom}><span>{win.userName || `User #${win.userId}`}</span><span className={styles.muted} title={formatDateTime(win.timestamp, 'yyyy-MM-dd HH:mm:ss')}>{formatDateTime(win.timestamp)}</span><StatusPill tone="ok">Won</StatusPill></div>
      </article>)}</div>
    </div>}
  </Card>
}

