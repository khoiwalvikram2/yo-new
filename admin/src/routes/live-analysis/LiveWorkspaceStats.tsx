import type { CSSProperties, ReactNode } from 'react'
import { IconActivity, IconChartBar, IconChartDots, IconCoins, IconPercentage, IconReceipt, IconScale,
  IconShield, IconTrendingUp, IconUsers, IconWallet } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import type { LiveFeature } from './LiveWorkspace'
import { formatLiveMetric, liveMetrics, type LiveStatsTrends } from './liveWorkspaceStatsModel'
import styles from './LiveWorkspace.module.css'

export interface LiveStatsProps {
  dashboard: unknown
  trends: LiveStatsTrends | null
  /** Before the first snapshot: the feature's tiles as placeholders, so the row is there from the start. */
  loading?: boolean
}

/** The kit tile glyph per metric; decorative, the label carries the meaning. */
const ICONS: Record<string, ReactNode> = {
  stake: <IconCoins size={18} />, wagered: <IconCoins size={18} />, ggr: <IconTrendingUp size={18} />,
  rtp: <IconPercentage size={18} />, bets: <IconActivity size={18} />, players: <IconUsers size={18} />,
  payouts: <IconWallet size={18} />, margin: <IconScale size={18} />, liability: <IconShield size={18} />,
  exposure: <IconShield size={18} />, markets: <IconChartBar size={18} />, odds: <IconChartDots size={18} />,
  'total-bets': <IconReceipt size={18} />,
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** The kit's stat row (.stats): compact tiles, each with its glyph and a supporting line, one row while the
 *  workspace has room. Narrower, the tiles take two rows (seven go 4 + 3) on shared tracks, so the shorter
 *  row's tiles widen and no row leaves a hole; on a phone two across, an odd last tile taking the row. */
export function LiveWorkspaceStats({ feature, dashboard, trends, windowMins, canViewFinance = true, loading = false,
}: LiveStatsProps & { feature: LiveFeature; windowMins?: number; canViewFinance?: boolean }) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const metrics = loading
    ? liveMetrics(feature, { kpis: {} }, null, windowMins)
    : liveMetrics(feature, dashboard, trends, windowMins)
  if (!metrics.length) return null
  const money = (amount: number) => canViewFinance ? formatAmount(convertFromWhitelabelCurrency(amount)) : '••••'
  // Without a trend or a quality reading a tile still says what its figure covers.
  const context = feature === 'casino' ? `Last ${windowMins ?? 10}m` : 'Open bets'
  const count = metrics.length
  const firstRow = Math.ceil(count / 2)
  const secondRow = count - firstRow
  const tracks = secondRow > 0 ? firstRow * secondRow / gcd(firstRow, secondRow) : firstRow
  return (
    <section className={styles.statsSection} aria-label={`${feature} live statistics`}>
      <div className={styles.statsGrid} aria-busy={loading || undefined} data-count={count}
        style={{ '--mid-tracks': tracks } as CSSProperties}>
        {metrics.map((metric, index) => (
          <Stat key={metric.key} className={styles.stat} label={metric.label} loading={loading}
            value={formatLiveMetric(metric, money)} size="compact" hue={metric.hue} icon={ICONS[metric.key]}
            tooltip={metric.tooltip} delta={metric.quality ? undefined : metric.delta}
            note={metric.quality ? <StatusPill tone={metric.quality.tone}>{metric.quality.label}</StatusPill>
              : metric.delta ? undefined : context}
            style={{ '--mid-span': tracks / (index < firstRow ? firstRow : secondRow) } as CSSProperties} />
        ))}
      </div>
    </section>
  )
}
