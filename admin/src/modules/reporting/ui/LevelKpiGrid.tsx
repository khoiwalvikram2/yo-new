import { levelKpis } from './drillDownModel'
import { ReportKpiGrid } from './ReportKpiGrid'

export interface LevelKpiGridProps {
  level: string
  domain: string
  // The level row is whatever its breakdown query returns; levelKpis reads named fields from it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
  formatAmount: (value: number) => string
  convertCurrency: (value: number) => number
}

/**
 * The KPI row for one drill-down level. Same props as the legacy components/LevelKpiGrid.tsx: the
 * level and domain choose the figures (drillDownModel.levelKpis), the kit ReportKpiGrid draws them.
 */
export function LevelKpiGrid({ level, domain, data, formatAmount, convertCurrency }: LevelKpiGridProps) {
  if (!data) {
    return null
  }
  return <ReportKpiGrid kpis={levelKpis(level, domain, data, formatAmount, convertCurrency)} />
}
