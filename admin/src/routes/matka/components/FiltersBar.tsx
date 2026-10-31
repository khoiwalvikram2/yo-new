import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { countMatkaFilters, MATKA_STATUS_OPTIONS } from '../matkaManagementModel'
import styles from '../ManagementPage.module.css'

interface FiltersBarProps {
  query: string
  status: string
  onChangeQuery: (value: string) => void
  onChangeStatus: (value: string) => void
  onClearAll: () => void
}

export function FiltersBar({ query, status, onChangeQuery, onChangeStatus, onClearAll }: FiltersBarProps) {
  return (
    <FilterBar
      activeCount={countMatkaFilters(query, status)}
      onClearAll={onClearAll}
      search={(
        <SearchField
          label="Search matka draws"
          hideLabel
          size="sm"
          placeholder="Search matka draws..."
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
        options={MATKA_STATUS_OPTIONS}
        onChange={onChangeStatus}
        className={styles.statusField}
      />
    </FilterBar>
  )
}

