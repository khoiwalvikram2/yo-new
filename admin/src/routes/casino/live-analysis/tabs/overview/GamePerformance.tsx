import clsx from 'clsx'
import { useMemo, useRef, useState } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { StoredImage } from '@/ui/components/StoredImage'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { Meter } from '@/ui/components/Meter'
import { EmptyState } from '@/ui/components/EmptyState'
import styles from '../../CasinoLive.module.css'
interface GamePerformanceProps {
  breakdown?: {
    byGame: Array<{
      gameId: string
      gameName?: string | null
      thumbnailUrl?: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
}

export function GamePerformance({ breakdown }: GamePerformanceProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return
    setIsDragging(true)
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft)
    setScrollLeft(scrollContainerRef.current.scrollLeft)
  }

  const handleMouseLeave = () => {
    if (!scrollContainerRef.current) return
    setIsDragging(false)
  }

  const handleMouseUp = () => {
    if (!scrollContainerRef.current) return
    setIsDragging(false)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return
    e.preventDefault()
    const x = e.pageX - scrollContainerRef.current.offsetLeft
    const walk = (x - startX) * 2 // Scroll speed multiplier
    scrollContainerRef.current.scrollLeft = scrollLeft - walk
  }

  // Touch events for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!scrollContainerRef.current) return
    setIsDragging(true)
    setStartX(e.touches[0].pageX - scrollContainerRef.current.offsetLeft)
    setScrollLeft(scrollContainerRef.current.scrollLeft)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || !scrollContainerRef.current) return
    e.preventDefault()
    const x = e.touches[0].pageX - scrollContainerRef.current.offsetLeft
    const walk = (x - startX) * 2
    scrollContainerRef.current.scrollLeft = scrollLeft - walk
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
  }

  const gameStats = useMemo(() => {
    if (!breakdown?.byGame) return []
    
    return breakdown.byGame
      .map(game => ({
        id: game.gameId,
        name: game.gameName || game.gameId,
        thumbnailUrl: game.thumbnailUrl || null,
        wagered: game.wagered,
        ggr: game.ggr,
        bets: game.bets,
        payouts: game.payouts,
        rtp: game.wagered > 0 ? (game.payouts / game.wagered) * 100 : 0,
        margin: game.wagered > 0 ? (game.ggr / game.wagered) * 100 : 0,
        avgBet: game.bets > 0 ? game.wagered / game.bets : 0,
      }))
      .sort((a, b) => b.wagered - a.wagered)
      .slice(0, 10) // Top 10 games
  }, [breakdown])

  const totalWagered = gameStats.reduce((sum, g) => sum + g.wagered, 0)


  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const columns: DataTableColumn<(typeof gameStats)[number]>[] = [{ key: 'rank', header: '#', cell: row => `#${gameStats.indexOf(row) + 1}` },
    { key: 'name', header: 'Game', cell: row => row.name, emphasis: 'key' },
    { key: 'wagered', header: 'Volume', align: 'right', cell: row => fmt(row.wagered) },
    { key: 'ggr', header: 'GGR', align: 'right', cell: row => <strong className={row.ggr >= 0 ? styles.positive : styles.negative}>{fmt(row.ggr)}</strong> },
    { key: 'bets', header: 'Bets', align: 'right', cell: row => row.bets.toLocaleString() },
    { key: 'avgBet', header: 'Avg Bet', align: 'right', cell: row => fmt(row.avgBet) },
    { key: 'rtp', header: 'RTP', align: 'right', cell: row => <StatusPill tone={row.rtp < 85 ? 'ok' : row.rtp < 95 ? 'info' : row.rtp < 105 ? 'warn' : 'neg'}>{row.rtp.toFixed(1)}%</StatusPill> },
    { key: 'share', header: 'Market Share', align: 'right', cell: row => <div className={styles.tableDetails}><span>{(totalWagered > 0 ? row.wagered / totalWagered * 100 : 0).toFixed(1)}%</span><Meter value={totalWagered > 0 ? row.wagered / totalWagered * 100 : 0} /></div> },
    { key: 'margin', header: 'Margin', align: 'right', cell: row => <StatusPill tone={row.margin >= 20 ? 'ok' : row.margin >= 10 ? 'info' : row.margin >= 5 ? 'warn' : row.margin >= 0 ? 'neutral' : 'neg'}>{row.margin >= 0 ? '+' : ''}{row.margin.toFixed(1)}%</StatusPill> }]
  return <Card title="Top Games" body={viewMode === 'table' ? 'table' : 'padded'} tools={gameStats.length > 0 && <SegmentedControl label="Game view" value={viewMode} onChange={value => setViewMode(value)} options={[{ label: 'Grid', value: 'grid' }, { label: 'Table', value: 'table' }]} size="sm" />}>
    {!gameStats.length ? <EmptyState title="No game data available" /> : viewMode === 'table' ? <DataTable label="Top casino games" columns={columns} rows={gameStats} rowKey={row => row.id} pagination={false} /> :
      <div ref={scrollContainerRef} className={clsx(styles.carousel, isDragging && styles.dragging)} role="region" aria-label="Top Games cards" tabIndex={0} onMouseDown={handleMouseDown} onMouseLeave={handleMouseLeave} onMouseUp={handleMouseUp} onMouseMove={handleMouseMove} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
        <div className={styles.carouselItems}>{gameStats.map((game, index) => { const share = totalWagered > 0 ? game.wagered / totalWagered * 100 : 0; return <article key={game.id} className={styles.carouselItem}>
          <StoredImage className={styles.thumbnail} src={game.thumbnailUrl} alt={game.name} loading="lazy" fallback={<div className={styles.imageFallback}>{game.name}</div>} />
          <div className={styles.details}><div className={styles.actions}><StatusPill tone="info">#{index + 1}</StatusPill><h3 className={styles.heading} title={game.name}>{game.name}</h3></div>
            <div className={styles.grid2}><Stat variant="bare" size="compact" label="Volume" value={fmt(game.wagered)} hue="blu" /><Stat variant="bare" size="compact" label="GGR" value={fmt(game.ggr)} hue={game.ggr > 0 ? 'grn' : 'red'} /><Stat variant="bare" size="compact" label="Bets" value={game.bets.toLocaleString()} /><div className={styles.details}><span className={styles.muted}>RTP</span><StatusPill tone={game.rtp < 85 ? 'ok' : game.rtp < 95 ? 'info' : game.rtp < 105 ? 'warn' : 'neg'}>{game.rtp.toFixed(1)}%</StatusPill></div></div>
            <div className={styles.details}><span className={styles.muted}>Share: {share.toFixed(1)}%</span><Meter value={share} /></div>
            <div className={styles.feedBottom}><span className={styles.muted}>Avg: {fmt(game.avgBet)}</span><StatusPill tone={game.margin >= 20 ? 'ok' : game.margin >= 10 ? 'info' : game.margin >= 5 ? 'warn' : game.margin >= 0 ? 'neutral' : 'neg'}>{game.margin >= 0 ? '+' : ''}{game.margin.toFixed(1)}%</StatusPill></div>
          </div>
        </article> })}</div>
      </div>}
  </Card>
}

