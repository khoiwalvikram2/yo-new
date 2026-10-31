import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import clsx from 'clsx';
import { liveChartTone } from '../../sportsLiveModel';
import styles from '../../SportsLive.module.css';
interface BarChartComponentProps { data: Array<Record<string, unknown>>; dataKeys: Array<{ key: string; name: string; color: string }>; xAxisKey: string; height?: number; orientation?: 'vertical' | 'horizontal'; formatValue?: (value: number) => string; showGrid?: boolean; showLegend?: boolean }
export function BarChartComponent({ data, dataKeys, xAxisKey, height = 300, orientation = 'vertical', formatValue, showGrid = true, showLegend = true }: BarChartComponentProps) {
  const fmt = (value: unknown) => formatValue ? formatValue(Number(value)) : Number(value).toLocaleString();
  const legend = <ul className={styles.chartLegend}>{dataKeys.map((series, index) => <li key={series.key}><span className={clsx(styles.chartMarker, styles[liveChartTone(series.color, index)])} />{series.name}</li>)}</ul>;
  return <div className={styles.chart}><ResponsiveContainer width="100%" height={height}><BarChart data={data} layout={orientation === 'horizontal' ? 'vertical' : undefined} margin={orientation === 'horizontal' ? { top: 5, right: 30, left: 20, bottom: 5 } : undefined}>
    {showGrid && <CartesianGrid strokeDasharray="3 3" />}
    {orientation === 'horizontal' ? <><XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={fmt} /><YAxis type="category" dataKey={xAxisKey} tick={{ fontSize: 12 }} width={120} /></> : <><XAxis dataKey={xAxisKey} type="category" tick={{ fontSize: 12 }} angle={data.length > 10 ? -45 : 0} textAnchor={data.length > 10 ? 'end' : 'middle'} height={data.length > 10 ? 80 : undefined} /><YAxis type="number" tick={{ fontSize: 12 }} tickFormatter={fmt} /></>}
    <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className={styles.chartTip}><strong>{String(label ?? '')}</strong>{payload.map((item, index) => <span key={index}>{String(item.name)}: {fmt(item.value)}</span>)}</div> : null} />
    {showLegend && <Legend content={legend} />}
    {dataKeys.map((series, index) => <Bar key={series.key} dataKey={series.key} name={series.name} className={styles[liveChartTone(series.color, index)]} radius={orientation === 'horizontal' ? [0, 4, 4, 0] : [4, 4, 0, 0]} />)}
  </BarChart></ResponsiveContainer></div>;
}

