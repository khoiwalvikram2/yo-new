import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconInfoCircle, IconRefresh, IconX } from '@tabler/icons-react'
import { useQuery, useMutation, useApolloClient } from '@apollo/client'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useAuthStore } from '@/shared/core/authStore'
import { useUIStore } from '@/shared/core/uiStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { IconButton } from '@/ui/components/IconButton'
import { Notice } from '@/ui/components/Notice'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { strokeFor } from '@/ui/components/icons'
import {
  SNAPSHOT_HEALTH_SUMMARY_QUERY,
  SNAPSHOT_MISSING_DAYS_QUERY,
  SNAPSHOT_STALE_DAYS_QUERY,
  ENQUEUE_SNAPSHOT_FOR_REPORTING_DAY_MUTATION,
  ENQUEUE_SNAPSHOT_BACKFILL_RANGE_MUTATION,
  REGENERATE_STALE_SNAPSHOT_MUTATION,
} from '@/modules/reporting/graphql'
import { SnapshotHealthSummaryCards } from './components/SnapshotHealthSummaryCards'
import { SnapshotHealthMissingTable } from './components/SnapshotHealthMissingTable'
import { SnapshotHealthStaleTable } from './components/SnapshotHealthStaleTable'
import { SnapshotHealthRunsEvents } from './components/SnapshotHealthRunsEvents'
import { isSuperAdminRole, leavesForWhitelabel } from './snapshotHealthModel'
import styles from './SnapshotHealthPage.module.css'

export default function SnapshotHealthPage() {
  const navigate = useNavigate()
  const roles = useAuthStore((s) => s.roles) ?? []
  const directorMode = useUIStore((s) => s.directorMode)

  // Snapshot health is only for Super Admin in core mode; redirect if in whitelabel mode
  const isSuperAdmin = isSuperAdminRole(roles)
  useEffect(() => {
    if (leavesForWhitelabel(isSuperAdmin, directorMode)) {
      navigate('/overview', { replace: true })
    }
  }, [isSuperAdmin, directorMode, navigate])

  if (leavesForWhitelabel(isSuperAdmin, directorMode)) {
    return null
  }

  // The guard wraps the data-owning content, so a denied caller starts no query and no mutation hook.
  return (
    <RBACGuard required={[{ domain: 'reporting.snapshot-health', actions: ['view'] }]}>
      <SnapshotHealthContent />
    </RBACGuard>
  )
}

