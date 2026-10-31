import type { MatkaExposureBook as ExposureBookData, MatkaExposureMarket, MatkaExposureSelection } from '../../liveUiModel'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable'
import { Button } from '@/ui/components/Button'
import { FilterBar } from '@/ui/components/FilterBar'
import { TextField } from '@/ui/components/TextField'
import { Select } from '@/ui/components/Select'
import { Tooltip } from '@/ui/components/Tooltip'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
import styles from '../../MatkaLiveUi.module.css'
import { useMemo, useState } from 'react'
import { useSubscription } from '@apollo/client'
import { SUB_MATKA_EXPOSURE_BOOK } from '@/lib/graphql/matkaLive'
import { useCurrentWhitelabel } from '@/shared/core/useWhitelabels'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useMatkaLiveStore } from '@/state/matkaLiveStore'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

export const ExposureBook: React.FC = () => {
  const { whitelabel } = useCurrentWhitelabel()
  // Use whitelabel ID for both tenant and whitelabelId to ensure consistent filtering
  const scope = useMemo(() => ({ tenant: whitelabel?.id || 'default', whitelabelId: whitelabel?.id || 'default' }), [whitelabel?.id])
  const { data } = useSubscription<{ matkaExposureBook: ExposureBookData }>(SUB_MATKA_EXPOSURE_BOOK, { variables: { scope }, shouldResubscribe: true })
  const book = data?.matkaExposureBook
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatTime } = useFormatDate()
  const permissions = useAuthStore(s => s.permissions)
  const canViewFinance = hasPermissionWithNested(permissions, 'settlements.center', 'view')
  const fmt = (v: number) => (canViewFinance ? formatAmount(convertFromWhitelabelCurrency(v)) : '••••')

  const [marketFilter, setMarketFilter] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState<string>('')
  const watchlist = useMatkaLiveStore(s => s.watchlist)
  const addWatch = useMatkaLiveStore(s => s.addWatch)
  const removeWatch = useMatkaLiveStore(s => s.removeWatch)

  const markets = useMemo(() => {
    const items = book?.markets || []
    let res = items
    if (marketFilter) {
      res = res.filter((m: MatkaExposureMarket) => m.marketName === marketFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      res = res.map((m: MatkaExposureMarket) => ({
        ...m,
        selections: (m.selections || []).filter((s: MatkaExposureSelection) =>
          s.selectionKey.toLowerCase().includes(q) || (s.bidType || '').toLowerCase().includes(q)
        )
      }))
    }
    return res
  }, [book, marketFilter, search])

  const marketOptions = useMemo(() => {
    const names = new Set<string>()
    ;(book?.markets || []).forEach((m: MatkaExposureMarket) => names.add(m.marketName))
    return Array.from(names).sort().map(n => ({ label: n, value: n }))
  }, [book])

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sort, setSort] = useState<DataTableSort | null>(null)
  const sortedMarkets = useMemo(() => {
    if (!sort) return markets
    const key = sort.key as 'bets' | 'totalStake' | 'potentialPayout' | 'exposure'
    return [...markets].sort((a, b) => (a[key] - b[key]) * (sort.dir === 'asc' ? 1 : -1))
  }, [markets, sort])
  const columns: DataTableColumn<MatkaExposureMarket>[] = [
    { key: 'marketName', header: 'Market', minWidth: 170, cell: row => <div className={styles.stack}><strong>{row.marketName}</strong>{row.marketSession && <span className={styles.muted}>{row.marketSession}</span>}</div> },
    { key: 'bets', header: 'Bets', minWidth: 90, align: 'right', sort: true, cell: row => row.bets },
    { key: 'totalStake', header: 'Stake', minWidth: 140, align: 'right', sort: true, cell: row => fmt(row.totalStake) },
    { key: 'potentialPayout', header: 'Potential', minWidth: 150, align: 'right', sort: true, cell: row => fmt(row.potentialPayout) },
    { key: 'exposure', header: 'Exposure', minWidth: 140, align: 'right', sort: true, cell: row => <StatusPill tone={row.exposure >= 0 ? 'neg' : 'ok'}>{row.exposure >= 0 ? '+' : ''}{fmt(row.exposure)}</StatusPill> },
    { key: 'selections', header: 'Top Selections', minWidth: 280, cell: row => !row.selections?.length ? <span className={styles.muted}>No selections</span> : <div className={styles.stack}>{row.selections.slice(0, 5).map(selection => <div className={styles.inline} key={selection.selectionKey}>
      <Tooltip content={<div className={styles.stack}><strong>{selection.bidType} · {selection.selectionKey}</strong><span>Bets: {selection.bets}</span><span>Stake: {fmt(selection.totalStake)}</span><span>Potential: {fmt(selection.potentialPayout)}</span><span>Exposure: {fmt(selection.exposure)}</span></div>}><span tabIndex={0}><StatusPill tone={selection.exposure >= 0 ? 'neg' : 'ok'}>{selection.bidType}:{selection.selectionKey.split(':').slice(1).join(':')} · {fmt(selection.exposure)}</StatusPill></span></Tooltip>
      <Button size="xs" variant={watchlist.includes(selection.selectionKey) ? 'primary' : 'secondary'} aria-label={`${watchlist.includes(selection.selectionKey) ? 'Unpin' : 'Pin'} ${selection.selectionKey}`} onClick={() => watchlist.includes(selection.selectionKey) ? removeWatch(selection.selectionKey) : addWatch(selection.selectionKey)}>{watchlist.includes(selection.selectionKey) ? 'Unpin' : 'Pin'}</Button>
    </div>)}</div> },
  ]
  return <Card title="Exposure Book" sub="Open bets exposure by market/selection" tools={<span className={styles.muted}>{book?.at ? `Updated ${formatTime(book.at, 'HH:mm:ss')}` : ''}</span>}>
    <div className={styles.stack}><FilterBar label="Exposure book filters" activeCount={[marketFilter, search].filter(Boolean).length} onClearAll={() => { setMarketFilter(undefined); setSearch(''); setPage(1) }} search={<TextField label="Search exposure selections" hideLabel size="sm" value={search} onChange={value => { setSearch(value); setPage(1) }} clearable placeholder="Search selection (e.g., 123, single)" />}>
      <Select label="Exposure market" size="sm" value={marketFilter || ''} onChange={value => { setMarketFilter(value || undefined); setPage(1) }} options={[{ label: 'All markets', value: '' }, ...marketOptions]} />
    </FilterBar>
    {watchlist.length > 0 && <section className={styles.stack} aria-label="Watchlist"><h3 className={styles.heading}>Watchlist</h3><div className={styles.inline}>{watchlist.map(key => {
      const selection = (book?.markets || []).flatMap(market => market.selections || []).find(selection => selection.selectionKey === key)
      return <StatusPill key={key} tone={selection && selection.exposure >= 0 ? 'neg' : 'ok'}>{key}{selection ? ` · ${formatAmount(convertFromWhitelabelCurrency(selection.exposure))}` : ''}</StatusPill>
    })}</div></section>}
    {!book || !book.markets.length ? <EmptyState title="No exposure data" /> : <DataTable columns={columns} rows={sortedMarkets.slice((page - 1) * pageSize, page * pageSize)} rowKey={row => `${row.marketName}:${row.marketSession || ''}`} label="Matka exposure book" width="wide" sort={sort} onSortChange={next => { setSort(next); setPage(1) }} pagination={{ current: page, pageSize, total: sortedMarkets.length, pageSizeOptions: [10, 20, 50, 100], onChange: setPage, onPageSizeChange: size => { setPage(1); setPageSize(size) } }} />}
    </div>
  </Card>
}

