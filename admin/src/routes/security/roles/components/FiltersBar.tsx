import { useRef } from 'react'
import { FilterBar } from '@/ui/components/FilterBar'
import { SearchField } from '@/ui/components/SearchField'
import { SEARCH_PLACEHOLDER, activeFilterCount } from '../rolesManagementModel'

type FiltersBarProps = {
  query: string
  onChangeQuery: (v: string) => void
  onClearAll: () => void
}

/* The legacy filter row: one client-side search (every keystroke, no debounce, as before), with Clear all
   while it holds text. A search-only FilterBar never folds into the compact Filters popover. */
export function FiltersBar({
  query,
  onChangeQuery,
  onClearAll,
}: FiltersBarProps) {
  const searchRef = useRef<HTMLInputElement>(null)

  return (
    <FilterBar
      label="Filters"
      activeCount={activeFilterCount(query)}
      onClearAll={() => {
        onClearAll()
        // FilterBar refocuses only when the focused Clear all unmounts; a click that never focused the
        // button (Safari) would otherwise leave focus on the page. Focus goes back to the search it emptied.
        searchRef.current?.focus()
      }}
      search={(
        <SearchField
          ref={searchRef}
          label="Search roles"
          placeholder={SEARCH_PLACEHOLDER}
          size="sm"
          value={query}
          onChange={onChangeQuery}
        />
      )}
    />
  )
}
