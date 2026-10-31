import { useMemo, useState } from 'react'
import { useQuery } from '@apollo/client'
import { LIST_SPORTS_AUDIT, LIST_SPORTS } from '@/lib/graphql/sports'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { SegmentedControl } from '@/ui/components/SegmentedControl'
import { StatusPill } from '@/ui/components/StatusPill'
import { builderActionLabels, builderAuditChange, builderAutoActions, builderMutationActions } from './builderModel'
import type { BuilderAuditRow } from './types'
import styles from './Builder.module.css'
type Mode = 'All' | 'Manual' | 'Auto'
export default function AuditPanel() {
  const [filter, setFilter] = useState<Mode>('All')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const { formatDateTime } = useFormatDate()
  const { data, loading, error, refetch } = useQuery<{ audit: BuilderAuditRow[] }>(LIST_SPORTS_AUDIT, { variables: { action: null }, fetchPolicy: 'cache-and-network' })
  const { data: sportsData } = useQuery<{ sports: Array<{ id: string; name: string }> }>(LIST_SPORTS, { fetchPolicy: 'cache-first' })
  const nameById = new Map((sportsData?.sports ?? []).map(sport => [String(sport.id), String(sport.name)]))
  const rows = useMemo(() => (data?.audit ?? []).filter(row => builderMutationActions.has(row.action) && (filter === 'All' || filter === 'Manual' && row.action === 'persistSportsSelections' || filter === 'Auto' && builderAutoActions.has(row.action))), [data, filter])
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / pageSize)))
  const columns: DataTableColumn<BuilderAuditRow>[] = [
    { key: 'time', header: 'Time', cell: row => formatDateTime(row.timestamp) },
    { key: 'action', header: 'Action', cell: row => <div className={styles.stack}><span>{builderActionLabels[row.action] ?? row.action}</span>{filter === 'All' && <StatusPill tone={builderAutoActions.has(row.action) ? 'info' : 'muted'}>{builderAutoActions.has(row.action) ? 'Auto' : 'Manual'}</StatusPill>}<span className={styles.muted}>{row.action}</span></div> },
    { key: 'change', header: 'Change', minWidth: 360, cell: builderAuditChange },
    { key: 'resource', header: 'Resource', cell: row => `${row.resourceType} · ${['autoConfig', 'autoRun'].includes(row.resourceType) ? nameById.get(String(row.resourceId)) ?? row.resourceId : row.resourceId}` },
    { key: 'actor', header: 'Actor', cell: row => row.actorId },
  ]
  return <Card title="Recent Changes" sub="Latest activity across Manual and Auto" body="table" tools={<div className={styles.actions}>
    <SegmentedControl label="Audit source" value={filter} options={(['All', 'Manual', 'Auto'] as const).map(value => ({ value, label: value }))} onChange={value => { setFilter(value); setPage(1) }} />
    <Button size="sm" onClick={() => { void refetch().catch(() => undefined) }}>Refresh audits</Button>
  </div>}>
    <DataTable label="Builder audits" rows={rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)} columns={columns} rowKey={row => row.id} width="wide"
      state={error ? 'error' : loading ? 'loading' : 'ready'} error={error?.message} onRetry={() => { void refetch().catch(() => undefined) }}
      pagination={{ current: currentPage, pageSize, total: rows.length, onChange: setPage, onPageSizeChange: size => { setPageSize(size); setPage(1) }, pageSizeOptions: [15, 30, 50, 100], itemName: 'changes' }} />
  </Card>
}
