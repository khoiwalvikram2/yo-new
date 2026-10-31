import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { useQuery } from '@apollo/client'
import {
  IconArrowLeft,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCrown,
  IconDeviceGamepad2,
  IconLayoutGrid,
  IconList,
  IconPhoto,
  IconSearch,
  IconX,
} from '@tabler/icons-react'
import { CASINO_GAMES, CASINO_VENDORS, GAMES_BY_IDS } from '@/lib/graphql/casino'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { useAuthStore } from '@/shared/core/authStore'
import { compressImageToDataUrl } from '@/shared/utils/imageCompression'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { FileField } from '@/ui/components/FileField'
import { FilterBar } from '@/ui/components/FilterBar'
import { IconButton } from '@/ui/components/IconButton'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { SearchField } from '@/ui/components/SearchField'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { Select } from '@/ui/components/Select'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  CATEGORY_FILTER_OPTIONS,
  QUICK_FILTER_OPTIONS,
  SORT_OPTIONS,
  VIEW_OPTIONS,
  categoryLabel,
  filterAndSortGames,
  filterSelectedGames,
  hasActiveFilters,
  mapCatalogGame,
  mergeCatalogPages,
  shouldLoadNextPage,
  type CasinoCategoryType,
  type CasinoMainCategory,
  type CatalogGame,
  type CategoryFilter,
  type GameSort,
  type QuickFilter,
  type RawCatalogGame,
  type ViewMode,
} from '../categoryAddGamesModel'
import styles from '../CategoryAddGamesPage.module.css'

interface CategoryAssignPanelProps {
  categoryId: string
  categoryName: string
  mainCategory: CasinoMainCategory
  categoryType?: CasinoCategoryType
  categorySubtitle?: string | null
  providerId: string | null
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onBack: () => void
  onSave: () => Promise<void> | void
  loungeImages?: Record<string, string | null>
  onLoungeImageChange?: (gameId: string, imageData: string | null) => void
  imagesLoading?: boolean
  imagesError?: string | null
  onRetryImages?: () => void
  saveDisabled?: boolean
}

interface VendorsData {
  casinoVendors?: Array<{ id: string | number; name: string }>
}

interface GamesData {
  casinoGames?: { total?: number; items?: RawCatalogGame[] }
}

interface GamesByIdsData {
  gamesByIds?: RawCatalogGame[]
}

const PAGE_SIZE = 50

