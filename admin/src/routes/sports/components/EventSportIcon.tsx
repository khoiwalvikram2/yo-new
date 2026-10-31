import { useState } from 'react'
import clsx from 'clsx'
import { IconTrophy } from '@tabler/icons-react'
import { strokeFor } from '@/ui/components/icons'
import { sportIconMapFrom, sportImageSrc } from '../eventsPageModel'
import styles from '../EventsPage.module.css'

/* The sport images the legacy table and cards each globbed, keyed by file name. A sport with no image,
   or an image that fails to load, shows the trophy glyph the legacy fallback injected (as Font Awesome
   markup through innerHTML; it is a React glyph now). */
const SPORT_ICONS = sportIconMapFrom(
  import.meta.glob('@/assets/images/sports/*.{png,jpg,jpeg,svg,webp}', {
    eager: true,
    import: 'default',
  }) as Record<string, string>,
)

interface EventSportIconProps {
  sport: string
  /** md 40px (the table), lg 44px (the cards). @default 'md' */
  size?: 'md' | 'lg'
}

/** Decorative: the sport's name is always printed beside it. */
export function EventSportIcon({ sport, size = 'md' }: EventSportIconProps) {
  const src = sportImageSrc(SPORT_ICONS, sport)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = src !== '' && failedSrc !== src

  return (
    <span className={clsx(styles.sportTile, size === 'lg' && styles.sportTileLg)} aria-hidden="true">
      {showImage ? (
        <img className={styles.sportImage} src={src} alt="" onError={() => setFailedSrc(src)} />
      ) : (
        <IconTrophy className={styles.sportFallback} size={16} stroke={strokeFor(16)} />
      )}
    </span>
  )
}
