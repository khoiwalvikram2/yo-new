import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import clsx from 'clsx';
import { liveChartTone } from '../../sportsLiveModel';
import styles from '../../SportsLive.module.css';
interface DistributionChartProps { data: Array<{ name: string; value: number; [key: string]: unknown }>; height?: number; type?: 'pie' | 'donut'; formatValue?: (value: number) => string; colors?: string[]; showLegend?: boolean; showLabel?: boolean }
export function DistributionChart({ data, height = 300, type = 'pie', formatValue, colors, showLegend = true, showLabel = false }: DistributionChartProps) {
  const fmt = (value: unknown) => formatValue ? formatValue(Number(value)) : Number(value).toLocaleString();
  const tone = (index: number) => liveChartTone(colors?.length ? colors[index % colors.length] : undefined, index);
  const legend = <ul className={styles.chartLegend}>{data.map((item, index) => <li key={index}><span className={clsx(styles.chartMarker, styles[tone(index)])} />{item.name}</li>)}</ul>;
  return <div className={styles.chart}><ResponsiveContainer width="100%" height={height}><PieChart><Pie data={data} cx="50%" cy="50%" labelLine={false} label={showLabel ? props => `${props.name || ''}: ${((props.percent || 0) * 100).toFixed(0)}%` : false} outerRadius={type === 'donut' ? 80 : 100} innerRadius={type === 'donut' ? 40 : 0} dataKey="value">
    {data.map((_, index) => <Cell key={index} className={styles[tone(index)]} />)}
  </Pie><Tooltip content={({ active, payload }) => active && payload?.length ? <div className={styles.chartTip}>{payload.map((item, index) => <span key={index}>{String(item.name)}: {fmt(item.value)}</span>)}</div> : null} />{showLegend && <Legend content={legend} />}</PieChart></ResponsiveContainer></div>;
}

