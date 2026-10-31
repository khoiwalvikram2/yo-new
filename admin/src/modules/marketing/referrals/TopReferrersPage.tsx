import { useState } from 'react'
import { useQuery, gql } from '@apollo/client'
import { Link } from 'react-router-dom'
import {
  IconAlertCircle,
  IconCash,
  IconInbox,
  IconInfoCircle,
  IconRefresh,
  IconTrophy,
  IconUsers,
  IconX,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable'
import { DateRangeField } from '@/ui/components/DateRangeField'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Select } from '@/ui/components/Select'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import {
  DEFAULT_LIMIT,
  DEFAULT_SORT_BY,
  LIMIT_OPTIONS,
  SORT_BY_OPTIONS,
  TOP_REFERRERS_DATE_PRESETS,
  TOP_REFERRERS_PAGE_SIZE,
  TOP_REFERRERS_PAGE_SIZES,
  clampPage,
  conversionLevel,
  conversionText,
  countText,
  isTopReferrersSortBy,
  normalizeTopReferrersRange,
  pageOf,
  parseLimit,
  rankMedal,
  rankReferrers,
  referrerNameText,
  referrerPhoneText,
  referrerStatsPath,
  sortReferrers,
  topReferrerRowKey,
  topReferrerTotals,
  topReferrersDatePreset,
  topReferrersEmptyText,
  topReferrersFilterCount,
  topReferrersVariables,
  type RankedReferrer,
  type TopReferrerRow,
  type TopReferrersDateRange,
  type TopReferrersSortBy,
} from './topReferrersModel'
import styles from './TopReferrersPage.module.css'

const REFERRALS_PATH = '/referrals'

const MEDAL_CLASS = {
  gold: styles.gold,
  silver: styles.silver,
  bronze: styles.bronze,
} as const

const RATE_CLASS = {
  high: styles.rateHigh,
  mid: styles.rateMid,
  plain: undefined,
} as const

const TOP_REFERRERS_QUERY = gql`
  query TopReferrers($limit: Int, $sortBy: String, $fromDate: String, $toDate: String) {
    topReferrers(limit: $limit, sortBy: $sortBy, fromDate: $fromDate, toDate: $toDate) {
      referrerId
      referrerName
      referrerPhone
      totalEarnings
      totalReferrals
      activeReferrals
      totalTransactions
      totalClicks
      conversionRate
    }
  }
`

export default function TopReferrersPage() {
  return (
    <RBACGuard required={[{ domain: 'referrals.top-referrers', actions: ['view'] }]}>
      <TopReferrersPageContent />
    </RBACGuard>
  )
}

