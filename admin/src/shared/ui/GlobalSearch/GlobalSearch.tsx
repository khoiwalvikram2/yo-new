import React, { useEffect, useRef, useCallback, useMemo, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconClock, IconKeyboard } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { useGlobalSearch, type SearchResult } from '@/hooks/useGlobalSearch'
import { SearchInput } from './SearchInput'
import { SearchResults, seeAllPath } from './SearchResults'
import { SearchResultIcon } from './SearchResultItem'
import { usePageMatcher } from '@/shell/usePageMatcher'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import styles from './GlobalSearch.module.css'

interface GlobalSearchProps {
  isOpen: boolean
  onClose: () => void
}

const IP_REGEX = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

// Each domain here must exist in the permission catalogue. hasPermissionWithNested
// returns false for a domain it has never heard of, so a typo does not raise —
// it quietly removes the category for everyone except an all:* holder.
// crmSearchCategories.test.ts asserts every one of these resolves.
const ALL_SEARCH_CATEGORIES = [
  { key: 'players', icon: 'fa-user', label: 'Players', hint: 'name, email, phone', domain: 'players.list', action: 'view' },
  { key: 'agents', icon: 'fa-user-tie', label: 'Agents', hint: 'username, phone', domain: 'agents', action: 'view' },
  { key: 'whitelabels', icon: 'fa-globe', label: 'Whitelabels', hint: 'name, domain', domain: 'config.whitelabels', action: 'view' },
  { key: 'casinoGames', icon: 'fa-gamepad', label: 'Casino Games', hint: 'game name', domain: 'casino.management', action: 'view' },
  { key: 'sports', icon: 'fa-futbol', label: 'Sports', hint: 'events, leagues', domain: 'sports.events', action: 'view' },
  { key: 'vipMembers', icon: 'fa-gem', label: 'VIP', hint: 'tier members', domain: 'vip', action: 'view' },
  { key: 'matkas', icon: 'fa-dice-five', label: 'Matka', hint: 'name, code', domain: 'matka.management', action: 'view' },
  { key: 'referralCodes', icon: 'fa-share-nodes', label: 'Referrals', hint: 'referral codes', domain: 'referrals.overview', action: 'view' },
  { key: 'bets', icon: 'fa-receipt', label: 'Bets', hint: 'bet ID, open list', domain: 'sports.bets', action: 'view' },
  { key: 'bonuses', icon: 'fa-gift', label: 'Bonuses', hint: 'campaign name', domain: 'bonuses.list', action: 'view' },
]

const AGENT_ALLOWED_CATEGORIES = ['players', 'agents']

