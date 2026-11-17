import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * A list page seeds its search box from ?search= once, as its initial state. A later link to the same page (the
 * global search's "See all", or a casino game result, which opens the games list filtered by its name) finds the
 * page still mounted, so that initial value never runs again and the box kept the old term. This hands the term
 * of each later navigation to onTerm, the same handler the box's typing uses. Navigations without the parameter
 * (a page writing its own tab or filter to the URL) leave the box alone.
 */
export function useSearchParamUpdates(onTerm: (term: string) => void, param = 'search'): void {
  const location = useLocation()
  const handledKey = useRef(location.key)
  useEffect(() => {
    if (location.key === handledKey.current) return
    handledKey.current = location.key
    const term = new URLSearchParams(location.search).get(param)
    if (term !== null) onTerm(term)
  }, [location.key, location.search, onTerm, param])
}
