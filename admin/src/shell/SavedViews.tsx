import type { ShellSection } from './shellTypes'
import { normalizePath } from './paths'
import { resolveSavedViews } from './savedViews'
import { PanelRow } from './PanelRow'
import { FavoriteStar } from './FavoriteStar'
import { useSidebarStore } from '@/state/sidebarStore'
import panelStyles from './ContextPanel.module.css'
import styles from './SavedViews.module.css'

export interface SavedViewsProps {
  sections: readonly ShellSection[]
  activeTo: string | null
  onNavigate: () => void
}

export function SavedViews(props: SavedViewsProps) {
  const { sections, activeTo, onNavigate } = props
  const favorites = useSidebarStore((state) => state.favorites)
  const rows = resolveSavedViews(favorites, sections)

  if (rows.length === 0) {
    return null
  }

  return (
    <>
      <div className={panelStyles.divider} role="presentation" />
      <div className={styles.root}>
        <h4 className={styles.heading}>Saved views</h4>
        {rows.map((row) => (
          <PanelRow
            key={row.id}
            quiet
            row={row}
            isCurrent={normalizePath(row.to) === activeTo}
            announceCurrent={false}
            onNavigate={onNavigate}
            trailing={<FavoriteStar path={row.to} label={row.label} />}
          />
        ))}
      </div>
    </>
  )
}
