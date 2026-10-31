/**
 * The matcher GlobalSearch passes to useGlobalSearch (contracts §8.13, §11.1). Rows are the searchable page
 * rows of the shell navigation (Task 27's searchablePageRows), recomputed only when useShellNavigation returns
 * new sections: a role or principal change, or a Super Admin core/whitelabel switch. The callback therefore
 * keeps its identity between renders, which the pages, results and allResults memos in useGlobalSearch
 * rely on.
 */
import { useCallback, useMemo } from 'react'
import type { SearchResult } from '@/hooks/useGlobalSearch'
import { matchPages, searchablePageRows } from './matchPages'
import { toPageSearchResults } from './pageSearchResults'
import { useShellNavigation } from './useShellNavigation'

/** Stable callback (memoised on sections) for useGlobalSearch's second argument. */
export function usePageMatcher(): (query: string) => SearchResult[] {
  const sections = useShellNavigation()
  const rows = useMemo(() => searchablePageRows(sections), [sections])
  return useCallback((query: string) => toPageSearchResults(matchPages(query, rows)), [rows])
}
