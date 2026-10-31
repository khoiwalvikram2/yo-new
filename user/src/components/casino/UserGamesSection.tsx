import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Heart, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'
import { getRecentCasinoGames, getCasinoUrl, getLikedCasinoGames, likeCasinoGame, unlikeCasinoGame } from '@/lib/api/user'
import { getSelectedWallet } from '@/lib/walletUtils'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import LobbyTile from './LobbyTile'
import { scrollBehavior } from './lobbyScroll'
import type { CasinoCardItem } from '@/types'

type Game = {
  id: string
  gameId?: string
  title: string
  provider: string
  category: string
  thumbnail: string
  lastPlayed?: string
  isLiked?: boolean
  rating?: number
  badge?: 'HOT' | 'NEW' | 'POPULAR'
}

const recentGames: Game[] = []
const likedGames: Game[] = []

function normalizeApiGame(raw: any, isLiked = false): Game | null {
  const gameId = String(raw?.gameId || raw?.game_id || raw?.id || raw?._id || '').trim()
  const id = String(raw?.id || raw?._id || gameId).trim()
  const title = String(raw?.title || '').trim()
  if (!gameId || !id || !title) return null

  const playedAt = raw?.lastPlayedAt ? new Date(raw.lastPlayedAt) : null
  return {
    id,
    gameId,
    title,
    provider: String(raw?.provider_name || raw?.provider || '').trim(),
    category: String(raw?.category || raw?.game_category || '').trim().toLowerCase(),
    thumbnail: String(raw?.imageUrl || raw?.game_images || raw?.image || raw?.thumbnail || '').trim(),
    lastPlayed: playedAt && Number.isFinite(playedAt.getTime()) ? playedAt.toLocaleString() : undefined,
    isLiked,
  }
}


function gameToCardItem(game: Game): CasinoCardItem {
  return {
    title: game.title,
    provider: game.provider,
    imageUrl: game.thumbnail,
    gameId: game.gameId || game.id,
    category: game.category,
    isLiked: game.isLiked ?? false,
  }
}

/** One "your games" row: dark bar (title, count, arrows) over a sideways row of tiles. */
function GamesRow({
  id,
  title,
  icon: Icon,
  games,
  onLike,
  onPlay,
  loadingGameId,
}: {
  id: 'recent' | 'liked'
  title: string
  icon: LucideIcon
  games: Game[]
  onLike?: (game: Game, nextLiked: boolean) => void | Promise<void>
  onPlay?: (gameId: string) => void | Promise<void>
  loadingGameId?: string | null
}) {
  const { t } = useTranslation()
  const trackId = `nova-lobby-user-${id}`
  const scroll = (direction: 1 | -1) => {
    const el = document.getElementById(trackId)
    if (el) el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.8), behavior: scrollBehavior() })
  }
  return (
    <section className="nova-lobby-section" aria-labelledby={`${trackId}-title`}>
      <header className="nova-ex-section-head">
        <Icon className="nova-lobby-head-icon" aria-hidden="true" />
        <h2 id={`${trackId}-title`}>{title}</h2>
        <span className="nova-ex-section-count">{games.length}</span>
        <span className="nova-ex-section-arrows nova-lobby-arrows-end">
          <button type="button" aria-label={t('nova.scrollLeft')} aria-controls={trackId} onClick={() => scroll(-1)}><ChevronLeft aria-hidden="true" /></button>
          <button type="button" aria-label={t('nova.scrollRight')} aria-controls={trackId} onClick={() => scroll(1)}><ChevronRight aria-hidden="true" /></button>
        </span>
      </header>
      <div id={trackId} className="nova-ex-strip-track nova-lobby-track">
        {games.map((game) => (
          <LobbyTile
            key={game.id}
            item={gameToCardItem(game)}
            onLike={onLike ? (nextLiked) => onLike(game, nextLiked) : undefined}
            onPlay={onPlay ? () => onPlay(game.gameId || game.id) : undefined}
            loading={loadingGameId === (game.gameId || game.id)}
          />
        ))}
      </div>
    </section>
  )
}

