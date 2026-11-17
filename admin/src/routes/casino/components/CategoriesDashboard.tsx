import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { CSS } from '@dnd-kit/utilities'
import {
  IconChevronDown,
  IconChevronRight,
  IconDeviceGamepad2,
  IconEdit,
  IconFolder,
  IconGripVertical,
  IconTrash,
} from '@tabler/icons-react'
import {
  CASINO_CUSTOM_CATEGORIES,
  DELETE_CASINO_CATEGORY,
  GAMES_BY_IDS,
  GAMES_IN_CATEGORY,
  REORDER_CASINO_CATEGORIES,
  REORDER_CATEGORY_GAMES,
  UPDATE_CASINO_CATEGORY,
} from '@/lib/graphql/casino'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { LoadingState } from '@/ui/components/LoadingState'
import { StatusPill } from '@/ui/components/StatusPill'
import { StoredImage } from '@/ui/components/StoredImage'
import { Switch } from '@/ui/components/Switch'
import { Table, TBody, TD, TH, THead, TR } from '@/ui/components/Table'
import { Tooltip } from '@/ui/components/Tooltip'
import { confirm } from '@/ui/components/confirm'
import { strokeFor } from '@/ui/components/icons'
import {
  DELETE_CONFIRM,
  categoryCountLabel,
  categoryOrderAfterMove,
  categoryReorderInputs,
  categoryStatusLabel,
  filterCategories,
  gameStatusLabel,
  gamesCountLabel,
  moveId,
  orderedGameIds,
  rowsInOrder,
  type CasinoCategory,
  type CasinoCustomCategoriesData,
  type CategoryGame,
  type GamesByIdsData,
  type GamesInCategoryData,
  type MainCategory,
  type TypeFilter,
  typeLabel,
} from '../categoriesManagementModel'
import styles from '../CategoriesManagementPage.module.css'

export interface CategoriesDashboardProps {
  mainCategory: MainCategory
  typeFilter?: TypeFilter
  onEdit: (category: CasinoCategory) => void
  onAddGames: (category: CasinoCategory) => void
}

interface CategoryGamesPanelProps {
  category: CasinoCategory
}

function SortableGameRow({ game }: { game: CategoryGame }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: game.id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  }

  return (
    <TR ref={setNodeRef} style={style} className={styles.gameRow}>
      <TD className={styles.dragCell}>
        <IconButton
          ref={setActivatorNodeRef}
          label={`Reorder ${game.name}`}
          icon={<IconGripVertical size={16} stroke={strokeFor(16)} />}
          size="sm"
          {...attributes}
          {...listeners}
        />
      </TD>
      <TD className={styles.thumbCell}>
        {/* No thumbnail, or one that will not load: the gamepad tile, never a broken image (SYS-18). */}
        <StoredImage
          src={game.thumbnailUrl}
          alt=""
          className={styles.gameThumb}
          fallback={(
            <span className={styles.placeholderTile} aria-hidden="true">
              <IconDeviceGamepad2 size={17} stroke={strokeFor(17)} />
            </span>
          )}
        />
      </TD>
      <TD>
        <span className={styles.primaryText}>{game.name}</span>
        <span className={styles.secondaryText}>{game.slug}</span>
      </TD>
      <TD>{game.vendorName || '—'}</TD>
      <TD>
        <StatusPill status={gameStatusLabel(game.tenantEnabled)}>
          {gameStatusLabel(game.tenantEnabled)}
        </StatusPill>
      </TD>
    </TR>
  )
}

