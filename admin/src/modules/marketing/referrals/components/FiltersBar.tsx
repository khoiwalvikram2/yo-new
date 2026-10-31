import { DateRangeField } from '@/ui/components/DateRangeField'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'
import {
  REFERRAL_DATE_PRESETS,
  normalizeReferralRange,
  referralDatePreset,
  type ReferralDateRange,
} from '../referralsOverviewModel'

interface FiltersBarProps {
  /** The applied period as IST days, or null for every date. */
  dateRange: ReferralDateRange | null
  onDateRangeChange: (range: ReferralDateRange | null) => void
  /** The legacy Clear All: back to every date. */
  onClear: () => void
}

/**
 * The overview's only filter is its period. On the kit it is the page head's range pill, the slot the
 * mockup gives a page's own date filter (M:1736-1740, O5), rather than a bar of its own; the export
 * keeps its legacy name because the overview is its only importer. The legacy picker had no presets,
 * so the panel offers its two states: every date (the cleared picker) and a custom range. Reset is
 * the legacy Clear All.
 */
export function FiltersBar({ dateRange, onDateRangeChange, onClear }: FiltersBarProps) {
  const applied = normalizeReferralRange(dateRange)

  function apply(payload: DateRangeApply) {
    if (payload.kind === 'custom') {
      onDateRangeChange({ from: payload.from, to: payload.to })
      return
    }
    onDateRangeChange(null)
  }

  return (
    <DateRangeField
      label="Date range"
      size="md"
      presets={REFERRAL_DATE_PRESETS}
      appliedPreset={referralDatePreset(applied)}
      appliedFrom={applied.from}
      appliedTo={applied.to}
      onApply={apply}
      onReset={onClear}
    />
  )
}