export default function UserGamesSection({ filterSlotsOnly = false }: { filterSlotsOnly?: boolean }) {
  const { t } = useTranslation()
  const { isAuthenticated, openAuthModal } = useAuth()
  const [recentGamesList, setRecentGamesList] = useState(recentGames)
  const [likedGamesList, setLikedGamesList] = useState(likedGames)
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null)

  useEffect(() => {
    // Only fetch if user is authenticated
    if (!isAuthenticated) {
      setRecentGamesList([])
      setLikedGamesList([])
      return
    }

    (async () => {
      try {
        // Fetch liked from server (auth required)
        let likedServer: Game[] = []
        try {
          const likedRes = await getLikedCasinoGames(200)
          const likedData = Array.isArray(likedRes?.data) ? likedRes.data : []
          likedServer = likedData
            .map((g: any) => normalizeApiGame(g, true))
            .filter((game: Game | null): game is Game => game !== null)
            .filter((g: Game) => {
              const isSlot = g.category === 'slots'
              return filterSlotsOnly ? isSlot : !isSlot
            })
          setLikedGamesList(likedServer)
        } catch (_err) {
          setLikedGamesList([])
        }

        // Fetch recent and tag with liked
        let recentServer: Game[] = []
        try {
          const res = await getRecentCasinoGames(20)
          const data = Array.isArray(res?.data) ? res.data : []
          const likedIdSet = new Set(likedServer.map((g) => g.gameId || g.id))
          recentServer = data
            .map((g: any) => normalizeApiGame(g))
            .filter((game: Game | null): game is Game => game !== null)
            .filter((game: Game) => filterSlotsOnly ? game.category === 'slots' : game.category !== 'slots')
            .map((game: Game) => ({ ...game, isLiked: likedIdSet.has(game.gameId || game.id) }))
          setRecentGamesList(recentServer)
        } catch (_) {
          setRecentGamesList([])
        }
      } catch (_) {}
    })()

    const onLikedChange = async (event: Event) => {
      const detail = event instanceof CustomEvent
        ? event.detail as { source?: string } | undefined
        : undefined
      if (detail?.source !== 'server') return
      if (!isAuthenticated) return
      try {
        const likedRes = await getLikedCasinoGames(200)
        const likedData = Array.isArray(likedRes?.data) ? likedRes.data : []
        const likedServer: Game[] = likedData
          .map((g: any) => normalizeApiGame(g, true))
          .filter((game: Game | null): game is Game => game !== null)
          .filter((g: Game) => {
            const isSlot = g.category === 'slots'
            return filterSlotsOnly ? isSlot : !isSlot
          })
        setLikedGamesList(likedServer)
        const likedIdSet = new Set(likedServer.map(g => g.gameId || g.id))
        setRecentGamesList(prev => prev.map(g => ({ ...g, isLiked: likedIdSet.has(g.gameId || g.id) })))
      } catch (_) {}
    }
    window.addEventListener('stakex:liked-changed', onLikedChange)
    return () => window.removeEventListener('stakex:liked-changed', onLikedChange)
  }, [isAuthenticated, filterSlotsOnly])

  // legacy local persistence not used when server-backed likes are enabled

  const handleLike = async (game: Game, nextLiked: boolean) => {
    const gameId = game.gameId || game.id
    if (!gameId) return
    if (!isAuthenticated) {
      openAuthModal('login')
      return
    }
    const previousLiked = Boolean(game.isLiked)
    const updateLikedGames = (games: Game[], shouldBeLiked: boolean) => {
      if (!shouldBeLiked) {
        return games.filter(g => (g.gameId || g.id) !== gameId)
      }
      if (games.some(g => (g.gameId || g.id) === gameId)) return games
      return [...games, { ...game, isLiked: true }]
    }

    // optimistic update
    setRecentGamesList(prev => prev.map(g => (g.gameId || g.id) === gameId ? { ...g, isLiked: nextLiked } : g))
    setLikedGamesList(prev => updateLikedGames(prev, nextLiked))
    try {
      if (nextLiked) {
        await likeCasinoGame(gameId)
        notify.success('Added to Liked')
      } else {
        await unlikeCasinoGame(gameId)
        notify.message('Removed from Liked')
      }
      // Only server-settled changes should trigger a server-backed refresh.
      window.dispatchEvent(new CustomEvent('stakex:liked-changed', { detail: { source: 'server' } }))
    } catch (_) {
      // rollback
      setRecentGamesList(prev => prev.map(g => (g.gameId || g.id) === gameId ? { ...g, isLiked: previousLiked } : g))
      setLikedGamesList(prev => updateLikedGames(prev, previousLiked))
      notify.error('Failed to update Like')
    }
  }

  const handlePlay = async (gameId: string) => {
    if (!gameId) return
    if (!isAuthenticated) {
      openAuthModal('login')
      return
    }
    setLoadingGameId(gameId)
    try {
      const res = await getCasinoUrl(gameId, getSelectedWallet())
      const url = res?.data?.redirectUrl
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        window.open(url, '_self')
      } else if (url) {
        notify.error('Game unavailable. Please try again later.')
      } else {
        // A 403 refusal carries a player-facing reason (e.g. betting suspended by the agent).
        notify.error(res?.meta?.code === 403 && res.meta.message ? res.meta.message : 'Failed to launch game')
      }
    } catch (_) {
      notify.error('Failed to launch game')
    }
    finally {
      setLoadingGameId(null)
    }
  }

  // Signed-in players only; each row only when it has games.
  if (!isAuthenticated) {
    return null
  }

  return (
    <>
      {recentGamesList.length > 0 && (
        <GamesRow
          id="recent"
          title={t('casinoLobby.recentlyPlayed', { defaultValue: 'Recently played' })}
          icon={Clock}
          games={recentGamesList}
          onLike={handleLike}
          onPlay={handlePlay}
          loadingGameId={loadingGameId}
        />
      )}
      {likedGamesList.length > 0 && (
        <GamesRow
          id="liked"
          title={t('casinoLobby.favourites', { defaultValue: 'Favourites' })}
          icon={Heart}
          games={likedGamesList}
          onLike={handleLike}
          onPlay={handlePlay}
          loadingGameId={loadingGameId}
        />
      )}
    </>
  )
}
