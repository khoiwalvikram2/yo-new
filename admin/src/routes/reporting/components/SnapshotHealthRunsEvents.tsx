import { useRef, useState } from 'react'
import clsx from 'clsx'
import { IconAlertTriangle, IconDatabase, IconList, IconPlayerPlay } from '@tabler/icons-react'
import { NetworkStatus, useQuery } from '@apollo/client'
import {
  SNAPSHOT_RUNS_CONNECTION_QUERY,
  SNAPSHOT_EVENTS_CONNECTION_QUERY,
  SNAPSHOT_PG_BOSS_OVERVIEW_QUERY,
} from '@/modules/reporting/graphql'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Drawer } from '@/ui/components/Drawer'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { Tabs, type TabItem } from '@/ui/components/Tabs'
import { Tooltip } from '@/ui/components/Tooltip'
import { strokeFor } from '@/ui/components/icons'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import {
  dedupeNodesById,
  eventLevelTone,
  formatRunSummary,
  reportingDayHint,
  runEventsLabel,
  runStatusTone,
  type EventRow,
  type PgBossJobCountRow,
  type PgBossScheduleRow,
  type RunRow,
} from '../snapshotHealthModel'
import styles from '../SnapshotHealthPage.module.css'

const RUNS_PAGE = 25
const EVENTS_PAGE = 40
const TABS_ID = 'snapshot-health-logs'

type LogTab = 'runs' | 'events' | 'pgboss'

const TAB_ITEMS: readonly TabItem<LogTab>[] = [
  { value: 'runs', label: 'Pipeline runs', icon: <IconPlayerPlay size={15} stroke={strokeFor(15)} /> },
  { value: 'events', label: 'Event log', icon: <IconList size={15} stroke={strokeFor(15)} /> },
  { value: 'pgboss', label: 'pg-boss', icon: <IconDatabase size={15} stroke={strokeFor(15)} /> },
]

const jobCountColumns: DataTableColumn<PgBossJobCountRow>[] = [
  { key: 'name', header: 'Job name', emphasis: 'key', cell: (r) => r.name },
  { key: 'state', header: 'State', width: 120, cell: (r) => r.state },
  { key: 'count', header: 'Count', align: 'right', width: 88, cell: (r) => r.count },
]

const scheduleColumns: DataTableColumn<PgBossScheduleRow>[] = [
  { key: 'name', header: 'Name', emphasis: 'key', cell: (r) => r.name },
  { key: 'cron', header: 'Cron', cell: (r) => r.cron },
  { key: 'timezone', header: 'TZ', width: 160, cell: (r) => r.timezone },
]

/** An event's reporting day, with its timezone note as a tooltip the keyboard can reach too. */
function ReportingDayCell({ row }: { row: EventRow }) {
  if (!row.reportingDay) return <>—</>
  const hint = reportingDayHint(row)
  if (!hint) return <span>{row.reportingDay}</span>
  return (
    <Tooltip content={hint}>
      <span className={styles.dayHint} tabIndex={0}>{row.reportingDay}</span>
    </Tooltip>
  )
}

const noData = <EmptyState inset="none" title="No data" />

