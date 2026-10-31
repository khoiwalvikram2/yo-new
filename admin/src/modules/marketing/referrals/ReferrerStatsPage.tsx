import { useState, useMemo, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, gql } from '@apollo/client'
import {
  IconAlertCircle,
  IconCash,
  IconFileText,
  IconInbox,
  IconRefresh,
  IconTrendingUp,
  IconUsers,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { DateRangeField } from '@/ui/components/DateRangeField'
import type { DateRangeApply } from '@/ui/components/DateRangePanel'
import { EmptyState } from '@/ui/components/EmptyState'
import { strokeFor } from '@/ui/components/icons'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Stat } from '@/ui/components/Stat'
import { StatusPill } from '@/ui/components/StatusPill'
import {
  REFERRER_STATS_DATE_PRESETS,
  activeReferralsNote,
  clicksNote,
  conversionRateText,
  normalizeReferrerStatsRange,
  referrerFacts,
  referrerStatsDatePreset,
  referrerStatsPeriod,
  ruleCountText,
  ruleTypeLabel,
  signupsOverClicksNote,
  visibleRuleEarnings,
  type ReferrerStatsData,
  type ReferrerStatsDateRange,
  type ReferrerUser,
  type RuleTypeEarning,
} from './referrerStatsModel'
import styles from './ReferrerStatsPage.module.css'

const TOP_REFERRERS_PATH = '/referrals/top-referrers'

const REFERRER_STATS_QUERY = gql`
  query ReferrerStats($referrerId: ID!, $fromDate: String, $toDate: String) {
    referrerStats(referrerId: $referrerId, fromDate: $fromDate, toDate: $toDate) {
      referrerId
      totalEarnings
      grossEarnings
      totalReferrals
      activeReferrals
      totalTransactions
      totalClicks
      totalAttributions
      conversionRate
      earningsByRuleType {
        ruleType
        totalEarnings
        count
      }
    }
  }
`

const USER_QUERY = gql`
  query User($id: ID!) {
    user(id: $id) {
      id
      name
      email
      phone
      username
    }
  }
`

export default function ReferrerStatsPage() {
  return (
    <RBACGuard required={[{ domain: 'referrals.earnings', actions: ['view'] }]}>
      <ReferrerStatsPageContent />
    </RBACGuard>
  )
}

