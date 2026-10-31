import { useId, useState } from 'react'
import { useQuery } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import { AUDIT_EVENTS_QUERY } from '@/modules/audit/graphql/queries'
import { getUnifiedDiff, countChanges, computeDiff } from '@/modules/audit/services/diffService'
import { getResourceNavigationPath, getActorNavigationPath } from '@/modules/audit/utils/resourceNavigation'
import type { AuditEvent, AuditEventPage } from '@/modules/audit/types'
import { formatEvent } from '@/modules/audit/services/auditService'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { copyToClipboard } from '@/shared/utils/clipboard'
import { Drawer } from '@/ui/components/Drawer'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { StatusPill } from '@/ui/components/StatusPill'
import { Button } from '@/ui/components/Button'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { AnnotationsSection } from './AnnotationsSection'
import styles from '../AuditEvents.module.css'
type Tab = 'diff' | 'before' | 'after' | 'relatedResource' | 'relatedActor' | 'notes' | 'raw'
export function AuditDetailsDrawer({ open, onClose, event }: { open: boolean; onClose: () => void; event: AuditEvent | null }) {
  const navigate = useNavigate()
  const { formatDate, formatTime } = useFormatDate()
  const [tab, setTab] = useState<Tab>('diff')
  const prefix = useId()
  const resource = useQuery<{ auditEvents: AuditEventPage }>(AUDIT_EVENTS_QUERY, { variables: { filters: { resourceId: event?.resourceId, limit: 10 } }, skip: !open || !event?.resourceId, errorPolicy: 'all' })
  const actor = useQuery<{ auditEvents: AuditEventPage }>(AUDIT_EVENTS_QUERY, { variables: { filters: { actorId: event?.actorId, limit: 10 } }, skip: !open || !event?.actorId, errorPolicy: 'all' })
  if (!event) return null
  const relatedResource = (resource.data?.auditEvents?.items ?? []).filter((row) => row.id !== event.id)
  const relatedActor = (actor.data?.auditEvents?.items ?? []).filter((row) => row.id !== event.id)
  const changes = event.before && event.after ? countChanges(computeDiff(event.before, event.after)) : { added: 0, removed: 0, modified: 0 }
  const diff = event.before && event.after ? getUnifiedDiff(event.before, event.after) : ''
  const resourceNav = getResourceNavigationPath(event.resourceType, event.resourceId)
  const actorNav = event.actor ? getActorNavigationPath(event.actor.type, event.actor.id) : null
  const copy = (value: unknown, message: string) => { void copyToClipboard(JSON.stringify(value, null, 2), message) }
  const related = tab === 'relatedResource' ? relatedResource : relatedActor
  const relatedQuery = tab === 'relatedResource' ? resource : actor
  const raw = tab === 'before' ? event.before : tab === 'after' ? event.after : event
  return <Drawer title="Audit Event Details" open={open} onOpenChange={(next) => { if (!next) onClose() }} size="lg">
    <div className={styles.stack}>
      <DescriptionList className={styles.description} items={[
        { term: 'Domain', value: <StatusPill>{event.domain}</StatusPill> }, { term: 'Action', value: <StatusPill>{event.action}</StatusPill> },
        { term: 'Actor', value: <div className={styles.actions}>{event.actor?.name || event.actorId}{actorNav?.available && <Button variant="link" size="xs" onClick={() => navigate(actorNav.path)}>View Profile</Button>}</div> },
        { term: 'Timestamp', value: <div>{event.timestamp ? formatDate(event.timestamp, 'MMM d, yyyy') : '—'}<div className={styles.secondary}>{event.timestamp ? formatTime(event.timestamp, 'hh:mm:ss a') : '—'}</div><div className={styles.secondary}>{formatEvent(event).relativeTime}</div></div> },
        { term: 'Resource Type', value: event.resourceType }, { term: 'Resource ID', value: <div className={styles.actions}><code className={styles.code}>{event.resourceId}</code>{resourceNav.available && <Button size="xs" variant="link" onClick={() => navigate(resourceNav.path)}>View Resource</Button>}</div> },
      ]} />
      <div className={styles.tabs}><Tabs value={tab} onChange={setTab} label="Audit detail sections" idPrefix={prefix} items={[
        { value: 'diff', label: `Unified Diff (${changes.added + changes.removed + changes.modified})` }, { value: 'before', label: 'Before' }, { value: 'after', label: 'After' },
        { value: 'relatedResource', label: `Related by Resource (${relatedResource.length})` }, { value: 'relatedActor', label: `Related by Actor (${relatedActor.length})` }, { value: 'notes', label: 'Notes' }, { value: 'raw', label: 'Raw JSON' },
      ]} /></div>
      <div role="tabpanel" id={tabPanelId(prefix, tab)} aria-labelledby={tabId(prefix, tab)} className={styles.stack}>
        {tab === 'diff' ? changes.added + changes.removed + changes.modified > 0 ? <><p className={styles.secondary}>{changes.added} added, {changes.removed} removed, {changes.modified} modified</p><pre className={styles.json} tabIndex={0} aria-label="Unified diff">{diff}</pre></> : <EmptyState title="No changes" /> :
          tab === 'notes' ? <AnnotationsSection auditEventId={event.id} /> :
          tab === 'relatedResource' || tab === 'relatedActor' ? <>
            {relatedQuery.error && <Notice tone="error">{relatedQuery.error.message}</Notice>}
            {relatedQuery.loading ? <LoadingState label="Loading related events" /> : related.length ? related.map((row) => <div key={row.id} className={styles.row}>
              <div className={styles.actions}><StatusPill>{row.domain}</StatusPill><StatusPill>{row.action}</StatusPill>{tab === 'relatedActor' && <span className={styles.secondary}>{row.resourceType}</span>}<span className={styles.secondary}>{formatEvent(row).relativeTime}</span></div>
              <Button variant="link" size="sm" onClick={() => navigate(`/audit/events/${row.id}`)}>View</Button>
            </div>) : <EmptyState title={tab === 'relatedResource' ? 'No other events for this resource' : 'No other events by this actor'} />}
          </> : raw ? <><div className={styles.actions}><Button size="sm" onClick={() => copy(raw, tab === 'before' ? 'Before data copied!' : tab === 'after' ? 'After data copied!' : 'JSON copied!')}>{tab === 'raw' ? 'Copy All' : 'Copy'}</Button></div><pre className={styles.json} tabIndex={0} aria-label={tab === 'raw' ? 'Raw JSON' : `${tab} state`}>{JSON.stringify(raw, null, 2)}</pre></> : <EmptyState title={tab === 'before' ? 'No before state' : 'No after state'} />}
      </div>
    </div>
  </Drawer>
}
