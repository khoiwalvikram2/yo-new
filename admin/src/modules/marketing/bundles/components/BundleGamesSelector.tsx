import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@apollo/client'
import { IconDeviceGamepad2, IconPhotoOff } from '@tabler/icons-react'
import { CASINO_SELECTION_GAMES, CASINO_VENDORS, CASINO_API_PROVIDERS } from '@/lib/graphql/casino'
import { MATKA_CATALOG_QUERY as MATKAS_QUERY } from '@/lib/graphql/matka'
import { Button } from '@/ui/components/Button'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { strokeFor } from '@/ui/components/icons'
import { Notice } from '@/ui/components/Notice'
import { SearchField } from '@/ui/components/SearchField'
import { Select } from '@/ui/components/Select'
import { StatusPill } from '@/ui/components/StatusPill'
import type { BundleDomain } from '../bundleCreateEditModel'
import {
  SELECTOR_PAGE_SIZE,
  activeSelectorFilterCount,
  filteredMatkas,
  matkaVariables,
  type CasinoGameRow,
  type MatkaRow,
} from './bundleGamesSelectorModel'
import styles from './BundleGamesSelector.module.css'

interface BundleGamesSelectorProps {
  domain: BundleDomain
  selectedGameIds: string[]
  onSelectionChange: (gameIds: string[]) => void
}

interface CasinoGamesData {
  casinoSelectionGames?: {
    total?: number | null
    items?: CasinoGameRow[] | null
  } | null
}

interface ProvidersData {
  casinoApiProviders?: Array<{ id: string | number; name?: string | null }> | null
}

interface VendorsData {
  casinoVendors?: Array<{ id: string | number; name?: string | null }> | null
}

interface MatkasData {
  matkas?: { items?: MatkaRow[] | null; total?: number | null } | null
}

import { useSearch } from '@/shared/hooks/useSearch'

