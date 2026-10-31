import type { ReactNode } from 'react'
import {
  IconCash,
  IconChartLine,
  IconCircleCheck,
  IconGift,
  IconPercentage,
  IconTrophy,
  IconUsers,
} from '@tabler/icons-react'
import { Stat } from '@/ui/components/Stat'
import { strokeFor } from '@/ui/components/icons'
import { useFormatLocale } from '@/shared/core/useFormatLocale'
import {
  kpiDisplayValue,
  kpiHue,
  kpiSecondaryNote,
  kpiTrendDelta,
  type KPICard,
} from './drillDownModel'
import styles from './ReportKpiGrid.module.css'

export type { KPICard } from './drillDownModel'

export interface ReportKpiGridProps {
  kpis: KPICard[]
  loading?: boolean
  /** Accepted for parity; the legacy grid ignored it too. The column count follows the grid's width. */
  columns?: number
}

const ICON_SIZE = 18

/* The legacy icon cycle (check, money, chart, users, gift, percent, trophy). Decorative. */
const ICONS: readonly ReactNode[] = [
  <IconCircleCheck key="check" size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />,
  <IconCash key="cash" size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />,
  <IconChartLine key="chart" size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />,
  <IconUsers key="users" size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />,
  <IconGift key="gift" size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />,
  <IconPercentage key="percent" size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />,
  <IconTrophy key="trophy" size={ICON_SIZE} stroke={strokeFor(ICON_SIZE)} />,
]

/**
 * The drill-down reports' KPI row: one kit Stat per figure. Same props as the legacy
 * components/ReportKpiGrid.tsx; a page migrates by switching the import.
 */
export function ReportKpiGrid({ kpis, loading = false }: ReportKpiGridProps) {
  const formatLocale = useFormatLocale()

  // While loading, each figure is a placeholder on its own card, so the row keeps its height.
  return (
    <div className={styles.root}>
      <div className={styles.grid} role="group" aria-label="Key figures" aria-busy={loading || undefined}>
        {kpis.map((kpi, index) => (
          <Stat
            // the legacy grid keyed by position too: titles may repeat across levels
            key={index}
            label={kpi.title}
            value={kpiDisplayValue(kpi, formatLocale)}
            icon={ICONS[index % ICONS.length]}
            hue={kpiHue(index)}
            delta={kpi.trend ? kpiTrendDelta(kpi.trend) : undefined}
            note={kpiSecondaryNote(kpi)}
            loading={loading}
          />
        ))}
      </div>
    </div>
  )
}
