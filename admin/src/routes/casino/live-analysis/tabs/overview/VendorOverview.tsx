import clsx from 'clsx'
import { useMemo, useRef, useState } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { Meter } from '@/ui/components/Meter'
import { EmptyState } from '@/ui/components/EmptyState'
import styles from '../../CasinoLive.module.css'
interface VendorOverviewProps {
  breakdown?: {
    byVendor: Array<{
      vendorId: string
      vendorName?: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
}

export function VendorOverview({ breakdown }: VendorOverviewProps) {
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

  const vendorStats = useMemo(() => {
    if (!breakdown?.byVendor) return []
    
    return breakdown.byVendor
      .map(vendor => ({
        name: vendor.vendorName || 'Unknown Vendor',
        wagered: vendor.wagered,
        ggr: vendor.ggr,
        bets: vendor.bets,
        payouts: vendor.payouts,
        rtp: vendor.wagered > 0 ? (vendor.payouts / vendor.wagered) * 100 : 0,
        margin: vendor.wagered > 0 ? (vendor.ggr / vendor.wagered) * 100 : 0,
        betsPerMin: vendor.bets > 0 ? vendor.bets / 10 : 0, // Assuming 10 min window
      }))
      .sort((a, b) => b.wagered - a.wagered)
      .slice(0, 10) // Top 10 vendors
  }, [breakdown])

  const totalWagered = vendorStats.reduce((sum, v) => sum + v.wagered, 0)


  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const columns: DataTableColumn<(typeof vendorStats)[number]>[] = [{ key: 'rank', header: '#', cell: row => `#${vendorStats.indexOf(row) + 1}` },
    { key: 'name', header: 'Vendor', cell: row => row.name, emphasis: 'key' },
    { key: 'wagered', header: 'Volume', align: 'right', cell: row => fmt(row.wagered) },
    { key: 'ggr', header: 'GGR', align: 'right', cell: row => <strong className={row.ggr >= 0 ? styles.positive : styles.negative}>{fmt(row.ggr)}</strong> },
    { key: 'bets', header: 'Bets', align: 'right', cell: row => row.bets.toLocaleString() },
    { key: 'rtp', header: 'RTP', align: 'right', cell: row => <StatusPill tone={row.rtp < 85 ? 'ok' : row.rtp < 95 ? 'info' : row.rtp < 105 ? 'warn' : 'neg'}>{row.rtp.toFixed(1)}%</StatusPill> },
    { key: 'share', header: 'Market Share', align: 'right', cell: row => <div className={styles.tableDetails}><span>{(totalWagered > 0 ? row.wagered / totalWagered * 100 : 0).toFixed(1)}%</span><Meter value={totalWagered > 0 ? row.wagered / totalWagered * 100 : 0} /></div> },
    { key: 'margin', header: 'Margin', align: 'right', cell: row => <StatusPill tone={row.margin >= 20 ? 'ok' : row.margin >= 10 ? 'info' : row.margin >= 5 ? 'warn' : row.margin >= 0 ? 'neutral' : 'neg'}>{row.margin >= 0 ? '+' : ''}{row.margin.toFixed(1)}%</StatusPill> }]
  return <Card title="Top Vendors" body={viewMode === 'table' ? 'table' : 'padded'} tools={vendorStats.length > 0 && <SegmentedControl label="Vendor view" value={viewMode} onChange={value => setViewMode(value)} options={[{ label: 'Grid', value: 'grid' }, { label: 'Table', value: 'table' }]} size="sm" />}>
    {!vendorStats.length ? <EmptyState title="No vendor data available" /> : viewMode === 'table' ? <DataTable label="Top casino vendors" columns={columns} rows={vendorStats} rowKey={row => row.name} pagination={false} /> :
      <div ref={scrollContainerRef} className={clsx(styles.carousel, isDragging && styles.dragging)} role="region" aria-label="Top Vendors cards" tabIndex={0} onMouseDown={handleMouseDown} onMouseLeave={handleMouseLeave} onMouseUp={handleMouseUp} onMouseMove={handleMouseMove} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
        <div className={styles.carouselItems}>{vendorStats.map((vendor, index) => { const share = totalWagered > 0 ? vendor.wagered / totalWagered * 100 : 0; return <article key={vendor.name} className={styles.carouselItem}>
          
          <div className={styles.details}><div className={styles.actions}><StatusPill tone="info">#{index + 1}</StatusPill><h3 className={styles.heading} title={vendor.name}>{vendor.name}</h3></div>
            <div className={styles.grid2}><Stat variant="bare" size="compact" label="Volume" value={fmt(vendor.wagered)} hue="blu" /><Stat variant="bare" size="compact" label="GGR" value={fmt(vendor.ggr)} hue={vendor.ggr > 0 ? 'grn' : 'red'} /><Stat variant="bare" size="compact" label="Bets" value={vendor.bets.toLocaleString()} /><div className={styles.details}><span className={styles.muted}>RTP</span><StatusPill tone={vendor.rtp < 85 ? 'ok' : vendor.rtp < 95 ? 'info' : vendor.rtp < 105 ? 'warn' : 'neg'}>{vendor.rtp.toFixed(1)}%</StatusPill></div></div>
            <div className={styles.details}><span className={styles.muted}>Share: {share.toFixed(1)}%</span><Meter value={share} /></div>
            <div className={styles.feedBottom}><span className={styles.muted}>Margin</span><StatusPill tone={vendor.margin >= 20 ? 'ok' : vendor.margin >= 10 ? 'info' : vendor.margin >= 5 ? 'warn' : vendor.margin >= 0 ? 'neutral' : 'neg'}>{vendor.margin >= 0 ? '+' : ''}{vendor.margin.toFixed(1)}%</StatusPill></div>
          </div>
        </article> })}</div>
      </div>}
  </Card>
}