export function CategoryAssignPanel({
  categoryName,
  mainCategory,
  categoryType = 'GENERAL',
  categorySubtitle,
  providerId,
  selectedIds,
  onToggle,
  onBack,
  onSave,
  loungeImages = {},
  onLoungeImageChange,
  imagesLoading = false,
  imagesError,
  onRetryImages,
  saveDisabled = false,
}: CategoryAssignPanelProps) {
  const pageEyebrow = usePageEyebrow()
  const roles = useAuthStore((state) => state.roles)
  const isWhitelabelAdmin = roles.some((role) => {
    const normalized = role.toLocaleLowerCase()
    return normalized.includes('whitelabel') || normalized.includes('tenant')
  })
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedVendor, setSelectedVendor] = useState('')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [sortBy, setSortBy] = useState<GameSort>('name')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [page, setPage] = useState(1)
  const [allItems, setAllItems] = useState<CatalogGame[]>([])
  const [displayTotal, setDisplayTotal] = useState(0)
  const [selectedDetails, setSelectedDetails] = useState<Record<string, CatalogGame>>({})
  const [selectedSearch, setSelectedSearch] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [selectedPanelCollapsed, setSelectedPanelCollapsed] = useState(false)
  const [selectedDrawerOpen, setSelectedDrawerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [imageEditorId, setImageEditorId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadGeneration = useRef(0)
  const invalidateUpload = useCallback(() => { uploadGeneration.current++ }, [])
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const previousProviderId = useRef<string | null>(null)
  const isLounge = categoryType === 'LOUNGE'
  const cannotSave = saveDisabled || uploading
  const closeImageEditor = () => {
    invalidateUpload()
    setUploading(false)
    setUploadError(null)
    setImageEditorId(null)
  }
  useEffect(() => invalidateUpload, [invalidateUpload])
  const uploadImage = async (file: File | undefined) => {
    if (!file || !imageEditorId || !onLoungeImageChange || !selectedIds.has(imageEditorId)) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setUploadError('Choose a PNG, JPG or WebP image.'); return
    }
    if (file.size > 10 * 1024 * 1024) { setUploadError('Choose an image smaller than 10 MB.'); return }
    const generation = ++uploadGeneration.current
    const gameId = imageEditorId
    setUploading(true)
    setUploadError(null)
    try {
      const imageData = await compressImageToDataUrl(file, 'casinoLounge')
      if (generation !== uploadGeneration.current) return
      onLoungeImageChange(gameId, imageData)
    } catch (error) {
      if (generation === uploadGeneration.current) setUploadError(error instanceof Error ? error.message : 'Could not process this image')
    } finally {
      if (generation === uploadGeneration.current) setUploading(false)
    }
  }

  const { data: vendorsData } = useQuery<VendorsData>(CASINO_VENDORS, {
    variables: {
      providerId: isWhitelabelAdmin ? undefined : providerId || undefined,
      category: mainCategory,
    },
    skip: !mainCategory,
    errorPolicy: 'all',
  })
  const vendorOptions = (vendorsData?.casinoVendors ?? []).map((vendor) => ({
    value: String(vendor.id),
    label: vendor.name,
  }))

  const missingDetailsIds = useMemo(
    () => [...selectedIds].filter((id) => !selectedDetails[id]),
    [selectedDetails, selectedIds],
  )
  const { data: selectedGamesData } = useQuery<GamesByIdsData>(GAMES_BY_IDS, {
    variables: { gameIds: missingDetailsIds },
    skip: missingDetailsIds.length === 0,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  useEffect(() => {
    const fetched = selectedGamesData?.gamesByIds?.map(mapCatalogGame)
    if (!fetched?.length) return
    setSelectedDetails((current) => {
      const next = { ...current }
      for (const game of fetched) next[game.id] = game
      return next
    })
  }, [selectedGamesData])

  const enabled = quickFilter === 'enabled' ? true : quickFilter === 'disabled' ? false : undefined
  const { data: gamesData, loading, networkStatus } = useQuery<GamesData>(CASINO_GAMES, {
    variables: {
      input: {
        providerId: isWhitelabelAdmin ? undefined : providerId || undefined,
        category: mainCategory,
        vendorId: selectedVendor || undefined,
        search: debouncedQuery || undefined,
        enabled,
        page,
        pageSize: PAGE_SIZE,
      },
    },
    skip: !mainCategory,
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
    errorPolicy: 'all',
  })

  const actualTotal = gamesData?.casinoGames?.total ?? 0
  const catalogKey = [
    mainCategory,
    providerId ?? '',
    selectedVendor,
    debouncedQuery,
    quickFilter,
    categoryFilter,
  ].join('|')

  useEffect(() => {
    const incoming = (gamesData?.casinoGames?.items ?? []).map(mapCatalogGame)
    if (!incoming.length) return
    setAllItems((current) => mergeCatalogPages(current, incoming, page))
  }, [catalogKey, gamesData, page])

  useEffect(() => {
    if (page === 1 && actualTotal > 0) setDisplayTotal(actualTotal)
  }, [actualTotal, catalogKey, page])

  useEffect(() => {
    const initialProviderSelection = previousProviderId.current === null && providerId !== null
    previousProviderId.current = providerId
    if (initialProviderSelection) return
    setPage(1)
  }, [categoryFilter, debouncedQuery, mainCategory, providerId, quickFilter, selectedVendor])

  useEffect(() => {
    if (!allItems.length && selectedIds.size === 0) return
    setSelectedDetails((current) => {
      const next = { ...current }
      for (const game of allItems) if (selectedIds.has(game.id)) next[game.id] = game
      for (const id of Object.keys(next)) if (!selectedIds.has(id)) delete next[id]
      return next
    })
  }, [allItems, selectedIds])

  const visibleItems = useMemo(
    () => filterAndSortGames({
      games: allItems,
      selectedIds,
      selectedDetails,
      quickFilter,
      categoryFilter,
      sortBy,
    }),
    [allItems, categoryFilter, quickFilter, selectedDetails, selectedIds, sortBy],
  )
  const selectedInView = visibleItems.filter((game) => selectedIds.has(game.id)).length
  const filteredSelectedIds = useMemo(
    () => filterSelectedGames(selectedIds, selectedDetails, selectedSearch),
    [selectedDetails, selectedIds, selectedSearch],
  )

  const toggleGame = useCallback((game: CatalogGame) => {
    const wasSelected = selectedIds.has(game.id)
    onToggle(game.id)
    setSelectedDetails((current) => {
      const next = { ...current }
      if (wasSelected) delete next[game.id]
      else next[game.id] = game
      return next
    })
  }, [onToggle, selectedIds])

  useEffect(() => {
    if (!isDragging) return
    const endDrag = () => setIsDragging(false)
    window.addEventListener('mouseup', endDrag)
    return () => window.removeEventListener('mouseup', endDrag)
  }, [isDragging])

  const clientFilterActive = quickFilter === 'selected' || quickFilter === 'premium' || categoryFilter !== 'all'
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(([entry]) => {
      if (shouldLoadNextPage({
        intersecting: entry.isIntersecting,
        loading,
        networkStatus,
        clientFilterActive,
        loaded: allItems.length,
        total: actualTotal,
      })) setPage((current) => current + 1)
    }, { root: null, rootMargin: '200px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [actualTotal, allItems.length, clientFilterActive, loading, networkStatus])

  const selectAllVisible = () => {
    for (const game of visibleItems) if (!selectedIds.has(game.id)) toggleGame(game)
  }
  const clearVisible = () => {
    for (const game of visibleItems) if (selectedIds.has(game.id)) toggleGame(game)
  }
  const clearAllSelected = () => {
    for (const id of selectedIds) onToggle(id)
  }
  const resetFilters = () => {
    setQuery('')
    setDebouncedQuery('')
    setSelectedVendor('')
    setQuickFilter('all')
    setCategoryFilter('all')
    setSortBy('name')
  }
  const save = async () => {
    if (saving || cannotSave) return
    setSaveError(null)
    setSaving(true)
    try {
      await onSave()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save category games')
    } finally {
      setSaving(false)
    }
  }

  const selectedGames = (
    <div className={styles.selectedContent}>
      {selectedIds.size ? (
        <div className={styles.selectedToolbar}>
          <SearchField
            label="Search selected games"
            value={selectedSearch}
            onChange={setSelectedSearch}
            placeholder="Search selected games..."
            size="sm"
          />
          <IconButton
            label="Clear all selected games"
            icon={<IconX size={15} stroke={strokeFor(15)} />}
            variant="bordered"
            onClick={clearAllSelected}
          />
        </div>
      ) : null}
      {selectedIds.size === 0 ? (
        <EmptyState
          inset="none"
          title="No games selected"
          description="Select games from the catalog to add them to this category."
          icon={<IconDeviceGamepad2 size={18} stroke={strokeFor(18)} />}
        />
      ) : filteredSelectedIds.length === 0 ? (
        <EmptyState inset="none" title="No games match your search" icon={<IconSearch size={18} />} />
      ) : (
        <ul className={styles.selectedList} aria-label="Selected games">
          {filteredSelectedIds.map((id) => {
            const game = selectedDetails[id]
            return (
              <li key={id} className={styles.selectedItem}>
                <GameThumb game={game} compact image={isLounge ? loungeImages[id] : undefined} />
                <span className={styles.selectedCopy}>
                  <strong title={game?.name}>{game?.name ?? `Game ID: ${id}`}</strong>
                  <span>{game?.vendorName ?? (game ? game.slug : 'Loading details...')}</span>
                </span>
                <IconButton
                  label={`Remove ${game?.name ?? id} from selected games`}
                  icon={<IconX size={14} stroke={strokeFor(14)} />}
                  size="sm"
                  onClick={() => onToggle(id)}
                />
                {isLounge && onLoungeImageChange ? <div className={styles.loungeImageActions}>
                  <Button size="xs" disabled={uploading || imagesLoading || Boolean(imagesError) || saving}
                    aria-label={`${loungeImages[id] ? 'Replace' : 'Upload'} image for ${game?.name ?? id}`}
                    onClick={() => { setUploadError(null); setImageEditorId(id) }}>
                    {loungeImages[id] ? 'Replace image' : 'Upload image'}
                  </Button>
                  {loungeImages[id] ? <Button size="xs" disabled={uploading || saving}
                    aria-label={`Use original image for ${game?.name ?? id}`}
                    onClick={() => onLoungeImageChange(id, null)}>Use original</Button> : null}
                </div> : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  const activeFilters = hasActiveFilters(query, selectedVendor, quickFilter, categoryFilter, sortBy)
  // The same five settings hasActiveFilters checks, counted; the sort counts because Clear all resets it.
  const activeFilterCount = [
    query,
    selectedVendor,
    quickFilter !== 'all',
    categoryFilter !== 'all',
    sortBy !== 'name',
  ].filter(Boolean).length

  return (
    <Page maxWidth="wide" className={styles.page}>
      <PageHeader
        eyebrow={pageEyebrow}
        title={categoryName}
        sub={categorySubtitle || 'Select and assign games from the catalog below'}
        actions={(
          <div className={styles.headerActions}>
            <Button size="sm" icon={<IconArrowLeft size={15} stroke={strokeFor(15)} />} onClick={onBack}>
              Back
            </Button>
            <Button
              size="sm"
              className={styles.mobileSelectedButton}
              onClick={() => setSelectedDrawerOpen(true)}
            >
              Selected ({selectedIds.size})
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<IconCheck size={15} stroke={strokeFor(15)} />}
              disabled={cannotSave}
              loading={saving}
              onClick={() => void save()}
            >
              Save Changes
            </Button>
          </div>
        )}
      />

      <div className={styles.metaRow} aria-label="Category details">
        <StatusPill tone="info">{categoryLabel(mainCategory)}</StatusPill>
        <StatusPill tone="neutral">{categoryLabel(categoryType)}</StatusPill>
        <span>Add Games</span>
      </div>

      {saveError ? (
        <Notice tone="error" title="Changes were not saved" live="assertive">{saveError}</Notice>
      ) : null}
      {isLounge && imagesLoading ? <Notice tone="info" title="Loading saved Lounge images" /> : null}
      {isLounge && imagesError ? <Notice tone="error" title="Lounge images unavailable" live="assertive">
        {imagesError}<Button size="xs" onClick={onRetryImages}>Retry images</Button>
      </Notice> : null}
      {isLounge ? <p className={styles.loungeImageHint}>Select a game, then upload its Lounge image in Selected Games. Save Changes applies your images to the home page.</p> : null}

      <section className={styles.stats} aria-label="Game catalog statistics">
        <Stat
          label="Total available"
          value={displayTotal.toLocaleString()}
          note="For the current catalog filters"
          icon={<IconDeviceGamepad2 size={18} stroke={strokeFor(18)} />}
          hue="blu"
        />
        <Stat
          label="Loaded"
          value={allItems.length.toLocaleString()}
          note={allItems.length < actualTotal ? 'More load as you scroll' : 'Catalog page is current'}
          icon={<IconLayoutGrid size={18} stroke={strokeFor(18)} />}
          hue="vio"
        />
        <Stat
          label="Selected"
          value={selectedIds.size.toLocaleString()}
          note={`${selectedInView.toLocaleString()} in the current view`}
          icon={<IconCheck size={18} stroke={strokeFor(18)} />}
          hue="grn"
        />
      </section>

      <FilterBar
        label="Game filters"
        activeCount={activeFilterCount}
        onClearAll={resetFilters}
        search={(
          <SearchField
            label="Search games"
            value={query}
            onChange={setQuery}
            onSubmit={setDebouncedQuery}
            placeholder="Search games..."
            size="sm"
          />
        )}
        summary={<><b>{visibleItems.length.toLocaleString()}</b> games in the current view</>}
      >
        <Select
          label="Vendor"
          hideLabel
          size="sm"
          value={selectedVendor}
          onChange={setSelectedVendor}
          options={[{ value: '', label: 'All vendors' }, ...vendorOptions]}
        />
        <Select
          label="Category status"
          hideLabel
          size="sm"
          value={categoryFilter}
          onChange={(value) => setCategoryFilter(value as CategoryFilter)}
          options={CATEGORY_FILTER_OPTIONS}
        />
        <Select
          label="Sort games"
          hideLabel
          size="sm"
          value={sortBy}
          onChange={(value) => setSortBy(value as GameSort)}
          options={SORT_OPTIONS}
        />
        <SegmentedControl<QuickFilter>
          label="Quick game filter"
          value={quickFilter}
          options={QUICK_FILTER_OPTIONS}
          onChange={setQuickFilter}
          size="sm"
          stretch="phone"
        />
      </FilterBar>

      <Card
        title="Available Games"
        sub={`${visibleItems.length.toLocaleString()} showing · ${allItems.length.toLocaleString()} loaded`}
        body="flush"
        tools={(
          <SegmentedControl<ViewMode>
            label="Game view"
            value={viewMode}
            options={VIEW_OPTIONS.map((option) => ({
              ...option,
              icon: option.value === 'grid'
                ? <IconLayoutGrid size={14} stroke={strokeFor(14)} />
                : <IconList size={14} stroke={strokeFor(14)} />,
            }))}
            onChange={setViewMode}
            size="sm"
          />
        )}
        className={styles.catalogCard}
      >
        <div className={styles.catalogActions}>
          <div>
            <strong>{selectedInView.toLocaleString()}</strong> selected in this view
          </div>
          <div className={styles.catalogButtons}>
            <Button
              size="xs"
              disabled={!visibleItems.length || selectedInView === visibleItems.length}
              onClick={selectAllVisible}
            >
              Select all
            </Button>
            <Button size="xs" variant="danger" disabled={!selectedInView} onClick={clearVisible}>
              Clear view
            </Button>
          </div>
        </div>

        <div className={styles.catalogLayout}>
          <div className={styles.results}>
            {loading && allItems.length === 0 ? (
              <LoadingState label="Loading games" />
            ) : visibleItems.length === 0 ? (
              <EmptyState
                title={activeFilters ? 'No games match your filters' : 'No games available'}
                description={activeFilters ? 'Clear or change filters to see more games.' : undefined}
                icon={<IconDeviceGamepad2 size={18} stroke={strokeFor(18)} />}
              />
            ) : (
              <div
                className={viewMode === 'grid' ? styles.gameGrid : styles.gameList}
                onMouseLeave={() => setIsDragging(false)}
              >
                {visibleItems.map((game) => (
                  <GameOption
                    key={game.id}
                    game={game}
                    selected={selectedIds.has(game.id)}
                    viewMode={viewMode}
                    dragging={isDragging}
                    onMouseDown={() => {
                      if (viewMode !== 'grid') return
                      setIsDragging(true)
                      toggleGame(game)
                    }}
                    onMouseEnter={() => {
                      if (isDragging && viewMode === 'grid') toggleGame(game)
                    }}
                    onKeyboardSelect={() => toggleGame(game)}
                  />
                ))}
                {loading && allItems.length ? (
                  <div className={styles.loadingMore} role="status">Loading more games...</div>
                ) : null}
                <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
              </div>
            )}
          </div>

          {selectedPanelCollapsed ? (
            <div className={styles.selectedCollapsed}>
              <IconButton
                label="Show selected games"
                icon={<IconChevronLeft size={16} stroke={strokeFor(16)} />}
                variant="bordered"
                onClick={() => setSelectedPanelCollapsed(false)}
              />
              <strong>{selectedIds.size}</strong>
            </div>
          ) : (
            <aside className={styles.selectedPanel} aria-label="Selected games panel">
              <div className={styles.selectedHeader}>
                <div>
                  <strong>Selected Games</strong>
                  <span>{selectedIds.size.toLocaleString()} selected</span>
                </div>
                <IconButton
                  label="Collapse selected games"
                  icon={<IconChevronRight size={16} stroke={strokeFor(16)} />}
                  size="sm"
                  onClick={() => setSelectedPanelCollapsed(true)}
                />
              </div>
              {selectedGames}
              <div className={styles.selectedFooter}>
                <Button
                  variant="primary"
                  size="sm"
                  block
                  loading={saving}
                  disabled={cannotSave}
                  onClick={() => void save()}
                >
                  Save Changes
                </Button>
              </div>
            </aside>
          )}
        </div>

        <div className={styles.catalogFooter}>
          <span>Total {displayTotal.toLocaleString()}</span>
          <span>Loaded {allItems.length.toLocaleString()}</span>
          <span>Visible {visibleItems.length.toLocaleString()}</span>
          {allItems.length < actualTotal && !loading ? <span>Scroll to load more automatically</span> : null}
        </div>
      </Card>

      <Drawer
        open={selectedDrawerOpen}
        onOpenChange={setSelectedDrawerOpen}
        title={`Selected Games (${selectedIds.size})`}
        sub="Review and remove games before saving"
        size="md"
        footer={(
          <Button
            variant="primary"
            size="sm"
            block
            loading={saving}
            disabled={cannotSave}
            onClick={() => void save()}
          >
            Save Changes
          </Button>
        )}
      >
        {selectedGames}
      </Drawer>
      {isLounge && imageEditorId ? <Drawer
        open={selectedIds.has(imageEditorId)}
        onOpenChange={open => { if (!open) closeImageEditor() }}
        title={`Lounge image · ${selectedDetails[imageEditorId]?.name ?? imageEditorId}`}
        sub="This image appears on this game's home page Lounge card."
        size="md"
        footer={<Button size="sm" onClick={closeImageEditor}>Done</Button>}
      >
        <FileField
          label="Custom Lounge image"
          inputLabel={`Lounge image for ${selectedDetails[imageEditorId]?.name ?? imageEditorId}`}
          accept="image/png,image/jpeg,image/webp"
          maxSize={10 * 1024 * 1024}
          busy={uploading}
          busyLabel="Preparing image…"
          help="PNG, JPG or WebP. Your image is resized for the Lounge card."
          error={uploadError ?? undefined}
          onFiles={files => { void uploadImage(files[0]) }}
          files={loungeImages[imageEditorId] ? [{
            id: imageEditorId, name: 'Custom Lounge image', meta: 'Ready to save',
            src: loungeImages[imageEditorId]!, alt: 'Custom Lounge image preview', zoomable: true,
            onRemove: uploading ? undefined : () => onLoungeImageChange?.(imageEditorId, null), removeLabel: 'Use original image',
          }] : []}
        />
      </Drawer> : null}
    </Page>
  )
}

function GameThumb({ game, compact = false, image }: { game?: CatalogGame; compact?: boolean; image?: string | null }) {
  return (
    <span className={compact ? styles.thumbCompact : styles.thumb} aria-hidden="true">
      {image || game?.thumbnailUrl ? <img src={image || game?.thumbnailUrl} alt="" loading="lazy" /> : <IconPhoto size={compact ? 17 : 24} />}
    </span>
  )
}

function GameOption({
  game,
  selected,
  viewMode,
  dragging,
  onMouseDown,
  onMouseEnter,
  onKeyboardSelect,
}: {
  game: CatalogGame
  selected: boolean
  viewMode: ViewMode
  dragging: boolean
  onMouseDown: () => void
  onMouseEnter: () => void
  onKeyboardSelect: () => void
}) {
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0 || viewMode === 'list') onKeyboardSelect()
  }
  return (
    <button
      type="button"
      className={viewMode === 'grid' ? styles.gameCard : styles.gameRow}
      data-selected={selected || undefined}
      data-dragging={dragging || undefined}
      aria-pressed={selected}
      aria-label={`${selected ? 'Remove' : 'Select'} ${game.name}`}
      onMouseDown={(event) => {
        if (event.button === 0) onMouseDown()
      }}
      onMouseEnter={onMouseEnter}
      onClick={click}
    >
      <GameThumb game={game} />
      <span className={styles.gameCopy}>
        <strong title={game.name}>{game.name}</strong>
        <span title={game.vendorName}>{game.vendorName || game.slug}</span>
        <span className={styles.gameMeta}>
          {game.rtp !== undefined ? <small>{game.rtp}% RTP</small> : null}
          {game.premiumOnly ? <StatusPill tone="warn" icon={<IconCrown size={11} />}>Premium</StatusPill> : null}
          {!game.enabled ? <StatusPill status="disabled">Disabled</StatusPill> : null}
          {game.featured ? <StatusPill tone="info">Featured</StatusPill> : null}
        </span>
      </span>
      {selected ? <span className={styles.selectedMark}><IconCheck size={16} stroke={2} /></span> : null}
    </button>
  )
}
