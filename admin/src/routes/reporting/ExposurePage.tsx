import { useMemo, useState } from 'react'
import { gql, useQuery } from '@apollo/client'
import {
  IconActivity,
  IconChartLine,
  IconCurrencyRupee,
  IconRefresh,
  IconTrendingUp,
} from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useAuthStore } from '@/shared/core/authStore'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable'
import { DateRangeField } from '@/ui/components/DateRangeField'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { Grid } from '@/ui/components/LayoutPrimitives'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { SearchField } from '@/ui/components/SearchField'
import { SegmentedControl, type SegmentedOption } from '@/ui/components/SegmentedControl'
import { Stat } from '@/ui/components/Stat'
import { StatusPill, type StatusPillTone } from '@/ui/components/StatusPill'
import { strokeFor } from '@/ui/components/icons'
import {
  EXPOSURE_DATE_PRESETS,
  PAGE_SIZE_OPTIONS,
  calculateExposureMetrics,
  calculateTotalExposure,
  exposureDomainRows,
  exposureKpiSkips,
  exposureRangeDays,
  filterExposureRows,
  formatExposureChange,
  formatExposureSearchDate,
  getExposureDateRange,
  paginateExposureRows,
  sortExposurePage,
  visibleExposureDomains,
  type ExposureDataPoint,
  type ExposureDatePreset,
  type ExposureDomain,
} from './exposurePageModel'
import styles from './ExposurePage.module.css'

const EXPOSURE_QUERY = gql`
  query Exposure($range: String, $dateFrom: String, $dateTo: String) {
    exposure(range: $range, dateFrom: $dateFrom, dateTo: $dateTo) {
      dimension
      value
      date
    }
  }
`

const SPORTS_KPIS_QUERY = gql`
  query SportsKPIs($filter: SportsReportingFilter) {
    sportsKPIs(filter: $filter) {
      totalExposure
      totalStakes
      totalPayouts
      grossGamingRevenue
    }
  }
`

const MATKA_KPIS_QUERY = gql`
  query MatkaKPIs($filter: MatkaReportingFilter) {
    matkaKPIs(filter: $filter) {
      totalExposure
      totalStakes
      totalPayouts
      grossGamingRevenue
    }
  }
`

interface ExposureTableRow extends ExposureDataPoint {
  rowKey: string
}

const DOMAIN_LABELS: Record<ExposureDomain, string> = {
  all: 'All Domains',
  sports: 'Sports',
  matka: 'Matka',
}

function domainTone(dimension: string): StatusPillTone {
  const normalised = dimension.toLocaleLowerCase('en-US')
  if (normalised === 'all') return 'info'
  if (normalised === 'sports') return 'ok'
  if (normalised === 'matka') return 'warn'
  return 'neutral'
}

export default function ExposurePage() {
  return (
    <RBACGuard required={[{ domain: 'reporting.exposure', actions: ['view'] }]} bypassForAgents>
      <ExposurePageContent />
    </RBACGuard>
  )
}

