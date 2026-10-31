import { useMemo } from 'react'
import { useQuery } from '@apollo/client'
import { LIST_EVENTS, LIST_LEAGUES, LIST_SPORTS } from '@/lib/graphql/sports'
import { Combobox } from '@/ui/components/Combobox'
import { DateRangeField } from '@/ui/components/DateRangeField'
import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import type { SportsResultFilters } from '../../../../modules/sports/results'
import {
  MANUAL_RESULT_DATE_PRESETS,
  MARKET_TYPE_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
  applyManualResultDateRange,
  applyStatusFilter,
  countActiveManualResultFilters,
  manualResultDatePreset,
  namedOptions,
  statusFilterValue,
  withEvent,
  withLeague,
  withMarketType,
  withSearch,
  withSport,
} from '../manualResultsModel'
import styles from '../ManualResultsPage.module.css'

interface FiltersBarProps {
  filters: SportsResultFilters
  onChangeFilters: (filters: SportsResultFilters) => void
  onClearAll: () => void
}

export function FiltersBar({ filters, onChangeFilters, onClearAll }: FiltersBarProps) {
  const { data: sportsData } = useQuery(LIST_SPORTS, { errorPolicy: 'all' })
  const { data: leaguesData } = useQuery(LIST_LEAGUES, {
    variables: { sportId: filters.sportId || '' },
    skip: !filters.sportId,
    errorPolicy: 'all',
  })
  const { data: eventsData } = useQuery(LIST_EVENTS, {
    variables: { leagueId: filters.leagueId || '' },
    skip: !filters.leagueId,
    errorPolicy: 'all',
  })
  const sports = useMemo(() => namedOptions(sportsData?.sports), [sportsData?.sports])
  const leagues = useMemo(() => namedOptions(leaguesData?.leagues), [leaguesData?.leagues])
  const events = useMemo(() => namedOptions(eventsData?.events), [eventsData?.events])

  return (
    <FilterBar
      label="Filters"
      activeCount={countActiveManualResultFilters(filters)}
      onClearAll={onClearAll}
      search={(
        <SearchField
          label="Search results"
          placeholder="Search selection name, declared by..."
          size="sm"
          value={filters.search ?? ''}
          onChange={(value) => onChangeFilters(withSearch(filters, value))}
        />
      )}
    >
      <Combobox
        label="Sport"
        hideLabel
        size="sm"
        className={styles.filterControl}
        placeholder="All Sports"
        clearable
        options={sports}
        value={filters.sportId ?? null}
        onChange={(value) => onChangeFilters(withSport(filters, value ?? undefined))}
      />
      <Combobox
        label="League"
        hideLabel
        size="sm"
        className={styles.filterControl}
        placeholder="All Leagues"
        clearable
        disabled={!filters.sportId}
        options={leagues}
        value={filters.leagueId ?? null}
        onChange={(value) => onChangeFilters(withLeague(filters, value ?? undefined))}
      />
      <Combobox
        label="Event"
        hideLabel
        size="sm"
        className={styles.eventFilter}
        placeholder="All Events"
        clearable
        disabled={!filters.leagueId}
        options={events}
        value={filters.eventId ?? null}
        onChange={(value) => onChangeFilters(withEvent(filters, value ?? undefined))}
      />
      <Select
        label="Market type"
        hideLabel
        size="sm"
        className={styles.filterControl}
        value={filters.marketType ?? ''}
        options={MARKET_TYPE_FILTER_OPTIONS}
        onChange={(value) => onChangeFilters(withMarketType(filters, value))}
      />
      <DateRangeField
        label="Date range"
        className={styles.dateFilter}
        presets={MANUAL_RESULT_DATE_PRESETS}
        appliedPreset={manualResultDatePreset(filters)}
        appliedFrom={filters.dateFrom}
        appliedTo={filters.dateTo}
        onApply={(payload) => onChangeFilters(applyManualResultDateRange(filters, payload))}
        onReset={() => onChangeFilters(applyManualResultDateRange(filters, { kind: 'preset', preset: 'all' }))}
      />
      <Select
        label="Status"
        hideLabel
        size="sm"
        className={styles.filterControl}
        value={statusFilterValue(filters.rolledBack)}
        options={STATUS_FILTER_OPTIONS}
        onChange={(value) => onChangeFilters(applyStatusFilter(filters, value))}
      />
    </FilterBar>
  )
}
