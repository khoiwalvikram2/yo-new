import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '@/lib/auth'
import { getUserBets } from '@/lib/api/user'

export type UserBet = {
  id?: string
  eventId?: string
  marketId?: string
  market?: string
  marketName?: string
  marketType?: string
  selectionId?: string | number
  selection?: string
  type?: 'back' | 'lay' | 'Back' | 'Lay'
  side?: 'back' | 'lay'
  odds?: number
  stake?: number
  status?: string
  createdAt?: string
  pl?: number
  oddsSize?: number
}

type UseOpenBetsParams = {
  eventId?: string
  marketIds?: string[] | undefined // Can be undefined to fetch all event bets
  marketType?: 'exchange' | 'bookmaker' | 'fancy'
}

export function useOpenBets(params: UseOpenBetsParams) {
  const { isAuthenticated, isHydrating, user } = useAuth()
  const userId = user?.id
  const eventId = params.eventId || ''
  const marketType = params.marketType || ''
  const marketKey = JSON.stringify([...new Set(params.marketIds?.filter(Boolean) || [])].sort())
  const scope = JSON.stringify([isAuthenticated, isHydrating, userId, eventId, marketType, marketKey])
  const canRead = isAuthenticated && !isHydrating && !!userId && !!eventId
  const owner = useRef(scope)
  owner.current = scope
  const generation = useRef(0)
  const [read, setRead] = useState<{ scope: string; data: UserBet[]; loading: boolean; error: string | null }>({ scope: '', data: [], loading: false, error: null })

  const fetchBets = useCallback(async () => {
    const request = ++generation.current
    if (!canRead) return
    setRead(previous => ({ scope, data: previous.scope === scope ? previous.data : [], loading: true, error: null }))
    const current = () => generation.current === request && owner.current === scope
    try {
      const ids: string[] = JSON.parse(marketKey)
      const response = await getUserBets({ eventId, marketIds: ids.length ? ids : undefined, openOnly: true })
      if (!current()) return
      if (response.meta.code !== 200 || !Array.isArray(response.data)) throw new Error('Failed to load open bets')
      const data: UserBet[] = response.data
        .filter(b => ['matched', 'unmatched', 'pending', 'open'].includes((b.status || '').toLowerCase()))
        .map(b => ({ ...b, market: b.market || b.marketName, side: (b.side || b.type || '').toLowerCase() as 'back' | 'lay', type: (b.side || b.type || '').toLowerCase() as 'back' | 'lay' }))
      setRead({ scope, data, loading: false, error: null })
    } catch {
      if (current()) setRead({ scope, data: [], loading: false, error: 'Failed to load open bets' })
    }
  }, [canRead, eventId, marketKey, scope])

  useEffect(() => {
    void fetchBets()
    return () => { ++generation.current }
  }, [fetchBets])

  const current = read.scope === scope
  return {
    data: canRead && current ? read.data : [],
    isLoading: canRead && (!current || read.loading),
    error: canRead && current ? read.error : null,
    refresh: fetchBets,
  }
}
