import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { CasinoCardItem } from '@/types'
import CasinoCard from './CasinoCard'

type Props = {
  item: CasinoCardItem
  onLike?: (nextLiked: boolean) => void | Promise<void>
  onPlay?: () => void | Promise<void>
  loading?: boolean
}

/** A lobby game tile: the shared CasinoCard, restyled by casino-lobby.css (markup unchanged because the
 *  home page's rail uses it too). On hover the art turns red with a "Play Now" button; its wording
 *  reaches the stylesheet through --lobby-play-label so it follows the player's language. */
export default function LobbyTile({ item, onLike, onPlay, loading }: Props) {
  const { t } = useTranslation()
  const label = { '--lobby-play-label': JSON.stringify(t('casinoLobby.playNow', { defaultValue: 'Play Now' })) } as CSSProperties
  // eslint-disable-next-line no-restricted-syntax -- a CSS variable carrying the translated hover label (the rule's stated exception)
  return <div className="nova-lobby-tile" style={label}>
    <CasinoCard item={item} className="w-full" onLike={onLike} onPlay={onPlay} loading={loading} />
  </div>
}
