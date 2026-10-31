import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import {
  BULK_UPDATE_CASINO_GAME_SETTINGS,
  BULK_UPDATE_VIP_TIER_GAMES,
  CASINO_API_PROVIDERS,
  CASINO_GAME_BET_SETTINGS,
  CASINO_GAMES,
  CASINO_VENDORS,
  DELETE_CASINO_GAME_BET_SETTINGS,
  GAME_VIP_TIERS,
  REORDER_VENDOR_GAMES,
  TOGGLE_CASINO_GAME_MASTER_ACTIVE,
  TOGGLE_VIP_TIER_GAME_ENABLED,
  UPDATE_CASINO_GAME_SETTINGS,
  UPSERT_CASINO_GAME_BET_SETTINGS,
} from '@/lib/graphql/casino'
import { VIP_TIERS_QUERY } from '@/modules/vip/services/vipService'
import { useAuthStore } from '@/shared/core/authStore'
import { useCasinoStore, type CasinoMainCategory } from '@/state/casinoStore'
import { Card } from '@/ui/components/Card'
import {
  canReorderGames,
  combineAllCategoryGames,
  enabledVipTierIds,
  gameQueryInput,
  isWhitelabelAdminRole,
  moveGameId,
  sortGameRows,
  toggleSelection,
  vendorVariables,
  type CasinoProvider,
  type CasinoVendor,
  type DrawerMode,
  type DrawerTab,
  type GameRow,
  type GamesPage,
  type GameVipTier,
  type ViewMode,
  type VipTier,
} from './casinoManagementModel'
import { GamesContent } from './components/GamesContent'
import { GamesHeader } from './components/GamesHeader'
import { GamesPagination } from './components/GamesPagination'
import { ScopeControls } from './components/ScopeControls'
import { SettingsDrawer } from './components/SettingsDrawer'
import styles from './ManagementPage.module.css'

interface ProvidersData { casinoApiProviders: CasinoProvider[] }
interface VendorsData { casinoVendors: CasinoVendor[] }
interface GamesData { casinoGames: GamesPage }
interface VipTiersData { vipTiers: VipTier[] }
interface GameVipTiersData { gameVipTiers: GameVipTier[] }

