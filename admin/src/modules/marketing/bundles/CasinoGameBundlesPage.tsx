import { useEffect, useMemo, useState } from 'react'
import { gql, useMutation, useQuery } from '@apollo/client'
import { Link } from 'react-router-dom'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { GAMES_BY_IDS } from '@/lib/graphql/casino'
import { MATKAS_BY_IDS } from '@/lib/graphql/matka'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Checkbox } from '@/ui/components/Checkbox'
import { FilterBar } from '@/ui/components/FilterBar'
import { NumberField } from '@/ui/components/NumberField'
import { Pagination } from '@/ui/components/Pagination'
import { SearchField } from '@/ui/components/SearchField'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { StatusPill } from '@/ui/components/StatusPill'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { confirm } from '@/ui/components/confirm'
import { toast } from '@/ui/components/toast'
import { bundleWeightRecord, bundleWeightsChanged, clampBundleWeight, validBundleIds } from './casinoGameBundlesModel'
import styles from './CasinoGameBundlesPage.module.css'

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

const DELETE_BUNDLE_MUTATION = gql`
  mutation DeleteCasinoGameBundle($id: ID!) {
    deleteCasinoGameBundle(id: $id) {
      success
      message
    }
  }
`

const UPDATE_BUNDLE_WEIGHTS_MUTATION = gql`
  mutation UpdateCasinoGameBundle($id: ID!, $input: CasinoGameBundleUpdateInput!) {
    updateCasinoGameBundle(id: $id, input: $input) {
      success
      message
      bundle {
        id
        gameWeights
      }
    }
  }
`


interface Bundle {
  id: string
  name: string
  description?: string | null
  domain: string
  gameIds: unknown[]
  gameWeights?: Record<string, number> | null
  gameCount?: number
  createdAt?: string
  updatedAt?: string
}
interface BundleItem {
  id: string | number
  name: string
  slug?: string
  code?: string
  thumbnailUrl?: string
  vendorName?: string
  isActive?: boolean
  tenantEnabled?: boolean | null
  status?: string
}
interface MutationResult { success: boolean; message?: string }
const EMPTY_ITEMS: BundleItem[] = []

function BundleThumbnail({ item }: { item: BundleItem }) {
  const [failed, setFailed] = useState(false)
  return item.thumbnailUrl && !failed ? <img src={item.thumbnailUrl} alt="" className={styles.thumbnail} onError={() => setFailed(true)} /> :
    <span className={styles.thumbnailFallback}>{failed ? 'Failed' : 'No Image'}</span>
}

