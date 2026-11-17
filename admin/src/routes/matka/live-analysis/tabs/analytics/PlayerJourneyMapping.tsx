import type { MatkaBet, MatkaBetsData } from '../../liveUiModel'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { TextField } from '@/ui/components/TextField'
import { EmptyState } from '@/ui/components/EmptyState'
import { StatusPill } from '@/ui/components/StatusPill'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../MatkaLiveUi.module.css'
import { useMemo, useState } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useQuery } from '@apollo/client'
import { gql } from '@apollo/client'
import dayjs from 'dayjs'
import { nowIST } from '@/shared/utils/date'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

const MATKA_BETS_QUERY = gql`
  query MatkaBets($query: MatkaBetsQuery) {
    matkaBets(query: $query) {
      id
      userId
      userName
      matkaId
      matkaName
      matkaType
      marketName
      bidType
      betAmount
      potentialWin
      actualWin
      status
      createdAt
    }
  }
`

export const PlayerJourneyMapping: React.FC = () => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatTime } = useFormatDate()
  // Each player's and each bet's amounts only with settlements.center view, masked in the page as on the Players tab and in
  // Player Analytics (matkaBets sends amounts to every caller); counts, statuses and times stay (owner, 2026-11-04).
  const permissions = useAuthStore(s => s.permissions)
  const hasFinanceView = hasPermissionWithNested(permissions, 'settlements.center', 'view')
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Get recent bets for journey mapping (last 24 hours, all statuses to see full journey)
  const dateFrom = useMemo(() => {
    return nowIST().subtract(24, 'hour').toISOString()
  }, [])

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data: betsData } = useQuery<MatkaBetsData>(MATKA_BETS_QUERY, {
    variables: {
      query: {
        dateFrom,
        limit: 10000,
      },
    },
    pollInterval: 30000,
    fetchPolicy: "network-only",
  })

  // Map player journeys
  const playerJourneys = useMemo(() => {
    if (!betsData?.matkaBets) return []

    const journeysMap = new Map<string, {
      userId: string
      userName: string | null
      matkas: Set<string>
      matkaNames: Map<string, string>
      totalBets: number
      totalWagered: number
      totalPayouts: number
      firstBet: string
      lastBet: string
      betSequence: Array<{
        matkaId: string
        matkaName: string
        matkaType: string
        marketName: string
        bidType: string
        betAmount: number
        potentialWin: number | null
        actualWin: number | null
        status: string
        timestamp: string
      }>
    }>()

    betsData.matkaBets.forEach((bet: MatkaBet) => {
      const userId = String(bet.userId)
      if (!journeysMap.has(userId)) {
        journeysMap.set(userId, {
          userId,
          userName: bet.userName || null,
          matkas: new Set(),
          matkaNames: new Map(),
          totalBets: 0,
          totalWagered: 0,
          totalPayouts: 0,
          firstBet: bet.createdAt,
          lastBet: bet.createdAt,
          betSequence: [],
        })
      }

      const journey = journeysMap.get(userId)!
      journey.matkas.add(bet.matkaId)
      if (bet.matkaName) {
        journey.matkaNames.set(bet.matkaId, bet.matkaName)
      }
      journey.totalBets += 1
      journey.totalWagered += Number(bet.betAmount) || 0
      // What the bet has paid: nothing while open, 0 when lost, the stake back when void. GGR is stake less paid, as
      // PlayerPerformanceWidget, the dashboard and Top Matkas count it; a potential win is exposure, not a payout.
      journey.totalPayouts += Number(bet.actualWin || 0)
      
      if (dayjs(bet.createdAt).isBefore(dayjs(journey.firstBet))) {
        journey.firstBet = bet.createdAt
      }
      if (dayjs(bet.createdAt).isAfter(dayjs(journey.lastBet))) {
        journey.lastBet = bet.createdAt
      }

      journey.betSequence.push({
        matkaId: bet.matkaId,
        matkaName: bet.matkaName || `Matka ${bet.matkaId}`,
        matkaType: bet.matkaType,
        marketName: bet.marketName,
        bidType: bet.bidType,
        betAmount: Number(bet.betAmount) || 0,
        potentialWin: bet.potentialWin ? Number(bet.potentialWin) : null,
        actualWin: bet.actualWin ? Number(bet.actualWin) : null,
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
        matkaCount: journey.matkas.size,
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
        journey.betSequence.some(bet => bet.matkaName.toLowerCase().includes(query))
      })
      .slice(0, 50)
  }, [playerJourneys, searchQuery])

  // A masked figure keeps the plain amount colour and no sign, so whether it is up or down is not given away either.
  const money = (value: number) => (hasFinanceView ? formatAmount(convertFromWhitelabelCurrency(value)) : '••••')
  return <Card title="Player Journey Mapping" sub="Track player paths & bet transitions">
    {!playerJourneys.length ? <EmptyState title="No player journey data available" /> : <div className={styles.journeyColumns}>
      <section className={styles.stack}><h3 className={styles.heading}>Players List · {filteredPlayers.length} players</h3><TextField label="Search player journeys" value={searchQuery} onChange={setSearchQuery} clearable placeholder="Search by player ID or matka..." />
        <ul className={styles.list}>{filteredPlayers.map(journey => <li key={journey.userId} className={styles.item}><Button variant={selectedPlayer === journey.userId ? 'primary' : 'secondary'} aria-pressed={selectedPlayer === journey.userId} onClick={() => setSelectedPlayer(journey.userId)}>{journey.userName || `User #${journey.userId}`}</Button><p className={styles.muted}>{journey.totalBets} bets · {journey.matkaCount} matkas · {journey.sessionDuration}m</p><DescriptionList items={[{ term: 'Wagered', value: money(journey.totalWagered) }, { term: 'GGR', value: <span className={!hasFinanceView ? styles.amount : journey.ggr >= 0 ? styles.positive : styles.negative}>{money(journey.ggr)}</span> }]} /></li>)}</ul>
      </section>
      {selectedJourney ? <section className={styles.stack}><div className={styles.row}><h3 className={styles.heading}>{selectedJourney.userName || `User #${selectedJourney.userId}`}</h3><Button size="sm" onClick={() => setSelectedPlayer(null)}>Clear</Button></div><DescriptionList items={[{ term: 'Bets', value: selectedJourney.totalBets }, { term: 'Matkas', value: selectedJourney.matkaCount }, { term: 'Wagered', value: money(selectedJourney.totalWagered) }, { term: 'GGR', value: money(selectedJourney.ggr) }]} /><h4 className={styles.heading}>Bet Journey</h4><ol className={styles.timeline}>{selectedJourney.betSequence.map((bet, index) => {
        // An open bet ('pending' or 'active') has no result yet: no net figure, and its potential win shown only as potential.
        // A settled bet shows what it paid: 0 when lost, the stake back (a refund, not a win) when void.
        const status = bet.status.toLowerCase()
        const open = status === 'pending' || status === 'active'
        const paid = Number(bet.actualWin || 0)
        const netAmount = paid - Number(bet.betAmount)
        const outcome = open ? (bet.potentialWin ? [{ term: 'Potential win', value: money(bet.potentialWin) }] : []) : [{ term: status === 'void' ? 'Refund' : 'Win', value: money(paid) }]
        return <li key={index} className={styles.item}><div className={styles.row}><span className={styles.inline}><span className={styles.rank}>{index + 1}</span><h5 className={styles.heading}>{bet.matkaName}</h5><StatusPill status={bet.status}>{bet.status.toUpperCase()}</StatusPill></span>{!open && <span className={hasFinanceView && netAmount > 0 ? styles.positive : hasFinanceView && netAmount < 0 ? styles.negative : styles.amount}>{hasFinanceView && netAmount > 0 ? '+' : ''}{money(netAmount)}</span>}</div><p className={styles.muted}>{bet.matkaType} · {bet.marketName} · {bet.bidType}</p><DescriptionList items={[{ term: 'Bet', value: money(bet.betAmount) }, ...outcome, { term: 'Time', value: bet.timestamp ? formatTime(bet.timestamp, 'HH:mm:ss') : '—' }]} /></li>
      })}</ol></section> : <EmptyState title="Select a player to view journey" description="Click on any player from the list" />}
    </div>}
  </Card>
}