function CategoryGamesPanel({ category }: CategoryGamesPanelProps) {
  const [fetchGameIds, { data: idsData, loading: idsLoading }] = useLazyQuery<GamesInCategoryData>(
    GAMES_IN_CATEGORY,
    { fetchPolicy: 'network-only' },
  )
  const [fetchGames, { data: gamesData, loading: gamesLoading }] = useLazyQuery<GamesByIdsData>(
    GAMES_BY_IDS,
    { fetchPolicy: 'network-only' },
  )
  const [reorderGames] = useMutation(REORDER_CATEGORY_GAMES, {
    context: { uiToast: 'message' },
  })
  const [sortedGameIds, setSortedGameIds] = useState<string[]>([])

  useEffect(() => {
    void fetchGameIds({ variables: { categoryId: category.id } })
  }, [category.id, fetchGameIds])

  useEffect(() => {
    const ids = idsData?.gamesInCategory
    if (ids?.length) void fetchGames({ variables: { gameIds: ids, skipVendorFilter: true } })
  }, [fetchGames, idsData])

  const games = useMemo(() => gamesData?.gamesByIds ?? [], [gamesData])

  useEffect(() => {
    setSortedGameIds(orderedGameIds(idsData?.gamesInCategory ?? [], games))
  }, [games, idsData])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const next = moveId(sortedGameIds, String(event.active.id), event.over ? String(event.over.id) : null)
    if (!next) return
    setSortedGameIds(next)
    void reorderGames({ variables: { categoryId: category.id, gameIds: next } }).catch(() => undefined)
  }

  if (idsLoading || gamesLoading) {
    return (
      <TR>
        <TD colSpan={8} className={styles.expandedCell}>
          <LoadingState label="Loading games" minHeight={192} />
        </TD>
      </TR>
    )
  }

  const sortedGames = rowsInOrder(sortedGameIds, games)
  if (!sortedGames.length) {
    return (
      <TR>
        <TD colSpan={8} className={styles.expandedCell}>
          <EmptyState
            inset="none"
            title="No games in this category"
            description="Use Add Games to assign games to this category."
            icon={<IconDeviceGamepad2 size={20} stroke={strokeFor(20)} />}
          />
        </TD>
      </TR>
    )
  }

  return (
    <TR>
      <TD colSpan={8} className={styles.expandedCell}>
        <section className={styles.gamesPanel} aria-label={`Games in ${category.name}`}>
          <div className={styles.gamesHeading}>
            <IconDeviceGamepad2 size={17} stroke={strokeFor(17)} aria-hidden="true" />
            <strong>Games ({sortedGames.length})</strong>
            <span>Drag to reorder</span>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortedGameIds} strategy={verticalListSortingStrategy}>
              <Table caption={`Games in ${category.name}`} width="fill" inset>
                <THead>
                  <TR>
                    <TH aria-label="Reorder" />
                    <TH aria-label="Thumbnail" />
                    <TH>Game</TH>
                    <TH>Vendor</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {sortedGames.map((game) => <SortableGameRow key={game.id} game={game} />)}
                </TBody>
              </Table>
            </SortableContext>
          </DndContext>
        </section>
      </TD>
    </TR>
  )
}

interface SortableCategoryRowProps {
  row: CasinoCategory
  expanded: boolean
  onToggle: () => void
  onEdit: (category: CasinoCategory) => void
  onAddGames: (category: CasinoCategory) => void
  onToggleActive: (category: CasinoCategory, active: boolean) => void
  onDelete: (category: CasinoCategory) => void
}

function SortableCategoryRow({
  row,
  expanded,
  onToggle,
  onEdit,
  onAddGames,
  onToggleActive,
  onDelete,
}: SortableCategoryRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  }

  const activateRow = (event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as Element).closest('button, a, input, select')) return
    onToggle()
  }

  return (
    <>
      <TR ref={setNodeRef} style={style} interactive open={expanded} onClick={activateRow}>
        <TD className={styles.dragCell}>
          <IconButton
            ref={setActivatorNodeRef}
            label={`Reorder ${row.name}`}
            icon={<IconGripVertical size={16} stroke={strokeFor(16)} />}
            size="sm"
            {...attributes}
            {...listeners}
          />
        </TD>
        <TD className={styles.thumbCell}>
          {/* No icon (the server answers null for a legacy stored file), or one that will not load: the folder
              tile, never a broken image (SYS-18). */}
          <StoredImage
            src={row.iconData}
            alt=""
            className={styles.categoryIcon}
            fallback={(
              <span className={styles.placeholderTile} aria-hidden="true">
                <IconFolder size={18} stroke={strokeFor(18)} />
              </span>
            )}
          />
        </TD>
        <TD>
          <button
            type="button"
            className={styles.categoryToggle}
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {expanded ? (
              <IconChevronDown size={15} stroke={strokeFor(15)} />
            ) : (
              <IconChevronRight size={15} stroke={strokeFor(15)} />
            )}
            <span>{row.name}</span>
          </button>
          {row.subtitle ? <span className={styles.secondaryText}>{row.subtitle}</span> : null}
          <span className={styles.slug}>{row.slug}</span>
        </TD>
        <TD><StatusPill tone="info">{typeLabel(row.type)}</StatusPill></TD>
        <TD>{row.order ?? '—'}</TD>
        <TD>
          <Button size="xs" variant="link" onClick={() => onAddGames(row)}>
            {gamesCountLabel(row.gameCount)}
          </Button>
        </TD>
        <TD>
          <div className={styles.statusControl}>
            <Switch
              checked={row.isActive}
              onChange={(checked) => onToggleActive(row, checked)}
              label={`Set ${row.name} ${row.isActive ? 'inactive' : 'active'}`}
              hideLabel
              size="sm"
            />
            <StatusPill status={categoryStatusLabel(row.isActive)}>
              {categoryStatusLabel(row.isActive)}
            </StatusPill>
          </div>
        </TD>
        <TD align="right" sticky="end">
          <div className={styles.actions}>
            <Tooltip content="Add Games">
              <IconButton
                label={`Add games to ${row.name}`}
                icon={<IconDeviceGamepad2 size={16} stroke={strokeFor(16)} />}
                variant="bordered"
                onClick={() => onAddGames(row)}
              />
            </Tooltip>
            <Tooltip content="Edit Category">
              <IconButton
                label={`Edit ${row.name}`}
                icon={<IconEdit size={16} stroke={strokeFor(16)} />}
                variant="bordered"
                onClick={() => onEdit(row)}
              />
            </Tooltip>
            <Tooltip content="Delete">
              <IconButton
                label={`Delete ${row.name}`}
                icon={<IconTrash size={16} stroke={strokeFor(16)} />}
                variant="bordered"
                onClick={() => onDelete(row)}
              />
            </Tooltip>
          </div>
        </TD>
      </TR>
      {expanded ? <CategoryGamesPanel category={row} /> : null}
    </>
  )
}