const gameColumns: readonly DataTableColumn<CasinoGameRow>[] = [
  {
    key: 'game',
    header: 'Game',
    minWidth: 260,
    emphasis: 'key',
    cell: (game) => (
      <span className={styles.gameCell}>
        {game.thumbnailUrl ? (
          <img className={styles.thumbnail} src={game.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <span className={styles.thumbnailFallback} aria-hidden="true">
            <IconPhotoOff size={18} stroke={strokeFor(18)} />
          </span>
        )}
        <span className={styles.gameCopy}>
          <strong>{game.name || 'Unnamed game'}</strong>
          <span>{game.vendorName || 'Unknown vendor'}</span>
        </span>
      </span>
    ),
  },
  {
    key: 'provider',
    header: 'Provider',
    minWidth: 150,
    cell: (game) => game.vendorName || '—',
  },
  {
    key: 'category',
    header: 'Category',
    minWidth: 130,
    cell: (game) => <StatusPill>{game.mainCategory || 'Uncategorised'}</StatusPill>,
  },
]

const matkaColumns: readonly DataTableColumn<MatkaRow>[] = [
  {
    key: 'market',
    header: 'Market',
    minWidth: 220,
    emphasis: 'key',
    cell: (market) => (
      <span className={styles.marketCell}>
        <strong>{market.name || 'Unnamed market'}</strong>
        <span>{market.code || 'No code'}</span>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    minWidth: 110,
    cell: (market) => (
      <StatusPill status={market.status || ''}>{market.status || 'Unknown'}</StatusPill>
    ),
  },
  {
    key: 'timezone',
    header: 'Timezone',
    minWidth: 150,
    cell: (market) => market.timezone || '—',
  },
]

export function BundleGamesSelector({
  domain,
  selectedGameIds,
  onSelectionChange,
}: BundleGamesSelectorProps) {
  const { query: search, setQuery: setSearch, debouncedQuery } = useSearch()
  const [providerId, setProviderId] = useState('')
  const [vendorId, setVendorId] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(SELECTOR_PAGE_SIZE)

  const filters = useMemo(() => ({ search, providerId, vendorId }), [providerId, search, vendorId])

  useEffect(() => {
    setCurrentPage(1)
  }, [search, providerId, vendorId])

  const games = useQuery<CasinoGamesData>(CASINO_SELECTION_GAMES, {
    variables: { input: { providerId: providerId || undefined, vendorId: vendorId || undefined, search: debouncedQuery || undefined, page: currentPage, pageSize } },
    skip: domain !== 'casino', errorPolicy: 'all', notifyOnNetworkStatusChange: true,
  })
  const providersQuery = useQuery<ProvidersData>(CASINO_API_PROVIDERS, {
    skip: domain !== 'casino',
    errorPolicy: 'all',
  })
  const vendorsQuery = useQuery<VendorsData>(CASINO_VENDORS, {
    variables: providerId ? { providerId } : undefined,
    skip: domain !== 'casino',
    errorPolicy: 'all',
  })
  const matkas = useQuery<MatkasData>(MATKAS_QUERY, {
    variables: matkaVariables(search),
    skip: domain !== 'matka',
    errorPolicy: 'all',
  })

  const casinoPage = { rows: games.data?.casinoSelectionGames?.items ?? [], total: games.data?.casinoSelectionGames?.total ?? 0 }
  const markets = useMemo(
    () => filteredMatkas(matkas.data?.matkas?.items ?? [], search),
    [matkas.data, search],
  )
  const selected = useMemo(() => new Set(selectedGameIds.map(String)), [selectedGameIds])

  const providerOptions = useMemo(() => [
    { value: '', label: 'All providers' },
    ...(providersQuery.data?.casinoApiProviders ?? []).map((provider) => ({
      value: String(provider.id),
      label: provider.name || 'Unnamed provider',
    })),
  ], [providersQuery.data])
  const vendorOptions = useMemo(() => [
    { value: '', label: 'All vendors' },
    ...(vendorsQuery.data?.casinoVendors ?? []).map((vendor) => ({
      value: String(vendor.id),
      label: vendor.name || 'Unnamed vendor',
    })),
  ], [vendorsQuery.data])

  const selection = {
    selected,
    onChange: (next: Set<string>) => onSelectionChange([...next]),
    label: (item: CasinoGameRow | MatkaRow) => item.name || String(item.id),
  }

  if (domain === 'sports') {
    return (
      <Notice
        tone="info"
        icon={<IconDeviceGamepad2 size={18} stroke={strokeFor(18)} />}
        title="Sports games selection coming soon"
      >
        Sports bundles cannot be saved until selectable sports markets are available.
      </Notice>
    )
  }

  const activeCount = activeSelectorFilterCount(domain, filters)
  const clearFilters = () => {
    setSearch('')
    setProviderId('')
    setVendorId('')
  }
  // "Clear selection" empties the picked rows, not the filters, so it rides with the count in the summary,
  // which stays in the bar when the filters fold into the popover.
  const selectorSummary = (
    <div className={styles.selectionSummary}>
      <span role="status" aria-live="polite">
        <strong>{selectedGameIds.length.toLocaleString()}</strong> selected
      </span>
      {selectedGameIds.length > 0 ? (
        <Button variant="link" size="sm" onClick={() => onSelectionChange([])}>
          Clear selection
        </Button>
      ) : null}
    </div>
  )

  if (domain === 'casino') {
    const loading = games.loading
    const error = games.error
    return (
      <div className={styles.selector}>
        <FilterBar
          activeCount={activeCount}
          onClearAll={clearFilters}
          label="Game filters"
          search={(
            <SearchField
              label="Search games"
              placeholder="Search games..."
              value={search}
              onChange={setSearch}
              size="sm"
            />
          )}
          summary={selectorSummary}
        >
          <Select
            className={styles.filterSelect}
            label="Provider"
            hideLabel
            size="sm"
            value={providerId}
            options={providerOptions}
            onChange={(value) => {
              setProviderId(value)
              setVendorId('')
            }}
          />
          <Select
            className={styles.filterSelect}
            label="Vendor"
            hideLabel
            size="sm"
            value={vendorId}
            options={vendorOptions}
            onChange={setVendorId}
            disabled={!providerId}
          />
        </FilterBar>
        <DataTable
          label="Casino games"
          rows={casinoPage.rows}
          rowKey={(game) => String(game.id)}
          columns={gameColumns}
          selection={selection}
          state={loading ? 'loading' : error ? 'error' : 'ready'}
          error={error?.message || 'Unable to load games.'}
          onRetry={() => void games.refetch()}
          empty={<EmptyState title="No games found" />}
          density="compact"
          width="wide"
          pagination={{
            current: currentPage,
            pageSize,
            total: casinoPage.total,
            onChange: setCurrentPage,
            onPageSizeChange: (size) => {
              setPageSize(size)
              setCurrentPage(1)
            },
            itemName: 'games',
            pageSizeOptions: [25, 50, 100],
            variant: 'embedded',
          }}
        />
      </div>
    )
  }

  return (
    <div className={styles.selector}>
      <FilterBar
        activeCount={activeCount}
        onClearAll={clearFilters}
        label="Market filters"
        search={(
          <SearchField
            label="Search markets"
            placeholder="Search markets..."
            value={search}
            onChange={setSearch}
            size="sm"
          />
        )}
        summary={selectorSummary}
      />
      <DataTable
        label="Matka markets"
        rows={markets}
        rowKey={(market) => String(market.id)}
        columns={matkaColumns}
        selection={selection}
        state={matkas.loading ? 'loading' : matkas.error ? 'error' : 'ready'}
        error={matkas.error?.message || 'Unable to load Matka markets.'}
        onRetry={() => void matkas.refetch()}
        empty={<EmptyState title="No Matka markets found" />}
        density="compact"
        width="wide"
        pagination={false}
      />
    </div>
  )
}

