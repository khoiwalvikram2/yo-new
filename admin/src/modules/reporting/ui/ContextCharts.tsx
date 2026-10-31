import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PieLabelRenderProps } from 'recharts'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Stack } from '@/ui/components/LayoutPrimitives'
import {
  categorySlot,
  contextChartCopy,
  distributionData as toDistributionData,
  pieLabelText,
  type SeriesSlot,
} from './drillDownModel'
import { ReportChartTip } from './ReportChartTip'
import { TrendPlot } from './TrendCard'
import s from './reportCharts.module.css'

export interface ContextChartsProps {
  level:
    | 'all'
    | 'sport'
    | 'league'
    | 'event'
    | 'agent'
    | 'player'
    | 'provider'
    | 'vendor'
    | 'game'
    | 'matkaType'
    | 'market'
    | 'session'
    | 'campaign'
  domain: 'sports' | 'casino' | 'matka' | 'bonuses'
  /** `{ trends, breakdown }` as the drill-down pages assemble it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  loading: boolean
  formatAmount: (value: number) => string
  /** BEYOND the legacy props: h3 card titles when the charts sit inside another titled section. @default 2 */
  headingLevel?: 2 | 3
}

const FILL_CLASS: Readonly<Partial<Record<SeriesSlot, string>>> = {
  hInd: s.fillHInd,
  hRed: s.fillHRed,
  hGrn: s.fillHGrn,
  hVio: s.fillHVio,
  hBlu: s.fillHBlu,
  hAmb: s.fillHAmb,
}

/**
 * The drill-down reports' Overview tab: a trend plot, then the top-ten bar and its share pie, or a
 * single "no chart data" card. Same props as the legacy components/ContextCharts.tsx.
 */
export function ContextCharts({ domain, data, loading, formatAmount, headingLevel = 2 }: ContextChartsProps) {
  if (loading) {
    return <LoadingState label="Loading charts" />
  }

  const copy = contextChartCopy(domain)
  const timeSeriesData: Record<string, unknown>[] = data?.trends || []
  const distribution = toDistributionData(domain, data?.breakdown)
  const sliceSlot = (name: unknown, index: number): SeriesSlot => {
    const at = distribution.findIndex((row) => row.name === name)
    return categorySlot(at >= 0 ? at : index)
  }

  return (
    <Stack gap={16}>
      {timeSeriesData.length > 0 ? (
        <Card title={copy.trendTitle} sub={`${timeSeriesData.length} data points`} headingLevel={headingLevel}>
          <TrendPlot
            data={timeSeriesData}
            lines={copy.lines}
            height={300}
            formatY={formatAmount}
            formatTip={(value) => formatAmount(value)}
          />
        </Card>
      ) : null}

      {distribution.length > 0 ? (
        <div className={s.charts}>
          <div className={s.pair}>
            <Card title={copy.barTitle} sub={`Top ${distribution.length} entries`} headingLevel={headingLevel}>
              <div className={s.plot}>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={distribution}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => formatAmount(Number(value))} tick={{ fontSize: 11 }} />
                    <Tooltip
                      cursor={{ className: s.cursorBar }}
                      content={<ReportChartTip slotOf={() => 's1'} format={(value) => formatAmount(value)} />}
                    />
                    <Bar dataKey="totalStakes" name={copy.barSeries} className={s.barS1} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title={copy.pieTitle} sub="Proportional breakdown" headingLevel={headingLevel}>
              <div className={s.plot}>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={distribution}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(props: PieLabelRenderProps) => pieLabelText(props.name, props.percent)}
                      outerRadius={80}
                      dataKey="grossGamingRevenue"
                    >
                      {distribution.map((_row, index) => (
                        <Cell key={`cell-${index}`} className={FILL_CLASS[categorySlot(index)]} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={
                        <ReportChartTip
                          slotOf={(entry, index) => sliceSlot(entry.name, index)}
                          format={(value) => formatAmount(value)}
                        />
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {timeSeriesData.length === 0 && distribution.length === 0 ? (
        <Card title="Charts" headingLevel={headingLevel}>
          <EmptyState title="No chart data available" inset="none" />
        </Card>
      ) : null}
    </Stack>
  )
}
