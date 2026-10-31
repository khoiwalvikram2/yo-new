import { DateRangeField } from '@/ui/components/DateRangeField'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'
import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import {
  getDepositPresetFromRange,
  getDepositRangeForPreset,
  type DepositDatePreset,
  type DepositDateRange,
} from '../depositRequestsModel'

const DATE_PRESETS: ReadonlyArray<{ value: DepositDatePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 Days' },
  { value: 'last30days', label: 'Last 30 Days' },
  { value: 'custom', label: 'Custom range' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

const METHOD_OPTIONS = [
  { value: '', label: 'All Methods' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'UPI', label: 'UPI' },
]

type DepositRequestsFiltersBarProps = {
  status: string
  method: string
  query: string
  dateRange?: DepositDateRange
  onChangeStatus: (v: string) => void
  onChangeMethod: (v: string) => void
  onChangeQuery: (v: string) => void
  onChangeDateRange: (range: DepositDateRange | null) => void
  onClearAll: () => void
}

export function DepositRequestsFiltersBar({
  status,
  method,
  query,
  dateRange,
  onChangeStatus,
  onChangeMethod,
  onChangeQuery,
  onChangeDateRange,
  onClearAll,
}: DepositRequestsFiltersBarProps) {
  const appliedPreset = getDepositPresetFromRange(dateRange)
  const activeCount = [query, status, method, appliedPreset !== 'today' ? true : null].filter(Boolean).length

  function applyDateRange(payload: DateRangeApply) {
    if (payload.kind === 'custom') {
      onChangeDateRange({ from: payload.from, to: payload.to })
      return
    }

    const range = getDepositRangeForPreset(payload.preset as DepositDatePreset)
    if (range) onChangeDateRange(range)
  }

  function resetDateRange() {
    onChangeDateRange(getDepositRangeForPreset('today'))
  }

  return (
    <FilterBar
      label="Deposit filters"
      activeCount={activeCount}
      onClearAll={onClearAll}
      search={(
        <SearchField
          label="Search deposit requests"
          placeholder="UTR, Reference ID..."
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
      <Select
        label="Method"
        hideLabel
        size="sm"
        value={method}
        options={METHOD_OPTIONS}
        onChange={onChangeMethod}
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
