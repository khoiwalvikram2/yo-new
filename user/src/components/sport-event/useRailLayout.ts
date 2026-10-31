import { useEffect, useState } from 'react'

const RAIL_QUERY = '(min-width: 801px)'

/** True where the shell shows the utility rail and its right-hand drawers (801px and up). */
export function useRailLayout() {
  const [rail, setRail] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(RAIL_QUERY).matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(RAIL_QUERY)
    const sync = () => setRail(query.matches)
    sync()
    query.addEventListener?.('change', sync)
    return () => query.removeEventListener?.('change', sync)
  }, [])
  return rail
}
