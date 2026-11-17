import { Component, useEffect, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useApolloClient } from '@apollo/client'
import { useAuditStore } from '@/state/auditStore'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { AUDIT_EVENTS_QUERY, AUDIT_STATS_QUERY, AUDIT_EXPORT_CSV_QUERY } from '@/modules/audit/graphql/queries'
import { useAuditFilterOptions, useAuditSubscription } from '@/modules/audit/graphql/hooks'
import { serializeFiltersToURL, deserializeFiltersFromURL, cleanAuditFilters, getDefaultFilters } from '@/modules/audit/utils/filterUtils'
import type { AuditEventPage, AuditStats } from '@/modules/audit/types'
import { FiltersBar } from './components/FiltersBar'
import { FilterChips } from './components/FilterChips'
import { AuditStatsCards } from './components/AuditStatsCards'
import { AuditTable } from './components/AuditTable'
import { ExportJobsModal } from './components/ExportJobsModal'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { Notice } from '@/ui/components/Notice'
import { notify } from '@/shared/services/notification'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { auditActiveFilters, auditGraphqlFilters } from './auditPageModel'
import dayjs from 'dayjs'
import styles from './AuditEvents.module.css'

/** Local render failures stay inside their section, without the application's viewport-height fallback. */
class AuditSectionBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    return this.state.error ? <Notice tone="error" title="Unable to display this audit section" action={<Button size="sm" onClick={() => this.setState({ error: null })}>Retry</Button>}>{this.state.error.message}</Notice> : this.props.children
  }
}
export default function EventsPage() {
  return <RBACGuard required={[{ domain: 'audit.events', actions: ['view'] }]}><AuditEventsContent /></RBACGuard>
}
function download(data: string, type: string, extension: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const link = document.createElement('a')
  link.href = url; link.download = `audit-export-${dayjs().format('YYYY-MM-DD')}.${extension}`
  link.click(); URL.revokeObjectURL(url)
}
function AuditEventsContent() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialParams = useRef(searchParams)
  const client = useApolloClient()
  const eyebrow = usePageEyebrow()
  const { filters, setFilters, resetFilters, autoRefresh, refreshInterval } = useAuditStore()
  const [ready, setReady] = useState(false)
  const [jobsOpen, setJobsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportBusy = useRef(false)
  const permissions = useAuthStore((state) => state.permissions) ?? []
  const canExport = hasPermissionWithNested(permissions, 'audit.events', 'export')
  useEffect(() => {
    const incoming = deserializeFiltersFromURL(initialParams.current)
    if (Object.keys(incoming).length) setFilters(cleanAuditFilters({ ...getDefaultFilters(), ...incoming }))
    setReady(true)
  }, [setFilters])
  useEffect(() => {
    if (!ready) return
    const params = serializeFiltersToURL(filters)
    if (params.toString() !== searchParams.toString()) setSearchParams(params, { replace: true })
  }, [ready, filters, searchParams, setSearchParams])
  const graphqlFilters = useMemo(() => auditGraphqlFilters(filters), [filters])
  const events = useQuery<{ auditEvents: AuditEventPage }>(AUDIT_EVENTS_QUERY, { variables: { filters: graphqlFilters }, errorPolicy: 'all', fetchPolicy: 'network-only', skip: !ready })
  const stats = useQuery<{ auditStats: AuditStats }>(AUDIT_STATS_QUERY, { variables: { filters: graphqlFilters }, errorPolicy: 'all', fetchPolicy: 'network-only', skip: !ready })
  const refetchEvents = events.refetch
  const refetchStats = stats.refetch
  const refresh = useCallback(() => { void refetchEvents(); void refetchStats() }, [refetchEvents, refetchStats])
  useAuditSubscription({ filters: graphqlFilters, enabled: ready, onNewEvent: refresh })
  const filterOptions = useAuditFilterOptions(ready)
  useEffect(() => {
    if (!ready || !autoRefresh) return
    const timer = setInterval(refresh, refreshInterval * 1000)
    return () => clearInterval(timer)
  }, [ready, autoRefresh, refreshInterval, refresh])
  const exportCSV = useCallback(async () => {
    if (!canExport || exportBusy.current || events.loading) return
    exportBusy.current = true; setExporting(true)
    const close = notify.loading('Preparing export...')
    try {
      const result = await client.query({ query: AUDIT_EXPORT_CSV_QUERY, variables: { filters: { ...graphqlFilters, limit: 10000 } }, errorPolicy: 'all' })
      if (result.errors?.[0]?.message) throw new Error(result.errors[0].message)
      const csv = result.data?.auditExportCSV
      if (csv) { download(csv, 'text/csv', 'csv'); notify.success('CSV file has been saved to your downloads.', 'Audit export downloaded') }
    } catch (cause) { notify.error(cause instanceof Error ? cause.message : 'Export failed', 'Export failed') }
    finally { exportBusy.current = false; setExporting(false); close() }
  }, [canExport, events.loading, client, graphqlFilters])
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('[data-audit-search-input]')?.focus() }
      if (event.key === 'f') { event.preventDefault(); document.querySelector<HTMLElement>('[data-audit-filters-bar]')?.focus() }
      if (event.key === 'e' && canExport) { event.preventDefault(); void exportCSV() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [exportCSV, canExport])
  const denied = events.error?.message.includes('Insufficient permissions') || stats.error?.message.includes('Insufficient permissions')
  if (denied) return <Page><Notice tone="warn" title="Access Denied">You don't have permission to view audit trail. The audit.events (view) permission is required. Please contact your administrator.</Notice></Page>
  const count = auditActiveFilters(filters)
  return <Page maxWidth="wide"><PageHeader title="Audit Trail" eyebrow={eyebrow} sub="View and analyze all system audit events with advanced filtering and search capabilities." actions={canExport ? <div className={styles.actions}>
    <Button onClick={() => void exportCSV()} disabled={events.loading} loading={exporting} title="Uses current date range, domain, action, and actor filters only.">Export CSV</Button>
    <Button title="Exports only the current page of events" disabled={events.loading || !events.data?.auditEvents?.items.length} onClick={() => download(JSON.stringify(events.data?.auditEvents?.items ?? [], null, 2), 'application/json', 'json')}>Export current page (JSON)</Button>
    <Button onClick={() => setJobsOpen(true)}>Export Jobs</Button>
  </div> : undefined} />
    <div className={styles.stack}>
      <div data-audit-filters-bar tabIndex={-1}><FiltersBar filters={filters} onFiltersChange={setFilters} onReset={resetFilters} options={filterOptions} /></div>
      {count > 0 && <FilterChips filters={filters} onFiltersChange={setFilters} onClearAll={resetFilters} />}
      <AuditSectionBoundary><AuditStatsCards data={stats.data?.auditStats} loading={stats.loading || !ready} error={stats.error} activeFilterCount={count} /></AuditSectionBoundary>
      <AuditSectionBoundary><Card><AuditTable data={events.data?.auditEvents} loading={events.loading || !ready} error={events.error} filters={filters} onFiltersChange={setFilters} onRefresh={refresh} /></Card></AuditSectionBoundary>
    </div>
    {canExport && <ExportJobsModal open={jobsOpen} onClose={() => setJobsOpen(false)} currentFiltersJson={graphqlFilters as unknown as Record<string, unknown>} />}
  </Page>
}
