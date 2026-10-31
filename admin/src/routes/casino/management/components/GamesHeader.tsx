import { IconDeviceGamepad2, IconLayoutGrid, IconList } from '@tabler/icons-react'
import { SearchField } from '@/ui/components/SearchField'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { strokeFor } from '@/ui/components/icons'
import type { ViewMode } from '../casinoManagementModel'
import { MultiActions } from './MultiActions'
import styles from '../ManagementPage.module.css'

interface GamesHeaderProps {
  totalGames: number
  viewMode: ViewMode
  search: string
  hasGames: boolean
  selectedCount: number
  onViewModeChange: (mode: ViewMode) => void
  onSearchChange: (value: string) => void
  onBulkUpdate: () => void
  onClearSelection: () => void
}

const VIEW_OPTIONS = [
  { value: 'table', label: 'Table', icon: <IconList size={14} stroke={strokeFor(14)} /> },
  { value: 'grid', label: 'Grid', icon: <IconLayoutGrid size={14} stroke={strokeFor(14)} /> },
] as const

export function GamesHeader({
  totalGames,
  viewMode,
  search,
  hasGames,
  selectedCount,
  onViewModeChange,
  onSearchChange,
  onBulkUpdate,
  onClearSelection,
}: GamesHeaderProps) {
  return (
    <div className={styles.gamesHeader}>
      <div className={styles.gamesHeaderTop}>
        <div className={styles.gamesTitleGroup}>
          <span className={styles.sectionIcon} aria-hidden="true">
            <IconDeviceGamepad2 size={18} stroke={strokeFor(18)} />
          </span>
          <div>
            <h2 className={styles.gamesTitle}>Casino Games</h2>
            <p className={styles.gamesCount}>
              {totalGames.toLocaleString()} {totalGames === 1 ? 'game' : 'games'}
            </p>
          </div>
        </div>
        <SegmentedControl
          value={viewMode}
          options={VIEW_OPTIONS}
          onChange={onViewModeChange}
          label="Games view"
          size="sm"
        />
      </div>
      <div className={styles.gamesToolbar}>
        <SearchField
          label="Search games"
          value={search}
          onChange={onSearchChange}
          placeholder="Search games by name (min 3 chars)..."
          className={styles.gameSearch}
        />
        {hasGames ? (
          <MultiActions
            selectedCount={selectedCount}
            onUpdate={onBulkUpdate}
            onClear={onClearSelection}
          />
        ) : null}
      </div>
    </div>
  )
}
