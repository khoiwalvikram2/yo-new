import { useMemo } from 'react'
import { IconBan, IconCircleCheck, IconListDetails, IconPlayerPause } from '@tabler/icons-react'
import type { Matka } from '@/modules/matka/types'
import { Stat } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import { coreTotalsFrom, percentage, type CoreTotals } from '../matkaManagementModel'
import styles from '../ManagementPage.module.css'

interface StatsCardsProps {
  matkas?: Matka[]
  totals?: CoreTotals
}

export function StatsCards({ matkas, totals }: StatsCardsProps) {
  const stats = useMemo(() => totals ?? coreTotalsFrom(matkas ?? []), [matkas, totals])

  return (
    <section className={styles.statsGrid} aria-label="Matka catalog summary">
      <Stat
        label="Total Matkas"
        value={stats.total.toLocaleString()}
        note={`${stats.active} active`}
        icon={<IconListDetails size={18} stroke={strokeFor(18)} />}
        hue="blu"
      />
      <Stat
        label="Active"
        value={stats.active.toLocaleString()}
        note={`${percentage(stats.active, stats.total)} of total`}
        icon={<IconCircleCheck size={18} stroke={strokeFor(18)} />}
        hue="grn"
      />
      <Stat
        label="Inactive"
        value={stats.inactive.toLocaleString()}
        note={percentage(stats.inactive, stats.total)}
        icon={<IconPlayerPause size={18} stroke={strokeFor(18)} />}
        hue="amb"
      />
      <Stat
        label="Suspended"
        value={stats.suspended.toLocaleString()}
        note={percentage(stats.suspended, stats.total)}
        icon={<IconBan size={18} stroke={strokeFor(18)} />}
        hue="red"
      />
    </section>
  )
}

