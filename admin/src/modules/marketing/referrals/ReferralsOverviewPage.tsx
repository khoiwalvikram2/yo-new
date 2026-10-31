import { useState } from 'react'
import { useQuery, gql } from '@apollo/client'
import { Link } from 'react-router-dom'
import { IconAlertTriangle, IconInbox, IconRefresh, IconSettings } from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { buttonClassName } from '@/ui/components/buttonClassName'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn, type DataTableSort } from '@/ui/components/DataTable'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { EmptyState } from '@/ui/components/EmptyState'
import { strokeFor } from '@/ui/components/icons'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { StatusPill } from '@/ui/components/StatusPill'
import { ReferralStatsCards } from './components/StatsCards'
import { FiltersBar } from './components/FiltersBar'
import { RBACGuard } from '@/shared/core/RBACGuard'
import {
  EARNINGS_PAGE_SIZE,
  EARNINGS_PAGE_SIZES,
  clampPage,
  earningRowKey,
  maxDepthLabel,
  pageOf,
  referralRangeVariables,
  ruleTypeLabel,
  sortEarnings,
  tierLabel,
  visibleEarnings,
  visibleRewardModes,
  type ReferralDateRange,
  type ReferralEarningRow,
  type ReferralProgramSummary,
} from './referralsOverviewModel'
import styles from './ReferralsOverviewPage.module.css'

const PROGRAM_SETTINGS_PATH = '/referrals/program'
const EARNINGS_PATH = '/referrals/earnings'

// Router links that wear the button look (a <button> inside an <a> is invalid and loses middle-click).
const SETTINGS_LINK_CLASS = buttonClassName({ variant: 'secondary' })
const CONFIGURE_LINK_CLASS = buttonClassName({ variant: 'primary', size: 'sm' })
const CARD_LINK_CLASS = buttonClassName({ variant: 'link', size: 'sm' })

const REFERRAL_PROGRAM_QUERY = gql`
  query ReferralProgram {
    referralProgramByTenant {
      id
      name
      enabledModes
      maxDepth
    }
  }
`

const REFERRAL_EARNINGS_QUERY = gql`
  query ReferralEarnings($fromDate: String, $toDate: String) {
    referralEarnings(fromDate: $fromDate, toDate: $toDate) {
      id
      referrerId
      refereeId
      tier
      ruleType
      grossAmount
      netAmount
      currency
      calculatedAt
    }
  }
`

export default function ReferralsOverviewPage() {
  return (
    <RBACGuard required={[{ domain: 'referrals.overview', actions: ['view'] }]}>
      <ReferralsOverviewPageContent />
    </RBACGuard>
  );
}