function SnapshotHealthContent() {
  const client = useApolloClient()
  const permissions = useAuthStore((s) => s.permissions)
  const canTrigger = hasPermissionWithNested(permissions ?? [], 'reporting.snapshot-health', 'trigger')
  const pageEyebrow = usePageEyebrow()
  const [noticeOpen, setNoticeOpen] = useState(true)

  const {
    data: summaryData,
    loading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery(SNAPSHOT_HEALTH_SUMMARY_QUERY, {
    fetchPolicy: 'cache-and-network',
  })
  const summary = summaryData?.snapshotHealthSummary
  const lookback = summary?.backfillLookbackDays ?? 30

  const {
    data: missingData,
    loading: missingLoading,
    error: missingError,
    refetch: refetchMissing,
  } = useQuery(SNAPSHOT_MISSING_DAYS_QUERY, {
    variables: { lookbackDays: lookback },
    fetchPolicy: 'cache-and-network',
  })

  const {
    data: staleData,
    loading: staleLoading,
    error: staleError,
    refetch: refetchStale,
  } = useQuery(SNAPSHOT_STALE_DAYS_QUERY, {
    variables: { lookbackDays: lookback },
    fetchPolicy: 'cache-and-network',
    errorPolicy: 'all',
  })

  const refetchQueries = [
    'SnapshotHealthSummary',
    'SnapshotMissingDays',
    'SnapshotStaleDays',
    'SnapshotRuns',
    'SnapshotEvents',
    'SnapshotRunsConnection',
    'SnapshotEventsConnection',
    'SnapshotPgBossOverview',
  ]

  const [enqueueDay, { loading: dayLoading }] = useMutation(ENQUEUE_SNAPSHOT_FOR_REPORTING_DAY_MUTATION, {
    refetchQueries,
  })
  const [enqueueRange, { loading: rangeLoading }] = useMutation(ENQUEUE_SNAPSHOT_BACKFILL_RANGE_MUTATION, {
    refetchQueries,
  })
  const [regenerateStale, { loading: staleMutating }] = useMutation(REGENERATE_STALE_SNAPSHOT_MUTATION, {
    refetchQueries,
  })

  const missingRows = missingData?.snapshotMissingDays ?? []
  const staleRows = staleData?.snapshotStaleDays ?? []

  const handleRefresh = () => {
    void client.refetchQueries({
      include: [
        'SnapshotHealthSummary',
        'SnapshotMissingDays',
        'SnapshotRunsConnection',
        'SnapshotEventsConnection',
        'SnapshotPgBossOverview',
        'SnapshotStaleDays',
      ],
    })
  }

  return (
    <Page maxWidth="wide">
      <PageHeader
        eyebrow={pageEyebrow}
        title="Snapshot health"
        sub="Daily reporting snapshot pipeline (pg-boss) observability"
        actions={(
          <Button
            icon={<IconRefresh size={16} stroke={strokeFor(16)} />}
            onClick={handleRefresh}
            loading={summaryLoading}
          >
            Refresh
          </Button>
        )}
      />

      <div className={styles.content}>
        {noticeOpen ? (
          <Notice
            tone="info"
            icon={<IconInfoCircle size={18} stroke={strokeFor(18)} />}
            title="Timezone & storage"
            action={(
              <IconButton
                size="sm"
                label="Dismiss timezone note"
                icon={<IconX size={15} stroke={strokeFor(15)} />}
                onClick={() => setNoticeOpen(false)}
              />
            )}
          >
            Reporting days use each tenant&apos;s configured timezone. DB{' '}
            <code className={styles.code}>snapshot_date</code> is stored as timestamptz (UTC). IST/UTC labels
            appear where relevant.
          </Notice>
        ) : null}

        <div className={styles.group}>
          <p className={styles.groupLabel}>Overview</p>
          <SnapshotHealthSummaryCards
            summary={summary}
            loading={summaryLoading}
            error={summaryError?.message}
            onRetry={() => void refetchSummary()}
          />
        </div>

        <div className={styles.group}>
          <p className={styles.groupLabel}>Gaps & backfill</p>
          <SnapshotHealthMissingTable
            rows={missingRows}
            loading={missingLoading}
            error={missingError?.message}
            onRetry={() => void refetchMissing()}
            canTrigger={canTrigger}
            mutating={dayLoading || rangeLoading}
            onEnqueueDay={async (row) => {
              await enqueueDay({
                variables: {
                  tenant: row.tenant,
                  whitelabelId: row.whitelabelId,
                  reportingDay: row.reportingDay,
                  currency: row.currency,
                },
              })
            }}
            onEnqueueRange={async (p) => {
              await enqueueRange({
                variables: {
                  tenant: p.tenant,
                  whitelabelId: p.whitelabelId,
                  dateFrom: p.dateFrom,
                  dateTo: p.dateTo,
                  currency: p.currency,
                },
              })
            }}
          />
        </div>

        <div className={styles.group}>
          <p className={styles.groupLabel}>Stale snapshots</p>
          <SnapshotHealthStaleTable
            rows={staleRows}
            loading={staleLoading}
            error={staleError?.message}
            onRetry={() => void refetchStale()}
            canTrigger={canTrigger}
            mutating={staleMutating}
            onRegenerate={async (row) => {
              await regenerateStale({
                variables: {
                  tenant: row.tenant,
                  whitelabelId: row.whitelabelId,
                  reportingDay: row.reportingDay,
                  currency: row.currency,
                },
              })
            }}
            onRegenerateAll={async () => {
              for (const row of staleRows) {
                await regenerateStale({
                  variables: {
                    tenant: row.tenant,
                    whitelabelId: row.whitelabelId,
                    reportingDay: row.reportingDay,
                    currency: row.currency,
                  },
                })
              }
            }}
          />
        </div>

        <div className={styles.group}>
          <p className={styles.groupLabel}>Pipeline & logs</p>
          <SnapshotHealthRunsEvents />
        </div>
      </div>
    </Page>
  )
}
