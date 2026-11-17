import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { Meter } from '@/ui/components/Meter'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { DescriptionList } from '@/ui/components/DescriptionList'
import styles from '../../MatkaLiveUi.module.css'
import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import type { MatkaSelectionTotals } from '../../liveUiModel'

interface SelectionRiskDashboardProps {
  breakdown?: {
    /** Every selection summed by the server; bySelection holds only the riskiest 200 (G502). */
    selectionTotals?: MatkaSelectionTotals | null
    bySelection: Array<{
      selection: string
      matkaId: string
      matkaName?: string | null
      marketName: string
      marketSession: string | null
      bidType: string
      wagered: number
      payouts: number
      exposure: number
      bets: number
    }>
  }
}

export const SelectionRiskDashboard: React.FC<SelectionRiskDashboardProps> = ({ breakdown }) => {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const permissions = useAuthStore(s => s.permissions)
  const hasFinanceView = hasPermissionWithNested(permissions, 'settlements.center', 'view')
  const mask = (v: number) => (hasFinanceView ? formatAmount(convertFromWhitelabelCurrency(v)) : '••••')

  const selectionData = useMemo(() => {
    if (!breakdown?.bySelection) return []
    
    return breakdown.bySelection
      .map(s => ({
        ...s,
        exposure: s.exposure,
      }))
      .sort((a, b) => b.exposure - a.exposure)
  }, [breakdown])

  // Top risky selections
  const topRisky = useMemo(() => {
    return selectionData.slice(0, 15)
  }, [selectionData])

  // Concentration metrics. The totals are the server's, over every selection: bySelection is cut to the riskiest 200,
  // so summing it came up short past 200 selections (G502). A frame cached before the totals existed sums the rows.
  const concentrationMetrics = useMemo(() => {
    const totals = breakdown?.selectionTotals
    const totalExposure = totals ? totals.exposure : selectionData.reduce((sum, s) => sum + s.exposure, 0)
    const top5Exposure = selectionData.slice(0, 5).reduce((sum, s) => sum + s.exposure, 0)
    const top10Exposure = selectionData.slice(0, 10).reduce((sum, s) => sum + s.exposure, 0)

    return {
      totalExposure,
      top5Concentration: totalExposure > 0 ? (top5Exposure / totalExposure) * 100 : 0,
      top10Concentration: totalExposure > 0 ? (top10Exposure / totalExposure) * 100 : 0,
      uniqueSelections: totals ? Math.max(totals.selections, selectionData.length) : selectionData.length,
    }
  }, [breakdown, selectionData])

  // High concentration alerts (selections with very high exposure): any selection above 10% of the total is among
  // the riskiest rows sent, so the rows are enough once the share is taken of the full total.
  const highRiskAlerts = useMemo(() => {
    const totalExposure = concentrationMetrics.totalExposure
    return selectionData
      .filter(s => {
        const concentration = totalExposure > 0 ? (s.exposure / totalExposure) * 100 : 0
        return concentration > 10 || s.exposure > 10000 // More than 10% or >10k exposure
      })
      .slice(0, 5)
  }, [selectionData, concentrationMetrics])

  const capped = concentrationMetrics.uniqueSelections > selectionData.length
  const maxExposure = Math.max(...selectionData.map(s => s.exposure), 1)
  if (!selectionData.length) return <Card title="Selection Risk Dashboard" sub="Top risky selections & concentration"><EmptyState title="No selection data available" /></Card>
  return <div className={styles.stack}>
    {highRiskAlerts.length > 0 && <Notice title="High Risk Selections Detected" tone="warn">{highRiskAlerts.length} selection(s) with very high exposure concentration</Notice>}
    <div className={styles.grid2}><Stat label="Unique Selections" value={concentrationMetrics.uniqueSelections} /><Stat label="Total Exposure" value={mask(concentrationMetrics.totalExposure)} hue="red" /><Stat label="Top 5 Concentration" value={`${concentrationMetrics.top5Concentration.toFixed(1)}%`} hue="amb" /><Stat label="Top 10 Concentration" value={`${concentrationMetrics.top10Concentration.toFixed(1)}%`} hue="amb" /></div>
    {capped && <p className={styles.muted}>{`Showing top ${selectionData.length} of ${concentrationMetrics.uniqueSelections.toLocaleString()} selections`}</p>}
    <Card title="Top Risky Selections" sub="Selections with highest exposure"><ol className={styles.list}>{topRisky.map((selection, idx) => {
      const exposurePercent = selection.exposure / maxExposure * 100
      const concentration = concentrationMetrics.totalExposure > 0 ? selection.exposure / concentrationMetrics.totalExposure * 100 : 0
      // A row is one matka, market, session, bid type and numbers (the server groups them so): the same numbers in the
      // Open and the Close session are two rows, so the key holds all five (JSON keeps a null session apart from '').
      return <li className={styles.item} key={JSON.stringify([selection.matkaId, selection.marketName, selection.marketSession, selection.bidType, selection.selection])}><div className={styles.inline}><span className={styles.rank}>{idx + 1}</span><h3 className={styles.heading}>{selection.matkaName || `Matka #${selection.matkaId.slice(0, 8)}`}</h3><StatusPill tone="info">{selection.marketName}</StatusPill>{selection.marketSession && <StatusPill>{selection.marketSession}</StatusPill>}</div><p className={styles.text}>{selection.bidType} · {selection.selection}</p><DescriptionList items={[{ term: 'Exposure', value: mask(selection.exposure) }, { term: 'Share of total', value: `${concentration.toFixed(1)}%` }, { term: 'Bets', value: selection.bets }, { term: 'Wagered', value: mask(selection.wagered) }, { term: 'Payouts', value: mask(selection.payouts) }]} /><Meter value={exposurePercent} tone="neg" label={`Exposure for ${selection.bidType} ${selection.selection}`} /></li>
    })}</ol></Card>
  </div>
}

