import type { MatkaBetsData, MatkaBet } from '../../liveUiModel'
import clsx from 'clsx'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Button } from '@/ui/components/Button'
import { Tooltip } from '@/ui/components/Tooltip'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from '../../MatkaLiveUi.module.css'
import { useQuery } from '@apollo/client'
import { useMemo, useRef, useState, useEffect } from 'react'
import { gql } from '@apollo/client'
import dayjs from 'dayjs'
import { nowIST } from '@/shared/utils/date'

const MATKA_BETS_QUERY = gql`
  query MatkaBets($query: MatkaBetsQuery) {
    matkaBets(query: $query) {
      userId
      userName
      createdAt
    }
  }
`

export const PlayerHeatmapWidget: React.FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showLeftBtn, setShowLeftBtn] = useState(false)
  const [showRightBtn, setShowRightBtn] = useState(false)

  const checkScrollButtons = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
      setShowLeftBtn(scrollLeft > 0)
      setShowRightBtn(scrollLeft < scrollWidth - clientWidth - 10)
    }
  }

  // Get last 24 hours of data for player activity
  const dateFrom = useMemo(() => {
    return nowIST().subtract(24, 'hour').toISOString()
  }, [])

  // NOTE: Don't pass tenant from frontend - let backend derive both tenant and whitelabelId from context
  const { data, loading } = useQuery<MatkaBetsData>(MATKA_BETS_QUERY, {
    variables: {
      query: {
        dateFrom,
        limit: 10000,
      },
    },
    pollInterval: 30000,
    fetchPolicy: "network-only",
  })

  const heatmapData = useMemo(() => {
    const bets = data?.matkaBets || []
    
    // Group by player
    const playerActivity = new Map<string, {
      userId: string
      userName: string
      bets: number
      firstBet: string
      lastBet: string
    }>()

    bets.forEach((bet: MatkaBet) => {
      const userId = String(bet.userId)
      const stats = playerActivity.get(userId) || {
        userId,
        userName: bet.userName || `User #${userId}`,
        bets: 0,
        firstBet: bet.createdAt,
        lastBet: bet.createdAt,
      }

      stats.bets += 1
      if (dayjs(bet.createdAt).isBefore(dayjs(stats.firstBet))) {
        stats.firstBet = bet.createdAt
      }
      if (dayjs(bet.createdAt).isAfter(dayjs(stats.lastBet))) {
        stats.lastBet = bet.createdAt
      }

      playerActivity.set(userId, stats)
    })

    const players = Array.from(playerActivity.values())
      .sort((a, b) => b.bets - a.bets)
      .slice(0, 50) // Top 50 most active players

    const maxBets = Math.max(...players.map(p => p.bets), 1)

    return players.map(player => ({
      ...player,
      intensity: (player.bets / maxBets) * 100,
    }))
  }, [data])

  useEffect(() => {
    checkScrollButtons()
    const scrollEl = scrollRef.current
    if (scrollEl) {
      scrollEl.addEventListener('scroll', checkScrollButtons)
      return () => scrollEl.removeEventListener('scroll', checkScrollButtons)
    }
  }, [heatmapData])

  const intensityClass = (value: number) => value >= 80 ? styles.heatCritical : value >= 60 ? styles.heatHigh : value >= 40 ? styles.heatElevated : value >= 20 ? styles.heatModerate : value > 0 ? styles.heatLow : styles.heatNeutral
  if (loading) return <Card title="Player Activity Heatmap" sub="Activity by individual players · Less to more"><LoadingState label="Loading player activity" /></Card>
  return <Card title="Player Activity Heatmap" sub="Activity by individual players · Less to more">
    {!heatmapData.length ? <EmptyState title="No activity data" /> : <div className={styles.stack}>
      <div className={styles.inline}>{showLeftBtn && <Button size="sm" aria-label="Previous player heatmap items" onClick={() => scrollRef.current?.scrollBy({ left: -250, behavior: 'smooth' })}>Previous</Button>}{showRightBtn && <Button size="sm" aria-label="Next player heatmap items" onClick={() => scrollRef.current?.scrollBy({ left: 250, behavior: 'smooth' })}>Next</Button>}</div>
      <div ref={scrollRef} className={styles.rail} onScroll={checkScrollButtons} tabIndex={0} role="region" aria-label="Player activity heatmap"><div className={clsx(styles.railItems, heatmapData.length > 5 && styles.railRows)}>
        {heatmapData.map(player => <Tooltip key={player.userId} content={<div className={styles.stack}><strong>{player.userName}</strong><span>Bets: {player.bets.toLocaleString()}</span><span>Activity: {player.intensity.toFixed(1)}%</span></div>}>
          <div tabIndex={0} className={clsx(styles.heatCell, intensityClass(player.intensity))} style={{ opacity: 0.7 + player.intensity / 100 * 0.3 }}><strong className={styles.heading}>{player.userName}</strong><span className={styles.heatNumber}>{player.bets.toLocaleString()}</span><span>bets</span><StatusPill>{player.intensity.toFixed(0)}%</StatusPill></div>
        </Tooltip>)}
      </div></div>
    </div>}
  </Card>
}

