import { useEffect, useState } from 'react'
import { getCasinoGames } from '@/lib/api/user'

/** How many games the lobby holds (live tables or slots) for the chosen providers: one `limit: 1`
 *  request read for `meta.total` (summing category totals would count a game once per category it
 *  is listed in). Undefined until it answers, null if it fails. */
export default function useLobbyTotal(kind: 'live' | 'slots', providers: string[]): number | null | undefined {
  const [total, setTotal] = useState<number | null | undefined>(undefined)
  const providerKey = providers.join('\n')
  useEffect(() => {
    let cancelled = false
    setTotal(undefined)
    const list = providerKey ? providerKey.split('\n') : undefined
    getCasinoGames({ ...(kind === 'slots' ? { slots: true } : { liveOnly: true }), page: 1, limit: 1, providers: list })
      .then((res) => {
        const value = (res?.meta as Record<string, unknown> | undefined)?.total
        if (!cancelled) setTotal(typeof value === 'number' && Number.isFinite(value) ? value : null)
      })
      .catch(() => { if (!cancelled) setTotal(null) })
    return () => { cancelled = true }
  }, [kind, providerKey])
  return total
}
