import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { CURRENCY_STATUS_OPTIONS, countActiveFilters } from '../currencyManagementModel'

type FiltersBarProps = {
  query: string
  status: string
  onChangeQuery: (v: string) => void
  onChangeStatus: (v: string) => void
  onClearAll: () => void
}

/* The legacy filter row on the kit FilterBar: the client-side search (every keystroke, no debounce, as
   before) and the status select, whose cleared value is "All Status". The landmark and its compact phone
   trigger are named "Filters" (a longer name overflows the compact row at 375px, Task 101). */
export function FiltersBar({
  query,
  status,
  onChangeQuery,
  onChangeStatus,
  onClearAll,
}: FiltersBarProps) {
  return (
    <FilterBar
      label="Filters"
      activeCount={countActiveFilters(query, status)}
      onClearAll={onClearAll}
      search={(
        <SearchField
          label="Search currencies"
          placeholder="Currency code, name, symbol..."
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
        options={CURRENCY_STATUS_OPTIONS}
        onChange={onChangeStatus}
      />
    </FilterBar>
  )
}