export function BundleGamesList({ gameIds, domain, isExpanded = true, bundleId, gameWeights, onWeightsUpdate }: {
  gameIds: readonly unknown[]
  domain: string
  isExpanded?: boolean
  bundleId?: string
  gameWeights?: Record<string, number> | null
  onWeightsUpdate?: () => void
}) {
  const ids = useMemo(() => validBundleIds(gameIds, domain), [gameIds, domain])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [current, setCurrent] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const casino = useQuery<{ gamesByIds: BundleItem[] }>(GAMES_BY_IDS, {
    variables: { gameIds: ids, skipVendorFilter: true },
    skip: !isExpanded || !ids.length || domain !== 'casino', errorPolicy: 'all', fetchPolicy: 'network-only',
  })
  const matka = useQuery<{ matkasByIds: BundleItem[] }>(MATKAS_BY_IDS, {
    variables: { matkaIds: ids }, skip: !isExpanded || !ids.length || domain !== 'matka',
    errorPolicy: 'all', fetchPolicy: 'network-only',
  })
  const items = (domain === 'matka' ? matka.data?.matkasByIds : casino.data?.gamesByIds) || EMPTY_ITEMS
  const itemIds = useMemo(() => items.map((item) => String(item.id)), [items])
  const original = useMemo(() => bundleWeightRecord(gameWeights, itemIds), [gameWeights, itemIds])
  const [weights, setWeights] = useState<Record<string, number>>(() => bundleWeightRecord(gameWeights, []))
  useEffect(() => {
    setWeights((previous) => {
      const next = { ...previous }
      let changed = false
      for (const [id, value] of Object.entries(original)) if (!(id in next)) { next[id] = value; changed = true }
      return changed ? next : previous
    })
  }, [original])
  useEffect(() => { if (!isExpanded) setSelected(new Set()) }, [isExpanded])
  const [updateWeights, { loading: saving }] = useMutation<{ updateCasinoGameBundle: MutationResult }>(UPDATE_BUNDLE_WEIGHTS_MUTATION, {
    // Reported here; the global mutation toast said it a second time (MAR-06).
    context: { skipNotification: true },
    onCompleted: (data) => {
      if (data.updateCasinoGameBundle.success) {
        toast({ title: 'Success', tone: 'ok', message: domain === 'matka' ? 'Market weights updated successfully' : 'Game weights updated successfully' })
        onWeightsUpdate?.()
      } else toast({ title: 'Error', tone: 'error', message: data.updateCasinoGameBundle.message || 'Failed to update weights' })
    },
    onError: (error) => toast({ title: 'Error', tone: 'error', message: error.message }),
  })
  const changed = Boolean(bundleId) && bundleWeightsChanged(weights, original)
  const allSelected = items.length > 0 && itemIds.every((id) => selected.has(id))
  const someSelected = itemIds.some((id) => selected.has(id))
  const columns: DataTableColumn<BundleItem>[] = [
    { key: 'select', header: <Checkbox label={domain === 'matka' ? 'Select all markets' : 'Select all games'} hideLabel
      checked={allSelected} indeterminate={someSelected && !allSelected} onChange={(checked) => {
        setSelected((previous) => { const next = new Set(previous); for (const id of itemIds) { if (checked) next.add(id); else next.delete(id) } return next })
      }} />, cell: (item) => <Checkbox label={`Select ${item.name}`} hideLabel checked={selected.has(String(item.id))} onChange={(checked) => {
        setSelected((previous) => { const next = new Set(previous); if (checked) next.add(String(item.id)); else next.delete(String(item.id)); return next })
      }} /> },
    { key: 'name', header: domain === 'matka' ? 'Market' : 'Game', cell: (item) =>
      <div className={styles.identity}>{domain === 'casino' ? <BundleThumbnail item={item} /> : null}
        <div><div className={styles.name}>{item.name}</div><div className={styles.secondary}>{item.code || item.slug || item.id}</div></div></div> },
    ...(domain === 'casino' ? [{ key: 'vendor', header: 'Vendor', cell: (item: BundleItem) => item.vendorName || '—' }] : []),
    { key: 'status', header: 'Status', cell: (item) => domain === 'matka' ? <StatusPill status={item.status}>{item.status || '—'}</StatusPill> :
      <div><StatusPill tone={item.isActive ? 'ok' : 'neg'}>{item.isActive ? 'Active' : 'Inactive'}</StatusPill>
        {item.tenantEnabled !== null ? <StatusPill tone={item.tenantEnabled ? 'info' : 'muted'}>{item.tenantEnabled ? 'Enabled' : 'Disabled'}</StatusPill> : null}</div> },
    { key: 'weight', header: 'Weight', cell: (item) => <NumberField label={`Weight for ${item.name}`} hideLabel className={styles.weight}
      size="sm" min={0} max={1} step={0.01} precision={2} value={weights[String(item.id)] ?? 1} disabled={!bundleId || saving}
      onChange={(value) => { const next = clampBundleWeight(value); if (next !== null) setWeights((previous) => ({ ...previous, [String(item.id)]: next })) }} /> },
  ]
  if (!isExpanded || (domain !== 'casino' && domain !== 'matka')) return null
  const loading = domain === 'matka' ? matka.loading : casino.loading
  const error = domain === 'matka' ? matka.error : casino.error
  const plural = domain === 'matka' ? 'markets' : 'games'
  if (loading) return <LoadingState label={`Loading ${plural}`} minHeight={192} />
  if (error) return <Notice tone="error">Error loading {plural}: {error.message}</Notice>
  if (!ids.length) return <EmptyState title={`No ${plural} in this bundle`} />
  if (!items.length) return <Notice tone="warn" title={`No ${plural} found`}>
    Tried to load {ids.length} {plural} with IDs: {ids.slice(0, 10).join(', ')}{ids.length > 10 ? '...' : ''}
  </Notice>
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const page = Math.min(current, pageCount)
  return <div className={styles.list}>
    <div className={styles.listHeader}>
      <h3 className={styles.listTitle}>{domain === 'matka' ? 'Markets' : 'Games'} in Bundle ({items.length}):</h3>
      {bundleId ? <Button variant="primary" size="sm" loading={saving} aria-disabled={!changed}
        onClick={() => { void updateWeights({ variables: { id: String(bundleId), input: { gameWeights: bundleWeightRecord(weights, []) } } }).catch(() => undefined) }}>Save Weights</Button> : null}
    </div>
    <DataTable columns={columns} rows={items.slice((page - 1) * pageSize, page * pageSize)}
      rowKey={(item) => String(item.id)} label={domain === 'matka' ? 'Bundle markets' : 'Bundle games'} width="wide" pagination={false} />
    <div className={styles.pagination}>
      <Pagination current={page} pageSize={pageSize} total={items.length} onChange={setCurrent} itemName={plural}
        pageSizeOptions={[10, 20, 50, 100]} onPageSizeChange={(size) => { setPageSize(size); setCurrent(1) }} />
      <NumberField label="Go to page" size="sm" className={styles.quickJump} min={1} max={pageCount} precision={0} value={page}
        onChange={(value) => { if (value !== null) setCurrent(Math.max(1, Math.min(pageCount, Math.round(value)))) }} />
    </div>
  </div>
}

