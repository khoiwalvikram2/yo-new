import { useMutation } from '@apollo/client'
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { IconDeviceGamepad2, IconShieldLock, IconStar } from '@tabler/icons-react'
import { TOGGLE_CASINO_GAME_ENABLED } from '@/lib/graphql/casino'
import { Checkbox } from '@/ui/components/Checkbox'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { Table, TBody, TH, THead, TR } from '@/ui/components/Table'
import { strokeFor } from '@/ui/components/icons'
import type { GameRow, ViewMode, VipTier } from '../casinoManagementModel'
import { SortableRow } from './SortableRow'
import styles from '../ManagementPage.module.css'

interface GamesContentProps {
  loading: boolean
  error: { message?: string } | null | undefined
  rows: GameRow[]
  viewMode: ViewMode
  hasGames: boolean
  selectedKeys: Set<string>
  allSelected: boolean
  isDragging: boolean
  sortedIds: string[]
  sensors: SensorDescriptor<SensorOptions>[]
  vipTiers: VipTier[]
  onToggleAll: () => void
  onToggleOne: (key: string) => void
  onMouseDown: (key: string) => void
  onMouseEnter: (key: string) => void
  onMouseUp: () => void
  onDragEnd: (event: DragEndEvent) => void
  onOpenDrawer: (row: GameRow) => void
  refetchGames: () => Promise<unknown> | unknown
  toggleMasterActive?: (gameId: string, isActive: boolean) => Promise<void>
  isWhitelabelAdmin?: boolean
}

export function GamesContent({
  loading,
  error,
  rows,
  viewMode,
  hasGames,
  selectedKeys,
  allSelected,
  isDragging,
  sortedIds,
  sensors,
  vipTiers,
  onToggleAll,
  onToggleOne,
  onMouseDown,
  onMouseEnter,
  onMouseUp,
  onDragEnd,
  onOpenDrawer,
  refetchGames,
  toggleMasterActive,
  isWhitelabelAdmin = false,
}: GamesContentProps) {
  const [toggleEnabled] = useMutation(TOGGLE_CASINO_GAME_ENABLED)

  if (error && rows.length === 0) {
    return (
      <div className={styles.stateInset}>
        <Notice tone="error" title="Failed to load games" live="assertive">
          {String(error.message || '')}
        </Notice>
      </div>
    )
  }
  if (loading && rows.length === 0) return <LoadingState label="Loading casino games" />
  if (!loading && !hasGames) {
    return (
      <EmptyState
        title="No games found"
        description="Try adjusting your filters or select a different provider"
        icon={<IconDeviceGamepad2 size={22} stroke={strokeFor(22)} />}
      />
    )
  }

  if (viewMode === 'table') {
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
      >
        <Table caption="Casino games" width="wide">
          <THead>
            <TR>
              <TH className={styles.checkCell}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={selectedKeys.size > 0 && !allSelected}
                  onChange={onToggleAll}
                  label="Select all games"
                  hideLabel
                />
              </TH>
              <TH>Priority</TH>
              <TH>Game Details</TH>
              {!isWhitelabelAdmin ? <TH>Master Control</TH> : null}
              <TH>Status</TH>
              <TH>Vendor</TH>
              <TH>VIP Tiers</TH>
              <TH>Bet Settings</TH>
              <TH align="right" sticky="end">Actions</TH>
            </TR>
          </THead>
          <TBody>
            <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
              {sortedIds.map((id) => {
                const row = rows.find((candidate) => candidate.id === id)
                if (!row) return null
                return (
                  <SortableRow
                    key={row.id}
                    row={row}
                    isSelected={selectedKeys.has(String(row.id))}
                    onToggleSelect={() => onToggleOne(String(row.id))}
                    onOpenDrawer={() => onOpenDrawer(row)}
                    vipTiers={vipTiers}
                    toggleMasterActive={toggleMasterActive}
                    isWhitelabelAdmin={isWhitelabelAdmin}
                  />
                )
              })}
            </SortableContext>
          </TBody>
        </Table>
      </DndContext>
    )
  }

  return (
    <div className={styles.gamesGrid} onMouseLeave={onMouseUp}>
      {rows.map((game) => {
        const selected = selectedKeys.has(String(game.id))
        return (
          <article
            key={game.id}
            className={styles.gameCard}
            data-selected={selected ? 'true' : undefined}
            data-drag-select={isDragging ? 'true' : undefined}
            onMouseDown={() => onMouseDown(String(game.id))}
            onMouseEnter={() => onMouseEnter(String(game.id))}
          >
            <span
              className={styles.cardCheckbox}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <Checkbox checked={selected} onChange={() => onToggleOne(String(game.id))} label={`Select ${game.name}`} hideLabel />
            </span>
            <button type="button" className={styles.gamePoster} onClick={() => onOpenDrawer(game)}>
              {game.thumbnailUrl ? <img src={game.thumbnailUrl} alt="" /> : (
                <span className={styles.posterPlaceholder} aria-hidden="true">
                  <IconDeviceGamepad2 size={26} stroke={strokeFor(26)} />
                </span>
              )}
              <span className={styles.posterVendor}>{game.vendorName}</span>
              <span className={styles.posterStatus}>
                <StatusPill status={game.tenantEnabled ? 'enabled' : 'disabled'}>
                  {game.tenantEnabled ? 'ON' : 'OFF'}
                </StatusPill>
              </span>
            </button>
            <div className={styles.gameCardBody}>
              <div className={styles.gameCardHeading}>
                <div>
                  <button type="button" className={styles.gameName} onClick={() => onOpenDrawer(game)}>{game.name}</button>
                  <span className={styles.secondaryText}>{game.slug}</span>
                </div>
                {game.order !== null && game.order !== undefined ? <span className={styles.orderBadge}>#{game.order}</span> : null}
              </div>
              <div className={styles.inlineBadges}>
                {!game.isActive ? <StatusPill status="blocked" icon={<IconShieldLock size={11} stroke={strokeFor(11)} />}>Blocked</StatusPill> : null}
                {game.premiumOnly ? <StatusPill tone="warn" icon={<IconStar size={11} stroke={strokeFor(11)} />}>Premium</StatusPill> : null}
              </div>
              <div className={styles.cardToggle} onMouseDown={(event) => event.stopPropagation()}>
                <span>Enable Game</span>
                <Switch
                  checked={Boolean(game.tenantEnabled)}
                  label={`Enable ${game.name}`}
                  hideLabel
                  size="sm"
                  onChange={async (checked) => {
                    await toggleEnabled({
                      variables: { gameId: game.id, enabled: checked },
                      context: { uiToast: 'notification' },
                    })
                    await refetchGames()
                  }}
                />
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
