import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { Meter } from '@/ui/components/Meter'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
import styles from '../../CasinoLive.module.css'
interface GameAnalyticsProps {
  breakdown?: {
    byGame: Array<{
      gameId: string
      gameName: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
}

export function GameAnalytics({ breakdown }: GameAnalyticsProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  const topGames = useMemo(() => {
    if (!breakdown?.byGame) return []
    return [...breakdown.byGame]
      .sort((a, b) => b.wagered - a.wagered)
      .slice(0, 10)
  }, [breakdown])

  const maxGameWagered = Math.max(...topGames.map(g => g.wagered), 1)


  return <Card title="Game Analytics">{!topGames.length ? <EmptyState title="No game data yet" /> : <div className={styles.stack}>{topGames.map((game, index) => <article key={game.gameId} className={styles.details}><div className={styles.actions}><StatusPill tone="info">#{index + 1}</StatusPill><h3 className={styles.heading}>{game.gameName || `Game #${game.gameId}`}</h3></div><div className={styles.grid3}><Stat variant="bare" size="compact" label="Volume" value={formatAmount(convertFromWhitelabelCurrency(game.wagered))} /><Stat variant="bare" size="compact" label="GGR" value={formatAmount(convertFromWhitelabelCurrency(game.ggr))} hue={game.ggr > 0 ? 'grn' : 'red'} /><Stat variant="bare" size="compact" label="Bets" value={game.bets} /></div><Meter value={game.wagered / maxGameWagered * 100} /></article>)}</div>}</Card>
}

