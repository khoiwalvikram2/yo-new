import { useMemo } from 'react'
import { Combobox } from '@/ui/components/Combobox'
import { DateRangeField } from '@/ui/components/DateRangeField'
import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { useMatkas } from '../../../../modules/matka'
import type { MatkaResultFilters } from '../../../../modules/matka/results'
import {
  MATKA_RESULT_DATE_PRESETS,
  MATKA_RESULT_STATUS_FILTER_OPTIONS,
  MATKA_RESULT_TYPE_FILTER_OPTIONS,
  applyMatkaResultDateRange,
  applyStatusFilter,
  countActiveMatkaResultFilters,
  matkaListboxOptions,
  matkaOptionsFrom,
  matkaResultDatePreset,
  statusFilterValue,
  typeFilterFromValue,
  withMatkaResultFilter,
} from '../matkaResultsModel'
import styles from '../MatkaResultsPage.module.css'

type FiltersBarProps = {
  filters: MatkaResultFilters
  onChangeFilters: (filters: MatkaResultFilters) => void
  onClearAll: () => void
}

export function FiltersBar({ filters, onChangeFilters, onClearAll }: FiltersBarProps) {
  const { data: matkasData } = useMatkas({ page: 1, limit: 1000 })
  const marketOptions = useMemo(
    () => matkaListboxOptions(matkaOptionsFrom(matkasData?.matkas?.items)),
    [matkasData],
  )

  const activeFiltersCount = countActiveMatkaResultFilters(filters)

  return (
    <FilterBar
      label="Filters"
      activeCount={activeFiltersCount}
      onClearAll={onClearAll}
      search={(
        <SearchField
          label="Search results"
          placeholder="Search result, declared by..."
          size="sm"
          value={filters.search ?? ''}
          onChange={(search) => onChangeFilters({ ...filters, search, page: 1 })}
        />
      )}
    >
      <Combobox
        label="Market"
        hideLabel
        size="sm"
        className={styles.marketField}
        placeholder="All Markets"
        clearable
        options={marketOptions}
        value={filters.matkaId ?? null}
        onChange={(value) => onChangeFilters(withMatkaResultFilter(filters, { matkaId: value ?? undefined }))}
      />
      <Select
        label="Type"
        hideLabel
        size="sm"
        className={styles.typeField}
        value={filters.type ?? ''}
        options={MATKA_RESULT_TYPE_FILTER_OPTIONS}
        onChange={(value) => onChangeFilters(withMatkaResultFilter(filters, { type: typeFilterFromValue(value) }))}
      />
      <DateRangeField
        label="Date range"
        presets={MATKA_RESULT_DATE_PRESETS}
        appliedPreset={matkaResultDatePreset(filters)}
        appliedFrom={filters.dateFrom}
        appliedTo={filters.dateTo}
        onApply={(payload) => onChangeFilters(applyMatkaResultDateRange(filters, payload))}
        onReset={() => onChangeFilters(applyMatkaResultDateRange(filters, { kind: 'preset', preset: 'all' }))}
      />
      <Select
        label="Status"
        hideLabel
        size="sm"
        className={styles.statusField}
        value={statusFilterValue(filters.rolledBack)}
        options={MATKA_RESULT_STATUS_FILTER_OPTIONS}
        onChange={(value) => onChangeFilters(applyStatusFilter(filters, value))}
      />
    </FilterBar>
  )
}