export const GlobalSearch: React.FC<GlobalSearchProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate()
  const modalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const prefix = useId()
  const isMac = typeof navigator !== 'undefined' && navigator.platform?.toUpperCase().includes('MAC')
  const adminPermissions = useAuthStore((s) => s.permissions)
  const isAgent = useAuthStore((s) => s.isAgent())
  const searchCategories = useMemo(() => {
    if (isAgent) {
      return ALL_SEARCH_CATEGORIES.filter((cat) => AGENT_ALLOWED_CATEGORIES.includes(cat.key))
    }
    if (!adminPermissions?.length) return ALL_SEARCH_CATEGORIES
    return ALL_SEARCH_CATEGORIES.filter((cat) =>
      hasPermissionWithNested(adminPermissions, cat.domain, cat.action)
    )
  }, [adminPermissions, isAgent])
  const matchPageResults = usePageMatcher()
  const {
    query, setQuery, results, allResults, loading, error,
    selectedIndex, navigateUp, navigateDown, selectResult, reset,
    categoryFilter, setCategoryFilter, recentSearches, addToRecent, clearRecentSearches,
  } = useGlobalSearch(isOpen, matchPageResults)

  // Reset when modal closes (clear query and category filter)
  useEffect(() => {
    if (!isOpen) {
      reset()
      setCategoryFilter(null)
    }
  }, [isOpen, reset, setCategoryFilter])
  
  // Memoize escape handler to prevent unnecessary re-renders
  // Note: reset() is already called by the useEffect above when isOpen becomes false
  const handleEscape = useCallback(() => {
    onClose()
  }, [onClose])
  

  // Memoize navigation handlers to prevent unnecessary re-renders
  const handleNavigation = useCallback((e: KeyboardEvent) => {
    if (!modalRef.current) return

    // Arrow keys retain the existing flat-result selection order.
    if (allResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        navigateDown()
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        navigateUp()
        return
      }
    }

    // Enter: open highlighted result when focus is inside modal but not on a button/link
    // (so category chips, recent rows, See all, clear-X keep native Enter behavior)
    if (e.key === 'Enter' && allResults.length > 0) {
      const ae = document.activeElement as HTMLElement | null
      if (!ae || !modalRef.current.contains(ae)) return
      const tag = ae.tagName
      if (tag === 'BUTTON' || tag === 'A') return
      if (ae.isContentEditable) return
      e.preventDefault()
      const result = selectResult()
      if (result) {
        addToRecent(query.trim())
        navigate(result.route)
        onClose()
        reset()
      }
    }
  }, [allResults.length, navigateDown, navigateUp, selectResult, navigate, onClose, reset, addToRecent, query])
  
  useEffect(() => {
    if (!isOpen) return
    document.addEventListener('keydown', handleNavigation)
    return () => document.removeEventListener('keydown', handleNavigation)
  }, [isOpen, handleNavigation])

  // Memoize result selection handler
  const handleSelect = useCallback((result: SearchResult) => {
    addToRecent(query.trim())
    navigate(result.route)
    onClose()
    reset()
  }, [navigate, onClose, reset, query, addToRecent])

  // Parent chain chip click: navigate to agent and close search
  const handleParentChainClick = useCallback((route: string) => {
    navigate(route)
    onClose()
    reset()
  }, [navigate, onClose, reset])

  // "See all" link: navigate to domain page with search param (the table SearchResults shows the link from); the
  // agents list also gets the scheme of the matched agents, since it lists one scheme at a time (B005)
  const handleSeeAll = useCallback((categoryKey: string, q: string) => {
    const url = seeAllPath(categoryKey, q, results)
    if (url) {
      navigate(url)
      onClose()
      reset()
    }
  }, [navigate, onClose, reset, results])

  const trimmed = query.trim()
  const enoughCharacters = trimmed.length >= (IP_REGEX.test(trimmed) ? 1 : 2)
  const footerVisible = allResults.length > 0 || recentSearches.length > 0
  return <Dialog open={isOpen} onOpenChange={next => { if (!next) onClose() }} title="Search" size="lg" initialFocus={inputRef} className={styles.dialog}
    footer={<div className={footerVisible ? styles.footer : styles.emptyFooter}>
      <div className={styles.hints}><span><kbd>↑</kbd> <kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>Esc</kbd> Close</span></div>
      {recentSearches.length > 0 && <Button variant="ghost" size="sm" onClick={clearRecentSearches}>Clear search history</Button>}
      {allResults.length > 0 && <span className={styles.count}>{allResults.length} result{allResults.length !== 1 ? 's' : ''}</span>}
    </div>}>
    <div ref={modalRef} className={styles.stack}>
      <SearchInput ref={inputRef} value={query} onChange={setQuery} loading={loading} onEscape={handleEscape} resultsId={enoughCharacters ? prefix + '-results' : undefined} activeResultId={enoughCharacters && selectedIndex >= 0 && selectedIndex < allResults.length ? prefix + '-option-' + selectedIndex : undefined} />
      <span className={styles.shortcut}>{isMac ? '⌘K' : 'Ctrl+K'} to toggle search</span>
      {enoughCharacters ? <>
        {allResults.length > 0 && <div className={styles.filters} aria-label="Search category filters">
          <Button size="sm" variant={!categoryFilter ? 'primary' : 'ghost'} aria-pressed={!categoryFilter} onClick={() => setCategoryFilter(null)}>All</Button>
          {searchCategories.map(({ key, label }) => {
            const count = results[key as keyof typeof results]?.length ?? 0
            return count > 0 ? <Button key={key} size="sm" variant={categoryFilter === key ? 'primary' : 'ghost'} aria-pressed={categoryFilter === key} onClick={() => setCategoryFilter(key)}>{label} ({count})</Button> : null
          })}
        </div>}
        <SearchResults results={results} allResults={allResults} selectedIndex={selectedIndex} loading={loading} error={error} query={query} onSelect={handleSelect} onParentChainClick={handleParentChainClick} onSeeAll={handleSeeAll} isAgent={isAgent} idPrefix={prefix} />
      </> : trimmed ? <div className={styles.state}><IconKeyboard size={24} aria-hidden="true" /><p>Keep typing...</p><span>{IP_REGEX.test(trimmed) ? 'Enter a valid IP address to search' : 'Enter at least 2 characters to search'}</span></div> : <div className={styles.stack}>
        {recentSearches.length > 0 && <section aria-label="Recent searches" className={styles.stack}>
          <h3 className={styles.categoryLabel}>Recent searches</h3>
          <div className={styles.resultList}>{recentSearches.slice(0, 10).map(recent => <button key={recent} type="button" className={styles.recent} onClick={() => setQuery(recent)}><IconClock size={16} aria-hidden="true" /><span>{recent}</span></button>)}</div>
        </section>}
        <section aria-label="Search across" className={styles.stack}>
          <h3 className={styles.categoryLabel}>Search across</h3>
          <div className={styles.categoryGrid}>{searchCategories.map(category => <div key={category.key} className={styles.categoryTile}>
            <span className={styles.typeIcon}><SearchResultIcon type={category.icon} /></span><div className={styles.resultCopy}><strong>{category.label}</strong><span className={styles.subtitle}>{category.hint}</span></div>
          </div>)}</div>
        </section>
      </div>}
    </div>
  </Dialog>
}
