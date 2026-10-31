import clsx from 'clsx'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Meter } from '@/ui/components/Meter'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { StatusPill } from '@/ui/components/StatusPill'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../MatkaLiveUi.module.css'
import { useMemo, useRef, useState } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'

interface MatkaPerformanceProps {
  breakdown?: {
    byMatka: Array<{
      matkaId: string
      matkaName?: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
}

export const MatkaPerformance: React.FC<MatkaPerformanceProps> = ({ breakdown }) => {
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
    scrollContainerRef.current.style.cursor = 'grabbing'
    scrollContainerRef.current.style.userSelect = 'none'
  }

  const handleMouseLeave = () => {
    if (!scrollContainerRef.current) return
    setIsDragging(false)
    scrollContainerRef.current.style.cursor = 'grab'
    scrollContainerRef.current.style.userSelect = 'auto'
  }

  const handleMouseUp = () => {
    if (!scrollContainerRef.current) return
    setIsDragging(false)
    scrollContainerRef.current.style.cursor = 'grab'
    scrollContainerRef.current.style.userSelect = 'auto'
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

  const matkaStats = useMemo(() => {
    if (!breakdown?.byMatka) return []
    
    return breakdown.byMatka
      .map(matka => ({
        id: matka.matkaId,
        name: matka.matkaName || matka.matkaId,
        wagered: matka.wagered,
        ggr: matka.ggr,
        bets: matka.bets,
        payouts: matka.payouts,
        margin: matka.wagered > 0 ? (matka.ggr / matka.wagered) * 100 : 0,
        avgBet: matka.bets > 0 ? matka.wagered / matka.bets : 0,
      }))
      .sort((a, b) => b.wagered - a.wagered)
      .slice(0, 10) // Top 10 matkas
  }, [breakdown])

  const totalWagered = matkaStats.reduce((sum, m) => sum + m.wagered, 0)

  const marginTone = (margin: number): 'ok' | 'info' | 'warn' | 'neg' | 'neutral' => margin >= 20 ? 'ok' : margin >= 10 ? 'info' : margin >= 5 ? 'warn' : margin >= 0 ? 'neutral' : 'neg'
  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const share = (wagered: number) => totalWagered > 0 ? wagered / totalWagered * 100 : 0
  type Row = typeof matkaStats[number]
  const columns: DataTableColumn<Row>[] = [
    { key: 'rank', header: '#', minWidth: 80, cell: (_row, index) => index + 1 },
    { key: 'matka', header: 'Matka', minWidth: 180, cell: row => row.name },
    { key: 'volume', header: 'Volume', minWidth: 140, align: 'right', cell: row => money(row.wagered) },
    { key: 'ggr', header: 'GGR', minWidth: 140, align: 'right', cell: row => <span className={row.ggr >= 0 ? styles.positive : styles.negative}>{money(row.ggr)}</span> },
    { key: 'bets', header: 'Bets', minWidth: 90, align: 'right', cell: row => row.bets.toLocaleString() },
    { key: 'average', header: 'Avg Bet', minWidth: 130, align: 'right', cell: row => money(row.avgBet) },
    { key: 'rtp', header: 'RTP', minWidth: 120, cell: () => <span title="RTP is unavailable for open bets"><StatusPill tone="neutral">Pending settlement</StatusPill></span> },
    { key: 'share', header: 'Market Share', minWidth: 160, cell: row => <div className={styles.stack}><span>{share(row.wagered).toFixed(1)}%</span><Meter value={share(row.wagered)} /></div> },
    { key: 'margin', header: 'Margin', minWidth: 120, cell: row => <StatusPill tone={marginTone(row.margin)}>{row.margin >= 0 ? '+' : ''}{row.margin.toFixed(1)}%</StatusPill> },
  ]
  return <Card title="Top Matkas" sub={`${matkaStats.length} active`} tools={matkaStats.length > 0 && <SegmentedControl label="Top Matkas view" value={viewMode} onChange={value => setViewMode(value as typeof viewMode)} options={[{ value: 'grid', label: 'Cards' }, { value: 'table', label: 'Table' }]} />}>
    {!matkaStats.length ? <EmptyState title="No matka data available" /> : viewMode === 'table' ? <DataTable columns={columns} rows={matkaStats} rowKey={row => row.id} label="Top Matkas performance" width="wide" /> : <div ref={scrollContainerRef} className={clsx(styles.rail, isDragging && styles.dragging)} tabIndex={0} role="region" aria-label="Top Matkas performance cards" onMouseDown={handleMouseDown} onMouseLeave={handleMouseLeave} onMouseUp={handleMouseUp} onMouseMove={handleMouseMove} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); scrollContainerRef.current?.scrollBy({ left: event.key === 'ArrowLeft' ? -250 : 250, behavior: 'smooth' }) } }}>
      <div className={styles.carouselItems}>{matkaStats.map((matka, idx) => <article key={matka.id} className={styles.carouselItem}>
        <div className={styles.row}><span className={styles.rank}>{idx + 1}</span><span title="RTP is unavailable for open bets"><StatusPill tone="neutral">RTP pending</StatusPill></span></div><h3 className={styles.heading}>{matka.name}</h3>
        <DescriptionList items={[{ term: 'Volume', value: money(matka.wagered) }, { term: 'GGR', value: <span className={matka.ggr > 0 ? styles.positive : styles.negative}>{money(matka.ggr)}</span> }, { term: 'Bets', value: matka.bets.toLocaleString() }, { term: 'Share', value: `${share(matka.wagered).toFixed(1)}%` }, { term: 'Avg', value: money(matka.avgBet) }]} />
        <Meter value={share(matka.wagered)} label={`Market share for ${matka.name}`} /><StatusPill tone={marginTone(matka.margin)}>{matka.margin >= 0 ? '+' : ''}{matka.margin.toFixed(1)}% margin</StatusPill>
      </article>)}</div>
    </div>}
  </Card>
}

