import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { gql, useQuery } from '@apollo/client'
import dayjs from 'dayjs'
import { nowIST } from '@/shared/utils/date'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { Stat } from '@/ui/components/Stat'
import { SearchField } from '@/ui/components/SearchField'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
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
      status
      createdAt
    }
  }
`

interface PlayerJourneyMappingProps {
  windowMins?: number
}

export function PlayerJourneyMapping({ windowMins = 60 }: PlayerJourneyMappingProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatTime } = useFormatDate()
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')

  const dateFrom = useMemo(() => {
    return nowIST().subtract(windowMins, 'minute').toISOString()
  }, [windowMins])

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data: betsData } = useQuery<{ casinoBets: CasinoBet[] }>(CASINO_BETS_QUERY, {
    variables: {
      query: {
        dateFrom,
        limit: 10000,
      },
    },
    pollInterval: 30000, // Poll every 30 seconds for live updates
    fetchPolicy: "network-only",
  })

  // Map player journeys
  const playerJourneys = useMemo(() => {
    if (!betsData?.casinoBets) return []

    const journeysMap = new Map<string, {
      userId: string
      userName: string | null
      games: Set<string>
      gameNames: Map<string, string>
      totalBets: number
      totalWagered: number
      totalPayouts: number
      firstBet: string
      lastBet: string
      betSequence: Array<{
        gameId: string
        gameName: string
        stake: number
        payout: number | null
        status: string
        timestamp: string
      }>
    }>()

    betsData.casinoBets.forEach((bet: CasinoBet) => {
      const userId = String(bet.userId)
      if (!journeysMap.has(userId)) {
        journeysMap.set(userId, {
          userId,
          userName: bet.userName || null,
          games: new Set(),
          gameNames: new Map(),
          totalBets: 0,
          totalWagered: 0,
          totalPayouts: 0,
          firstBet: bet.createdAt,
          lastBet: bet.createdAt,
          betSequence: [],
        })
      }

      const journey = journeysMap.get(userId)!
      journey.games.add(String(bet.gameId))
      if (bet.gameName) {
        journey.gameNames.set(String(bet.gameId), bet.gameName)
      }
      journey.totalBets += 1
      journey.totalWagered += bet.stake || 0
      journey.totalPayouts += bet.payout || 0
      
      if (dayjs(bet.createdAt).isBefore(dayjs(journey.firstBet))) {
        journey.firstBet = bet.createdAt
      }
      if (dayjs(bet.createdAt).isAfter(dayjs(journey.lastBet))) {
        journey.lastBet = bet.createdAt
      }

      journey.betSequence.push({
        gameId: String(bet.gameId),
        gameName: bet.gameName || `Game ${bet.gameId}`,
        stake: bet.stake || 0,
        payout: bet.payout ?? null,
        status: bet.status,
        timestamp: bet.createdAt,
      })
    })

    // Sort bet sequences by timestamp (most recent first)
    Array.from(journeysMap.values()).forEach((journey) => {
      journey.betSequence.sort((a, b) => 
        dayjs(b.timestamp).valueOf() - dayjs(a.timestamp).valueOf()
      )
    })

    return Array.from(journeysMap.values())
      .map((journey) => ({
        ...journey,
        gameCount: journey.games.size,
        ggr: journey.totalWagered - journey.totalPayouts,
        sessionDuration: dayjs(journey.lastBet).diff(dayjs(journey.firstBet), 'minute'),
        avgBetSize: journey.totalBets > 0 ? journey.totalWagered / journey.totalBets : 0,
        winRate: journey.totalBets > 0 
          ? (journey.betSequence.filter(b => b.status === 'won').length / journey.totalBets) * 100 
          : 0,
      }))
      .sort((a, b) => dayjs(b.lastBet).valueOf() - dayjs(a.lastBet).valueOf())
  }, [betsData])

  // Get selected player journey
  const selectedJourney = useMemo(() => {
    if (!selectedPlayer) return null
    return playerJourneys.find((j) => j.userId === selectedPlayer)
  }, [selectedPlayer, playerJourneys])

  // Filter players based on search query
  const filteredPlayers = useMemo(() => {
    if (!searchQuery.trim()) {
      return playerJourneys.slice(0, 50)
    }
    const query = searchQuery.toLowerCase()
    return playerJourneys
      .filter((journey) => {
        const userName = (journey.userName || `User #${journey.userId}`).toLowerCase()
        return userName.includes(query) ||
        journey.userId.toLowerCase().includes(query) ||
        journey.betSequence.some(bet => bet.gameName.toLowerCase().includes(query))
      })
      .slice(0, 50)
  }, [playerJourneys, searchQuery])


  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  return <Card title="Player Journey Mapping">{!playerJourneys.length ? <EmptyState title="Loading player journey data..." /> : <div className={styles.journeyColumns}>
    <section className={styles.stack}><div className={styles.feedTop}><h3 className={styles.heading}>Players List</h3><span className={styles.muted}>{filteredPlayers.length} players</span></div><SearchField label="Search player journeys" placeholder="Search by player ID or game..." value={searchQuery} onChange={setSearchQuery} size="sm" />
      <div className={styles.feedList}>{filteredPlayers.map(journey => <article key={journey.userId} className={clsx(styles.feedItem, selectedPlayer === journey.userId && styles.feedNew)}><Button variant="link" aria-pressed={selectedPlayer === journey.userId} onClick={() => setSelectedPlayer(journey.userId)}>{journey.userName || `User #${journey.userId}`}</Button><div className={styles.actions}><span className={styles.muted}>{journey.totalBets} bets</span><span className={styles.muted}>{journey.gameCount} games</span><span className={styles.muted}>{journey.sessionDuration}m</span><StatusPill tone={journey.winRate > 50 ? 'ok' : journey.winRate > 30 ? 'warn' : 'neg'}>{journey.winRate.toFixed(1)}%</StatusPill></div>
        <DescriptionList items={[{ term: 'Wagered', value: fmt(journey.totalWagered) }, { term: 'GGR', value: <strong className={journey.ggr >= 0 ? styles.positive : styles.negative}>{fmt(journey.ggr)}</strong> }]} />
      </article>)}</div>
    </section>
    <section className={styles.stack}>{!selectedJourney ? <EmptyState title="Select a player to view journey" description="Click on any player from the list" /> : <><div className={styles.feedTop}><h3 className={styles.heading}>{selectedJourney.userName || `User #${selectedJourney.userId}`}</h3><Button size="sm" onClick={() => setSelectedPlayer(null)}>Clear</Button></div><div className={styles.grid4}><Stat variant="bare" label="Bets" value={selectedJourney.totalBets} size="compact" /><Stat variant="bare" label="Games" value={selectedJourney.gameCount} size="compact" /><Stat variant="bare" label="Wagered" value={fmt(selectedJourney.totalWagered)} size="compact" /><Stat variant="bare" label="Win Rate" value={`${selectedJourney.winRate.toFixed(1)}%`} size="compact" /></div>
      <div className={styles.feedTop}><h3 className={styles.heading}>Bet Journey</h3><div className={styles.actions}><StatusPill tone="ok">Won</StatusPill><StatusPill tone="neg">Lost</StatusPill><StatusPill>Pending</StatusPill></div></div>
      <ol className={styles.timeline}>{selectedJourney.betSequence.map((bet, index) => { const netAmount = bet.payout ? Number(bet.payout) - Number(bet.stake) : 0; return <li key={index} className={styles.feedItem}><div className={styles.feedTop}><strong>{index + 1}. {bet.gameName}</strong><StatusPill tone={bet.status === 'won' ? 'ok' : bet.status === 'lost' ? 'neg' : 'neutral'}>{bet.status.toUpperCase()}</StatusPill></div><DescriptionList items={[{ term: 'Stake', value: fmt(bet.stake) }, ...(bet.payout ? [{ term: 'Payout', value: fmt(bet.payout) }, { term: 'Net', value: <strong className={netAmount > 0 ? styles.positive : netAmount < 0 ? styles.negative : undefined}>{netAmount > 0 ? '+' : ''}{fmt(netAmount)}</strong> }] : []), { term: 'Time', value: formatTime(bet.timestamp, 'HH:mm:ss') }]} /></li> })}</ol>
    </>}</section>
  </div>}</Card>
}

