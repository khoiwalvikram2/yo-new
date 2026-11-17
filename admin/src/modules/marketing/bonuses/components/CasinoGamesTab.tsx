import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, gql } from '@apollo/client'
import { Checkbox } from '@/ui/components/Checkbox'
import { Button } from '@/ui/components/Button'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { SearchField } from '@/ui/components/SearchField'
import { StoredImage } from '@/ui/components/StoredImage'
import { Combobox } from '@/ui/components/Combobox'
import { StatusPill } from '@/ui/components/StatusPill'
import { Drawer } from '@/ui/components/Drawer'
import { NumberField } from '@/ui/components/NumberField'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { confirm } from '@/ui/components/confirm'
import { Notice } from '@/ui/components/Notice'
import { bonusNotification as notification, type BonusGameRow, type BonusBundle } from './bonusDetailModel'
import styles from './BonusDetailTabs.module.css'
import { CASINO_SELECTION_GAMES, CASINO_SELECTION_GAME_IDS, CASINO_VENDORS, CASINO_API_PROVIDERS } from '@/lib/graphql/casino'

import { useSearch } from '@/shared/hooks/useSearch'

const SAVE_BONUS_CAMPAIGN_GAMES = gql`
  mutation SaveBonusCampaignGames($campaignId: ID!, $gameIds: [ID!]!, $gameWeights: JSON) {
    saveBonusCampaignGames(campaignId: $campaignId, gameIds: $gameIds, gameWeights: $gameWeights) {
      success
      message
      campaign {
        id
        casinoGameIds
        casinoGameWeights
      }
    }
  }
`

const CASINO_GAME_BUNDLES_QUERY = gql`
  query CasinoGameBundles($search: String, $domain: BonusDomain) {
    casinoGameBundles(search: $search, domain: $domain) {
      id
      name
      description
      domain
      gameIds
      gameWeights
      gameCount
      createdAt
      updatedAt
    }
  }
`

interface CasinoGamesTabProps {
  campaignId: string
  currentGameIds: string[]
  currentGameWeights: Record<string, number> | null
  onUpdate: () => void
}