function ReferrerStatsPageContent() {
  const { referrerId } = useParams<{ referrerId: string }>()
  const pageEyebrow = usePageEyebrow()
  const { formatAmount } = useCurrency()
  // The applied period as IST days; the document takes the start of the first and the end of the last.
  const [dateRange, setDateRange] = useState<ReferrerStatsDateRange | null>(null)
  const appliedRange = normalizeReferrerStatsRange(dateRange)
  const period = referrerStatsPeriod(dateRange)

  const handleDateRangeChange = (payload: DateRangeApply) => {
    setDateRange(payload.kind === 'custom' ? { from: payload.from, to: payload.to } : null)
  }

  const queryVariables = useMemo(
    () => ({
      referrerId: referrerId!,
      fromDate: period.from,
      toDate: period.to,
    }),
    [referrerId, period.from, period.to]
  )

  const { data: statsData, loading: statsLoading, error: statsError, refetch: refetchStats } = useQuery(REFERRER_STATS_QUERY, {
    variables: queryVariables,
    skip: !referrerId,
    errorPolicy: 'all',
  })

  const { data: userData, loading: userLoading, error: userError, refetch: refetchUser } = useQuery(USER_QUERY, {
    variables: { id: referrerId! },
    skip: !referrerId,
    errorPolicy: 'all',
  })

  const stats: ReferrerStatsData | null | undefined = statsData?.referrerStats
  const user: ReferrerUser | null | undefined = userData?.user
  const earningsByRuleType = visibleRuleEarnings(stats?.earningsByRuleType)
  const loadError = statsError ?? userError

  const ruleColumns: DataTableColumn<RuleTypeEarning>[] = [
    {
      key: 'ruleType',
      header: 'Rule Type',
      cell: (row) => <StatusPill tone="info">{ruleTypeLabel(row.ruleType)}</StatusPill>,
    },
    {
      key: 'totalEarnings',
      header: 'Total Earnings',
      align: 'right',
      cell: (row) => <span className={styles.amount}>{formatAmount(row.totalEarnings, 'INR')}</span>,
    },
    {
      key: 'count',
      header: 'Transactions',
      align: 'right',
      emphasis: 'key',
      cell: (row) => row.count.toLocaleString(),
    },
  ]

  let body: ReactNode
  if (statsLoading || userLoading) {
    body = <LoadingState label="Loading referrer statistics" />
  } else if (!stats || !user) {
    // Legacy said "Referrer not found" for a failed request too; a failure now says what happened.
    body = loadError ? (
      <Notice
        tone="error"
        live="polite"
        icon={<IconAlertCircle size={18} stroke={strokeFor(18)} />}
        title="Failed to load referrer statistics"
        action={(
          <Button
            size="sm"
            onClick={() => {
              void refetchStats()
              void refetchUser()
            }}
          >
            Retry
          </Button>
        )}
      >
        {loadError.message}
      </Notice>
    ) : (
      // An untitled kit Card has no head, so its padded body would start flush with the top border; the
      // flush body leaves the inset to the EmptyState's own card padding.
      <Card body="flush">
        <EmptyState title="Referrer not found" icon={<IconInbox size={20} stroke={strokeFor(20)} />} />
      </Card>
    )
  } else {
    body = (
      <div className={styles.content}>
        {/* Untitled, so the body is flush and the facts row carries the card inset itself. */}
        <Card body="flush" className={styles.factsCard}>
          <dl className={styles.facts}>
            {referrerFacts(referrerId, user).map((fact) => (
              <div className={styles.fact} key={fact.key}>
                <dt className={styles.factTerm}>{fact.term}</dt>
                <dd className={clsx(styles.factValue, fact.code && styles.code)}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {/* Legacy tile colours on the decorative ramp: green, blue, grey (indigo: the kit Stat has no grey), blue. */}
        <div className={styles.statsRegion}>
          <div className={styles.stats} role="group" aria-label="Referrer statistics">
            <Stat
              label="Total Earnings"
              value={formatAmount(stats.totalEarnings, 'INR')}
              note={`Gross: ${formatAmount(stats.grossEarnings, 'INR')}`}
              icon={<IconCash size={18} stroke={strokeFor(18)} />}
              hue="grn"
            />
            <Stat
              label="Total Referrals"
              value={stats.totalReferrals}
              note={activeReferralsNote(stats.activeReferrals)}
              icon={<IconUsers size={18} stroke={strokeFor(18)} />}
              hue="blu"
            />
            <Stat
              label="Conversion Rate"
              value={conversionRateText(stats.conversionRate)}
              note={signupsOverClicksNote(stats.totalAttributions, stats.totalClicks)}
              icon={<IconTrendingUp size={18} stroke={strokeFor(18)} />}
              hue="ind"
            />
            <Stat
              label="Total Transactions"
              value={stats.totalTransactions}
              note={clicksNote(stats.totalClicks)}
              icon={<IconFileText size={18} stroke={strokeFor(18)} />}
              hue="blu"
            />
          </div>
        </div>

        <Card title="Earnings by Rule Type" sub={ruleCountText(earningsByRuleType.length)} body="table">
          <DataTable
            label="Earnings by rule type"
            columns={ruleColumns}
            rows={earningsByRuleType}
            rowKey={(row) => row.ruleType}
            width="narrow"
            empty={(
              <EmptyState
                title="No earnings data by rule type"
                icon={<IconInbox size={20} stroke={strokeFor(20)} />}
              />
            )}
          />
        </Card>
      </div>
    )
  }

  return (
    <Page>
      <PageHeader
        eyebrow={pageEyebrow}
        title="Referrer Statistics"
        meta={referrerId ? `Referrer #${referrerId}` : undefined}
        back={{ to: TOP_REFERRERS_PATH, label: 'Back' }}
        actions={(
          <>
            {/* The page's own period takes the page head's range slot (M:1736-1740, O5); Reset is the
                legacy Clear. It stays mounted while the figures reload. */}
            <DateRangeField
              label="Date range"
              size="md"
              presets={REFERRER_STATS_DATE_PRESETS}
              appliedPreset={referrerStatsDatePreset(appliedRange)}
              appliedFrom={appliedRange.from}
              appliedTo={appliedRange.to}
              onApply={handleDateRangeChange}
              onReset={() => setDateRange(null)}
            />
            <Button icon={<IconRefresh size={16} stroke={strokeFor(16)} />} onClick={() => refetchStats()}>
              Refresh
            </Button>
          </>
        )}
      />

      {body}
    </Page>
  )
}