export function SnapshotHealthRunsEvents() {
  const { formatDateTime } = useFormatDate()
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [tab, setTab] = useState<LogTab>('runs')
  const drawerTriggerRef = useRef<HTMLElement | null>(null)

  const {
    data: runsData,
    loading: runsLoading,
    error: runsError,
    networkStatus: runsNetworkStatus,
    fetchMore: fetchMoreRuns,
    refetch: refetchRuns,
  } = useQuery(SNAPSHOT_RUNS_CONNECTION_QUERY, {
    variables: { first: RUNS_PAGE, after: null as string | null, trigger: null as string | null },
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  })

  const {
    data: logData,
    loading: logLoading,
    error: logError,
    networkStatus: eventsNetworkStatus,
    fetchMore: fetchMoreEvents,
    refetch: refetchEvents,
  } = useQuery(SNAPSHOT_EVENTS_CONNECTION_QUERY, {
    variables: {
      first: EVENTS_PAGE,
      after: null as string | null,
      runId: null,
      errorsOnly,
    },
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  })

  const {
    data: drawerData,
    loading: drawerLoading,
    error: drawerError,
    refetch: refetchDrawer,
  } = useQuery(SNAPSHOT_EVENTS_CONNECTION_QUERY, {
    variables: { first: 200, after: null, runId: drawerRunId, errorsOnly: false },
    skip: !drawerRunId,
    fetchPolicy: 'network-only',
  })

  const {
    data: pgData,
    loading: pgLoading,
    error: pgError,
    refetch: refetchPg,
  } = useQuery(SNAPSHOT_PG_BOSS_OVERVIEW_QUERY, {
    fetchPolicy: 'cache-and-network',
  })

  const runs: RunRow[] = runsData?.snapshotRunsConnection?.nodes ?? []
  const runsPage = runsData?.snapshotRunsConnection?.pageInfo
  const logEvents: EventRow[] = logData?.snapshotEventsConnection?.nodes ?? []
  const eventsPage = logData?.snapshotEventsConnection?.pageInfo
  const drawerEvents: EventRow[] = drawerData?.snapshotEventsConnection?.nodes ?? []

  // Any network wait but "load more" puts the table in its loading state: the first load, the Errors
  // only switch (new variables) and a refetch, which keeps the rows on screen under a busy bar.
  const runsBusy = runsLoading && runsNetworkStatus !== NetworkStatus.fetchMore
  const runsFetchingMore = runsNetworkStatus === NetworkStatus.fetchMore
  const eventsBusy = logLoading && eventsNetworkStatus !== NetworkStatus.fetchMore
  const eventsFetchingMore = eventsNetworkStatus === NetworkStatus.fetchMore

  const loadMoreRuns = () => {
    if (!runsPage?.hasNextPage || !runsPage.endCursor) return
    void fetchMoreRuns({
      variables: {
        first: RUNS_PAGE,
        after: runsPage.endCursor,
        trigger: null as string | null,
      },
      updateQuery: (prev, { fetchMoreResult }) => {
        if (!fetchMoreResult?.snapshotRunsConnection) return prev
        return {
          snapshotRunsConnection: {
            ...fetchMoreResult.snapshotRunsConnection,
            nodes: dedupeNodesById([
              ...(prev.snapshotRunsConnection?.nodes ?? []),
              ...fetchMoreResult.snapshotRunsConnection.nodes,
            ]),
          },
        }
      },
    })
  }

  const loadMoreEvents = () => {
    if (!eventsPage?.hasNextPage || !eventsPage.endCursor) return
    void fetchMoreEvents({
      variables: {
        first: EVENTS_PAGE,
        after: eventsPage.endCursor,
        runId: null,
        errorsOnly,
      },
      updateQuery: (prev, { fetchMoreResult }) => {
        if (!fetchMoreResult?.snapshotEventsConnection) return prev
        return {
          snapshotEventsConnection: {
            ...fetchMoreResult.snapshotEventsConnection,
            nodes: dedupeNodesById([
              ...(prev.snapshotEventsConnection?.nodes ?? []),
              ...fetchMoreResult.snapshotEventsConnection.nodes,
            ]),
          },
        }
      },
    })
  }

  const openRun = (runId: string, trigger: HTMLElement) => {
    drawerTriggerRef.current = trigger
    setDrawerRunId(runId)
  }

  const runColumns: DataTableColumn<RunRow>[] = [
    { key: 'startedAt', header: 'Started', width: 180, cell: (r) => formatDateTime(r.startedAt) },
    { key: 'trigger', header: 'Trigger', width: 140, cell: (r) => r.trigger },
    {
      key: 'status',
      header: 'Status',
      width: 100,
      cell: (r) => <StatusPill tone={runStatusTone(r.status)}>{r.status}</StatusPill>,
    },
    {
      key: 'summary',
      header: 'Summary',
      cell: (r) => {
        const summary = formatRunSummary(r.summaryJson)
        return <span className={clsx(styles.mono, styles.wideTruncate)} title={summary}>{summary}</span>
      },
    },
  ]

  const eventColumns: DataTableColumn<EventRow>[] = [
    { key: 'occurredAt', header: 'Time', width: 168, cell: (e) => formatDateTime(e.occurredAt) },
    {
      key: 'level',
      header: 'Level',
      width: 72,
      cell: (e) => <StatusPill tone={eventLevelTone(e.level)}>{e.level}</StatusPill>,
    },
    {
      key: 'eventType',
      header: 'Type',
      cell: (e) => <span className={styles.truncate} title={e.eventType}>{e.eventType}</span>,
    },
    { key: 'domain', header: 'Domain', width: 88, cell: (e) => e.domain },
    { key: 'reportingDay', header: 'Reporting day', width: 112, cell: (e) => <ReportingDayCell row={e} /> },
    {
      key: 'message',
      header: 'Message',
      cell: (e) => <span className={styles.wideTruncate} title={e.message ?? undefined}>{e.message}</span>,
    },
  ]

  const pgOverview = pgData?.snapshotPgBossOverview
  const selectedRun = drawerRunId ? runs.find((r) => r.id === drawerRunId) : null

  return (
    <>
      <Card title="Pipeline runs & events" body="table">
        <div className={styles.tabScroller}>
          <Tabs
            className={styles.tabs}
            label="Pipeline runs & events"
            idPrefix={TABS_ID}
            value={tab}
            items={TAB_ITEMS}
            onChange={setTab}
            size="sm"
          />
        </div>

        <div
          className={styles.tabPanel}
          role="tabpanel"
          id={tabPanelId(TABS_ID, tab)}
          aria-labelledby={tabId(TABS_ID, tab)}
        >
          {tab === 'runs' ? (
            <>
              <DataTable
                label="Pipeline runs"
                rows={runs}
                rowKey={(r) => r.id}
                columns={runColumns}
                state={runsBusy ? 'loading' : runsError ? 'error' : 'ready'}
                error={runsError?.message}
                onRetry={() => void refetchRuns()}
                empty={noData}
                rowActions={(r) => ({
                  primary: (
                    <Button
                      size="xs"
                      aria-label={runEventsLabel(r, formatDateTime(r.startedAt))}
                      onClick={(event) => openRun(r.id, event.currentTarget)}
                    >
                      Events
                    </Button>
                  ),
                })}
              />
              {runsPage?.hasNextPage ? (
                <div className={styles.loadMore}>
                  <Button onClick={loadMoreRuns} loading={runsFetchingMore} block>
                    Load more runs
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}

          {tab === 'events' ? (
            <>
              <div className={styles.eventsTools}>
                <Switch label="Errors only" size="sm" checked={errorsOnly} onChange={setErrorsOnly} />
              </div>
              <DataTable
                label="Event log"
                rows={logEvents}
                rowKey={(e) => e.id}
                columns={eventColumns}
                state={eventsBusy ? 'loading' : logError ? 'error' : 'ready'}
                error={logError?.message}
                onRetry={() => void refetchEvents()}
                empty={noData}
              />
              {eventsPage?.hasNextPage ? (
                <div className={styles.loadMore}>
                  <Button onClick={loadMoreEvents} loading={eventsFetchingMore} block>
                    Load more events
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}

          {tab === 'pgboss' ? (
            <>
              {pgOverview?.readError ? (
                <div className={styles.panelNotice}>
                  <Notice
                    tone="warn"
                    icon={<IconAlertTriangle size={18} stroke={strokeFor(18)} />}
                    title="Could not read all pg-boss data"
                  >
                    {pgOverview.readError}
                  </Notice>
                </div>
              ) : null}
              <p className={styles.panelText}>
                Job rows in <code className={styles.code}>pgboss.job</code> for reporting snapshot names.
                Schema varies by pg-boss version; empty is normal if jobs completed and were archived.
              </p>
              <DataTable
                label="pg-boss job counts"
                rows={pgOverview?.jobCounts ?? []}
                rowKey={(r) => `${r.name}-${r.state}`}
                columns={jobCountColumns}
                state={pgLoading ? 'loading' : pgError ? 'error' : 'ready'}
                error={pgError?.message}
                onRetry={() => void refetchPg()}
                empty={noData}
              />
              <p className={clsx(styles.panelText, styles.panelTextSpaced)}>
                Registered schedules (<code className={styles.code}>pgboss.schedule</code>)
              </p>
              <DataTable
                label="pg-boss schedules"
                rows={pgOverview?.schedules ?? []}
                rowKey={(r) => r.name}
                columns={scheduleColumns}
                state={pgLoading ? 'loading' : pgError ? 'error' : 'ready'}
                error={pgError?.message}
                onRetry={() => void refetchPg()}
                empty={noData}
              />
            </>
          ) : null}
        </div>
      </Card>

      <Drawer
        title="Run events"
        sub={selectedRun ? (
          <StatusPill tone={runStatusTone(selectedRun.status)}>
            {selectedRun.trigger} · {selectedRun.status}
          </StatusPill>
        ) : undefined}
        size="lg"
        open={!!drawerRunId}
        onOpenChange={(open) => {
          if (!open) setDrawerRunId(null)
        }}
        themeFrom={drawerTriggerRef}
        restoreFocusTo={drawerTriggerRef}
      >
        <div className={styles.drawerTable}>
          <DataTable
            label="Run events"
            rows={drawerEvents}
            rowKey={(e) => e.id}
            columns={eventColumns}
            state={drawerLoading ? 'loading' : drawerError ? 'error' : 'ready'}
            error={drawerError?.message}
            onRetry={() => void refetchDrawer()}
            empty={noData}
          />
        </div>
      </Drawer>
    </>
  )
}
