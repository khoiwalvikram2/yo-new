import { IconActivity, IconBroadcast, IconChartBar, IconCoins, IconTicket } from '@tabler/icons-react'
import { strokeFor } from '@/ui/components/icons'
import { Stat } from '@/ui/components/Stat'
import type { EventsStats as EventsStatsValues } from '../eventsPageModel'
import styles from '../EventsPage.module.css'

interface EventsStatsProps {
  stats: EventsStatsValues
  /** The liability total, already converted and shortened (K / M) by the page. */
  liability: string
}

/** The legacy header strip's five figures, over the events the filters leave. */
export function EventsStats({ stats, liability }: EventsStatsProps) {
  const icon = (Glyph: typeof IconBroadcast) => <Glyph size={18} stroke={strokeFor(18)} />
  return (
    <div className={styles.statsFrame}>
      <div className={styles.stats} role="group" aria-label="Event statistics">
        <Stat label="Live" value={String(stats.liveEvents)} icon={icon(IconBroadcast)} hue="red" />
        <Stat
          label="Markets"
          value={stats.totalMarkets.toLocaleString()}
          icon={icon(IconChartBar)}
          hue="vio"
        />
        <Stat label="Bets" value={stats.totalBets.toLocaleString()} icon={icon(IconTicket)} hue="ind" />
        <Stat label="Liability" value={liability} icon={icon(IconCoins)} hue="grn" />
        <Stat label="Active" value={String(stats.recentActivity)} icon={icon(IconActivity)} hue="amb" />
      </div>
    </div>
  )
}
