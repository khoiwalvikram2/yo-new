import { DateRangePanel, type DateRangeApply } from '@/ui/components/DateRangePanel'
import { istDayEnd, istDayOf, istDayStart } from '@/ui/components/istDate'
import { useDashboardStore, type DateRangePreset } from '@/state/dashboardStore'

/* The dashboard's period control: the kit's range panel wired to the dashboard store.
 *
 * It replaces the shared antd picker on this page (page migration C, W0). That file stays where it is
 * for modules/agents/AgentHome.tsx until W8, so nothing about the agent home changes.
 *
 * The store holds instants; the panel deals in IST calendar days. The two conversions live here, and
 * they are the same instants the antd picker sent: a day starts at 18:30Z the evening before and ends
 * at 18:29:59.999Z. */

const PRESETS: Array<{ value: DateRangePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: '7D' },
  { value: 'last30days', label: '30D' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'custom', label: 'Custom' },
]

export interface PeriodPanelProps {
  /** Called after an applied change or a reset, so the host popover can close. */
  onDone?: () => void
}

export function PeriodPanel({ onDone }: PeriodPanelProps) {
  const { filters, setDateRange, setDateRangePreset, resetFilters } = useDashboardStore()
  const { preset, dateFrom, dateTo } = filters.dateRange

  function handleApply(payload: DateRangeApply) {
    if (payload.kind === 'preset') {
      setDateRangePreset(payload.preset as DateRangePreset)
      return
    }
    setDateRange({
      preset: 'custom',
      dateFrom: istDayStart(payload.from),
      dateTo: istDayEnd(payload.to),
    })
  }

  return (
    <DateRangePanel
      presets={PRESETS}
      appliedPreset={preset}
      appliedFrom={istDayOf(dateFrom)}
      appliedTo={istDayOf(dateTo)}
      onApply={handleApply}
      onReset={resetFilters}
      onDone={onDone}
    />
  )
}
