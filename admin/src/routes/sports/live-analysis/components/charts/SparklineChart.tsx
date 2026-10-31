import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { liveChartTone } from '../../sportsLiveModel';
import styles from '../../SportsLive.module.css';
interface SparklineChartProps { data: Array<{ time: string | number; value: number }>; color?: string; height?: number; width?: number }
export function SparklineChart({ data, color = 'chartBlue', height = 40, width = 100 }: SparklineChartProps) {
  if (!data?.length) return <span style={{ width, height }} className={styles.sparkEmpty}>No data</span>;
  return <span className={styles.chart}><ResponsiveContainer width={width} height={height}><LineChart data={data}><Line type="monotone" dataKey="value" className={styles[liveChartTone(color)]} strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></span>;
}