export default function CasinoGameBundlesPageWrapper() {
  return <RBACGuard required={[{ domain: 'bonuses.bundles', actions: ['view'] }]}><CasinoGameBundlesPageContent /></RBACGuard>
}
function CasinoGameBundlesPageContent() {
  const eyebrow = usePageEyebrow()
  const { formatDate } = useFormatDate()
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState('casino')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { data, loading, error, refetch } = useQuery<{ casinoGameBundles: Bundle[] }>(CASINO_GAME_BUNDLES_QUERY, {
    variables: { search: search.trim().length > 0 ? search.trim() : undefined, domain },
    errorPolicy: 'all', fetchPolicy: 'cache-and-network',
  })
  const [deleteBundle, { loading: deleting }] = useMutation<{ deleteCasinoGameBundle: MutationResult }>(DELETE_BUNDLE_MUTATION, {
    // Reported here; the global mutation toast said it a second time (MAR-06).
    context: { skipNotification: true },
    onCompleted: (data) => {
      const result = data.deleteCasinoGameBundle
      toast({ title: result.success ? 'Success' : 'Error', tone: result.success ? 'ok' : 'error', message: result.message || (result.success ? 'Bundle deleted' : 'Failed to delete bundle') })
      if (result.success) void refetch()
    },
    onError: (error) => toast({ title: 'Error', tone: 'error', message: error.message }),
  })
  const bundles = data?.casinoGameBundles || []
  function remove(id: string) {
    void confirm({ title: 'Delete bundle?', description: 'This action cannot be undone.', confirmLabel: 'Yes', cancelLabel: 'No', tone: 'danger',
      onConfirm: async () => {
        const response = await deleteBundle({ variables: { id } })
        if (response.data?.deleteCasinoGameBundle.success === false) throw new Error(response.data.deleteCasinoGameBundle.message || 'Failed to delete bundle')
      } })
  }
  return <Page maxWidth="wide">
    <PageHeader title="Bundles" eyebrow={eyebrow} sub="Create and manage reusable bundles of games"
      actions={<Link to="/bonuses/bundles/new" className={buttonClassName({ variant: 'primary' })}>Create Bundle</Link>} />
    <div className={styles.workspace}>
      <FilterBar label="Bundle filters" activeCount={(search ? 1 : 0) + (domain !== 'casino' ? 1 : 0)}
        onClearAll={() => { setSearch(''); setDomain('casino') }}
        search={<SearchField label="Search bundles" placeholder="Search bundles..." size="sm" value={search} onChange={setSearch} />}>
        <SegmentedControl label="Bundle domain" size="sm" value={domain} onChange={setDomain} stretch="phone"
          options={[{ value: 'casino', label: 'Casino' }, { value: 'sports', label: 'Sports' }, { value: 'matka', label: 'Matka' }]} />
      </FilterBar>
      {error ? <Notice tone="error">{error.message}</Notice> : null}
      {domain === 'sports' ? <EmptyState title="Sports bundles are not available on this page" /> :
        loading ? <LoadingState label="Loading bundles" /> :
          !bundles.length ? <EmptyState title={`No ${domain} bundles found`} /> :
            bundles.map((bundle) => <Card key={bundle.id} title={
              <button type="button" className={styles.expand} aria-expanded={expanded.has(bundle.id)} aria-controls={`bundle-${bundle.id}`}
                onClick={() => setExpanded((previous) => { const next = new Set(previous); if (next.has(bundle.id)) next.delete(bundle.id); else next.add(bundle.id); return next })}>
                {expanded.has(bundle.id) ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}
                {bundle.name}
              </button>}
              sub={<span className={styles.meta}><StatusPill>{bundle.domain.toUpperCase()}</StatusPill><span>{bundle.gameCount || 0} {domain === 'matka' ? 'markets' : 'games'}</span></span>}
              tools={<div className={styles.actions}><Link to={`/bonuses/bundles/${bundle.id}/edit`} className={buttonClassName({ size: 'sm' })} aria-label={`Edit ${bundle.name}`}>Edit</Link>
                <Button size="sm" aria-label={`Delete ${bundle.name}`} aria-disabled={deleting} onClick={() => remove(bundle.id)}>Delete</Button></div>}>
              <div id={`bundle-${bundle.id}`} hidden={!expanded.has(bundle.id)} className={styles.detail}>
                {bundle.description ? <p className={styles.description}>{bundle.description}</p> : null}
                <div className={styles.meta}><span>Created: {bundle.createdAt ? formatDate(bundle.createdAt, 'dd MMM yyyy') : '—'}</span>
                  <span>Updated: {bundle.updatedAt ? formatDate(bundle.updatedAt, 'dd MMM yyyy') : '—'}</span></div>
                <BundleGamesList gameIds={bundle.gameIds} domain={bundle.domain} isExpanded={expanded.has(bundle.id)}
                  bundleId={bundle.id} gameWeights={bundle.gameWeights} onWeightsUpdate={() => { void refetch() }} />
              </div>
            </Card>)}
    </div>
  </Page>
}