export function CategoriesDashboard({
  mainCategory,
  typeFilter = 'ALL',
  onEdit,
  onAddGames,
}: CategoriesDashboardProps) {
  const { data, loading, refetch } = useQuery<CasinoCustomCategoriesData>(CASINO_CUSTOM_CATEGORIES, {
    variables: { mainCategory },
    fetchPolicy: 'network-only',
    errorPolicy: 'all',
    nextFetchPolicy: 'cache-and-network',
  })
  const [updateCategory] = useMutation(UPDATE_CASINO_CATEGORY, { onCompleted: () => void refetch() })
  const [deleteCategory] = useMutation(DELETE_CASINO_CATEGORY, { onCompleted: () => void refetch() })
  const [reorderCategories] = useMutation(REORDER_CASINO_CATEGORIES, { onCompleted: () => void refetch() })
  const rows = useMemo(
    () => filterCategories(data?.casinoCustomCategories ?? [], typeFilter),
    [data, typeFilter],
  )
  const [sortedIds, setSortedIds] = useState<string[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    void refetch()
  }, [mainCategory, refetch])

  useEffect(() => {
    setSortedIds(rows.map((row) => row.id))
  }, [rows])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id)
    const overId = event.over ? String(event.over.id) : null
    const next = moveId(sortedIds, activeId, overId)
    if (!next) return
    // The move is saved in the main category's whole order, so categories a Type filter hides keep their numbers.
    const allIds = filterCategories(data?.casinoCustomCategories ?? [], 'ALL').map((category) => category.id)
    const whole = categoryOrderAfterMove(allIds, sortedIds, activeId, overId) ?? next
    setSortedIds(next)
    void reorderCategories({
      variables: { inputs: categoryReorderInputs(whole) },
      context: { uiToast: 'message' },
    }).catch(() => undefined)
  }

  const toggleExpanded = (categoryId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  const toggleActive = (category: CasinoCategory, isActive: boolean) => {
    void updateCategory({
      variables: { id: category.id, input: { isActive } },
      context: { uiToast: 'notification' },
    })
  }

  const requestDelete = (category: CasinoCategory) => {
    void confirm({
      ...DELETE_CONFIRM,
      onConfirm: async () => {
        await deleteCategory({
          variables: { id: category.id },
          context: { uiToast: 'notification' },
        })
      },
    })
  }

  const sortedRows = rowsInOrder(sortedIds, rows)

  return (
    <Card
      title="Categories List"
      sub={categoryCountLabel(sortedRows.length)}
      body="table"
      className={styles.listCard}
    >
      {loading && !data ? (
        <LoadingState label="Loading categories" />
      ) : sortedRows.length === 0 ? (
        <EmptyState
          title="No categories found"
          description="Create your first category to get started."
          icon={<IconFolder size={22} stroke={strokeFor(22)} />}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
            <Table caption="Casino categories" width="wide">
              <THead>
                <TR>
                  <TH aria-label="Reorder" />
                  <TH>Icon</TH>
                  <TH>Category</TH>
                  <TH>Type</TH>
                  <TH>Order</TH>
                  <TH>Games</TH>
                  <TH>Status</TH>
                  <TH align="right" sticky="end">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {sortedRows.map((row) => (
                  <SortableCategoryRow
                    key={row.id}
                    row={row}
                    expanded={expandedIds.has(row.id)}
                    onToggle={() => toggleExpanded(row.id)}
                    onEdit={onEdit}
                    onAddGames={onAddGames}
                    onToggleActive={toggleActive}
                    onDelete={requestDelete}
                  />
                ))}
              </TBody>
            </Table>
          </SortableContext>
        </DndContext>
      )}
    </Card>
  )
}