function TopReferrersPageContent() {
  const pageEyebrow = usePageEyebrow()
  const { formatAmount } = useCurrency()
  const [sortBy, setSortBy] = useState<TopReferrersSortBy>(DEFAULT_SORT_BY)
  const [limit, setLimit] = useState(DEFAULT_LIMIT)
  const [dateRange, setDateRange] = useState<TopReferrersDateRange | null>(null)
  const [sort, setSort] = useState<DataTableSort | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(TOP_REFERRERS_PAGE_SIZE)
  // The legacy error alert was closable; a new error (a new object) shows again.
  const [dismissedError, setDismissedError] = useState<unknown>(null)
  const variables = topReferrersVariables(limit, sortBy, dateRange)

  const { data, loading, refetch, error: queryError } = useQuery(TOP_REFERRERS_QUERY, {
    variables: {
      limit,
      sortBy,
      fromDate: variables.fromDate,
      toDate: variables.toDate,
    },
    errorPolicy: 'all',
  })

  const topReferrers: TopReferrerRow[] = data?.topReferrers || []
  const filterCount = topReferrersFilterCount(sortBy, limit, dateRange)
  const hasFilters = filterCount > 0
  const appliedRange = normalizeTopReferrersRange(dateRange)

  // A new filter re-mounted the legacy table (it showed the spinner while the new list loaded), which put
  // it back on page 1 with no column sort; the kit table stays mounted, so the reset is explicit.
  const resetTable = () => {
    setPage(1)
    setSort(null)
  }

  const handleSortByChange = (value: string) => {
    if (!isTopReferrersSortBy(value)) return
    setSortBy(value)
    resetTable()
  }

  const handleLimitChange = (value: string) => {
    setLimit(parseLimit(value))
    resetTable()
  }

  const handleDateChange = (payload: DateRangeApply) => {
    setDateRange(payload.kind === 'custom' ? { from: payload.from, to: payload.to } : null)
    resetTable()
  }

  const handleClear = () => {
    setSortBy(DEFAULT_SORT_BY)
    setLimit(DEFAULT_LIMIT)
    setDateRange(null)
    resetTable()
  }

  const ranked = rankReferrers(topReferrers)
  const sorted = sortReferrers(ranked, sort)
  const currentPage = clampPage(page, sorted.length, pageSize)
  const pageRows = pageOf(sorted, currentPage, pageSize)
  const totals = topReferrerTotals(topReferrers)
  const showError = Boolean(queryError) && queryError !== dismissedError

  const columns: DataTableColumn<RankedReferrer>[] = [
    {
      key: 'rank',
      header: 'Rank',
      align: 'right',
      emphasis: 'key',
      cell: (row) => {
        const medal = rankMedal(row.rank)
        return (
          <span className={styles.rank}>
            {medal ? (
              <IconTrophy
                size={14}
                stroke={strokeFor(14)}
                aria-hidden="true"
                className={clsx(styles.trophy, MEDAL_CLASS[medal])}
              />
            ) : null}
            <span>#{row.rank}</span>
          </span>
        )
      },
    },
    {
      key: 'referrer',
      header: 'Referrer',
      sort: true,
      cell: (row) => (
        <span className={styles.referrer}>
          <span className={styles.referrerName}>{referrerNameText(row.referrerName)}</span>
          <span className={styles.secondary}>{referrerPhoneText(row.referrerPhone)}</span>
          <Link className={styles.statsLink} to={referrerStatsPath(row.referrerId)}>
            ID: {row.referrerId} · View stats
          </Link>
        </span>
      ),
    },
    {
      key: 'totalReferrals',
      header: 'Total Referrals',
      align: 'right',
      emphasis: 'key',
      sort: true,
      cell: (row) => row.totalReferrals,
    },
    {
      key: 'activeReferrals',
      header: 'Active Referrals',
      align: 'right',
      cell: (row) => (
        <span className={styles.active}>
          <StatusPill tone="ok">{row.activeReferrals}</StatusPill>
          <span className={styles.secondary}>/ {row.totalReferrals}</span>
        </span>
      ),
    },
    {
      key: 'totalEarnings',
      header: 'Total Earnings',
      align: 'right',
      emphasis: 'key',
      sort: true,
      cell: (row) => formatAmount(Number(row.totalEarnings) || 0, 'INR'),
    },
    {
      key: 'totalClicks',
      header: 'Clicks',
      align: 'right',
      cell: (row) => countText(row.totalClicks),
    },
    {
      key: 'conversionRate',
      header: 'Conversion %',
      align: 'right',
      sort: true,
      cell: (row) => (
        <span className={styles.rate}>
          <span className={RATE_CLASS[conversionLevel(row.conversionRate)]}>{conversionText(row.conversionRate)}</span>
          {/* The legacy hover hint; the glyph is decorative and the figure is the value. */}
          <Tooltip content="Signups / Clicks × 100">
            <span className={styles.rateHint} aria-hidden="true">
              <IconInfoCircle size={13} stroke={strokeFor(13)} />
            </span>
          </Tooltip>
        </span>
      ),
    },
    {
      key: 'totalTransactions',
      header: 'Transactions',
      align: 'right',
      cell: (row) => countText(row.totalTransactions),
    },
  ]

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Top Referrers"
        sub="Track top performing referrers and their statistics"
        back={{ to: REFERRALS_PATH, label: 'Back to Referrals' }}
        actions={(
          <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={() => refetch()}>
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        {/* The legacy order: filters, the error, the totals, then the table. */}
        <FilterBar label="Filters" activeCount={filterCount} onClearAll={handleClear}>
          <Select
            label="Sort By"
            hideLabel
            size="sm"
            value={sortBy}
            options={SORT_BY_OPTIONS}
            onChange={handleSortByChange}
          />
          <Select
            label="Limit"
            hideLabel
            size="sm"
            value={String(limit)}
            options={LIMIT_OPTIONS}
            onChange={handleLimitChange}
          />
          <DateRangeField
            label="Date range"
            presets={TOP_REFERRERS_DATE_PRESETS}
            appliedPreset={topReferrersDatePreset(appliedRange)}
            appliedFrom={appliedRange.from}
            appliedTo={appliedRange.to}
            onApply={handleDateChange}
            onReset={() => handleDateChange({ kind: 'preset', preset: 'all' })}
          />
        </FilterBar>

        {showError && queryError ? (
          <Notice
            tone="error"
            live="polite"
            icon={<IconAlertCircle size={18} stroke={strokeFor(18)} />}
            title="Could not load top referrers"
            action={(
              <IconButton
                size="sm"
                label="Close"
                icon={<IconX size={15} stroke={strokeFor(15)} />}
                onClick={() => setDismissedError(queryError)}
              />
            )}
          >
            {queryError.message}
          </Notice>
        ) : null}

        {/* The legacy summary cards: shown only while there are referrers. Hues green, blue, violet. */}
        {topReferrers.length > 0 ? (
          <div className={styles.statsRegion}>
            <div className={styles.stats} role="group" aria-label="Top referrer totals">
              <Stat
                label="Total Earnings"
                value={formatAmount(totals.earnings, 'INR')}
                icon={<IconCash size={18} stroke={strokeFor(18)} />}
                hue="grn"
              />
              <Stat
                label="Total Referrals"
                value={totals.referrals}
                icon={<IconUsers size={18} stroke={strokeFor(18)} />}
                hue="blu"
              />
              <Stat
                label="Referrers"
                value={totals.referrers}
                icon={<IconTrophy size={18} stroke={strokeFor(18)} />}
                hue="vio"
              />
            </div>
          </div>
        ) : null}

        <Card
          title={`Top Referrers (${topReferrers.length})`}
          body="table"
          tools={topReferrers.length > 0 ? (
            <span className={styles.total}>Total earnings: {formatAmount(totals.earnings, 'INR')}</span>
          ) : null}
        >
          <DataTable
            label="top referrers"
            columns={columns}
            rows={pageRows}
            rowKey={topReferrerRowKey}
            width="wide"
            state={loading ? 'loading' : 'ready'}
            sort={sort}
            onSortChange={setSort}
            empty={(
              <EmptyState
                title={topReferrersEmptyText(hasFilters)}
                icon={<IconInbox size={20} stroke={strokeFor(20)} />}
              />
            )}
            pagination={topReferrers.length > 0 ? {
              current: currentPage,
              pageSize,
              total: sorted.length,
              onChange: setPage,
              onPageSizeChange: (size) => {
                setPageSize(size)
                setPage(1)
              },
              itemName: 'referrers',
              pageSizeOptions: TOP_REFERRERS_PAGE_SIZES,
              formatSummary: ({ total }) => `Total ${total} referrers`,
              variant: 'embedded',
            } : false}
          />
        </Card>
      </div>
    </Page>
  )
}

