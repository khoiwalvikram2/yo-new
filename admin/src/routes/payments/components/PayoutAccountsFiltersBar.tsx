import { DateRangeField } from '@/ui/components/DateRangeField'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'
import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import {
  countPayoutFilters,
  getPayoutDatePreset,
  type PayoutDatePreset,
  type PayoutDateRange,
} from '../payoutAccountApprovalsModel'

// The legacy picker had no presets: an empty picker meant every date, otherwise a custom range.
const DATE_PRESETS: ReadonlyArray<{ value: PayoutDatePreset; label: string }> = [
  { value: 'all', label: 'All dates' },
  { value: 'custom', label: 'Custom range' },
]

// The legacy phone layout titled this block "Filters"; it also names the compact trigger, and a longer
// name overflows the compact row at 375px (Task 101).
const FILTERS_LABEL = 'Filters'

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
]

type PayoutAccountsFiltersBarProps = {
  status: string
  query: string
  dateRange?: PayoutDateRange | null
  onChangeStatus: (v: string) => void
  onChangeQuery: (v: string) => void
  onChangeDateRange: (dates: PayoutDateRange | null) => void
  onClearAll: () => void
}

export function PayoutAccountsFiltersBar({
  status,
  query,
  dateRange,
  onChangeStatus,
  onChangeQuery,
  onChangeDateRange,
  onClearAll,
}: PayoutAccountsFiltersBarProps) {
  const appliedPreset = getPayoutDatePreset(dateRange)
  // A date range counts as one filter (the legacy badge counted its two ends separately).
  const activeCount = countPayoutFilters(query, status, dateRange)

  function applyDateRange(payload: DateRangeApply) {
    if (payload.kind === 'custom') {
      onChangeDateRange({ from: payload.from, to: payload.to })
      return
    }
    // "All dates" is the cleared picker: no date filter at all.
    onChangeDateRange(null)
  }

  return (
    <FilterBar
      label={FILTERS_LABEL}
      activeCount={activeCount}
      onClearAll={onClearAll}
      search={(
        <SearchField
          label="Search payout accounts"
          placeholder="User name, phone, email..."
          size="sm"
          value={query}
          onChange={onChangeQuery}
        />
      )}
    >
      <Select
        label="Status"
        hideLabel
        size="sm"
        value={status}
        options={STATUS_OPTIONS}
        onChange={onChangeStatus}
      />
      <DateRangeField
        label="Date range"
        presets={DATE_PRESETS}
        appliedPreset={appliedPreset}
        appliedFrom={dateRange?.from}
        appliedTo={dateRange?.to}
        onApply={applyDateRange}
        onReset={() => onChangeDateRange(null)}
      />
    </FilterBar>
  )
}
