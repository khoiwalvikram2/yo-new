import { IconStar, IconStarFilled } from '@tabler/icons-react'
import { IconButton } from '@/ui/components/IconButton'
import { Tooltip } from '@/ui/components/Tooltip'
import { useSidebarStore } from '@/state/sidebarStore'
import { SAVED_VIEWS_LIMIT_MESSAGE } from './savedViews'
import styles from './SavedViews.module.css'

export interface FavoriteStarProps {
  path: string
  label: string
}

export function FavoriteStar(props: FavoriteStarProps) {
  const { path, label } = props
  const isSaved = useSidebarStore((state) => state.favorites.includes(path))
  const favoritesCount = useSidebarStore((state) => state.favorites.length)
  const maxFavorites = useSidebarStore((state) => state.maxFavorites)
  const addFavorite = useSidebarStore((state) => state.addFavorite)
  const removeFavorite = useSidebarStore((state) => state.removeFavorite)
  const atLimit = !isSaved && favoritesCount >= maxFavorites

  const button = (
    <IconButton
      size="sm"
      label={isSaved ? `Remove saved view: ${label}` : `Save view: ${label}`}
      icon={
        <span className={isSaved ? `${styles.star} ${styles.starOn}` : styles.star} aria-hidden="true">
          {isSaved ? <IconStarFilled size={14} stroke={1.75} /> : <IconStar size={14} stroke={1.75} />}
        </span>
      }
      aria-disabled={atLimit ? 'true' : undefined}
      onClick={(event) => {
        if (atLimit) {
          event.preventDefault()
          return
        }
        if (isSaved) {
          removeFavorite(path)
        } else {
          addFavorite(path, label, '')
        }
      }}
    />
  )

  if (!atLimit) {
    return button
  }

  return <Tooltip content={SAVED_VIEWS_LIMIT_MESSAGE}>{button}</Tooltip>
}
