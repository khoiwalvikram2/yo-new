import { Card } from '@/ui/components/Card'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import type { PlayerActivityResult } from '../agentHomeModel'
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
import { useFormatDate } from '@/shared/core/useFormatDate'

const PLAYER_ACTIVITY_QUERY = gql`
  query PlayerActivity($agentId: ID!, $periodFrom: String!, $periodTo: String!) {
    reporting {
      playerActivity(agentId: $agentId, periodFrom: $periodFrom, periodTo: $periodTo) {
        date
        newPlayers
        activePlayers
        totalBets
        totalDeposits
      }
    }
  }
`

interface PlayerActivityChartProps {
  agentId: string
  periodFrom: string
  periodTo: string
  height?: number
}

export default function PlayerActivityChart({
  agentId,
  periodFrom,
  periodTo,
  height = 300,
}: PlayerActivityChartProps) {
  const { formatDate } = useFormatDate()
  const { data, loading, error } = useQuery<PlayerActivityResult>(PLAYER_ACTIVITY_QUERY, {
    variables: { agentId, periodFrom, periodTo },
    skip: !agentId,
  })

  if (loading && !data) return <Card title="Player Activity Over Time"><LoadingState label="Loading chart" height={height} /></Card>
  if (error) return <Card><Notice tone="error" title="Chart unavailable">{error.message}</Notice></Card>
  if (!data?.reporting?.playerActivity?.length) return <Card><EmptyState title="No player activity data available for this period" /></Card>

  const activity = data.reporting.playerActivity

  const chartData = activity.map((a: { date?: string; newPlayers?: number; activePlayers?: number; totalBets?: number }) => ({
    date: formatDate(a.date ?? '', 'MMM d'),
    'New Players': a.newPlayers ?? 0,
    'Active Players': a.activePlayers ?? 0,
    'Total Bets': a.totalBets ?? 0,
  }))

  return (
    <Card title="Player Activity Over Time">
      <div className={styles.chart}><ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis yAxisId="left" label={{ value: 'Players', angle: -90, position: 'insideLeft' }} />
          <YAxis
            yAxisId="right"
            orientation="right"
            label={{ value: 'Bets', angle: 90, position: 'insideRight' }}
          />
          <Tooltip />
          <Legend />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="New Players"
            className={styles.series0} stroke="var(--h-blu)" fill="none"
            strokeWidth={2}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="Active Players"
            className={styles.series1} stroke="var(--h-red)" fill="none"
            strokeWidth={2}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="Total Bets"
            className={styles.series2} stroke="var(--h-grn)" fill="none"
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer></div>
    </Card>
  )
}

