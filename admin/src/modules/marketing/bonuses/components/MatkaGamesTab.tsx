import { useState, useMemo } from 'react'
import { useQuery, useMutation, gql } from '@apollo/client'
import { Checkbox } from '@/ui/components/Checkbox'
import { Button } from '@/ui/components/Button'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { SearchField } from '@/ui/components/SearchField'
import { Combobox } from '@/ui/components/Combobox'
import { StatusPill } from '@/ui/components/StatusPill'
import { Drawer } from '@/ui/components/Drawer'
import { NumberField } from '@/ui/components/NumberField'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { confirm } from '@/ui/components/confirm'
import { Notice } from '@/ui/components/Notice'
import { bonusNotification as notification, type BonusMatkaRow, type BonusBundle } from './bonusDetailModel'
import styles from './BonusDetailTabs.module.css'
import { MATKA_CATALOG_QUERY as MATKAS_QUERY } from '@/lib/graphql/matka'

const SAVE_BONUS_CAMPAIGN_MATKAS = gql`
  mutation SaveBonusCampaignMatkas($campaignId: ID!, $matkaIds: [ID!]!, $matkaBidTypeWeights: JSON) {
    saveBonusCampaignMatkas(campaignId: $campaignId, matkaIds: $matkaIds, matkaBidTypeWeights: $matkaBidTypeWeights) {
      success
      message
      campaign {
        id
        matkaGameIds
        matkaBidTypeWeights
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

const BID_TYPES = [
  'SINGLE',
  'JODI',
  'SINGLE_PAANA',
  'DOUBLE_PAANA',
  'TRIPLE_PAANA',
  'HALF_SANGAM',
  'FULL_SANGAM',
]

interface MatkaGamesTabProps {
  campaignId: string
  currentMatkaIds: string[]
  currentBidTypeWeights: Record<string, Record<string, number>> | null
  onUpdate: () => void
}

export function MatkaGamesTab({
  campaignId,
  currentMatkaIds,
  currentBidTypeWeights,
  onUpdate,
}: MatkaGamesTabProps) {
  const [search, setSearch] = useState('')
  const [selectedMatkaIds, setSelectedMatkaIds] = useState<Set<string>>(new Set())
  const [weightDrawerOpen, setWeightDrawerOpen] = useState(false)
  const [editingMatkaId, setEditingMatkaId] = useState<string | null>(null)
  const [bidTypeWeights, setBidTypeWeights] = useState<Record<string, number>>({})
  const [activeTab, setActiveTab] = useState<'all' | 'added'>('all')
  const [addedMatkasSearch, setAddedMatkasSearch] = useState('')
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null)

  // Fetch all matka markets
  const { data: matkasData, loading: matkasLoading, error: matkasError } = useQuery(MATKAS_QUERY, {
    variables: {
      filters: {
        query: search.trim().length >= 2 ? search.trim() : undefined,
        status: 'ACTIVE',
      },
    },
    errorPolicy: 'all',
  })

  const [executesaveMatkas, { loading: saving }] = useMutation(SAVE_BONUS_CAMPAIGN_MATKAS, {
    // The tab reports the outcome itself; the global mutation toast said it twice (MAR-06).
    context: { skipNotification: true },
    onCompleted: (data) => {
      if (data.saveBonusCampaignMatkas.success) {
        notification.success({
          message: 'Success',
          description: data.saveBonusCampaignMatkas.message,
        })
        onUpdate()
        setSelectedMatkaIds(new Set())
        setActiveTab('added')
      } else {
        notification.error({
          message: 'Error',
          description: data.saveBonusCampaignMatkas.message,
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

  const saveMatkas = async (options: Parameters<typeof executesaveMatkas>[0]) => {
    const result = await executesaveMatkas(options)
    if (!result.data?.saveBonusCampaignMatkas?.success) throw new Error(result.data?.saveBonusCampaignMatkas?.message || 'Campaign update failed')
    return result
  }

  // Fetch all matka bundles
  const { data: bundlesData } = useQuery(CASINO_GAME_BUNDLES_QUERY, {
    variables: {
      domain: 'matka',
    },
    errorPolicy: 'all',
  })

  const allBundles = useMemo<BonusBundle[]>(() => bundlesData?.casinoGameBundles || [], [bundlesData])

  const allMatkas = useMemo<BonusMatkaRow[]>(() => matkasData?.matkas?.items || [], [matkasData])

  // Get added matkas
  const addedMatkas = useMemo(() => {
    if (!currentMatkaIds || currentMatkaIds.length === 0) return []
    let matkas = allMatkas.filter((m: { id: string }) => currentMatkaIds.includes(String(m.id)))
    
    // Filter by search if provided
    if (addedMatkasSearch.trim().length >= 2) {
      const q = addedMatkasSearch.trim().toLowerCase()
      matkas = matkas.filter(
        (m: { id: string; name?: string; code?: string; description?: string }) =>
          m.name?.toLowerCase().includes(q) ||
          m.code?.toLowerCase().includes(q) ||
          m.description?.toLowerCase().includes(q)
      )
    }
    
    return matkas
  }, [allMatkas, currentMatkaIds, addedMatkasSearch])

  // Filter matkas for "All Matka Markets" tab
  const filteredMatkas = useMemo(() => {
    let result = allMatkas.filter((m: { id: string }) => !currentMatkaIds.includes(String(m.id)))

    if (search.trim().length >= 2) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (m: { id: string; name?: string; code?: string; description?: string }) =>
          m.name?.toLowerCase().includes(q) ||
          m.code?.toLowerCase().includes(q) ||
          m.description?.toLowerCase().includes(q)
      )
    }

    return result
  }, [allMatkas, currentMatkaIds, search])

  const handleAddMatkas = async () => {
    if (selectedMatkaIds.size === 0) {
      notification.warning({
        message: 'No Markets Selected',
        description: 'Please select at least one Matka market to add.',
      })
      return
    }

    const matkaIds = Array.from(selectedMatkaIds)
    const newBidTypeWeights: Record<string, Record<string, number>> = {
      ...currentBidTypeWeights,
    }

    // Initialize default weights (1.0) for all bid types for new matkas
    matkaIds.forEach((matkaId) => {
      if (!newBidTypeWeights[matkaId]) {
        newBidTypeWeights[matkaId] = {}
        BID_TYPES.forEach((bidType) => {
          newBidTypeWeights[matkaId][bidType] = 1.0
        })
      }
    })

    const allMatkaIds = [...currentMatkaIds, ...matkaIds]

    await saveMatkas({
      variables: {
        campaignId,
        matkaIds: allMatkaIds,
        matkaBidTypeWeights: newBidTypeWeights,
      },
    })
  }

  const handleRemoveMatka = async (matkaId: string) => {
    const newMatkaIds = currentMatkaIds.filter((id) => id !== matkaId)
    const newBidTypeWeights = { ...currentBidTypeWeights }
    delete newBidTypeWeights[matkaId]

    await saveMatkas({
      variables: {
        campaignId,
        matkaIds: newMatkaIds,
        matkaBidTypeWeights: newBidTypeWeights,
      },
    })
  }

  const handleOpenWeightDrawer = (matkaId: string) => {
    setEditingMatkaId(matkaId)
    const existingWeights = currentBidTypeWeights?.[matkaId] || {}
    const weights: Record<string, number> = {}
    BID_TYPES.forEach((bidType) => {
      weights[bidType] = existingWeights[bidType] || 1.0
    })
    setBidTypeWeights(weights)
    setWeightDrawerOpen(true)
  }

  const handleSaveBidTypeWeights = async () => {
    if (!editingMatkaId) return

    const newBidTypeWeights = {
      ...currentBidTypeWeights,
      [editingMatkaId]: bidTypeWeights,
    }

    await saveMatkas({
      variables: {
        campaignId,
        matkaIds: currentMatkaIds,
        matkaBidTypeWeights: newBidTypeWeights,
      },
    })
    setWeightDrawerOpen(false)
    setEditingMatkaId(null)
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
        description: 'Bundle not found or has no markets.',
      })
      return
    }

    // Get bundle market IDs (gameIds in bundle represent matka market IDs)
    const bundleMatkaIds = bundle.gameIds.map(String)
    
    // Merge with existing markets and bid type weights
    const newBidTypeWeights: Record<string, Record<string, number>> = {
      ...currentBidTypeWeights,
    }
    const newMatkaIds = [...currentMatkaIds]
    
    bundleMatkaIds.forEach((matkaId: string) => {
      if (!newMatkaIds.includes(matkaId)) {
        newMatkaIds.push(matkaId)
      }
      // Initialize default weights (1.0) for all bid types for new matkas
      if (!newBidTypeWeights[matkaId]) {
        newBidTypeWeights[matkaId] = {}
        BID_TYPES.forEach((bidType) => {
          newBidTypeWeights[matkaId][bidType] = 1.0
        })
      }
    })

    await saveMatkas({
      variables: {
        campaignId,
        matkaIds: newMatkaIds,
        matkaBidTypeWeights: newBidTypeWeights,
      },
    })
    
    // Reset bundle selection and switch to added tab
    setSelectedBundleId(null)
    setActiveTab('added')
  }

  const getMatkaBidTypeWeights = (matkaId: string) => {
    return currentBidTypeWeights?.[matkaId] || {}
  }

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const baseColumns: DataTableColumn<BonusMatkaRow>[] = [
    { key: 'code', header: 'Market Code', cell: (row) => row.code || '—' },
    { key: 'name', header: 'Name', cell: (row) => row.name || '—' },
    { key: 'status', header: 'Status', cell: (row) => <StatusPill status={row.status || ''}>{row.status}</StatusPill> },
    { key: 'timezone', header: 'Timezone', cell: (row) => row.timezone || '—' },
  ]
  const addedColumns: DataTableColumn<BonusMatkaRow>[] = [
    ...baseColumns.slice(0, 2),
    { key: 'weights', header: 'Bid Type Weights', cell: (row) => { const count = Object.keys(getMatkaBidTypeWeights(String(row.id))).length; return <StatusPill tone={count ? 'info' : 'neutral'}>{count ? `${count} bid types configured` : 'Default weights (1.0x)'}</StatusPill> } },
    { key: 'actions', header: 'Actions', cell: (row) => <div className={styles.actions}><Button size="sm" disabled={saving} onClick={() => handleOpenWeightDrawer(String(row.id))}>Configure Weights</Button><Button variant="danger" size="sm" disabled={saving} onClick={() => void confirm({ title: 'Remove market from campaign?', tone: 'danger', confirmLabel: 'Remove', onConfirm: () => handleRemoveMatka(String(row.id)) })}>Remove</Button></div> },
  ]
  const rows = activeTab === 'all' ? filteredMatkas : addedMatkas
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)))
  const selectionColumn: DataTableColumn<BonusMatkaRow> = {
    key: 'select', header: <Checkbox label="Select all Matka markets" hideLabel checked={rows.length > 0 && rows.every(row => selectedMatkaIds.has(String(row.id)))} indeterminate={rows.some(row => selectedMatkaIds.has(String(row.id))) && !rows.every(row => selectedMatkaIds.has(String(row.id)))} onChange={checked => { const next = new Set(selectedMatkaIds); rows.forEach(row => { if (checked) next.add(String(row.id)); else next.delete(String(row.id)) }); setSelectedMatkaIds(next) }} />,
    cell: row => <Checkbox label={`Select ${row.name || row.id}`} hideLabel checked={selectedMatkaIds.has(String(row.id))} disabled={saving} onChange={checked => { const next = new Set(selectedMatkaIds); if (checked) next.add(String(row.id)); else next.delete(String(row.id)); setSelectedMatkaIds(next) }} />,
  }
  return <div className={styles.stack}>
    <div className={styles.tabs}><Tabs value={activeTab} items={[{ value: 'all', label: 'All Matka Markets' }, { value: 'added', label: `Added Markets (${addedMatkas.length})` }]} onChange={(value) => { setActiveTab(value); setPage(1) }} label="Matka market tabs" idPrefix="bonus-matka" /></div>
    {matkasError && <Notice tone="error" title="Unable to load Matka markets">{matkasError.message}</Notice>}
    <div className={styles.stack} role="tabpanel" id={tabPanelId('bonus-matka', activeTab)} aria-labelledby={tabId('bonus-matka', activeTab)}>
      <div className={styles.toolbar}><SearchField className={styles.search} label={activeTab === 'all' ? 'Search markets' : 'Search added markets'} placeholder={activeTab === 'all' ? 'Search markets...' : 'Search added markets...'} value={activeTab === 'all' ? search : addedMatkasSearch} onChange={(value) => { if (activeTab === 'all') setSearch(value); else setAddedMatkasSearch(value); setPage(1) }} />
        {activeTab === 'all' && <Button variant="primary" disabled={selectedMatkaIds.size === 0} loading={saving} onClick={() => void handleAddMatkas().catch(() => {})}>Add Selected ({selectedMatkaIds.size})</Button>}</div>
      {activeTab === 'all' && allBundles.length > 0 && <div className={styles.toolbar}><Combobox className={styles.picker} label="Matka bundle" placeholder="Select Bundle" clearable options={allBundles.map((bundle) => ({ value: String(bundle.id), label: `${bundle.name} (${bundle.gameCount ?? 0} markets)` }))} value={selectedBundleId} onChange={setSelectedBundleId} />{selectedBundleId && <Button loading={saving} onClick={() => void handleAddBundle().catch(() => {})}>Add Bundle</Button>}</div>}
      <DataTable label={activeTab === 'all' ? 'Available Matka markets' : 'Added Matka markets'} rows={rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)} columns={activeTab === 'all' ? [selectionColumn, ...baseColumns] : addedColumns} rowKey={(row) => String(row.id)} state={matkasLoading ? 'loading' : 'ready'}
        empty={activeTab === 'added' ? 'No Matka markets added to this campaign' : 'No markets found'}
        pagination={{ current: currentPage, pageSize, total: rows.length, onChange: setPage, onPageSizeChange: (size) => { setPageSize(size); setPage(1) }, pageSizeOptions: [20, 50, 100], itemName: 'markets' }} />
    </div>
    <Drawer open={weightDrawerOpen} onOpenChange={(open) => { setWeightDrawerOpen(open); if (!open) setEditingMatkaId(null) }} size="md" dismissible={!saving}
      title={`Configure Bid Type Weights - ${editingMatkaId ? allMatkas.find((row) => String(row.id) === editingMatkaId)?.name || '' : ''}`}>
      <div className={styles.stack}><p className={styles.muted}>Set weight for each bid type. Weight determines the contribution of each bid type to bonus wagering requirements.</p>
        <div className={styles.weights}>{BID_TYPES.map((type) => <NumberField key={type} label={type.replace(/_/g, ' ')} min={0} max={100} step={0.1} value={bidTypeWeights[type] || 1} onChange={(value) => setBidTypeWeights({ ...bidTypeWeights, [type]: value || 1 })} />)}</div>
        <div className={styles.actions}><Button disabled={saving} onClick={() => { setWeightDrawerOpen(false); setEditingMatkaId(null) }}>Cancel</Button><Button variant="primary" loading={saving} onClick={() => void handleSaveBidTypeWeights().catch(() => {})}>Save Weights</Button></div>
      </div>
    </Drawer>
  </div>
}
