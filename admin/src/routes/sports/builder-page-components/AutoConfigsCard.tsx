import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { RUN_AUTO_NOW, UPSERT_AUTO_CONFIG, DELETE_AUTO_CONFIG, LIST_AUTO_RUNS_PAGE, DELETE_AUTO_RUNS } from '@/lib/graphql/sports'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Drawer } from '@/ui/components/Drawer'
import { Notice } from '@/ui/components/Notice'
import { StatusPill } from '@/ui/components/StatusPill'
import { Switch } from '@/ui/components/Switch'
import { Tooltip } from '@/ui/components/Tooltip'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { AutoRunInfo } from './AutoRunInfo'
import { SportImage } from './AutoSportSelector'
import { builderRequireSuccess } from './builderModel'
import type { AutoConfigRow, AutoRunRow, Sport } from './types'
import styles from './Builder.module.css'
interface Props {
  rows: AutoConfigRow[]; sports: Sport[]; keyBySportId: Record<string, string>
  leaguesOptionsBySport: Record<string, Array<{ label: string; value: string }>>
  onRefresh: () => void | Promise<unknown>
}
export function AutoConfigsCard({ rows, sports, keyBySportId, leaguesOptionsBySport, onRefresh }: Props) {
  const { formatDateTime } = useFormatDate()
  const [runAutoNow] = useMutation(RUN_AUTO_NOW)
  const [upsertAutoConfig] = useMutation(UPSERT_AUTO_CONFIG)
  const [deleteAutoConfig] = useMutation(DELETE_AUTO_CONFIG)
  const [deleteAutoRuns] = useMutation(DELETE_AUTO_RUNS)
  const [historyForSportId, setHistoryForSportId] = useState<string | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(10)
  const [confirmation, setConfirmation] = useState<{ kind: 'config' | 'history'; sportId: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const busy = useRef(false)
  const confirmationPromise = useRef<Promise<void> | null>(null)
  const { data: runsData, loading: runsLoading, error: runsError, refetch: refetchRuns } = useQuery<{ autoRunsPage: { items: AutoRunRow[]; total: number } }>(LIST_AUTO_RUNS_PAGE, {
    variables: historyForSportId ? { sportId: historyForSportId, limit: historyPageSize, offset: (historyPage-1)*historyPageSize } : undefined, skip: !historyForSportId, fetchPolicy: 'cache-and-network',
  })
  const sortedRows = useMemo(() => [...rows].sort((a, b) => (sports.find(sport => sport.key === keyBySportId[String(a.sportId)])?.sort ?? 999) - (sports.find(sport => sport.key === keyBySportId[String(b.sportId)])?.sort ?? 999)), [rows, sports, keyBySportId])
  const nameFor = (sportId: string) => sports.find(sport => sport.key === keyBySportId[sportId])?.name ?? keyBySportId[sportId] ?? sportId
  const perform = async (key: string, action: () => Promise<unknown>) => {
    if (busy.current) return
    busy.current = true; setPending(key); setError(null)
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to complete auto-ingestion action') } finally { busy.current = false; setPending(null) }
  }
  const columns: DataTableColumn<AutoConfigRow>[] = [
    { key: 'sport', header: 'Sport', minWidth: 160, cell: row => <div className={styles.actions}><SportImage name={nameFor(String(row.sportId))} /><span>{nameFor(String(row.sportId))}</span></div> },
    { key: 'leagues', header: 'Leagues', minWidth: 260, cell: row => {
      const codes = row.leagueCodes ?? []; const options = leaguesOptionsBySport[keyBySportId[String(row.sportId)]] ?? []
      const names = codes.map(code => options.find(option => String(option.value) === String(code))?.label ?? String(code))
      return <div className={styles.actions}><StatusPill tone="info">{codes.length} selected</StatusPill>{names.slice(0, 2).map((name, index) => <StatusPill key={`${name}-${index}`} tone="neutral">{name}</StatusPill>)}
        {names.length > 2 && <Tooltip content={names.slice(2).join(', ')}><Button size="sm" variant="ghost">+{names.length - 2} more</Button></Tooltip>}
      </div>
    } },
    { key: 'run', header: 'Run', minWidth: 240, cell: row => <AutoRunInfo lastRunAt={row.lastRunAt} nextRunAt={row.nextRunAt} /> },
    { key: 'run-status', header: 'Run Status', cell: row => {
      const status = (row.lastRunStatus || 'never').toLowerCase()
      return <StatusPill tone={status === 'success' ? 'ok' : status === 'failure' ? 'neg' : status === 'running' ? 'info' : 'muted'}>{status}</StatusPill>
    } },
    { key: 'frequency', header: 'Frequency', cell: row => `${row.frequencyHours}h` },
    { key: 'status', header: 'Status', cell: row => <div className={styles.actions}>
      <Switch label={`Active configuration for ${nameFor(String(row.sportId))}`} hideLabel size="sm" checked={row.active} disabled={pending !== null}
        onChange={active => { void perform(`status-${row.id}`, async () => {
          builderRequireSuccess(await upsertAutoConfig({ variables: { sportId: String(row.sportId), leagueCodes: row.leagueCodes ?? [], frequencyHours: row.frequencyHours, active }, context: { uiToast: 'message' } }), 'upsertAutoSportsConfig'); await onRefresh()
        }) }} /><span>{row.active ? 'On' : 'Off'}</span>
    </div> },
    { key: 'actions', header: 'Actions', minWidth: 240, cell: row => <div className={styles.actions}>
      <Button size="sm" onClick={() => { setHistoryForSportId(String(row.sportId)); setHistoryPage(1) }}>History</Button>
      <Button size="sm" variant="primary" loading={pending === `run-${row.id}`} disabled={pending !== null} onClick={() => { void perform(`run-${row.id}`, async () => { builderRequireSuccess(await runAutoNow({ variables: { sportId: String(row.sportId), leagueCodes: row.leagueCodes ?? [] } }), 'runAutoSportsIngestion') }) }}>Run</Button>
      <Button size="sm" variant="danger" disabled={pending !== null} aria-label={`Delete configuration for ${nameFor(String(row.sportId))}`} onClick={() => setConfirmation({ kind: 'config', sportId: String(row.sportId), name: nameFor(String(row.sportId)) })}>Delete</Button>
    </div> },
  ]
  const historyColumns: DataTableColumn<AutoRunRow>[] = [
    { key: 'started', header: 'Started', cell: row => formatDateTime(row.startedAt) },
    { key: 'finished', header: 'Finished', cell: row => row.finishedAt ? formatDateTime(row.finishedAt) : '—' },
    { key: 'status', header: 'Status', cell: row => <StatusPill tone={row.status === 'success' ? 'ok' : row.status === 'failure' ? 'neg' : 'muted'}>{row.status}</StatusPill> },
    { key: 'added', header: 'Added', minWidth: 240, cell: row => <div className={styles.actions}><StatusPill tone="info">{row.leaguesAdded} leagues</StatusPill><StatusPill tone="info">{row.eventsAdded} events</StatusPill><StatusPill tone="neutral">{row.marketsAdded} markets</StatusPill><StatusPill tone="neutral">{row.runnersAdded} runners</StatusPill></div> },
    { key: 'skipped', header: 'Skipped', cell: row => <span title="Events skipped because the provider returned no Match Odds market"><StatusPill tone="warn">{row.skippedEventsCount}</StatusPill></span> },
  ]
  const historyRows = runsData?.autoRunsPage?.items ?? []
  const currentHistoryPage = Math.min(historyPage, Math.max(1, Math.ceil((runsData?.autoRunsPage?.total ?? 0) / historyPageSize)))
  return <>
    <Card title="Saved Auto Configurations" sub="Manage saved auto-ingestion settings" body="table" tools={<div className={styles.actions}>
      <StatusPill tone="neutral">{sortedRows.length} configs</StatusPill>
      <Button size="sm" disabled={pending !== null} onClick={() => { void perform('refresh', async () => { await onRefresh() }) }}>Refresh configurations</Button>
      <Button size="sm" variant="primary" loading={pending === 'all'} disabled={pending !== null || sortedRows.length === 0} onClick={() => { void perform('all', async () => {
        for (const row of sortedRows) builderRequireSuccess(await runAutoNow({ variables: { sportId: row.sportId, leagueCodes: row.leagueCodes ?? [] } }), 'runAutoSportsIngestion')
      }) }}>Run All Now</Button>
    </div>}>
      {error && <Notice tone="error" title="Auto configuration action failed">{error}</Notice>}
      <DataTable label="Saved auto configurations" columns={columns} rows={sortedRows} rowKey={row => row.id} pagination={false} width="wide" />
    </Card>
    <Drawer open={Boolean(historyForSportId) && confirmation === null} onOpenChange={open => { if (!open) setHistoryForSportId(null) }} title={`Run History · ${nameFor(historyForSportId ?? '')}`} size="lg">
      <div className={styles.stack}><Button size="sm" variant="danger" onClick={() => {
        if (historyForSportId) setConfirmation({ kind: 'history', sportId: historyForSportId, name: nameFor(historyForSportId) })
      }}>Delete History</Button>
      <DataTable label="Auto run history" rows={historyRows} columns={historyColumns} rowKey={row => row.id} width="wide"
        pagination={{ current: currentHistoryPage, pageSize: historyPageSize, total: runsData?.autoRunsPage?.total ?? 0, onChange: setHistoryPage, onPageSizeChange: size => { setHistoryPageSize(size); setHistoryPage(1) }, itemName: 'runs' }}
        state={runsError ? 'error' : runsLoading ? 'loading' : 'ready'} error={runsError?.message} onRetry={() => { void refetchRuns().catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to refresh history')) }} />
      </div>
    </Drawer>
    <ConfirmDialog open={confirmation !== null} onOpenChange={open => { if (!open) setConfirmation(null) }} tone="danger"
      title={confirmation?.kind === 'history' ? 'Clear Run History?' : 'Delete Configuration?'} confirmLabel="Delete"
      description={confirmation?.kind === 'history' ? `This will permanently delete all run history for ${confirmation.name}.` : `This will remove the auto-ingestion configuration for ${confirmation?.name ?? 'this sport'}.`}
      onConfirm={async () => {
        if (confirmationPromise.current) return confirmationPromise.current
        if (!confirmation) return
        const request = (async () => {
          if (confirmation.kind === 'history') { builderRequireSuccess(await deleteAutoRuns({ variables: { sportId: String(confirmation.sportId) } }), 'deleteAutoRuns'); await refetchRuns() }
          else { builderRequireSuccess(await deleteAutoConfig({ variables: { sportId: String(confirmation.sportId) } }), 'deleteAutoSportsConfig'); await onRefresh() }
        })()
        confirmationPromise.current = request
        try { await request } finally { confirmationPromise.current = null }
      }} />
  </>
}
