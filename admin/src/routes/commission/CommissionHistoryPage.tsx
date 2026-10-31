import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@apollo/client'
import { IconHistory, IconRefresh, IconUser } from '@tabler/icons-react'
import { useSearchParams } from 'react-router-dom'
import {
  DOWNLINE_COMMISSION_SETTLEMENT_HISTORY_QUERY,
  MY_COMMISSION_SETTLEMENT_HISTORY_QUERY,
  SUB_AGENT_COMMISSION_SUMMARIES_QUERY,
} from '@/lib/graphql/settlements'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { useAuthStore } from '@/shared/core/authStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { nowIST } from '@/shared/utils/date'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { DateRangeField } from '@/ui/components/DateRangeField'
import { EmptyState } from '@/ui/components/EmptyState'
import { FilterBar } from '@/ui/components/FilterBar'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Select } from '@/ui/components/Select'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { strokeFor } from '@/ui/components/icons'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import {
  COMMISSION_HISTORY_DATE_PRESETS,
  COMMISSION_HISTORY_DEFAULT_PAGE_SIZE,
  COMMISSION_HISTORY_PAGE_SIZES,
  COMMISSION_HISTORY_TABS,
  activeCommissionHistoryFilters,
  applyHistoryDateRange,
  historyTabFromParams,
  paidAtLabel,
  subAgentLabel,
  subAgentOptions,
  weekLabel,
  type CommissionHistoryTab,
  type CommissionPayoutItem,
} from './commissionHistoryModel'
import styles from './CommissionHistoryPage.module.css'
import { CommissionAdjustmentsSection } from './components/CommissionAdjustmentsSection'

const TAB_ID_PREFIX = 'commission-history'
const TAB_ICONS: Record<CommissionHistoryTab, ReactNode> = {
  my: <IconUser size={15} stroke={strokeFor(15)} />,
  subAgent: <IconHistory size={15} stroke={strokeFor(15)} />,
}
const TAB_ITEMS: readonly TabItem<CommissionHistoryTab>[] = COMMISSION_HISTORY_TABS.map((tab) => ({
  ...tab,
  icon: TAB_ICONS[tab.value],
}))

interface HistoryPageData {
  items?: CommissionPayoutItem[] | null
  total?: number | null
}

interface MyHistoryData {
  myCommissionSettlementHistory?: HistoryPageData | null
}

interface DownlineHistoryData {
  downlineCommissionSettlementHistory?: HistoryPageData | null
}

interface SummaryData {
  subAgentCommissionSummaries?: { agentId: string; username?: string | null }[] | null
}

function initialRange(): [string, string] {
  const now = nowIST()
  return [now.subtract(30, 'days').format('YYYY-MM-DD'), now.format('YYYY-MM-DD')]
}