export function CasinoGamesTab({
  campaignId,
  currentGameIds,
  currentGameWeights,
  onUpdate,
}: CasinoGamesTabProps) {
  const { query: search, setQuery: setSearch, debouncedQuery: debouncedSearch } = useSearch()
  const [providerFilter, setProviderFilter] = useState<string | null>(null)
  const [vendorFilter, setVendorFilter] = useState<string | null>(null)
  const [selectedGameIds, setSelectedGameIds] = useState<Set<string>>(new Set())
  const [weightDrawerOpen, setWeightDrawerOpen] = useState(false)
  const [editingGameId, setEditingGameId] = useState<string | null>(null)
  const [gameWeight, setGameWeight] = useState<number>(1.0)
  const [bulkWeight, setBulkWeight] = useState<number>(1.0)
  const [selectedForRemove, setSelectedForRemove] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'all' | 'added'>('all')
  const { query: addedGamesSearch, setQuery: setAddedGamesSearch, debouncedQuery: debouncedAddedSearch } = useSearch()
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const { data: gamesData, loading: gamesLoading, error: queryError } = useQuery<{ casinoSelectionGames: { items: BonusGameRow[]; total: number } }>(CASINO_SELECTION_GAMES, {
    variables: { input: {
      providerId: activeTab === 'all' ? providerFilter || undefined : undefined,
      vendorId: activeTab === 'all' ? vendorFilter || undefined : undefined,
      search: (activeTab === 'all' ? debouncedSearch : debouncedAddedSearch) || undefined,
      ...(activeTab === 'all' ? { excludeGameIds: currentGameIds } : { includeGameIds: currentGameIds }),
      page, pageSize,
    } },
    errorPolicy: 'all', fetchPolicy: 'cache-and-network', notifyOnNetworkStatusChange: true,
  })
  useEffect(() => { setPage(1) }, [debouncedSearch, debouncedAddedSearch, providerFilter, vendorFilter])

  // Fetch providers
  const { data: providersData } = useQuery(CASINO_API_PROVIDERS, {
    errorPolicy: 'all',
  })

  // Fetch vendors - filtered by provider if selected
  const { data: vendorsData } = useQuery(CASINO_VENDORS, {
    variables: providerFilter
      ? {
          providerId: providerFilter,
        }
      : undefined,
    errorPolicy: 'all',
  })

  // Fetch all casino bundles
  const { data: bundlesData } = useQuery(CASINO_GAME_BUNDLES_QUERY, {
    variables: {
      domain: 'casino',
    },
    errorPolicy: 'all',
  })

  const allBundles = useMemo<BonusBundle[]>(() => bundlesData?.casinoGameBundles || [], [bundlesData])

  const bundleGameIds = useMemo(() => [...new Set(allBundles.flatMap(bundle => (bundle.gameIds || []).map(String)))], [allBundles])
  const { data: matchingData, error: bundleMatchError, loading: bundleMatchLoading } = useQuery<{ casinoSelectionGameIds: string[] }>(CASINO_SELECTION_GAME_IDS, {
    variables: { providerId: providerFilter, gameIds: bundleGameIds },
    skip: !providerFilter || bundleGameIds.length === 0,
    errorPolicy: 'all',
  })
  const relevantBundles = useMemo(() => {
    if (!providerFilter || bundleMatchLoading) return []
    const matchingIds = new Set(matchingData?.casinoSelectionGameIds || [])
    return allBundles.filter(bundle => bundle.gameIds?.some(id => matchingIds.has(String(id))))
  }, [providerFilter, matchingData, allBundles, bundleMatchLoading])

  const [executesaveGames, { loading: saving }] = useMutation(SAVE_BONUS_CAMPAIGN_GAMES, {
    // The tab reports the outcome itself; the global mutation toast said it twice (MAR-06).
    context: { skipNotification: true },
    onCompleted: (data) => {
      if (data.saveBonusCampaignGames.success) {
        notification.success({
          message: 'Success',
          description: data.saveBonusCampaignGames.message,
        })
        onUpdate()
        setSelectedGameIds(new Set())
        setActiveTab('added')
      } else {
        notification.error({
          message: 'Error',
          description: data.saveBonusCampaignGames.message,
        })
      }
    },
    onError: (error) => {
      notification.error({
        message: 'Error',
        description: error.message,
      })
    },
  })

  const saveGames = async (options: Parameters<typeof executesaveGames>[0]) => {
    const result = await executesaveGames(options)
    if (!result.data?.saveBonusCampaignGames?.success) throw new Error(result.data?.saveBonusCampaignGames?.message || 'Campaign update failed')
    return result
  }

  const providers = providersData?.casinoApiProviders || []
  const vendors = vendorsData?.casinoVendors || []
  const rows = gamesData?.casinoSelectionGames?.items ?? []
  const total = gamesData?.casinoSelectionGames?.total ?? 0
  const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)))
  useEffect(() => { if (!gamesLoading && page !== currentPage) setPage(currentPage) }, [gamesLoading, page, currentPage])

  const handleAddGames = async () => {
    if (selectedGameIds.size === 0) {
      notification.warning({
        message: 'No Games Selected',
        description: 'Please select at least one game to add.',
      })
      return
    }

    const gameIds = Array.from(selectedGameIds)
    const newWeights: Record<string, number> = { ...currentGameWeights }
    gameIds.forEach((id) => {
      if (!newWeights[id]) {
        newWeights[id] = 1.0
      }
    })

    const allGameIds = [...currentGameIds, ...gameIds]

    await saveGames({
      variables: {
        campaignId,
        gameIds: allGameIds,
        gameWeights: newWeights,
      },
    })
  }

  const handleAddBundle = async () => {
    if (!selectedBundleId) {
      notification.warning({
        message: 'No Bundle Selected',
        description: 'Please select a bundle to add.',
      })
      return
    }

    const bundle = allBundles.find((b: { id: string }) => String(b.id) === selectedBundleId)
    if (!bundle || !Array.isArray(bundle.gameIds)) {
      notification.error({
        message: 'Error',
        description: 'Bundle not found or has no games.',
      })
      return
    }

    // Get bundle game IDs and weights
    const bundleGameIds = bundle.gameIds.map(String)
    const bundleWeights = bundle.gameWeights || {}
    
    // Merge with existing games and weights
    const newWeights: Record<string, number> = { ...currentGameWeights }
    const newGameIds = [...currentGameIds]
    
    bundleGameIds.forEach((gameId: string) => {
      if (!newGameIds.includes(gameId)) {
        newGameIds.push(gameId)
      }
      // Use bundle weight if available, otherwise default to 1.0
      if (!newWeights[gameId] && bundleWeights[gameId]) {
        newWeights[gameId] = bundleWeights[gameId]
      } else if (!newWeights[gameId]) {
        newWeights[gameId] = 1.0
      }
    })

    await saveGames({
      variables: {
        campaignId,
        gameIds: newGameIds,
        gameWeights: newWeights,
      },
    })
    
    // Reset bundle selection and switch to added tab
    setSelectedBundleId(null)
    setActiveTab('added')
  }

  const handleRemoveGame = async (gameId: string) => {
    const newGameIds = currentGameIds.filter((id) => id !== gameId)
    const newWeights = { ...currentGameWeights }
    delete newWeights[gameId]

    await saveGames({
      variables: {
        campaignId,
        gameIds: newGameIds,
        gameWeights: newWeights,
      },
    })
  }

  const handleBulkRemoveGames = async () => {
    if (selectedForRemove.size === 0) {
      notification.warning({
        message: 'No Games Selected',
        description: 'Please select at least one game to remove.',
      })
      return
    }

    const gameIdsToRemove = Array.from(selectedForRemove)
    const newGameIds = currentGameIds.filter((id) => !gameIdsToRemove.includes(id))
    const newWeights = { ...currentGameWeights }
    gameIdsToRemove.forEach((gameId) => {
      delete newWeights[gameId]
    })

    await saveGames({
      variables: {
        campaignId,
        gameIds: newGameIds,
        gameWeights: newWeights,
      },
    })
    
    // Clear selection after removal
    setSelectedForRemove(new Set())
  }

  const handleSetWeight = async (gameId: string, weight: number) => {
    const newWeights = { ...currentGameWeights, [gameId]: weight }

    await saveGames({
      variables: {
        campaignId,
        gameIds: currentGameIds,
        gameWeights: newWeights,
      },
    })
    setWeightDrawerOpen(false)
    setEditingGameId(null)
  }

  const handleBulkSetWeight = async () => {
    if (selectedForRemove.size === 0) {
      notification.warning({
        message: 'No Games Selected',
        description: 'Please select games for bulk weight assignment.',
      })
      return
    }

    const newWeights = { ...currentGameWeights }
    selectedForRemove.forEach((gameId) => {
      newWeights[gameId] = bulkWeight
    })

    await saveGames({
      variables: {
        campaignId,
        gameIds: currentGameIds,
        gameWeights: newWeights,
      },
    })
    setSelectedForRemove(new Set())
  }

  const baseColumns: DataTableColumn<BonusGameRow>[] = [
    { key: 'game', header: 'Game', cell: (record) => <div className={styles.game}><StoredImage src={record.thumbnailUrl} alt={record.name || ''} className={styles.thumbnail} fallback={<span className={styles.noImage}>No Image</span>} /><div><div className={styles.name}>{record.name}</div><div className={styles.muted}>{record.vendorName}</div></div></div> },
    { key: 'vendor', header: 'Provider', cell: (row) => row.vendorName || '—' },
    { key: 'category', header: 'Category', cell: (row) => <StatusPill>{row.mainCategory || '—'}</StatusPill> },
  ]
  const addedColumns: DataTableColumn<BonusGameRow>[] = [
    baseColumns[0],
    { key: 'weight', header: 'Weight', cell: (row) => { const weight = currentGameWeights?.[String(row.id)] ?? 1; return <StatusPill tone={weight > 1 ? 'ok' : weight < 1 ? 'warn' : 'neutral'}>{weight.toFixed(2)}x</StatusPill> } },
    { key: 'actions', header: 'Actions', cell: (row) => <div className={styles.actions}>
      <Button size="sm" disabled={saving} onClick={() => { setEditingGameId(String(row.id)); setGameWeight(currentGameWeights?.[String(row.id)] || 1); setWeightDrawerOpen(true) }}>Set Weight</Button>
      <Button size="sm" variant="danger" disabled={saving} onClick={() => void confirm({ title: 'Remove game from campaign?', tone: 'danger', confirmLabel: 'Remove', onConfirm: () => handleRemoveGame(String(row.id)) })}>Remove</Button>
    </div> },
  ]
  const selected = activeTab === 'all' ? selectedGameIds : selectedForRemove
  const updateSelected = activeTab === 'all' ? setSelectedGameIds : setSelectedForRemove
  const selectionColumn: DataTableColumn<BonusGameRow> = {
    key: 'select', header: <Checkbox label="Select all games on this page" hideLabel disabled={saving || gamesLoading || !!queryError} checked={rows.length > 0 && rows.every(row => selected.has(String(row.id)))} indeterminate={rows.some(row => selected.has(String(row.id))) && !rows.every(row => selected.has(String(row.id)))} onChange={checked => { const next = new Set(selected); rows.forEach(row => { if (checked) next.add(String(row.id)); else next.delete(String(row.id)) }); updateSelected(next) }} />,
    cell: row => <Checkbox label={`Select ${row.name || row.id}`} hideLabel checked={selected.has(String(row.id))} disabled={saving || gamesLoading || !!queryError} onChange={checked => { const next = new Set(selected); if (checked) next.add(String(row.id)); else next.delete(String(row.id)); updateSelected(next) }} />,
  }
  return <div className={styles.stack}>
    <div className={styles.tabs}><Tabs value={activeTab} items={[{ value: 'all', label: 'All Casino Games' }, { value: 'added', label: `Added Games (${currentGameIds.length})` }]} onChange={(value) => { setActiveTab(value); setPage(1) }} label="Casino game tabs" idPrefix="bonus-casino" /></div>
    {bundleMatchError && <Notice tone="error" title="Unable to load matching bundles">{bundleMatchError.message}</Notice>}
    {queryError && <Notice tone="error" title="Unable to load all casino games">{queryError.message}</Notice>}
    <div className={styles.stack} role="tabpanel" id={tabPanelId('bonus-casino', activeTab)} aria-labelledby={tabId('bonus-casino', activeTab)}>
      <div className={styles.toolbar}>
        <SearchField className={styles.search} label={activeTab === 'all' ? 'Search games' : 'Search added games'} placeholder={activeTab === 'all' ? 'Search games...' : 'Search added games...'} value={activeTab === 'all' ? search : addedGamesSearch} onChange={(value) => { if (activeTab === 'all') setSearch(value); else setAddedGamesSearch(value); setPage(1) }} />
        {activeTab === 'all' && <Button variant="primary" disabled={selectedGameIds.size === 0} loading={saving} onClick={() => void handleAddGames().catch(() => {})}>Add Selected ({selectedGameIds.size})</Button>}
      </div>
      {activeTab === 'all' ? <div className={styles.toolbar}>
        <Combobox className={styles.picker} label="Provider" placeholder="All Providers" clearable options={providers.map((p: { id: string; name: string }) => ({ value: String(p.id), label: p.name }))} value={providerFilter} onChange={(value) => { setProviderFilter(value); setVendorFilter(null); setSelectedBundleId(null); setPage(1) }} />
        <Combobox className={styles.picker} label="Vendor" placeholder="All Vendors" disabled={!providerFilter} clearable options={vendors.map((v: { id: string; name: string }) => ({ value: String(v.id), label: v.name }))} value={vendorFilter} onChange={(value) => { setVendorFilter(value); setPage(1) }} />
        {providerFilter && relevantBundles.length > 0 && <Combobox className={styles.picker} label="Bundle" placeholder="Select Bundle" clearable options={relevantBundles.map((bundle: BonusBundle) => ({ value: String(bundle.id), label: `${bundle.name} (${bundle.gameCount ?? 0} games)` }))} value={selectedBundleId} onChange={setSelectedBundleId} />}
        {selectedBundleId && <Button loading={saving} onClick={() => void handleAddBundle().catch(() => {})}>Add Bundle</Button>}
      </div> : selectedForRemove.size > 0 && <div className={styles.toolbar}>
        <Button variant="danger" loading={saving} onClick={() => void handleBulkRemoveGames().catch(() => {})}>Remove ({selectedForRemove.size})</Button>
        <NumberField className={styles.picker} label="Bulk weight" min={0} max={100} step={0.1} value={bulkWeight} onChange={(value) => setBulkWeight(value || 1)} />
        <Button loading={saving} onClick={() => void handleBulkSetWeight().catch(() => {})}>Set Weight ({selectedForRemove.size})</Button>
      </div>}
      <DataTable label={activeTab === 'all' ? 'Available casino games' : 'Added casino games'} rows={rows} rowKey={(row) => String(row.id)} columns={[selectionColumn, ...(activeTab === 'all' ? baseColumns : addedColumns)]}
        state={gamesLoading ? 'loading' : queryError ? 'error' : 'ready'} error={queryError?.message}
        pagination={{ current: currentPage, pageSize, total, onChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1) }, pageSizeOptions: [20, 50, 100], itemName: 'games' }} empty={activeTab === 'added' ? 'No games added to this campaign' : 'No games found'} />
    </div>
    <Drawer title="Set Game Weight" open={weightDrawerOpen} onOpenChange={(open) => { setWeightDrawerOpen(open); if (!open) setEditingGameId(null) }} size="sm" dismissible={!saving}>
      <div className={styles.stack}><NumberField label="Weight (0-100)" min={0} max={100} step={0.1} value={gameWeight} onChange={(value) => setGameWeight(value || 1)} help="Weight determines the contribution of this game to bonus wagering requirements." />
        <div className={styles.actions}><Button disabled={saving} onClick={() => { setWeightDrawerOpen(false); setEditingGameId(null) }}>Cancel</Button><Button variant="primary" loading={saving} onClick={() => editingGameId && void handleSetWeight(editingGameId, gameWeight).catch(() => {})}>Save</Button></div>
      </div>
    </Drawer>
  </div>
}
