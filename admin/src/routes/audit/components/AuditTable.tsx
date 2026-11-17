import { Fragment, useState } from 'react'
import clsx from 'clsx'
import { useNavigate } from 'react-router-dom'
import { IconChevronRight, IconChevronDown, IconArrowUp, IconArrowDown, IconDots } from '@tabler/icons-react'
import type { AuditFilters } from '@/state/auditStore'
import type { AuditEvent, AuditEventPage } from '@/modules/audit/types'
import { useAuditStore } from '@/state/auditStore'
import { formatEvent } from '@/modules/audit/services/auditService'
import { getResourceNavigationPath, getActorNavigationPath } from '@/modules/audit/utils/resourceNavigation'
import { copyToClipboard } from '@/shared/utils/clipboard'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Table, THead, TBody, TR, TH, TD } from '@/ui/components/Table'
import { Button } from '@/ui/components/Button'
import { Menu, MenuItem } from '@/ui/components/Menu'
import { Pagination } from '@/ui/components/Pagination'
import { StatusPill } from '@/ui/components/StatusPill'
import { EmptyState } from '@/ui/components/EmptyState'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { ColumnSettings } from './ColumnSettings'
import { AuditTableToolbar } from './AuditTableToolbar'
import { AuditExpandableRow } from './AuditExpandableRow'
import { AuditDetailsDrawer } from './AuditDetailsDrawer'
import { auditActiveFilters, auditHasChanges, auditPrintDocument, auditResetFilters } from '../auditPageModel'
import styles from '../AuditEvents.module.css'
interface AuditTableProps { data?: AuditEventPage; loading?: boolean; error?: { message?: string }; filters: AuditFilters; onFiltersChange: (filters: Partial<AuditFilters>) => void; onRefresh: () => void; refetchKey?: number }
const labels: Record<string, string> = { expand: 'Expand', id: 'ID', timestamp: 'Timestamp', actor: 'Actor', domain: 'Domain', action: 'Action', resource: 'Resource', details: 'Details' }
const fields: Record<string, string> = { timestamp: 'timestamp', actor: 'actorId', domain: 'domain', action: 'action' }
export function AuditTable({ data, loading, error, filters, onFiltersChange, onRefresh }: AuditTableProps) {
  const navigate = useNavigate()
  const { formatDateTime, formatDate, formatTime } = useFormatDate()
  const { visibleColumns, columnOrder, tableDensity, setVisibleColumns, setColumnOrder, setTableDensity } = useAuditStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState(false)
  const [selected, setSelected] = useState<AuditEvent | null>(null)
  const events = data?.items ?? []
  const total = data?.total ?? 0
  const columns = columnOrder.filter((key) => labels[key] && (key === 'expand' || visibleColumns.includes(key)))
  const [sortField, sortDir] = (filters.sort || 'timestamp:desc').split(':')
  function sort(field: string) { onFiltersChange({ sort: `${field}:${sortField === field && sortDir === 'desc' ? 'asc' : 'desc'}`, page: 1 }) }
  function toggle(id: string) { setExpanded((prior) => { const next = new Set(prior); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  function copy(value: string, message = 'Copied!') { void copyToClipboard(value, message) }
  function print() {
    const target = window.open('', '_blank')
    if (!target) return
    target.document.write(auditPrintDocument(events, total, filters, formatDateTime, formatDate))
    target.document.close()
    setTimeout(() => { target.print() }, 250)
  }
  function cell(key: string, row: AuditEvent) {
    const actorNav = row.actor ? getActorNavigationPath(row.actor.type, row.actor.id) : null
    const resourceNav = getResourceNavigationPath(row.resourceType, row.resourceId, row)
    if (key === 'expand') return auditHasChanges(row) ? <Button size="xs" aria-label={`${expanded.has(row.id) ? 'Collapse' : 'Expand'} ${row.id}`} aria-expanded={expanded.has(row.id)} icon={expanded.has(row.id) ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />} onClick={() => toggle(row.id)} /> : null
    if (key === 'id') return <Button variant="link" size="xs" aria-label={`Copy Event ID ${row.id}`} onClick={() => copy(row.id, 'Event ID copied!')}><code className={styles.code}>{row.id}</code></Button>
    if (key === 'timestamp') return <div className={styles.stack}><Button size="xs" variant="link" aria-label={`Open audit event ${row.id}`} onClick={() => navigate(`/audit/events/${row.id}`)}>{row.timestamp ? formatDate(row.timestamp, 'MMM d, yyyy') : '—'}</Button>
      <span className={styles.secondarySmall}>{row.timestamp ? formatTime(row.timestamp, 'HH:mm:ss') : '—'}</span><span className={styles.secondarySmall}>{formatEvent(row).relativeTime}</span>
      {Date.now() - new Date(row.timestamp).getTime() < 3600000 && <StatusPill tone="ok">Recent</StatusPill>}</div>
    if (key === 'actor') return <div><div className={styles.actions}><span className={styles.strong}>{row.actor?.name || row.actorId}</span>{row.actor?.type && <StatusPill>{row.actor.type}</StatusPill>}</div>
      {row.actor?.email && <p className={styles.secondary}>{row.actor.email}</p>}{actorNav?.available && <Button variant="link" size="xs" onClick={() => navigate(actorNav.path)}>View Profile</Button>}</div>
    if (key === 'domain' || key === 'action') return <StatusPill>{row[key]}</StatusPill>
    if (key === 'resource') return <div><span className={styles.strong}>{row.resourceType}</span><div className={styles.actions}><Button size="xs" variant="link" onClick={() => onFiltersChange({ resourceId: row.resourceId, page: 1 })}><code className={styles.code}>{row.resourceId}</code></Button>
      {resourceNav.available && <Button variant="link" size="xs" onClick={() => navigate(resourceNav.path)}>View</Button>}</div></div>
    return <Menu trigger={<Button size="xs" aria-label={`Actions for ${row.id}`} icon={<IconDots size={16} />} />}>
      <MenuItem onSelect={() => setSelected(row)}>View Details</MenuItem>
      <MenuItem onSelect={() => copy(row.id, 'Event ID copied!')}>Copy Event ID</MenuItem>
      <MenuItem onSelect={() => copy(JSON.stringify(row, null, 2), 'JSON copied!')}>Copy JSON</MenuItem>
      <MenuItem onSelect={() => onFiltersChange({ actorId: row.actorId, page: 1 })}>Filter by Actor</MenuItem>
      <MenuItem onSelect={() => onFiltersChange({ resourceId: row.resourceId, page: 1 })}>Filter by Resource</MenuItem>
      {actorNav?.available && <MenuItem onSelect={() => navigate(actorNav.path)}>View Actor Profile</MenuItem>}
      {resourceNav.available && <MenuItem onSelect={() => navigate(resourceNav.path)}>View Resource</MenuItem>}
    </Menu>
  }
  if (loading && !data) return <LoadingState label="Loading audit events" />
  if (error && !data) return <Notice tone="error">Failed to load audit events: {error.message}</Notice>
  return <div className={styles.stack}>
    <AuditTableToolbar eventsLength={events.length} total={total} onOpenColumnSettings={() => setSettings(true)} onPrint={print} onRefresh={onRefresh} />
    {error && data && <Notice tone="warn">Could not refresh audit events: {error.message}. Showing the last available events.</Notice>}
    <Table caption="Audit events" width="wide" inset aria-busy={loading || undefined} className={clsx(styles.table, tableDensity === 'small' && styles.compact, tableDensity === 'large' && styles.large)}>
      <THead><TR>{columns.map((key) => <TH key={key} aria-sort={fields[key] === sortField ? sortDir === 'asc' ? 'ascending' : 'descending' : undefined}>
        {fields[key] ? <button type="button" className={styles.sort} onClick={() => sort(fields[key])}>{labels[key]}{fields[key] === sortField && (sortDir === 'asc' ? <IconArrowUp size={14} /> : <IconArrowDown size={14} />)}</button> : labels[key]}
      </TH>)}</TR></THead>
      <TBody>{events.map((row) => <Fragment key={row.id}><TR interactive open={selected?.id === row.id} onClick={(event) => {
        if ((event.target as Element).closest('button,a,input,select,textarea,[role="menu"]')) return
        navigate(`/audit/events/${row.id}`)
      }}>{columns.map((key) => <TD key={key}>{cell(key, row)}</TD>)}</TR>
        {expanded.has(row.id) && <TR><TD colSpan={Math.max(1, columns.length)}><AuditExpandableRow record={row} onCopy={copy} /></TD></TR>}
      </Fragment>)}
      {!events.length && <TR><TD colSpan={Math.max(1, columns.length)}><EmptyState title={auditActiveFilters(filters) ? 'No events match your filters' : 'No audit events found'} action={auditActiveFilters(filters) ? <Button variant="primary" onClick={() => onFiltersChange(auditResetFilters())}>Clear All Filters</Button> : undefined} /></TD></TR>}
      </TBody>
    </Table>
    <Pagination loading={Boolean(loading)} current={data?.page ?? 1} pageSize={data?.pageSize ?? 100} total={total} itemName="events" pageSizeOptions={[25, 50, 100, 200]} formatSummary={() => `Total ${total} events`} onChange={(page) => onFiltersChange({ page, limit: data?.pageSize ?? 100 })} onPageSizeChange={(limit) => onFiltersChange({ page: 1, limit })} />
    <ColumnSettings open={settings} onClose={() => setSettings(false)} visibleColumns={visibleColumns} columnOrder={columnOrder} tableDensity={tableDensity} onVisibleColumnsChange={setVisibleColumns} onColumnOrderChange={setColumnOrder} onTableDensityChange={setTableDensity} />
    {selected && <AuditDetailsDrawer open event={selected} onClose={() => setSelected(null)} />}
  </div>
}
