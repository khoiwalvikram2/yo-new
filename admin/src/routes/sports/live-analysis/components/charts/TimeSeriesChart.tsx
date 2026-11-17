import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import clsx from 'clsx';
import { useFormatDate } from '@/shared/core/useFormatDate';
import { liveChartTone } from '../../sportsLiveModel';
import styles from '../../SportsLive.module.css';
interface TimeSeriesChartProps { data: Array<Record<string, unknown>>; dataKeys: Array<{ key: string; name: string; color: string }>; height?: number; type?: 'line' | 'area'; formatValue?: (value: number) => string; xAxisKey?: string; showGrid?: boolean; showLegend?: boolean }
export function TimeSeriesChart({ data, dataKeys, height = 300, type = 'line', formatValue, xAxisKey = 'time', showGrid = true, showLegend = true }: TimeSeriesChartProps) {
  const { formatTime } = useFormatDate();
  const Chart = type === 'area' ? AreaChart : LineChart;
  const Series = type === 'area' ? Area : Line;
  const fmt = (value: unknown) => formatValue ? formatValue(Number(value)) : Number(value).toLocaleString();
  const legend = <ul className={styles.chartLegend}>{dataKeys.map((series, index) => <li key={series.key}><span className={clsx(styles.chartMarker, styles[liveChartTone(series.color, index)])} />{series.name}</li>)}</ul>;
  return <div className={styles.chart}><ResponsiveContainer width="100%" height={height}><Chart data={data}>
    {showGrid && <CartesianGrid strokeDasharray="3 3" />}
    <XAxis dataKey={xAxisKey} tick={{ fontSize: 12 }} tickFormatter={value => { if (typeof value === 'string' && value.includes('T')) { try { return formatTime(value, 'HH:mm'); } catch { return value; } } return value; }} />
    <YAxis tick={{ fontSize: 12 }} tickFormatter={fmt} />
    <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className={styles.chartTip}><strong>{String(label ?? '')}</strong>{payload.map((item, index) => <span key={index}>{String(item.name)}: {fmt(item.value)}</span>)}</div> : null} />
    {/* A function, not the element: recharts clones an element with its own props (iconSize, inactiveColor…), which React reported as unknown DOM props on the <ul>. */}
    {showLegend && <Legend content={() => legend} />}
    {dataKeys.map((series, index) => <Series key={series.key} type="monotone" dataKey={series.key} name={series.name} className={styles[liveChartTone(series.color, index)]} fillOpacity={type === 'area' ? 0.3 : undefined} strokeWidth={2} dot={{ r: 3, className: styles[liveChartTone(series.color, index)] }} activeDot={{ r: 5, className: styles[liveChartTone(series.color, index)] }} />)}
  </Chart></ResponsiveContainer></div>;
}

