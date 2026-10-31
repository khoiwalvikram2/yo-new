import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCasinoGames } from '@/lib/api/user'

export type LoungeGame = { id: string; gameId: string; title: string; provider: string; image: string }

/** Explicit homepage membership, never a general catalogue fallback. */
export function useCasinoLoungeGames() {
  const { t } = useTranslation()
  const [items, setItems] = useState<LoungeGame[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const page = useRef(0)
  const busy = useRef(false)
  const generation = useRef(0)

  const load = useCallback(async (nextPage: number, requestGeneration: number) => {
    if (busy.current) return
    busy.current = true
    setLoading(true)
    setError(null)
    try {
      const response = await getCasinoGames({ categoryType: 'LOUNGE', page: nextPage, limit: 14 })
      if (generation.current !== requestGeneration) return
      if (!Array.isArray(response?.data) || Number(response?.meta?.code ?? 200) >= 400) throw new Error('Lounge request failed')
      const mapped: LoungeGame[] = response.data.flatMap(game => {
        if (!game?.id || !game?.gameId) return []
        return [{
          id: String(game.id), gameId: String(game.gameId),
          title: String(game.title || t('nova.genericGame')),
          provider: String(game.provider || t('nova.genericProvider')),
          image: String(game.imageUrl || ''),
        }]
      })
      setItems(previous => {
        const unique = new Map((nextPage === 1 ? [] : previous).map(game => [game.id, game]))
        for (const game of mapped) if (!unique.has(game.id)) unique.set(game.id, game)
        return [...unique.values()]
      })
      page.current = nextPage
      setHasMore(response.data.length > 0 && response.meta?.hasMore === true)
    } catch {
      if (generation.current === requestGeneration) setError(t('nova.casinoLoadError'))
    } finally {
      if (generation.current === requestGeneration) {
        busy.current = false
        setLoading(false)
      }
    }
  }, [t])

  useEffect(() => {
    const current = ++generation.current
    page.current = 0
    busy.current = false
    setItems([])
    setHasMore(false)
    void load(1, current)
    return () => { generation.current = current + 1 }
  }, [load])

  const loadMore = () => { if (hasMore) void load(page.current + 1, generation.current) }
  const retry = () => { void load(page.current + 1, generation.current) }
  return { items, loading, error, hasMore, loadMore, retry }
}
