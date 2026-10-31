import { useMemo } from 'react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
import styles from '../../CasinoLive.module.css'
interface FinancialHealthOverviewProps {
  kpis?: {
    wagered: number
    payouts: number
    ggr: number
  }
  windowMins?: number
}

export function FinancialHealthOverview({
  kpis,
  windowMins = 10,
}: FinancialHealthOverviewProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()

  // Calculate financial metrics from KPIs
  const financialMetrics = useMemo(() => {
    if (!kpis) return null

    // Total exposure calculation:
    // Exposure = Wagered - Payouts (amount still at risk from pending/unsettled bets)
    // This represents the potential liability from bets that haven't been settled yet
    // If payouts are less than wagered, the difference is exposure
    // If payouts exceed wagered (big wins), exposure is minimal
    const totalExposure = Math.max(0, kpis.wagered - kpis.payouts)

    return {
      payouts: kpis.payouts,
      totalExposure,
    }
  }, [kpis])

  const exposureStatus = useMemo(() => {
    if (!financialMetrics || !kpis) return 'low'
    // Calculate exposure status based on exposure vs payouts
    // High if exposure is more than 2x payouts
    // Moderate if exposure is more than 1x payouts
    const exposureRatio = kpis.payouts > 0 ? financialMetrics.totalExposure / kpis.payouts : 0
    if (exposureRatio > 2) return 'high'
    if (exposureRatio > 1) return 'moderate'
    return 'low'
  }, [financialMetrics, kpis])


  if (!financialMetrics || !kpis) return <Card title="Exposure & Payouts"><EmptyState title="Loading financial data..." /></Card>
  return <Card title="Exposure & Payouts"><div className={styles.grid2}><div className={styles.details}><Stat variant="bare" label="Total Exposure" value={formatAmount(convertFromWhitelabelCurrency(financialMetrics.totalExposure))} hue="amb" />
    <span title="Potential liability from active/pending bets"><StatusPill tone={exposureStatus === 'high' ? 'neg' : exposureStatus === 'moderate' ? 'warn' : 'ok'}>{exposureStatus === 'high' ? 'High' : exposureStatus === 'moderate' ? 'Moderate' : 'Low'}</StatusPill></span></div>
    <Stat variant="bare" label="Payouts" value={formatAmount(convertFromWhitelabelCurrency(financialMetrics.payouts))} note={`${windowMins}m window`} />
  </div></Card>
}

