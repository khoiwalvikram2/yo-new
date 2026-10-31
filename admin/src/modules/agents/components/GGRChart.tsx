import { Card } from '@/ui/components/Card'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import type { GgrResult } from '../agentHomeModel'
import styles from '../AgentHome.module.css'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useQuery, gql } from '@apollo/client'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { toChartNumber } from '@/lib/chartValue'

const GGR_TRENDS_QUERY = gql`
  query GGRTrends($agentId: ID!, $periodFrom: String!, $periodTo: String!) {
    reporting {
      ggrTrends(agentId: $agentId, periodFrom: $periodFrom, periodTo: $periodTo) {
        date
        sportsGGR
        casinoGGR
        matkaGGR
        totalGGR
      }
    }
  }
`

interface GGRChartProps {
  agentId: string
  periodFrom: string
  periodTo: string
  height?: number
}

export default function GGRChart({ agentId, periodFrom, periodTo, height = 300 }: GGRChartProps) {
  const { formatAmount, convertFromWhitelabelCurrency, getCurrencySymbol } = useCurrency()
  const { formatDate } = useFormatDate()
  const { data, loading, error } = useQuery<GgrResult>(GGR_TRENDS_QUERY, {
    variables: { agentId, periodFrom, periodTo },
    skip: !agentId,
  })

  if (loading && !data) return <Card title="GGR Trends Over Time"><LoadingState label="Loading chart" height={height} /></Card>
  if (error) return <Card><Notice tone="error" title="Chart unavailable">{error.message}</Notice></Card>
  if (!data?.reporting?.ggrTrends?.length) return <Card><EmptyState title="No GGR data available for this period" /></Card>

  const trends = data.reporting.ggrTrends

  const chartData = trends.map((t: { date?: string; sportsGGR?: number; casinoGGR?: number; matkaGGR?: number; totalGGR?: number }) => ({
    date: formatDate(t.date ?? '', 'MMM d'),
    'Sports GGR': t.sportsGGR ?? 0,
    'Casino GGR': t.casinoGGR ?? 0,
    'Matka GGR': t.matkaGGR ?? 0,
    'Total GGR': t.totalGGR ?? 0,
  }))

  return (
    <Card title="GGR Trends Over Time">
      <div className={styles.chart}><ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis tickFormatter={(value) => `${getCurrencySymbol()}${(value / 1000).toFixed(0)}k`} />
          <Tooltip
            formatter={(value) => formatAmount(convertFromWhitelabelCurrency(toChartNumber(value)))}
          />
          <Legend />
          <Line type="monotone" dataKey="Sports GGR" className={styles.series0} stroke="var(--h-blu)" fill="none" strokeWidth={2} />
          <Line type="monotone" dataKey="Casino GGR" className={styles.series1} stroke="var(--h-red)" fill="none" strokeWidth={2} />
          <Line type="monotone" dataKey="Matka GGR" className={styles.series2} stroke="var(--h-grn)" fill="none" strokeWidth={2} />
          <Line type="monotone" dataKey="Total GGR" className={styles.series3} stroke="var(--h-vio)" fill="none" strokeWidth={3} />
        </LineChart>
      </ResponsiveContainer></div>
    </Card>
  )
}

