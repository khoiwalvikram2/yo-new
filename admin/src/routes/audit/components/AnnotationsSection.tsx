import { useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { z } from 'zod'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { AUDIT_ANNOTATIONS_QUERY } from '@/modules/audit/graphql/queries'
import { CREATE_AUDIT_ANNOTATION, UPDATE_AUDIT_ANNOTATION, DELETE_AUDIT_ANNOTATION } from '@/modules/audit/graphql/mutations'
import type { AuditAnnotation } from '@/modules/audit/types'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Form } from '@/ui/components/Form'
import { Textarea } from '@/ui/components/Textarea'
import { LoadingState } from '@/ui/components/LoadingState'
import { EmptyState } from '@/ui/components/EmptyState'
import { Notice } from '@/ui/components/Notice'
import { toast } from '@/ui/components/toast'
import { useForm } from '@/ui/form/useForm'
import styles from '../EventDetailPage.module.css'

dayjs.extend(relativeTime)
const noteSchema = z.object({ note: z.string().min(1, 'Note is required').max(1000, 'Note cannot exceed 1000 characters') })
export function AnnotationsSection({ auditEventId }: { auditEventId: string }) {
  const { formatDateTime } = useFormatDate()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [createRevision, setCreateRevision] = useState(0)
  const { data, loading, error, refetch } = useQuery<{ auditAnnotations: AuditAnnotation[] }>(AUDIT_ANNOTATIONS_QUERY, {
    variables: { auditEventId }, errorPolicy: 'all', fetchPolicy: 'cache-and-network',
  })
  const [createAnnotation] = useMutation(CREATE_AUDIT_ANNOTATION, {
    onCompleted: () => {
      toast({ tone: 'ok', message: 'Annotation added' }); setCreateRevision((value) => value + 1); void refetch()
    },
    onError: (err) => toast({ tone: 'error', title: 'Failed to create annotation', message: err.message }),
  })
  const [updateAnnotation] = useMutation(UPDATE_AUDIT_ANNOTATION, {
    onCompleted: () => { toast({ tone: 'ok', message: 'Annotation updated' }); setEditingId(null); void refetch() },
    onError: (err) => toast({ tone: 'error', title: 'Failed to update annotation', message: err.message }),
  })
  const [deleteAnnotation, { loading: deleting }] = useMutation(DELETE_AUDIT_ANNOTATION, {
    onCompleted: () => { toast({ tone: 'ok', message: 'Annotation deleted' }); void refetch() },
    onError: (err) => toast({ tone: 'error', title: 'Failed to delete annotation', message: err.message }),
  })
  const annotations = data?.auditAnnotations || []
  return (
    <div className={styles.stack}>
      <Card title="Add Note" headingLevel={3}>
        <AnnotationEditor key={createRevision} onSubmit={async (note) => {
          await createAnnotation({ variables: { input: { auditEventId, note: note.trim() } } })
        }} />
      </Card>
      {error ? <Notice tone="error">{error.message}</Notice> : null}
      {loading && !data ? <LoadingState label="Loading annotations..." minHeight={192} /> :
        annotations.length ? <div className={styles.annotationList}>
          {annotations.map((annotation) => <Card key={annotation.id}>
            {editingId === annotation.id ?
              <AnnotationEditor key={annotation.id} initialNote={annotation.note} editing
                onCancel={() => setEditingId(null)}
                onSubmit={async (note) => { await updateAnnotation({ variables: { input: { id: annotation.id, note: note.trim() } } }) }} /> :
              <div className={styles.stackSmall}>
                <p className={styles.note}>{annotation.note}</p>
                <div className={styles.secondary}>
                  <div>Created: {formatDateTime(annotation.createdAt, 'MMM d, yyyy h:mm a')}</div>
                  {annotation.updatedAt ? <div>Updated: {formatDateTime(annotation.updatedAt, 'MMM d, yyyy h:mm a')} ({dayjs(annotation.updatedAt).fromNow()})</div> : null}
                </div>
                <div className={styles.inline}>
                  <Button size="sm" onClick={() => setEditingId(annotation.id)}>Edit</Button>
                  <Button size="sm" aria-disabled={deleting} onClick={() => {
                    void deleteAnnotation({ variables: { id: annotation.id } }).catch(() => undefined)
                  }}>Delete</Button>
                </div>
              </div>}
          </Card>)}
        </div> : <EmptyState title="No annotations yet" />}
    </div>
  )
}
function AnnotationEditor({ initialNote = '', onSubmit, onCancel, editing = false }: {
  initialNote?: string; onSubmit: (note: string) => Promise<void>; onCancel?: () => void; editing?: boolean
}) {
  const form = useForm({ schema: noteSchema, initialValues: { note: initialNote },
    onSubmit: async (values) => { await onSubmit(values.note) } })
  return (
    <Form onSubmit={form.handleSubmit} errorAnnouncement={form.errorAnnouncement}
      errorAnnouncementRevision={form.errorAnnouncementRevision}>
      <Textarea label={editing ? 'Edit note' : 'Note'} {...form.field('note')}
        placeholder="Enter your note here..." rows={4} showCount maxLength={1000} required />
      {form.formError ? <Notice tone="error">{form.formError}</Notice> : null}
      <div className={styles.inline}>
        <Button type="submit" variant="primary" loading={form.submitting}>{editing ? 'Save' : 'Add Note'}</Button>
        {onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
      </div>
    </Form>
  )
}