export default function CommissionHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const agent = useAuthStore((state) => state.agent)
  const pageEyebrow = usePageEyebrow()
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const urlSubAgentId = searchParams.get('subAgentId') || undefined
  const [activeTab, setActiveTab] = useState<CommissionHistoryTab>(() => historyTabFromParams(searchParams.get('tab'), searchParams.get('subAgentId')))
  const [dateRange, setDateRange] = useState<[string, string]>(initialRange)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(COMMISSION_HISTORY_DEFAULT_PAGE_SIZE)
  const [subAgentFilter, setSubAgentFilter] = useState<string | undefined>(urlSubAgentId)
  const isCommission = agent?.schemeType === 'COMMISSION'

  useEffect(() => {
    setActiveTab(historyTabFromParams(searchParams.get('tab'), searchParams.get('subAgentId')))
    setSubAgentFilter(searchParams.get('subAgentId') || undefined)
  }, [searchParams])

  const [periodFrom, periodTo] = dateRange
  const commonVariables = {
    limit: pageSize,
    offset: (currentPage - 1) * pageSize,
    fromDate: periodFrom,
    toDate: periodTo,
  }

  const { data: myData, loading: myLoading, refetch: refetchMy } = useQuery<MyHistoryData>(
    MY_COMMISSION_SETTLEMENT_HISTORY_QUERY,
    {
      variables: commonVariables,
      skip: !isCommission || activeTab !== 'my',
      errorPolicy: 'all',
      fetchPolicy: 'cache-and-network',
    },
  )
  const { data: summariesData } = useQuery<SummaryData>(SUB_AGENT_COMMISSION_SUMMARIES_QUERY, {
    variables: { periodFrom, periodTo },
    skip: !isCommission || activeTab !== 'subAgent',
    fetchPolicy: 'cache-first',
  })
  const { data: downlineData, loading: downlineLoading, refetch: refetchDownline } = useQuery<DownlineHistoryData>(
    DOWNLINE_COMMISSION_SETTLEMENT_HISTORY_QUERY,
    {
      variables: { subAgentId: subAgentFilter || null, ...commonVariables },
      skip: !isCommission || activeTab !== 'subAgent',
      errorPolicy: 'all',
      fetchPolicy: 'cache-and-network',
    },
  )

  const fmt = useCallback(
    (amount: number) => formatAmount(convertFromWhitelabelCurrency(Number(amount || 0))),
    [convertFromWhitelabelCurrency, formatAmount],
  )

  const myColumns = useMemo<DataTableColumn<CommissionPayoutItem>[]>(() => [
    { key: 'week', header: 'Week (IST)', cell: (row) => weekLabel(row.periodFrom, row.periodTo) },
    { key: 'amount', header: 'Amount', align: 'right', cell: (row) => <span className={styles.amount}>{fmt(row.amount)}</span> },
    { key: 'createdAt', header: 'Paid At', cell: (row) => <time className={styles.date} dateTime={row.createdAt}>{paidAtLabel(row.createdAt)}</time> },
    { key: 'notes', header: 'Notes', emphasis: 'dim', cell: (row) => <span className={styles.notes}>{row.notes || '—'}</span> },
  ], [fmt])

  const downlineColumns = useMemo<DataTableColumn<CommissionPayoutItem>[]>(() => [
    { key: 'agent', header: 'Sub-agent', emphasis: 'key', cell: subAgentLabel },
    { key: 'week', header: 'Week (IST)', cell: (row) => weekLabel(row.periodFrom, row.periodTo) },
    { key: 'amount', header: 'Paid Amount', align: 'right', cell: (row) => <span className={styles.amount}>{fmt(row.amount)}</span> },
    { key: 'createdAt', header: 'Paid At', cell: (row) => <time className={styles.date} dateTime={row.createdAt}>{paidAtLabel(row.createdAt)}</time> },
    { key: 'notes', header: 'Notes', emphasis: 'dim', cell: (row) => <span className={styles.notes}>{row.notes || '—'}</span> },
  ], [fmt])

  const changeTab = (next: CommissionHistoryTab) => {
    setActiveTab(next)
    setCurrentPage(1)
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous)
      params.set('tab', next)
      if (next !== 'subAgent') params.delete('subAgentId')
      return params
    })
  }

  const clearFilters = () => {
    setDateRange(initialRange())
    setSubAgentFilter(undefined)
    setCurrentPage(1)
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous)
      params.delete('subAgentId')
      return params
    })
  }

  const myHistory = myData?.myCommissionSettlementHistory
  const downlineHistory = downlineData?.downlineCommissionSettlementHistory
  const rows = activeTab === 'my' ? myHistory?.items ?? [] : downlineHistory?.items ?? []
  const total = Number(activeTab === 'my' ? myHistory?.total ?? 0 : downlineHistory?.total ?? 0)
  const loading = activeTab === 'my' ? myLoading : downlineLoading
  const columns = activeTab === 'my' ? myColumns : downlineColumns
  const emptyTitle = activeTab === 'my'
    ? 'No settlements received for the selected period'
    : 'No payouts to sub-agents for the selected period'

  const pagination = {
    current: currentPage,
    pageSize,
    total,
    onChange: setCurrentPage,
    onPageSizeChange: (size: number) => {
      setPageSize(size)
      setCurrentPage(1)
    },
    itemName: activeTab === 'my' ? 'settlements' : 'payouts',
    pageSizeOptions: COMMISSION_HISTORY_PAGE_SIZES,
    variant: 'embedded' as const,
  }

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Commission History"
        sub="Settlement history received and payouts to sub-agents"
      />

      <FilterBar
        label="Commission history filters"
        activeCount={activeCommissionHistoryFilters(activeTab, subAgentFilter)}
        onClearAll={clearFilters}
      >
        <DateRangeField
          label="Settlement period"
          className={styles.periodField}
          presets={COMMISSION_HISTORY_DATE_PRESETS}
          appliedPreset="custom"
          appliedFrom={periodFrom}
          appliedTo={periodTo}
          onApply={(payload) => {
            setDateRange((current) => applyHistoryDateRange(current, payload))
            setCurrentPage(1)
          }}
          onReset={() => {
            setDateRange(initialRange())
            setCurrentPage(1)
          }}
        />
        {activeTab === 'subAgent' ? (
          <Select
            label="Sub-agent"
            hideLabel
            size="sm"
            className={styles.agentField}
            value={subAgentFilter || 'all'}
            options={subAgentOptions(summariesData?.subAgentCommissionSummaries ?? [])}
            onChange={(value) => {
              const id = value === 'all' ? undefined : value
              setSubAgentFilter(id)
              setCurrentPage(1)
              setSearchParams((previous) => {
                const params = new URLSearchParams(previous)
                if (id) params.set('subAgentId', id)
                else params.delete('subAgentId')
                return params
              })
            }}
          />
        ) : null}
        <Button
          size="sm"
          icon={<IconRefresh size={15} stroke={strokeFor(15)} />}
          onClick={() => void (activeTab === 'my' ? refetchMy() : refetchDownline())}
        >
          Refresh
        </Button>
      </FilterBar>

      <div className={styles.tabs}>
        <Tabs
          value={activeTab}
          items={TAB_ITEMS}
          onChange={changeTab}
          label="Commission history views"
          idPrefix={TAB_ID_PREFIX}
        />
      </div>

      <div
        role="tabpanel"
        className={styles.panel}
        id={tabPanelId(TAB_ID_PREFIX, activeTab)}
        aria-labelledby={tabId(TAB_ID_PREFIX, activeTab)}
      >
        <Card
          title={activeTab === 'my' ? 'My Settlements' : 'Sub-agent Settlements'}
          sub={loading ? undefined : `${total.toLocaleString()} ${activeTab === 'my' ? 'settlements' : 'payouts'}`}
          body="table"
        >
          <DataTable
            label={activeTab === 'my' ? 'My commission settlements' : 'Sub-agent commission settlements'}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            width="wide"
            state={loading ? 'loading' : 'ready'}
            empty={<EmptyState title={emptyTitle} />}
            pagination={!loading && total > 0 ? pagination : false}
          />
        </Card>
        {/* The agent's own adjustments, read-only (owner decision 3); admins act on them from the agent profile. */}
        {isCommission && agent?.id && activeTab === 'my' ? <CommissionAdjustmentsSection agentId={agent.id} /> : null}
      </div>
    </Page>
  )
}
