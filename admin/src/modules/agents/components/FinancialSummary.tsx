import { useQuery } from '@apollo/client'
import { format } from 'date-fns'
import { COMMISSION_SUMMARY_QUERY, SETTLEMENT_SUMMARY_QUERY } from '@/lib/graphql/agents'
import { CURRENT_COMMISSION_CYCLE_QUERY } from '@/lib/graphql/settlements'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { IconCoin, IconCalendar, IconPercentage } from '@tabler/icons-react'
import { Stat } from '@/ui/components/Stat'
import { Card } from '@/ui/components/Card'
import { agentDirectionLabel, settlementDirectionOf } from '@/routes/settlement/settlementModel'
import styles from '../AgentHome.module.css'

interface FinancialSummaryProps {
  agentId: string
  periodFrom: string
  periodTo: string
  /** A CREDIT agent has no settlement summary since 2026-11-02: its dashboard shows its chips instead. */
  schemeType: 'COMMISSION' | 'SHARING'
}

// Commission cycles historically use the browser's calendar day, not the dashboard's IST day.
function localCalendarDay(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return Number.isFinite(date.getTime()) ? format(date, 'yyyy-MM-dd') : 'Invalid Date'
}

export default function FinancialSummary({ agentId, periodFrom, periodTo, schemeType }: FinancialSummaryProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatDate } = useFormatDate()
  const allTimeTo = localCalendarDay(new Date())
  const { data: allTimeCommissionData } = useQuery(COMMISSION_SUMMARY_QUERY, {
    variables: { agentId, periodFrom: '2000-01-01', periodTo: allTimeTo },
    skip: schemeType !== 'COMMISSION',
    fetchPolicy: 'cache-and-network',
  })

  const { data: currentCycleData } = useQuery(CURRENT_COMMISSION_CYCLE_QUERY, {
    skip: !agentId || schemeType !== 'COMMISSION',
    fetchPolicy: 'cache-and-network',
  })
  const currentCycle = currentCycleData?.currentCommissionCycle
  const currentCycleFrom = currentCycle?.from ? localCalendarDay(currentCycle.from) : null
  const currentCycleTo = currentCycle?.to ? localCalendarDay(currentCycle.to) : null

  const { data: currentWeekCommission } = useQuery(COMMISSION_SUMMARY_QUERY, {
    variables: {
      agentId,
      periodFrom: currentCycleFrom ?? undefined,
      periodTo: currentCycleTo ?? undefined,
    },
    skip: schemeType !== 'COMMISSION' || !currentCycleFrom || !currentCycleTo,
    fetchPolicy: 'cache-and-network',
  })
  const currentWeekSummary = currentWeekCommission?.agents?.commissionSummary

  const { data: settlementData } = useQuery(SETTLEMENT_SUMMARY_QUERY, {
    variables: { agentId, periodFrom, periodTo },
    skip: schemeType !== 'SHARING',
  })

  const fmt = (n: number) => formatAmount(convertFromWhitelabelCurrency(n))
  if (schemeType === 'COMMISSION') {
    const commission = allTimeCommissionData?.agents?.commissionSummary
    const getEffective = (summary: typeof commission) => ({
      total: Number(summary?.effectiveCalculatedTotal ?? summary?.calculatedTotal ?? 0),
      sports: Number(summary?.effectiveSportsCommission ?? summary?.sportsCommission ?? 0),
      casino: Number(summary?.effectiveCasinoCommission ?? summary?.casinoCommission ?? 0),
      matka: Number(summary?.effectiveMatkaCommission ?? summary?.matkaCommission ?? 0),
    })
    const allTimeEffective = getEffective(commission)
    const currentWeekEffective = getEffective(currentWeekSummary)
    const breakdown = (values: ReturnType<typeof getEffective>) => <div className={styles.split}>
      <div className={styles.row}><span className={styles.muted}>Sports</span><span>{fmt(values.sports)}</span></div>
      <div className={styles.row}><span className={styles.muted}>Casino</span><span>{fmt(values.casino)}</span></div>
      <div className={styles.row}><span className={styles.muted}>Matka</span><span>{fmt(values.matka)}</span></div>
    </div>
    return <div className={styles.three}>
      <Card><div className={styles.stack}><Stat variant="bare" label="Total Earned" value={fmt(allTimeEffective.total)} note="All commissions" icon={<IconCoin size={20} />} hue="grn" />{breakdown(allTimeEffective)}</div></Card>
      <Card><div className={styles.stack}><Stat variant="bare" label="Current Week" value={<span className={currentWeekEffective.total >= 0 ? styles.positive : styles.negative}>{currentWeekEffective.total >= 0 ? '+' : ''}{fmt(currentWeekEffective.total)}</span>} note="Provisional" icon={<IconCoin size={20} />} hue="amb" />{breakdown(currentWeekEffective)}</div></Card>
      <Stat label="Paid" value={fmt(commission?.paid ?? 0)} note="Completed payments" icon={<IconCoin size={20} />} hue="blu" />
    </div>
  }
  const settlement = settlementData?.agents?.settlementSummary
  const netPL = settlement?.netPL || 0
  const isPositive = netPL >= 0
  // The settlement with the upline, in words: positive is TO_AGENT (this agent receives), as everywhere.
  const dueDirection = settlementDirectionOf(settlement?.settlementDirection, settlement?.settlementDue)
  return <div className={styles.kpis}>
    <Stat label="Net P&L" value={<span className={isPositive ? styles.positive : styles.negative}>{netPL ? `${isPositive ? '+' : '-'}${fmt(Math.abs(netPL))}` : formatAmount(0)}</span>} note="Profit & Loss" icon={<IconCoin size={20} />} hue="grn" />
    <Stat label="Share %" value={settlement?.sharePercentage ? `${settlement.sharePercentage.toFixed(2)}%` : '0.00%'} note="Revenue share" icon={<IconPercentage size={20} />} hue="blu" />
    <Stat label="Settlement Due" value={fmt(Math.abs(settlement?.settlementDue ?? 0))} note={dueDirection === 'NONE' ? 'Nothing pending' : agentDirectionLabel(dueDirection)} icon={<IconCoin size={20} />} hue="amb" />
    <Stat label="Last Settlement" value={fmt(settlement?.lastSettlementAmount ?? 0)} note={settlement?.lastSettlementDate ? formatDate(settlement.lastSettlementDate, 'MMM dd, yyyy') : 'N/A'} icon={<IconCalendar size={20} />} hue="vio" />
  </div>
}