function ReferralsOverviewPageContent() {
  const pageEyebrow = usePageEyebrow()
  const { formatAmount } = useCurrency()
  const { formatDateTime } = useFormatDate()
  const [dateRange, setDateRange] = useState<ReferralDateRange | null>(null)
  const [sort, setSort] = useState<DataTableSort | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(EARNINGS_PAGE_SIZE)
  // The applied period as the documents' instants: the start of its first IST day, the end of its last.
  const period = referralRangeVariables(dateRange)

  const { data: programData, loading: programLoading, refetch: refetchProgram } = useQuery(REFERRAL_PROGRAM_QUERY, {
    errorPolicy: 'all',
  })

  const {
    data: earningsData,
    loading: earningsLoading,
    error: earningsError,
    refetch: refetchEarnings,
  } = useQuery(REFERRAL_EARNINGS_QUERY, {
    variables: {
      fromDate: period.fromDate,
      toDate: period.toDate,
    },
    errorPolicy: 'all',
  })

  const program: ReferralProgramSummary | null | undefined = programData?.referralProgramByTenant

  // The legacy table was swapped for its empty state while a new period loaded, so it came back on page
  // 1 with no column sort. The kit table stays mounted; the reset is explicit.
  const handleDateRangeChange = (dates: ReferralDateRange | null) => {
    setDateRange(dates)
    setPage(1)
    setSort(null)
  }

  const handleRefresh = () => {
    refetchProgram()
    refetchEarnings()
  }

  const earnings = visibleEarnings(earningsData?.referralEarnings)
  const sortedEarnings = sortEarnings(earnings, sort)
  const currentPage = clampPage(page, sortedEarnings.length, pageSize)
  const earningsPage = pageOf(sortedEarnings, currentPage, pageSize)
  const earningsState = earningsLoading
    ? 'loading'
    : earningsError && earnings.length === 0
      ? 'error'
      : 'ready'
  const rewardModes = visibleRewardModes(program?.enabledModes)

  const earningsColumns: DataTableColumn<ReferralEarningRow>[] = [
    {
      key: 'referrerId',
      header: 'Referrer ID',
      emphasis: 'id',
      cell: (row) => row.referrerId,
    },
    {
      key: 'refereeId',
      header: 'Referee ID',
      emphasis: 'id',
      cell: (row) => row.refereeId,
    },
    {
      key: 'tier',
      header: 'Tier',
      sort: true,
      cell: (row) => <StatusPill tone="neutral">{tierLabel(row.tier)}</StatusPill>,
    },
    {
      key: 'ruleType',
      header: 'Rule Type',
      cell: (row) => <StatusPill tone="info">{ruleTypeLabel(row.ruleType)}</StatusPill>,
    },
    {
      key: 'netAmount',
      header: 'Amount',
      align: 'right',
      sort: true,
      cell: (row) => (
        <span className={styles.amount}>{formatAmount(Number(row.netAmount), row.currency ?? 'INR')}</span>
      ),
    },
    {
      key: 'calculatedAt',
      header: 'Date',
      sort: true,
      cell: (row) => (row.calculatedAt ? formatDateTime(row.calculatedAt, 'MMM d, yyyy HH:mm') : '—'),
    },
  ]

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        title="Referral Program"
        sub="Manage referral programs, track performance, and configure rewards"
        actions={(
          <>
            <FiltersBar
              dateRange={dateRange}
              onDateRangeChange={handleDateRangeChange}
              onClear={() => handleDateRangeChange(null)}
            />
            <Link to={PROGRAM_SETTINGS_PATH} className={SETTINGS_LINK_CLASS}>
              <IconSettings size={16} stroke={strokeFor(16)} aria-hidden="true" />
              <span>Program Settings</span>
            </Link>
            <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={handleRefresh}>
              Refresh
            </Button>
          </>
        )}
      />

      <div className={styles.content}>
        {/* The program query has to finish before "no program" is true; legacy showed this while loading. */}
        {!programLoading && !program ? (
          <Notice
            tone="warn"
            icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />}
            title="No Program Configured"
            action={(
              <Link to={PROGRAM_SETTINGS_PATH} className={CONFIGURE_LINK_CLASS}>
                Configure Now
              </Link>
            )}
          >
            Please configure your referral program settings to start using referrals.
          </Notice>
        ) : null}

        <div className={styles.statsRegion}>
          <ReferralStatsCards dateRange={{
            from: period.fromDate,
            to: period.toDate,
          }} />
        </div>

        {program ? (
          <Card
            title="Program Configuration"
            sub="Current referral program settings"
            tools={(
              <Link to={PROGRAM_SETTINGS_PATH} className={CARD_LINK_CLASS}>
                <IconSettings size={14} stroke={strokeFor(14)} aria-hidden="true" />
                <span>Edit Settings</span>
              </Link>
            )}
          >
            <DescriptionList
              items={[
                { key: 'name', term: 'Program Name', value: program.name },
                {
                  key: 'depth',
                  term: 'Max Tier Depth',
                  value: <StatusPill tone="neutral">{maxDepthLabel(program.maxDepth)}</StatusPill>,
                },
                {
                  key: 'modes',
                  term: 'Reward Types',
                  note: rewardModes.length === 0,
                  value: rewardModes.length > 0 ? (
                    <span className={styles.modes}>
                      {rewardModes.map((mode) => (
                        <StatusPill key={mode} tone="ok">{ruleTypeLabel(mode)}</StatusPill>
                      ))}
                    </span>
                  ) : 'None enabled',
                },
              ]}
            />
          </Card>
        ) : null}

        <Card
          title="Recent Earnings"
          sub="Latest referral earnings activity"
          body="table"
          tools={(
            <Link to={EARNINGS_PATH} className={CARD_LINK_CLASS}>
              View All
            </Link>
          )}
        >
          <DataTable
            label="Recent earnings"
            columns={earningsColumns}
            rows={earningsPage}
            rowKey={(row) => earningRowKey(row)}
            state={earningsState}
            error="Unable to load referral earnings."
            onRetry={() => void refetchEarnings()}
            sort={sort}
            onSortChange={setSort}
            empty={(
              <EmptyState
                title="No earnings data available"
                icon={<IconInbox size={20} stroke={strokeFor(20)} />}
              />
            )}
            pagination={{
              current: currentPage,
              pageSize,
              total: sortedEarnings.length,
              onChange: setPage,
              onPageSizeChange: (size) => {
                setPageSize(size)
                setPage(1)
              },
              itemName: 'earnings',
              pageSizeOptions: EARNINGS_PAGE_SIZES,
              variant: 'embedded',
            }}
          />
        </Card>
      </div>
    </Page>
  )
}
