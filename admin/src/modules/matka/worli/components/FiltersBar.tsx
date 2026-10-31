import { DateField } from '@/ui/components/DateField'
import { MultiSelect } from '@/ui/components/MultiSelect'
import { Select } from '@/ui/components/Select'
import { Switch } from '@/ui/components/Switch'
import { todayISTString } from '@/shared/utils/date'
import { useWorliFilters } from '@/state/matkaWorli'
import { WORLI_SORT_OPTIONS, WORLI_STATUS_OPTIONS, isWorliStatus } from '../runningMarketsModel'
import styles from '../RunningMarketsPage.module.css'

/* The advanced filters: run date, statuses, Has result and sort, read from and written to the persisted
   Worli filter store exactly as before. They are the page FilterBar's controls, so they sit inline on a
   wide bar and inside its Filters popover on a narrow one. The legacy panel also repeated the search box
   ("Search market name"); the page's single search field edits the same stored value. */
export function FiltersBar() {
  const { date, status, hasResult, sort, setDate, setStatus, setHasResult, setSort } = useWorliFilters()
  return (
    <>
      {/* Clearing the date falls back to today in IST, as the legacy picker's clear did. */}
      <DateField
        label="Date"
        hideLabel
        size="sm"
        className={styles.dateField}
        value={date}
        onChange={(value) => setDate(value || todayISTString())}
      />
      <MultiSelect
        label="Status"
        hideLabel
        size="sm"
        className={styles.statusField}
        placeholder="Status"
        clearable
        maxTagCount={1}
        options={WORLI_STATUS_OPTIONS}
        value={status}
        onChange={(values) => setStatus(values.filter(isWorliStatus))}
      />
      <Switch label="Has result" checked={!!hasResult} onChange={(v) => setHasResult(v)} />
      <Select
        label="Sort"
        hideLabel
        size="sm"
        className={styles.sortField}
        value={sort ?? ''}
        options={WORLI_SORT_OPTIONS}
        onChange={setSort}
      />
    </>
  )
}

