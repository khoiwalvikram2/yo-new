import { useMemo, useState } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { Select } from '@/ui/components/Select'
import { MultiSelect } from '@/ui/components/MultiSelect'
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable'
import { Stat } from '@/ui/components/Stat'
import { Meter } from '@/ui/components/Meter'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
import styles from '../../CasinoLive.module.css'
interface ComparisonViewProps {
  kpis?: {
    at: string
    betsPerMin: number
    wagered: number
    payouts: number
    ggr: number
    rtp: number
    activePlayers: number
  }
  breakdown?: {
    byGame: Array<{
      gameId: string
      gameName: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
    byProvider: Array<{
      providerId: string
      providerName: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
    byVendor: Array<{
      vendorId: string
      vendorName?: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
  history?: unknown[]
}

export function ComparisonView({ breakdown }: ComparisonViewProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  
  // Hide provider comparison if only one provider
  const hasMultipleProviders = (breakdown?.byProvider?.length || 0) > 1
  const hasMultipleVendors = (breakdown?.byVendor?.length || 0) > 1
  
  const [comparisonType, setComparisonType] = useState<'games' | 'providers' | 'vendors' | 'periods'>('games')
  const [selectedItems, setSelectedItems] = useState<string[]>([])

  const gameOptions = useMemo(() => {
    if (!breakdown?.byGame) return []
    return breakdown.byGame.map(g => ({
      label: g.gameName || `Game #${g.gameId}`,
      value: g.gameId,
    }))
  }, [breakdown])

  const providerOptions = useMemo(() => {
    if (!breakdown?.byProvider) return []
    return breakdown.byProvider.map(p => ({
      label: p.providerName || `Provider #${p.providerId}`,
      value: p.providerId,
    }))
  }, [breakdown])

  const vendorOptions = useMemo(() => {
    if (!breakdown?.byVendor) return []
    return breakdown.byVendor.map(v => ({
      label: v.vendorName || `Vendor #${v.vendorId}`,
      value: v.vendorId,
    }))
  }, [breakdown])

  const comparisonData = useMemo(() => {
    if (!breakdown) return []

    if (comparisonType === 'games' && selectedItems.length > 0) {
      return breakdown.byGame
        .filter(g => selectedItems.includes(g.gameId))
        .map(g => ({
          id: g.gameId,
          name: g.gameName || `Game #${g.gameId}`,
          wagered: g.wagered,
          payouts: g.payouts,
          ggr: g.ggr,
          rtp: g.wagered > 0 ? (g.payouts / g.wagered) * 100 : 0,
          bets: g.bets,
          avgBet: g.bets > 0 ? g.wagered / g.bets : 0,
          profitMargin: g.wagered > 0 ? (g.ggr / g.wagered) * 100 : 0,
        }))
    }

    if (comparisonType === 'providers' && selectedItems.length > 0) {
      return breakdown.byProvider
        .filter(p => selectedItems.includes(p.providerId))
        .map(p => ({
          id: p.providerId,
          name: p.providerName || `Provider #${p.providerId}`,
          wagered: p.wagered,
          payouts: p.payouts,
          ggr: p.ggr,
          rtp: p.wagered > 0 ? (p.payouts / p.wagered) * 100 : 0,
          bets: p.bets,
          avgBet: p.bets > 0 ? p.wagered / p.bets : 0,
          profitMargin: p.wagered > 0 ? (p.ggr / p.wagered) * 100 : 0,
        }))
    }

    if (comparisonType === 'vendors' && selectedItems.length > 0) {
      return breakdown.byVendor
        .filter(v => selectedItems.includes(v.vendorId))
        .map(v => ({
          id: v.vendorId,
          name: v.vendorName || `Vendor #${v.vendorId}`,
          wagered: v.wagered,
          payouts: v.payouts,
          ggr: v.ggr,
          rtp: v.wagered > 0 ? (v.payouts / v.wagered) * 100 : 0,
          bets: v.bets,
          avgBet: v.bets > 0 ? v.wagered / v.bets : 0,
          profitMargin: v.wagered > 0 ? (v.ggr / v.wagered) * 100 : 0,
        }))
    }

    return []
  }, [breakdown, comparisonType, selectedItems])

  const maxValues = useMemo(() => {
    if (comparisonData.length === 0) return { wagered: 0, ggr: 0, bets: 0, rtp: 0 }
    return {
      wagered: Math.max(...comparisonData.map(d => d.wagered)),
      ggr: Math.max(...comparisonData.map(d => d.ggr)),
      bets: Math.max(...comparisonData.map(d => d.bets)),
      rtp: Math.max(...comparisonData.map(d => d.rtp)),
    }
  }, [comparisonData])


  const [sort, setSort] = useState<DataTableSort | null>(null)
  type Row = (typeof comparisonData)[number]
  const fmt = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const columns: DataTableColumn<Row>[] = [
    { key: 'name', header: 'Name', cell: row => row.name, emphasis: 'key' },
    { key: 'wagered', header: 'Total Wagered', align: 'right', cell: row => <div className={styles.tableDetails}><strong>{fmt(row.wagered)}</strong><Meter value={maxValues.wagered > 0 ? row.wagered / maxValues.wagered * 100 : 0} /></div>, sort: (a, b) => a.wagered - b.wagered },
    { key: 'ggr', header: 'GGR', align: 'right', cell: row => <div className={styles.tableDetails}><strong className={row.ggr >= 0 ? styles.positive : styles.negative}>{fmt(row.ggr)}</strong><Meter value={row.ggr / Math.max(maxValues.ggr, 1) * 100} tone={row.ggr >= 0 ? 'acc' : 'neg'} /></div>, sort: (a, b) => a.ggr - b.ggr },
    { key: 'rtp', header: 'RTP', align: 'right', cell: row => <div className={styles.tableDetails}><StatusPill tone={row.rtp < 95 ? 'ok' : row.rtp < 105 ? 'info' : 'neg'}>{row.rtp.toFixed(2)}%</StatusPill><Meter value={Math.min(row.rtp, 150)} tone={row.rtp >= 105 ? 'neg' : 'acc'} /></div>, sort: (a, b) => a.rtp - b.rtp },
    { key: 'bets', header: 'Bets', align: 'right', cell: row => <div className={styles.tableDetails}><strong>{row.bets}</strong><Meter value={maxValues.bets ? row.bets / maxValues.bets * 100 : 0} /></div>, sort: (a, b) => a.bets - b.bets },
    { key: 'avgBet', header: 'Avg Bet', align: 'right', cell: row => fmt(row.avgBet), sort: (a, b) => a.avgBet - b.avgBet },
    { key: 'profitMargin', header: 'Profit Margin', align: 'right', cell: row => <StatusPill tone={row.profitMargin >= 10 ? 'ok' : row.profitMargin >= 5 ? 'info' : row.profitMargin >= 0 ? 'warn' : 'neg'}>{row.profitMargin >= 0 ? '+' : ''}{row.profitMargin.toFixed(2)}%</StatusPill>, sort: (a, b) => a.profitMargin - b.profitMargin },
  ]
  if (!breakdown) return <EmptyState title="Waiting for data..." />
  return <div className={styles.stack}>
    <Card title="Comparison Controls"><div className={styles.toolbar}><Select className={styles.field} layout="stacked" label="Comparison Type" value={comparisonType} options={[{ label: 'Compare Games', value: 'games' }, ...(hasMultipleProviders ? [{ label: 'Compare Providers', value: 'providers' }] : []), ...(hasMultipleVendors ? [{ label: 'Compare Vendors', value: 'vendors' }] : [])]} onChange={value => { setComparisonType(value as typeof comparisonType); setSelectedItems([]) }} />
      <MultiSelect className={styles.search} label="Select Items to Compare" help="(up to 5)" value={selectedItems} onChange={values => setSelectedItems(values.slice(0, 5))} placeholder={`Select ${comparisonType}...`} options={comparisonType === 'games' ? gameOptions : comparisonType === 'providers' ? providerOptions : comparisonType === 'vendors' ? vendorOptions : []} maxTagCount={3} />
    </div></Card>
    {!selectedItems.length ? <Card title="Comparison Results"><EmptyState title="Select items to compare" description={`Choose up to 5 ${comparisonType} to see detailed comparative analysis`} /></Card> : <>
      <Card title="Visual Comparison"><div className={comparisonData.length > 2 ? styles.grid3 : styles.grid2}>{comparisonData.map((item, index) => <article key={item.id} className={styles.comparison}><div className={styles.actions}><h3 className={styles.heading}>{item.name}</h3><StatusPill tone="info">#{index + 1}</StatusPill></div>
        <div className={styles.grid2}><Stat variant="bare" size="compact" label="Total Wagered" value={fmt(item.wagered)} /><Stat variant="bare" size="compact" label="GGR" value={fmt(item.ggr)} hue={item.ggr >= 0 ? 'grn' : 'red'} /><Stat variant="bare" size="compact" label="RTP" value={`${item.rtp.toFixed(2)}%`} /><Stat variant="bare" size="compact" label="Bets" value={item.bets} /></div>
        <div className={styles.feedBottom}><span className={styles.muted}>Profit Margin</span><StatusPill tone={item.profitMargin >= 10 ? 'ok' : item.profitMargin >= 0 ? 'info' : 'neg'}>{item.profitMargin >= 0 ? '+' : ''}{item.profitMargin.toFixed(2)}%</StatusPill></div>
      </article>)}</div></Card>
      <Card title="Detailed Comparison Matrix" body="table"><DataTable label="Detailed casino comparison" columns={columns} rows={comparisonData} rowKey={row => row.id} pagination={false} sort={sort} onSortChange={setSort} /></Card>
    </>}
  </div>
}

