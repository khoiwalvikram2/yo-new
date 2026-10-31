import { useState, useEffect, useMemo } from 'react'

export interface UseSearchOptions {
  /** Minimum length before debouncedQuery is updated (default 2) */
  minLength?: number
  /** Debounce delay in ms (default 300) */
  debounceMs?: number
  /** Initial value (e.g. from URL) */
  initialQuery?: string
}

/**
 * Shared search hook: standardized debounce and min length for domain search pages.
 * - query/setQuery: controlled input value
 * - debouncedQuery: value to use for API (updates after debounceMs of no changes)
 * - isSearching: true while query has changed but debouncedQuery hasn't caught up
 */
export function useSearch(opts: UseSearchOptions = {}) {
  const {
    minLength = 2,
    debounceMs = 300,
    initialQuery = '',
  } = opts

  const [query, setQuery] = useState(initialQuery)
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length > 0 && trimmed.length < minLength) {
      setDebouncedQuery('')
      return
    }
    const timeoutId = setTimeout(() => {
      setDebouncedQuery(trimmed)
    }, debounceMs)
    return () => clearTimeout(timeoutId)
  }, [query, minLength, debounceMs])

  const isSearching = query !== debouncedQuery

  const meetsMinLength = useMemo(
    () => query.trim().length >= minLength,
    [query, minLength]
  )

  return {
    query,
    setQuery,
    debouncedQuery,
    isSearching,
    meetsMinLength,
  }
}
