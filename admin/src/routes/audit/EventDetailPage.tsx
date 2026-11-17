import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import { ROUTES } from '@/shared/core/constants'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { AUDIT_EVENTS_QUERY } from '@/modules/audit/graphql/queries'
import { formatEvent } from '@/modules/audit/services/auditService'
import { getResourceNavigationPath, getActorNavigationPath } from '@/modules/audit/utils/resourceNavigation'
import type { AuditEventPage } from '@/modules/audit/types'
import { copyToClipboard } from '@/shared/utils/clipboard'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { StatusPill } from '@/ui/components/StatusPill'
import { LoadingState } from '@/ui/components/LoadingState'
import { Notice } from '@/ui/components/Notice'
import { AnnotationsSection } from './components/AnnotationsSection'
import styles from './EventDetailPage.module.css'

export default function EventDetailPage() {
  return <RBACGuard required={[{ domain: 'audit.events', actions: ['view'] }]}><EventDetailPageContent /></RBACGuard>
}
function EventDetailPageContent() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const eyebrow = usePageEyebrow()
  const { data, loading, error } = useQuery<{ auditEvents: AuditEventPage }>(AUDIT_EVENTS_QUERY, {
    variables: { filters: { id, limit: 1 } }, errorPolicy: 'all', skip: !id,
  })
  const event = data?.auditEvents?.items?.[0]
  const header = <PageHeader title="Audit Detail Page" eyebrow={eyebrow}
    meta={event ? `Audit ID: ${event.id}` : undefined}
    back={{ to: ROUTES.AUDIT_EVENTS, label: 'Back to Audit Trail' }} />
  if (loading && !data) return <Page>{header}<LoadingState label="Loading audit event" /></Page>
  if (error && !data) return <Page>{header}<Notice tone="error" title="Error">Failed to load audit event: {error.message}</Notice></Page>
  if (!event) return <Page>{header}<Notice tone="warn" title="Not Found">Audit event not found</Notice></Page>
  const formatted = formatEvent(event)
  const resourceNav = getResourceNavigationPath(event.resourceType, event.resourceId, event)
  const actorNav = event.actor ? getActorNavigationPath(event.actor.type, event.actor.id) : null
  const copy = (value: string, message: string) => { void copyToClipboard(value, message) }
  return (
    <Page maxWidth="wide">{header}
      <div className={styles.layout}>
        <div className={styles.stack}>
          <Card title="Event Information">
            <DescriptionList items={[
              { term: 'Audit ID', value: <div className={styles.inline}><code>{event.id}</code>
                <Button size="sm" onClick={() => copy(event.id, 'Event ID copied!')}>Copy Audit ID</Button></div> },
              { term: 'Domain', value: <StatusPill>{event.domain}</StatusPill> },
              { term: 'Action', value: <StatusPill>{event.action}</StatusPill> },
              { term: 'Resource Type', value: event.resourceType },
              { term: 'Resource ID', value: <div className={styles.inline}><code>{event.resourceId}</code>
                {resourceNav.available ? <Button size="sm" onClick={() => navigate(resourceNav.path)}>View Resource</Button> : null}</div> },
              { term: 'Actor', value: <div className={styles.stackSmall}><span>{event.actor?.name || event.actorId}</span>
                {event.actor?.email ? <span className={styles.secondary}>{event.actor.email}</span> : null}
                {actorNav?.available ? <Button size="sm" onClick={() => navigate(actorNav.path)}>View Profile</Button> : null}</div> },
              ...(event.actor?.role ? [{ term: 'Role', value: event.actor.role }] : []),
              { term: 'Timestamp', value: <div className={styles.stackSmall}><span>{formatted.formattedTimestamp}</span>
                <span>{formatted.formattedTime}</span><span className={styles.secondary}>{formatted.relativeTime}</span></div> },
              { term: 'Tenant', value: event.tenant },
            ]} />
          </Card>
          {event.before || event.after ? <Card title="Change Data">
            <div className={styles.changes}>
              {event.before ? <section aria-label="Before data">
                <div className={styles.inline}><h3 className={styles.before}>Before</h3>
                  <Button size="sm" onClick={() => copy(JSON.stringify(event.before, null, 2), 'Before data copied!')}>Copy Before</Button></div>
                <pre className={styles.json}>{JSON.stringify(event.before, null, 2)}</pre>
              </section> : null}
              {event.after ? <section aria-label="After data">
                <div className={styles.inline}><h3 className={styles.after}>After</h3>
                  <Button size="sm" onClick={() => copy(JSON.stringify(event.after, null, 2), 'After data copied!')}>Copy After</Button></div>
                <pre className={styles.json}>{JSON.stringify(event.after, null, 2)}</pre>
              </section> : null}
            </div>
          </Card> : null}
          <Card title="Raw JSON" tools={<Button size="sm" onClick={() => copy(JSON.stringify(event, null, 2), 'JSON copied!')}>Copy All</Button>}>
            <pre className={styles.json}>{JSON.stringify(event, null, 2)}</pre>
          </Card>
        </div>
        <aside className={styles.notes} aria-label="Audit notes"><Card title="Notes"><AnnotationsSection auditEventId={event.id} /></Card></aside>
      </div>
    </Page>
  )
}
