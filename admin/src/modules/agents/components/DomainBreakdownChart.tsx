import { Card } from '@/ui/components/Card'
import { Stat } from '@/ui/components/Stat'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { rawAmount, type DomainResult } from '../agentHomeModel'
import styles from '../AgentHome.module.css'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend as RechartsLegend, Tooltip } from 'recharts'
import { useQuery, gql } from '@apollo/client'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { toChartNumber } from '@/lib/chartValue'

const DOMAIN_BREAKDOWN_QUERY = gql`
  query DomainBreakdown($agentId: ID!, $periodFrom: String!, $periodTo: String!) {
    reporting {
      domainBreakdown(agentId: $agentId, periodFrom: $periodFrom, periodTo: $periodTo) {
        domain
        ggr
        percentage
        totalBets
        totalStake
      }
    }
  }
`

interface DomainBreakdownChartProps {
  agentId: string
  periodFrom: string
  periodTo: string
  height?: number
}

export default function DomainBreakdownChart({
  agentId,
  periodFrom,
  periodTo,
  height = 300,
}: DomainBreakdownChartProps) {
  const { formatAmount, convertFromWhitelabelCurrency, getCurrencySymbol } = useCurrency()
  const { data, loading, error } = useQuery<DomainResult>(DOMAIN_BREAKDOWN_QUERY, {
    variables: { agentId, periodFrom, periodTo },
    skip: !agentId,
  })

  // The card's head and the plot's own height are known before the answer; the per-domain lines are not.
  if (loading && !data) return <Card title="GGR by Domain"><LoadingState label="Loading domain breakdown" height={height} /></Card>
  if (error) return <Card><Notice tone="error" title="Domain breakdown unavailable">{error.message}</Notice></Card>
  if (!data?.reporting?.domainBreakdown?.length) return <Card><EmptyState title="No domain breakdown data available for this period" /></Card>

  const breakdown = data.reporting.domainBreakdown

  const COLORS = ['var(--h-blu)', 'var(--h-red)', 'var(--h-grn)']

  const totalGGR = breakdown.reduce((sum: number, d: { ggr?: number }) => sum + (d.ggr ?? 0), 0)

  type ChartDataEntry = { domain?: string; name?: string; value?: number; valueForPie?: number; percentage?: number; totalBets?: number; color?: string }
  const chartData = breakdown.map((d: { domain?: string; ggr?: number; totalBets?: number }, index: number) => {
    const ggr = Number(d.ggr) || 0
    return {
      name: (d.domain ?? '').charAt(0).toUpperCase() + (d.domain ?? '').slice(1),
      value: ggr,
      valueForPie: Math.abs(ggr), // Pie needs positive values to render; we show actual in tooltip
      percentage: totalGGR !== 0 ? (ggr / totalGGR) * 100 : 0,
      totalBets: d.totalBets || 0,
      color: COLORS[index % COLORS.length],
    }
  })
  const plottedAbsoluteTotal = chartData.reduce((sum, entry) => sum + entry.valueForPie, 0)

  return (
    <Card title="GGR by Domain">
      <div className={styles.two}>
        <div className={styles.chart}>
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={false}
                outerRadius={80}
                fill="currentColor"
                dataKey="valueForPie"
              >
                {chartData.map((entry: ChartDataEntry, index: number) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, _name, props: { payload?: { value?: number; percentage?: number } }) => [
                  formatAmount(convertFromWhitelabelCurrency(toChartNumber(props?.payload?.value ?? value))),
                  `${Number(props?.payload?.percentage ?? 0).toFixed(1)}%`,
                ]}
              />
              <RechartsLegend />
            </PieChart>
          </ResponsiveContainer>
          <p className={styles.muted}>Chart slices use absolute GGR; figures retain their actual sign.</p>
          <ul className={styles.list} aria-label="Pie slice values">
            {chartData.map(entry => <li key={entry.name}>{entry.name}: {(plottedAbsoluteTotal ? entry.valueForPie / plottedAbsoluteTotal * 100 : 0).toFixed(1)}% ({formatAmount(convertFromWhitelabelCurrency(entry.value))})</li>)}
          </ul>
        </div>
        <div>
          <div className={styles.stack}>
            <Stat variant="bare" label="Total GGR" value={rawAmount(totalGGR, getCurrencySymbol())} />
            {chartData.map((d: ChartDataEntry) => <div key={d.name} className={styles.domain}>
              <span className={styles.muted}>{d.name}</span>
              <strong className={styles.amount}>{formatAmount(convertFromWhitelabelCurrency(Number(d.value)))}</strong>
              <span className={styles.muted}>{Number(d.totalBets).toLocaleString()} bets • {Number(d.percentage).toFixed(1)}% of total</span>
            </div>)}
          </div>
        </div>
      </div>
    </Card>
  )
}

