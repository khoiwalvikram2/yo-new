import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import {
  DOMAIN_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  TYPE_FILTER_OPTIONS,
  activeBonusFilterCount,
} from '../bonusesListModel'
import styles from '../BonusesListPage.module.css'

/* The legacy phone layout's block had no title; "Filters" names the landmark and the compact trigger,
   as on the payment pages (a longer name overflows the compact row at 375px, Task 101). */
const FILTERS_LABEL = 'Filters'

interface FiltersBarProps {
  search: string
  status: string
  domain: string
  type: string
  onSearchChange: (value: string) => void
  onStatusChange: (value: string) => void
  onDomainChange: (value: string) => void
  onTypeChange: (value: string) => void
  onClearAll: () => void
}

export function FiltersBar({
  search,
  status,
  domain,
  type,
  onSearchChange,
  onStatusChange,
  onDomainChange,
  onTypeChange,
  onClearAll,
}: FiltersBarProps) {
  const activeCount = activeBonusFilterCount({ search, status, domain, type })

  // Every edit is sent as typed, one query per keystroke, as before (no debounce was ever applied).
  return (
    <FilterBar
      label={FILTERS_LABEL}
      activeCount={activeCount}
      onClearAll={onClearAll}
      search={(
        <SearchField
          label="Search campaigns"
          placeholder="Search campaigns by name..."
          size="sm"
          value={search}
          onChange={onSearchChange}
        />
      )}
    >
      <Select
        label="Status"
        hideLabel
        size="sm"
        className={styles.statusFilter}
        value={status}
        options={STATUS_FILTER_OPTIONS}
        onChange={onStatusChange}
      />
      <Select
        label="Domain"
        hideLabel
        size="sm"
        className={styles.domainFilter}
        value={domain}
        options={DOMAIN_FILTER_OPTIONS}
        onChange={onDomainChange}
      />
      <Select
        label="Type"
        hideLabel
        size="sm"
        className={styles.typeFilter}
        value={type}
        options={TYPE_FILTER_OPTIONS}
        onChange={onTypeChange}
      />
    </FilterBar>
  )
}
