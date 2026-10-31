import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { SearchField } from '@/ui/components/SearchField'
import { Spinner } from '@/ui/components/Spinner'
import styles from './GlobalSearch.module.css'

interface SearchInputProps { value: string; onChange: (value: string) => void; loading?: boolean; autoFocus?: boolean; onEscape?: () => void; resultsId?: string; activeResultId?: string }
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput({ value, onChange, loading = false, autoFocus = false, onEscape, resultsId, activeResultId }, ref) {
  const input = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => input.current as HTMLInputElement, [])
  useEffect(() => {
    if (!autoFocus) return
    const timeout = setTimeout(() => input.current?.focus(), 80)
    return () => clearTimeout(timeout)
  }, [autoFocus])
  return <div className={styles.inputRow}>
    <SearchField ref={input} label="Search anything" value={value} onChange={onChange} placeholder="Search anything..." autoComplete="off" spellCheck={false}
      role={resultsId ? 'combobox' : undefined} aria-autocomplete={resultsId ? 'list' : undefined} aria-expanded={resultsId ? true : undefined} aria-controls={resultsId} aria-activedescendant={activeResultId}
      onKeyDown={event => { if (event.key === 'Escape' && onEscape) { event.preventDefault(); event.stopPropagation(); onEscape() } }} className={styles.input} />
    {loading && <Spinner label="Searching entities" size="sm" />}
  </div>
})