function ExposurePageContent() {
  const initialRange = useMemo(() => getExposureDateRange('allTime'), [])
  const customSeed = useMemo(() => getExposureDateRange('custom'), [])
  const [dateFrom, setDateFrom] = useState(initialRange.dateFrom)
  const [dateTo, setDateTo] = useState(initialRange.dateTo)
  const [datePreset, setDatePreset] = useState<ExposureDatePreset>('allTime')
  const [selectedDomain, setSelectedDomain] = useState<ExposureDomain>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [sort, setSort] = useState<DataTableSort | null>(null)

  const pageEyebrow = usePageEyebrow()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const agent = useAuthStore((state) => state.agent)
  const isAgent = useAuthStore((state) => state.isAgent())
  const rangeDays = exposureRangeDays(dateFrom, dateTo)

  const {
    data: exposureData,
    loading: exposureLoading,
    error: exposureError,
    refetch: refetchExposure,
  } = useQuery(EXPOSURE_QUERY, {
    variables: {
      range: rangeDays,
      dateFrom,
      dateTo,
    },
    errorPolicy: 'all',
    skip: false,
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
  })

  // An agent asks only for the totals of its allowed domains: the API refuses the others (SCO-07).
  const { sportsSkipped, matkaSkipped } = exposureKpiSkips(selectedDomain, isAgent, agent?.allowedDomains)
  const {
    data: sportsKPIs,
    loading: sportsLoading,
    error: sportsError,
  } = useQuery(SPORTS_KPIS_QUERY, {
    variables: {
      filter: {
        dateFrom,
        dateTo,
        domain: selectedDomain === 'all' || selectedDomain === 'sports' ? undefined : null,
      },
    },
    skip: sportsSkipped,
    errorPolicy: 'all',
    fetchPolicy: 'network-only',
  })

  const {
    data: matkaKPIs,
    loading: matkaLoading,
    error: matkaError,
  } = useQuery(MATKA_KPIS_QUERY, {
    variables: {
      filter: {
        dateFrom,
        dateTo,
      },
    },
    skip: matkaSkipped,
    errorPolicy: 'all',
    fetchPolicy: 'network-only',
  })

  const exposureRows = useMemo<ExposureDataPoint[]>(
    () => exposureData?.exposure ?? [],
    [exposureData?.exposure],
  )
  const filteredExposureRows = useMemo(
    () => filterExposureRows(exposureRows, {
      domain: selectedDomain,
      search: searchQuery,
      formatDate: formatExposureSearchDate,
      formatAmount,
      convertAmount: convertFromWhitelabelCurrency,
    }),
    [
      convertFromWhitelabelCurrency,
      exposureRows,
      formatAmount,
      searchQuery,
      selectedDomain,
    ],
  )
  const paginatedExposureRows = useMemo(
    () => paginateExposureRows(filteredExposureRows, currentPage, pageSize),
    [currentPage, filteredExposureRows, pageSize],
  )
  const sortedExposureRows = useMemo(
    () => sortExposurePage(
      paginatedExposureRows,
      sort && (sort.key === 'date' || sort.key === 'value')
        ? { key: sort.key, dir: sort.dir }
        : null,
    ),
    [paginatedExposureRows, sort],
  )
  const tableRows = useMemo<ExposureTableRow[]>(
    () => sortedExposureRows.map((row, index) => ({
      ...row,
      rowKey: `${row.date}-${row.dimension}-${index}`,
    })),
    [sortedExposureRows],
  )

  // The cards describe the domain tab, as the table and the Total card do (F-REP-17).
  const domainRows = useMemo(() => exposureDomainRows(exposureRows, selectedDomain), [exposureRows, selectedDomain])
  const metrics = useMemo(() => calculateExposureMetrics(domainRows), [domainRows])
  const totalExposure = useMemo(
    () => calculateTotalExposure(
      selectedDomain,
      sportsKPIs?.sportsKPIs?.totalExposure ?? 0,
      matkaKPIs?.matkaKPIs?.totalExposure ?? 0,
      convertFromWhitelabelCurrency,
    ),
    [convertFromWhitelabelCurrency, matkaKPIs, selectedDomain, sportsKPIs],
  )

  const availableDomains = useMemo(
    () => visibleExposureDomains(
      isAgent,
      agent?.allowedDomains ?? ['sports', 'casino', 'matka'],
    ),
    [agent?.allowedDomains, isAgent],
  )
  const domainOptions = useMemo<SegmentedOption<ExposureDomain>[]>(
    () => availableDomains.map((domain) => ({ value: domain, label: DOMAIN_LABELS[domain] })),
    [availableDomains],
  )

  const columns = useMemo<DataTableColumn<ExposureTableRow>[]>(() => [
    {
      key: 'date',
      header: 'Date',
      minWidth: 190,
      sort: true,
      cell: (row) => (
        <time className={styles.dateCell} dateTime={row.date}>
          {formatDateTime(row.date, 'yyyy-MM-dd HH:mm')}
        </time>
      ),
    },
    {
      key: 'dimension',
      header: 'Domain',
      minWidth: 180,
      cell: (row) => (
        <span className={styles.dimensionCell} title={row.dimension}>
          <StatusPill tone={domainTone(row.dimension)}>{row.dimension}</StatusPill>
        </span>
      ),
    },
    {
      key: 'value',
      header: 'Exposure',
      align: 'right',
      minWidth: 190,
      sort: true,
      cell: (row) => (
        <span className={styles.amountCell}>
          {formatAmount(convertFromWhitelabelCurrency(row.value))}
        </span>
      ),
    },
  ], [convertFromWhitelabelCurrency, formatAmount, formatDateTime])

  const isLoading = exposureLoading || sportsLoading || matkaLoading
  const activeFiltersCount = [
    searchQuery,
    selectedDomain !== 'all',
    datePreset !== 'allTime',
  ].filter(Boolean).length
  const kpiErrors = [
    sportsSkipped ? null : sportsError,
    matkaSkipped ? null : matkaError,
  ].filter(Boolean)

  const applyDatePreset = (preset: ExposureDatePreset) => {
    const range = getExposureDateRange(preset)
    setDateFrom(range.dateFrom)
    setDateTo(range.dateTo)
    setDatePreset(preset)
    setCurrentPage(1)
  }

  const clearFilters = () => {
    const range = getExposureDateRange('allTime')
    setSearchQuery('')
    setSelectedDomain('all')
    setDateFrom(range.dateFrom)
    setDateTo(range.dateTo)
    setDatePreset('allTime')
    setCurrentPage(1)
  }

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Exposure Report"
        sub="Analyze risk exposure and liability across all domains"
        actions={(
          <Button
            icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
            onClick={() => void refetchExposure()}
          >
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        <Grid cols={{ base: 1, md: 2 }} gap={16} aria-label="Exposure statistics">
          <Stat
            label="Total Exposure"
            value={formatAmount(totalExposure)}
            note={`Change: ${formatExposureChange(metrics.exposureChange)}`}
            icon={<IconChartLine size={18} stroke={strokeFor(18)} />}
            hue="blu"
          />
          <Stat
            label="Avg Exposure"
            value={formatAmount(convertFromWhitelabelCurrency(metrics.avgExposure))}
            note={`${domainRows.length} records`}
            icon={<IconCurrencyRupee size={18} stroke={strokeFor(18)} />}
            hue="grn"
          />
          <Stat
            label="Peak Exposure"
            value={formatAmount(convertFromWhitelabelCurrency(metrics.maxExposure))}
            note={`Min: ${formatAmount(convertFromWhitelabelCurrency(metrics.minExposure))}`}
            icon={<IconTrendingUp size={18} stroke={strokeFor(18)} />}
            hue="vio"
          />
          <Stat
            label="Records"
            value={domainRows.length.toLocaleString()}
            note={`${paginatedExposureRows.length} showing`}
            icon={<IconActivity size={18} stroke={strokeFor(18)} />}
            hue="red"
          />
        </Grid>

        {kpiErrors.length > 0 ? (
          <Notice tone="warn" title="Some totals could not be loaded">
            Available exposure rows and totals are still shown. Try changing the domain or date range.
          </Notice>
        ) : null}

        <FilterBar
          activeCount={activeFiltersCount}
          onClearAll={clearFilters}
          label="Exposure filters"
          search={(
            <SearchField
              label="Search exposure"
              placeholder="Search by domain, date, amount..."
              size="sm"
              value={searchQuery}
              onChange={(value) => {
                setSearchQuery(value)
                setCurrentPage(1)
              }}
            />
          )}
        >
          <DateRangeField
            label="Period"
            presets={EXPOSURE_DATE_PRESETS}
            appliedPreset={datePreset}
            appliedFrom={datePreset === 'custom' ? dateFrom : customSeed.dateFrom}
            appliedTo={datePreset === 'custom' ? dateTo : customSeed.dateTo}
            customValue="custom"
            onApply={(payload) => {
              if (payload.kind === 'custom') {
                setDateFrom(payload.from)
                setDateTo(payload.to)
                setDatePreset('custom')
                setCurrentPage(1)
                return
              }
              applyDatePreset(payload.preset as ExposureDatePreset)
            }}
            onReset={() => applyDatePreset('allTime')}
          />
        </FilterBar>

        <div className={styles.domainScroller}>
          <SegmentedControl
            className={styles.domainControl}
            label="Domain filter"
            value={selectedDomain}
            options={domainOptions}
            size="sm"
            onChange={(domain) => {
              setSelectedDomain(domain)
              setCurrentPage(1)
            }}
          />
        </div>

        <Card
          className={styles.tableCard}
          title="Exposure Data"
          sub={`${filteredExposureRows.length} ${filteredExposureRows.length === 1 ? 'record' : 'records'}`}
          body="table"
        >
          <DataTable
            label="Exposure data"
            rows={tableRows}
            rowKey={(row) => row.rowKey}
            columns={columns}
            width="default"
            state={exposureError ? 'error' : isLoading ? 'loading' : 'ready'}
            error={exposureError?.message ?? 'Unable to load exposure data.'}
            onRetry={() => void refetchExposure()}
            empty={(
              <EmptyState
                inset="none"
                title="No exposure data"
                description="No records match the current domain, period and search filters."
              />
            )}
            sort={sort}
            onSortChange={setSort}
            pagination={{
              current: currentPage,
              pageSize,
              total: filteredExposureRows.length,
              onChange: setCurrentPage,
              onPageSizeChange: setPageSize,
              itemName: 'records',
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              formatSummary: ({ total }) => `Total ${total} records`,
              variant: 'embedded',
            }}
          />
        </Card>
      </div>
    </Page>
  )
}
