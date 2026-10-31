import { DateRangeField } from '@/ui/components/DateRangeField'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'
import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import {
  getWithdrawalPresetFromRange,
  getWithdrawalRangeForPreset,
  type WithdrawalDatePreset,
  type WithdrawalDateRange,
} from '../withdrawalRequestsModel'

const DATE_PRESETS: ReadonlyArray<{ value: WithdrawalDatePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 Days' },
  { value: 'last30days', label: 'Last 30 Days' },
  { value: 'custom', label: 'Custom range' },
]

// The legacy phone layout titled this block "Filters"; it also names the compact trigger, and a longer
// name overflows the compact row at 375px.
const FILTERS_LABEL = 'Filters'

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

type WithdrawalRequestsFiltersBarProps = {
  status: string
  query: string
  dateRange?: WithdrawalDateRange
  onChangeStatus: (v: string) => void
  onChangeQuery: (v: string) => void
  onChangeDateRange: (range: WithdrawalDateRange | null) => void
  onClearAll: () => void
}

export function WithdrawalRequestsFiltersBar({
  status,
  query,
  dateRange,
  onChangeStatus,
  onChangeQuery,
  onChangeDateRange,
  onClearAll,
}: WithdrawalRequestsFiltersBarProps) {
  const appliedPreset = getWithdrawalPresetFromRange(dateRange)
  // The date range counts only when it is not the default Today, as before.
  const activeCount = [query, status, appliedPreset !== 'today' ? true : null].filter(Boolean).length

  function applyDateRange(payload: DateRangeApply) {
    if (payload.kind === 'custom') {
      onChangeDateRange({ from: payload.from, to: payload.to })
      return
    }

    const range = getWithdrawalRangeForPreset(payload.preset as WithdrawalDatePreset)
    if (range) onChangeDateRange(range)
  }

  function resetDateRange() {
    onChangeDateRange(getWithdrawalRangeForPreset('today'))
  }

  return (
    <FilterBar
      label={FILTERS_LABEL}
      activeCount={activeCount}
      onClearAll={onClearAll}
      search={(
        <SearchField
          label="Search withdrawal requests"
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
        onReset={resetDateRange}
      />
    </FilterBar>
  )
}
