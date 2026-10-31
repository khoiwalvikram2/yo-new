import type { MatkaKpis } from '../../liveUiModel'
import clsx from 'clsx'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Stat } from '@/ui/components/Stat'
import { Select } from '@/ui/components/Select'
import { MultiSelect } from '@/ui/components/MultiSelect'
import { EmptyState } from '@/ui/components/EmptyState'
import { Meter } from '@/ui/components/Meter'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from '../../MatkaLiveUi.module.css'
import React, { useMemo, useState } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'

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
    byType: Array<{
      matkaType: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
    byMarket: Array<{
      marketName: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
    byBidType: Array<{
      bidType: string
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
    byMatka: Array<{
      matkaId: string
      matkaName?: string | null
      wagered: number
      payouts: number
      ggr: number
      bets: number
    }>
  }
  history?: MatkaKpis[]
}

export const ComparisonView: React.FC<ComparisonViewProps> = ({ breakdown }) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  
  const hasMultipleTypes = (breakdown?.byType?.length || 0) > 1
  const hasMultipleMarkets = (breakdown?.byMarket?.length || 0) > 1
  const hasMultipleMatkas = (breakdown?.byMatka?.length || 0) > 1
  
  const [comparisonType, setComparisonType] = useState<'matkas' | 'types' | 'markets' | 'bidTypes'>('matkas')
  const [selectedItems, setSelectedItems] = useState<string[]>([])

  const matkaOptions = useMemo(() => {
    if (!breakdown?.byMatka) return []
    return breakdown.byMatka.map(m => ({
      label: m.matkaName || `Matka #${m.matkaId}`,
      value: m.matkaId,
    }))
  }, [breakdown])

  const typeOptions = useMemo(() => {
    if (!breakdown?.byType) return []
    return breakdown.byType.map(t => ({
      label: t.matkaType.charAt(0).toUpperCase() + t.matkaType.slice(1),
      value: t.matkaType,
    }))
  }, [breakdown])

  const marketOptions = useMemo(() => {
    if (!breakdown?.byMarket) return []
    return breakdown.byMarket.map(m => ({
      label: m.marketName,
      value: m.marketName,
    }))
  }, [breakdown])

  const bidTypeOptions = useMemo(() => {
    if (!breakdown?.byBidType) return []
    return breakdown.byBidType.map(b => ({
      label: b.bidType,
      value: b.bidType,
    }))
  }, [breakdown])

  const comparisonData = useMemo(() => {
    if (!breakdown) return []

    if (comparisonType === 'matkas' && selectedItems.length > 0) {
      return breakdown.byMatka
        .filter(m => selectedItems.includes(m.matkaId))
        .map(m => ({
          id: m.matkaId,
          name: m.matkaName || `Matka #${m.matkaId}`,
          wagered: m.wagered,
          payouts: m.payouts,
          ggr: m.ggr,
          bets: m.bets,
          avgBet: m.bets > 0 ? m.wagered / m.bets : 0,
          profitMargin: m.wagered > 0 ? (m.ggr / m.wagered) * 100 : 0,
        }))
    }

    if (comparisonType === 'types' && selectedItems.length > 0) {
      return breakdown.byType
        .filter(t => selectedItems.includes(t.matkaType))
        .map(t => ({
          id: t.matkaType,
          name: t.matkaType.charAt(0).toUpperCase() + t.matkaType.slice(1),
          wagered: t.wagered,
          payouts: t.payouts,
          ggr: t.ggr,
          bets: t.bets,
          avgBet: t.bets > 0 ? t.wagered / t.bets : 0,
          profitMargin: t.wagered > 0 ? (t.ggr / t.wagered) * 100 : 0,
        }))
    }

    if (comparisonType === 'markets' && selectedItems.length > 0) {
      return breakdown.byMarket
        .filter(m => selectedItems.includes(m.marketName))
        .map(m => ({
          id: m.marketName,
          name: m.marketName,
          wagered: m.wagered,
          payouts: m.payouts,
          ggr: m.ggr,
          bets: m.bets,
          avgBet: m.bets > 0 ? m.wagered / m.bets : 0,
          profitMargin: m.wagered > 0 ? (m.ggr / m.wagered) * 100 : 0,
        }))
    }

    if (comparisonType === 'bidTypes' && selectedItems.length > 0) {
      return breakdown.byBidType
        .filter(b => selectedItems.includes(b.bidType))
        .map(b => ({
          id: b.bidType,
          name: b.bidType,
          wagered: b.wagered,
          payouts: b.payouts,
          ggr: b.ggr,
          bets: b.bets,
          avgBet: b.bets > 0 ? b.wagered / b.bets : 0,
          profitMargin: b.wagered > 0 ? (b.ggr / b.wagered) * 100 : 0,
        }))
    }

    return []
  }, [breakdown, comparisonType, selectedItems])

  const maxValues = useMemo(() => {
    if (comparisonData.length === 0) return {}
    return {
      wagered: Math.max(...comparisonData.map(d => d.wagered)),
      ggr: Math.max(...comparisonData.map(d => d.ggr)),
      bets: Math.max(...comparisonData.map(d => d.bets)),
    }
  }, [comparisonData])


  const currentOptions = useMemo(() => {
    switch (comparisonType) {
      case 'matkas': return matkaOptions
      case 'types': return typeOptions
      case 'markets': return marketOptions
      case 'bidTypes': return bidTypeOptions
      default: return []
    }
  }, [comparisonType, matkaOptions, typeOptions, marketOptions, bidTypeOptions])

  type Row = typeof comparisonData[number]
  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(value))
  const columns: DataTableColumn<Row>[] = [
    { key: 'name', header: 'Name', minWidth: 200, cell: row => row.name },
    { key: 'wagered', header: 'Total Wagered', minWidth: 160, align: 'right', sort: (a, b) => a.wagered - b.wagered, cell: row => <div className={styles.stack}><span>{money(row.wagered)}</span><Meter value={row.wagered / (maxValues.wagered || 1) * 100} /></div> },
    { key: 'ggr', header: 'GGR', minWidth: 150, align: 'right', sort: (a, b) => a.ggr - b.ggr, cell: row => <div className={styles.stack}><span className={row.ggr >= 0 ? styles.positive : styles.negative}>{money(row.ggr)}</span><Meter value={row.ggr / Math.max(maxValues.ggr || 1, 1) * 100} tone={row.ggr >= 0 ? 'acc' : 'neg'} /></div> },
    { key: 'rtp', header: 'RTP', minWidth: 130, align: 'right', cell: () => <span title="Final payouts are not available for open bets"><StatusPill tone="neutral">Pending settlement</StatusPill></span> },
    { key: 'bets', header: 'Total Bets', minWidth: 120, align: 'right', sort: (a, b) => a.bets - b.bets, cell: row => <div className={styles.stack}><span>{row.bets.toLocaleString()}</span><Meter value={row.bets / (maxValues.bets || 1) * 100} /></div> },
    { key: 'average', header: 'Avg Bet', minWidth: 130, align: 'right', sort: (a, b) => a.avgBet - b.avgBet, cell: row => money(row.avgBet) },
    { key: 'margin', header: 'Profit Margin', minWidth: 140, align: 'right', sort: (a, b) => a.profitMargin - b.profitMargin, cell: row => <StatusPill tone={row.profitMargin >= 10 ? 'ok' : row.profitMargin >= 5 ? 'info' : row.profitMargin >= 0 ? 'warn' : 'neg'}>{row.profitMargin >= 0 ? '+' : ''}{row.profitMargin.toFixed(2)}%</StatusPill> },
  ]
  return <div className={styles.stack}><Card title="Comparison View" sub="Compare performance across dimensions"><div className={styles.stack}>
    <div className={styles.grid2}><Select label="Comparison Type" layout="stacked" value={comparisonType} onChange={value => { setComparisonType(value as typeof comparisonType); setSelectedItems([]) }} options={[{ label: 'Matkas', value: 'matkas', disabled: !hasMultipleMatkas }, { label: 'Matka Types', value: 'types', disabled: !hasMultipleTypes }, { label: 'Markets', value: 'markets', disabled: !hasMultipleMarkets }, { label: 'Bid Types', value: 'bidTypes' }]} /><MultiSelect label="Select Items to Compare" value={selectedItems} onChange={setSelectedItems} options={currentOptions} placeholder="Select items to compare..." clearable /></div>
    {!comparisonData.length ? <EmptyState title={selectedItems.length === 0 ? 'Select items from the dropdown to compare' : 'No data available for selected items'} /> : <><div className={styles.grid2}>{comparisonData.map(item => <Stat key={item.id} label={item.name} value={<span className={clsx(styles.amount, item.ggr >= 0 ? styles.positive : styles.negative)}>{money(item.ggr)}</span>} note={`${item.bets} bets · ${item.profitMargin.toFixed(1)}% margin`} />)}</div><DataTable columns={columns} rows={comparisonData} rowKey={row => row.id} label="Matka comparison" width="wide" /></>}
  </div></Card></div>
}