export function CasinoDashboard() {
  const roles = useAuthStore((state) => state.roles)
  const isWhitelabelAdmin = isWhitelabelAdminRole(roles)
  const {
    selectedProviderId,
    selectedCategory,
    selectedVendorId,
    selectedVipTierId,
    search,
    enabled,
    setProvider,
    setCategory,
    setVendor,
    setVipTier,
    setSearch,
    setEnabled,
    page,
    pageSize,
    setPage,
    setPageSize,
  } = useCasinoStore()
  const [debouncedSearch, setDebouncedSearch] = useState(search)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 500)
    return () => window.clearTimeout(timer)
  }, [search])

  const providersQ = useQuery<ProvidersData>(CASINO_API_PROVIDERS, { errorPolicy: 'all' })
  const defaultsSetRef = useRef(false)
  useEffect(() => {
    const providers = providersQ.data?.casinoApiProviders
    if (defaultsSetRef.current || !providers?.length) return
    if (!isWhitelabelAdmin && !selectedProviderId) setProvider(String(providers[0].id))
    if (!selectedCategory) setCategory('ALL')
    defaultsSetRef.current = true
  }, [
    providersQ.data?.casinoApiProviders,
    isWhitelabelAdmin,
    selectedProviderId,
    selectedCategory,
    setProvider,
    setCategory,
  ])

  const vendorsQ = useQuery<VendorsData>(CASINO_VENDORS, {
    variables: vendorVariables(selectedProviderId, selectedCategory, isWhitelabelAdmin),
    skip: !isWhitelabelAdmin && !selectedProviderId,
    errorPolicy: 'all',
  })
  const queryFilters = {
    providerId: selectedProviderId,
    vendorId: selectedVendorId,
    vipTierId: selectedVipTierId,
    search: debouncedSearch,
    enabled,
    page,
    pageSize,
    whitelabelAdmin: isWhitelabelAdmin,
  }
  const canQuery = isWhitelabelAdmin || Boolean(selectedProviderId)
  const allMode = canQuery && selectedCategory === 'ALL'
  const singleMode = canQuery && Boolean(selectedCategory && selectedCategory !== 'ALL')

  const gamesQLive = useQuery<GamesData>(CASINO_GAMES, {
    variables: allMode ? gameQueryInput(queryFilters, 'LIVE_CASINO', true) : undefined,
    skip: !allMode,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })
  const gamesQCasino = useQuery<GamesData>(CASINO_GAMES, {
    variables: allMode ? gameQueryInput(queryFilters, 'CASINO', true) : undefined,
    skip: !allMode,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })
  const gamesQSlots = useQuery<GamesData>(CASINO_GAMES, {
    variables: allMode ? gameQueryInput(queryFilters, 'SLOTS', true) : undefined,
    skip: !allMode,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })
  const gamesQSingle = useQuery<GamesData>(CASINO_GAMES, {
    variables: singleMode
      ? gameQueryInput(queryFilters, selectedCategory as Exclude<CasinoMainCategory, 'ALL'>, false)
      : undefined,
    skip: !singleMode,
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const allGamesPage = useMemo(
    () => combineAllCategoryGames(
      [gamesQLive.data?.casinoGames, gamesQCasino.data?.casinoGames, gamesQSlots.data?.casinoGames],
      selectedVendorId,
      page,
      pageSize,
    ),
    [
      gamesQLive.data?.casinoGames,
      gamesQCasino.data?.casinoGames,
      gamesQSlots.data?.casinoGames,
      selectedVendorId,
      page,
      pageSize,
    ],
  )
  const refetchLiveGames = gamesQLive.refetch
  const refetchCasinoGames = gamesQCasino.refetch
  const refetchSlotGames = gamesQSlots.refetch
  const refetchAllGames = useCallback(async () => {
    await Promise.all([refetchLiveGames(), refetchCasinoGames(), refetchSlotGames()])
  }, [refetchLiveGames, refetchCasinoGames, refetchSlotGames])
  const gamesQ = selectedCategory !== 'ALL'
    ? {
        data: gamesQSingle.data?.casinoGames,
        loading: gamesQSingle.loading,
        error: gamesQSingle.error,
        refetch: () => gamesQSingle.refetch(),
      }
    : {
      data: allGamesPage,
      loading: gamesQLive.loading || gamesQCasino.loading || gamesQSlots.loading,
      error: gamesQLive.error || gamesQCasino.error || gamesQSlots.error,
      refetch: refetchAllGames,
    }

  const [reorderGames] = useMutation(REORDER_VENDOR_GAMES, {
    refetchQueries:
      selectedCategory !== 'ALL' && gamesQSingle.variables
        ? [{ query: CASINO_GAMES, variables: gamesQSingle.variables }]
        : [],
  })
  const [toggleVipTierGame] = useMutation(TOGGLE_VIP_TIER_GAME_ENABLED)
  const [bulkUpdateVipTierGames] = useMutation(BULK_UPDATE_VIP_TIER_GAMES)
  const [updateGameSettings] = useMutation(UPDATE_CASINO_GAME_SETTINGS)
  const [bulkUpdateGameSettings] = useMutation(BULK_UPDATE_CASINO_GAME_SETTINGS)
  const [upsertBetSettings] = useMutation(UPSERT_CASINO_GAME_BET_SETTINGS, {
    context: { uiToast: 'notification' },
  })
  const [deleteBetSettings] = useMutation(DELETE_CASINO_GAME_BET_SETTINGS, {
    context: { uiToast: 'notification' },
  })
  const [toggleMasterActive] = useMutation(TOGGLE_CASINO_GAME_MASTER_ACTIVE, {
    context: { uiToast: 'notification' },
  })
  const apolloClient = useApolloClient()

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('bulk')
  const [drawerGame, setDrawerGame] = useState<GameRow | null>(null)
  const [drawerActive, setDrawerActive] = useState(true)
  const [drawerPremiumOnly, setDrawerPremiumOnly] = useState(false)
  const [bulkVipTiers, setBulkVipTiers] = useState<Set<string>>(new Set())
  const [singleVipTiers, setSingleVipTiers] = useState<Set<string>>(new Set())
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('main')
  const drawerTriggerRef = useRef<HTMLElement | null>(null)

  const { refetch: refetchBetSettings } = useQuery(CASINO_GAME_BET_SETTINGS, {
    variables: { gameId: drawerGame?.id || '' },
    skip: !drawerGame?.id || drawerMode !== 'single' || !drawerOpen,
    fetchPolicy: 'network-only',
  })
  const { data: vipTiersData } = useQuery<VipTiersData>(VIP_TIERS_QUERY, { errorPolicy: 'all' })
  const vipTiers = useMemo(() => vipTiersData?.vipTiers ?? [], [vipTiersData?.vipTiers])
  const gameVipTiersQ = useQuery<GameVipTiersData>(GAME_VIP_TIERS, {
    variables: drawerGame?.id ? { gameId: drawerGame.id } : undefined,
    skip: !drawerGame?.id || drawerMode !== 'single',
    errorPolicy: 'all',
  })
  const gameVipTiers = useMemo(
    () => gameVipTiersQ.data?.gameVipTiers ?? [],
    [gameVipTiersQ.data?.gameVipTiers],
  )

  useEffect(() => {
    if (drawerMode === 'single' && drawerGame?.id) setSingleVipTiers(enabledVipTierIds(gameVipTiers))
  }, [drawerMode, drawerGame?.id, gameVipTiers])

  const providerOptions = (providersQ.data?.casinoApiProviders ?? []).map((provider) => ({
    label: provider.name,
    value: String(provider.id),
  }))
  const vendorOptions = (vendorsQ.data?.casinoVendors ?? []).map((vendor) => ({
    label: vendor.name,
    value: String(vendor.id),
  }))
  const vipTierOptions = vipTiers.map((tier) => ({ label: tier.name, value: String(tier.id) }))
  const rows = useMemo(() => sortGameRows(gamesQ.data?.items ?? []), [gamesQ.data?.items])

  useEffect(() => {
    if (!drawerOpen) return
    setDrawerTab('main')
    if (drawerMode === 'single' && drawerGame) {
      setDrawerActive(drawerGame.tenantEnabled === true)
      setDrawerPremiumOnly(Boolean(drawerGame.premiumOnly))
    }
  }, [drawerOpen, drawerMode, drawerGame])

  useEffect(() => {
    if (drawerMode !== 'bulk' || !drawerOpen || selectedKeys.size === 0) {
      if (!drawerOpen || drawerMode !== 'bulk') setBulkVipTiers(new Set())
      return
    }
    const selectedRows = rows.filter((row) => selectedKeys.has(String(row.id)))
    if (selectedRows.length > 0) {
      if (selectedRows.every((row) => row.tenantEnabled === true)) setDrawerActive(true)
      else if (selectedRows.every((row) => row.tenantEnabled === false)) setDrawerActive(false)
    }
    if (vipTiers.length === 0 || selectedRows.length === 0) return
    let active = true
    const loadCommonTiers = async () => {
      const settings = await Promise.all(selectedRows.map(async (row) => {
        try {
          const result = await apolloClient.query<GameVipTiersData>({
            query: GAME_VIP_TIERS,
            variables: { gameId: row.id },
            fetchPolicy: 'cache-first',
          })
          return result.data?.gameVipTiers ?? []
        } catch {
          return []
        }
      }))
      if (!active) return
      const common = new Set<string>()
      vipTiers.forEach((tier) => {
        if (settings.length === selectedRows.length && settings.every((list) => list.some(
          (setting) => setting.tierId === tier.id && setting.enabled === true,
        ))) common.add(tier.id)
      })
      setBulkVipTiers(common)
    }
    void loadCommonTiers()
    return () => { active = false }
  }, [drawerMode, drawerOpen, selectedKeys, rows, vipTiers, apolloClient])

  const allSelected = rows.length > 0 && selectedKeys.size === rows.length
  const toggleAll = () => setSelectedKeys(allSelected ? new Set() : new Set(rows.map((row) => String(row.id))))
  const toggleOne = (key: string) => setSelectedKeys((current) => toggleSelection(current, key))
  const [isDragging, setIsDragging] = useState(false)
  const handleMouseDown = (key: string) => {
    if (viewMode !== 'grid') return
    setIsDragging(true)
    toggleOne(key)
  }
  const handleMouseEnter = (key: string) => {
    if (isDragging && viewMode === 'grid') toggleOne(key)
  }
  useEffect(() => {
    if (!isDragging) return
    const stopDragging = () => setIsDragging(false)
    window.addEventListener('mouseup', stopDragging)
    return () => window.removeEventListener('mouseup', stopDragging)
  }, [isDragging])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [sortedIds, setSortedIds] = useState<string[]>([])
  useEffect(() => setSortedIds(rows.map((row) => row.id)), [rows])
  const handleDragEnd = (event: DragEndEvent) => {
    if (!canReorderGames(selectedVendorId, selectedCategory)) return
    const next = moveGameId(sortedIds, String(event.active.id), event.over ? String(event.over.id) : null)
    if (!next || !selectedVendorId || !selectedCategory || selectedCategory === 'ALL') return
    setSortedIds(next)
    void reorderGames({
      variables: { vendorId: selectedVendorId, category: selectedCategory, gameIds: next },
    }).catch(() => undefined)
  }

  const openDrawer = (mode: DrawerMode, game: GameRow | null) => {
    drawerTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setDrawerMode(mode)
    setDrawerGame(game)
    if (game) {
      setDrawerActive(Boolean(game.tenantEnabled))
      setDrawerPremiumOnly(Boolean(game.premiumOnly))
    } else {
      setDrawerPremiumOnly(false)
    }
    setDrawerOpen(true)
  }
  const totalGames = Number(gamesQ.data?.total || 0)
  const hasGames = rows.length > 0

  return (
    <div className={styles.dashboard}>
      <ScopeControls
        selectedProviderId={selectedProviderId}
        selectedCategory={selectedCategory}
        selectedVendorId={selectedVendorId}
        selectedVipTierId={selectedVipTierId}
        enabled={enabled}
        providersOptions={providerOptions}
        vendorOptions={vendorOptions}
        vipTierOptions={vipTierOptions}
        setProvider={setProvider}
        setCategory={setCategory}
        setVendor={setVendor}
        setVipTier={setVipTier}
        setEnabled={setEnabled}
        isWhitelabelAdmin={isWhitelabelAdmin}
      />
      <Card body="flush" className={styles.gamesCard}>
        <GamesHeader
          totalGames={totalGames}
          viewMode={viewMode}
          search={search}
          hasGames={hasGames}
          selectedCount={selectedKeys.size}
          onViewModeChange={setViewMode}
          onSearchChange={setSearch}
          onBulkUpdate={() => openDrawer('bulk', null)}
          onClearSelection={() => setSelectedKeys(new Set())}
        />
        <GamesContent
          loading={gamesQ.loading}
          error={gamesQ.error}
          rows={rows}
          viewMode={viewMode}
          hasGames={hasGames}
          selectedKeys={selectedKeys}
          allSelected={allSelected}
          isDragging={isDragging}
          sortedIds={sortedIds}
          sensors={sensors}
          vipTiers={vipTiers}
          onToggleAll={toggleAll}
          onToggleOne={toggleOne}
          onMouseDown={handleMouseDown}
          onMouseEnter={handleMouseEnter}
          onMouseUp={() => setIsDragging(false)}
          onDragEnd={handleDragEnd}
          onOpenDrawer={(row) => openDrawer('single', row)}
          refetchGames={gamesQ.refetch}
          toggleMasterActive={async (gameId, isActive) => {
            await toggleMasterActive({ variables: { gameId, isActive } })
            await gamesQ.refetch()
          }}
          isWhitelabelAdmin={isWhitelabelAdmin}
        />
        {hasGames ? (
          <GamesPagination
            page={page}
            pageSize={pageSize}
            totalGames={totalGames}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        ) : null}
      </Card>
      <SettingsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        restoreFocusTo={drawerTriggerRef}
        drawerMode={drawerMode}
        drawerGame={drawerGame}
        drawerTab={drawerTab}
        setDrawerTab={setDrawerTab}
        drawerActive={drawerActive}
        setDrawerActive={setDrawerActive}
        drawerPremiumOnly={drawerPremiumOnly}
        setDrawerPremiumOnly={setDrawerPremiumOnly}
        bulkVipTiers={bulkVipTiers}
        setBulkVipTiers={setBulkVipTiers}
        singleVipTiers={singleVipTiers}
        setSingleVipTiers={setSingleVipTiers}
        selectedKeys={selectedKeys}
        vipTiers={vipTiers}
        gameVipTiers={gameVipTiers}
        gameVipTiersLoading={gameVipTiersQ.loading}
        refetchGameVipTiers={gameVipTiersQ.refetch}
        isWhitelabelAdmin={isWhitelabelAdmin}
        updateGameSettings={updateGameSettings}
        bulkUpdateGameSettings={bulkUpdateGameSettings}
        toggleVipTierGame={toggleVipTierGame}
        bulkUpdateVipTierGames={bulkUpdateVipTierGames}
        upsertBetSettings={(options) => upsertBetSettings(options as Parameters<typeof upsertBetSettings>[0])}
        deleteBetSettings={(options) => deleteBetSettings(options as Parameters<typeof deleteBetSettings>[0])}
        refetchBetSettings={refetchBetSettings}
        refetchGames={gamesQ.refetch}
      />
    </div>
  )
}
