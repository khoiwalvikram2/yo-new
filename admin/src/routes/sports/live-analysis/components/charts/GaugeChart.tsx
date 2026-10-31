import { RadialBarChart, RadialBar, ResponsiveContainer, Cell } from 'recharts';
import clsx from 'clsx';
import { liveChartTone } from '../../sportsLiveModel';
import styles from '../../SportsLive.module.css';
interface GaugeChartProps { value: number; max: number; height?: number; color?: string; label?: string; formatValue?: (value: number) => string }
export function GaugeChart({ value, max, height = 200, color = 'chartBlue', label, formatValue }: GaugeChartProps) {
  const percentage = Math.min(value / max * 100, 100);
  const data = [{ name: 'value', value: percentage }, { name: 'remaining', value: 100 - percentage }];
  const tone = liveChartTone(color || (percentage >= 75 ? 'chartNegative' : percentage >= 50 ? 'chartWarning' : percentage >= 25 ? 'chartBlue' : 'chartPositive'));
  return <div className={clsx(styles.chart, styles.gauge, styles[tone])} style={{ height, minHeight: height }}><ResponsiveContainer width="100%" height="100%"><RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" barSize={20} data={data} startAngle={90} endAngle={-270}><RadialBar dataKey="value" cornerRadius={10}><Cell className={styles[tone]} /><Cell className={styles.chartTrack} /></RadialBar></RadialBarChart></ResponsiveContainer>
    <div className={styles.gaugeLabel}><strong className={styles.gaugeValue}>{formatValue ? formatValue(value) : value.toFixed(1)}</strong>{label && <span className={styles.muted}>{label}</span>}<span className={styles.muted}>of {formatValue ? formatValue(max) : max.toFixed(1)}</span></div>
  </div>;
}

