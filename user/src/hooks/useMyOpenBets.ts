import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { getUserBets } from '@/lib/api/user'
import { getMyMatkaBets, type MatkaBet } from '@/lib/api/matka'
import { isOpenMatkaBet, isOpenSportsBet, type BetsTab } from '@/features/my-bets/model'

async function loadSports() {
  const response = await getUserBets({ openOnly: true })
  if (response.meta.code !== 200 || !Array.isArray(response.data)) throw new Error('Failed to load sports bets')
  return response.data.filter(isOpenSportsBet)
}

async function loadMatka(isCancelled: () => boolean) {
  const bets = new Map<string, MatkaBet>()
  // The history API caps each page at 100. Read every open page, including older trading dates.
  for (let page = 1; !isCancelled(); page++) {
    const response = await getMyMatkaBets({ status: 'open', page, limit: 100 })
    for (const bet of response.data) if (isOpenMatkaBet(bet)) bets.set(bet.id, bet)
    if (!response.meta.hasMore) break
    if (!response.data.length) throw new Error('Could not load all open Matka bets')
  }
  return [...bets.values()]
}

function useOpenList<T>(scope: string, enabled: boolean, load: (isCancelled: () => boolean) => Promise<T[]>) {
  const [read, setRead] = useState<{ scope: string; data: T[]; loading: boolean; loaded: boolean; error: string | null }>({ scope: '', data: [], loading: false, loaded: false, error: null })
  const refresh = useRef<() => void>(() => {})
  useEffect(() => {
    if (!enabled) return
    let cancelled = false, inFlight = false
    const fetchBets = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      setRead(previous => ({ scope, data: previous.scope === scope ? previous.data : [], loaded: previous.scope === scope && previous.loaded, loading: true, error: null }))
      try {
        const data = await load(() => cancelled)
        if (!cancelled) setRead({ scope, data, loading: false, loaded: true, error: null })
      } catch {
        if (!cancelled) setRead(previous => ({ ...previous, loading: false, error: 'Could not refresh your open bets. Please try again.' }))
      } finally { inFlight = false }
    }
    const refreshVisible = () => { if (document.visibilityState !== 'hidden') void fetchBets() }
    refresh.current = () => { void fetchBets() }
    void fetchBets()
    const timer = window.setInterval(refreshVisible, 5000)
    window.addEventListener('focus', refreshVisible)
    window.addEventListener('stakex:bet-placed', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      cancelled = true
      refresh.current = () => {}
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
      window.removeEventListener('stakex:bet-placed', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [enabled, scope, load])
  const current = read.scope === scope
  return { data: current ? read.data : [], loading: !current || (!read.loaded && !read.error), refreshing: current && read.loading, error: current ? read.error : null, refresh: () => refresh.current() }
}

export function useMyOpenBets(tab: BetsTab) {
  const { user, isAuthenticated, isHydrating } = useAuth()
  const canRead = !!user?.id && isAuthenticated && !isHydrating
  const scope = JSON.stringify([user?.id, isAuthenticated, isHydrating])
  const sports = useOpenList(scope, canRead && tab === 'sports', loadSports)
  const matka = useOpenList(scope, canRead && tab === 'matka', loadMatka)
  return { sports, matka }
}
