import { useState } from 'react'
import { useMutation, useQuery, gql } from '@apollo/client'
import clsx from 'clsx'
import { IconPlus } from '@tabler/icons-react'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { Checkbox } from '@/ui/components/Checkbox'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { Dialog } from '@/ui/components/Dialog'
import { EmptyState } from '@/ui/components/EmptyState'
import { Form } from '@/ui/components/Form'
import { Notice } from '@/ui/components/Notice'
import { Spinner } from '@/ui/components/Spinner'
import { StatusPill, StatusPill as Tag } from '@/ui/components/StatusPill'
import { Textarea } from '@/ui/components/Textarea'
import { TextField } from '@/ui/components/TextField'
import { strokeFor } from '@/ui/components/icons'
import { useForm } from '@/ui/form/useForm'
import { PLAYER_NOTE_INITIAL, playerNoteInput, playerNoteSchema } from '../profileModel'
import styles from '../PlayerProfile.module.css'
const PLAYER_NOTES_QUERY = gql`
  query PlayerNotes($playerId: ID!) {
    playerNotes(playerId: $playerId) {
      id
      content
      category
      tags
      isPinned
      createdBy
      createdAt
      updatedAt
    }
  }
`

const ADD_PLAYER_NOTE_MUTATION = gql`
  mutation AddPlayerNote($input: AddPlayerNoteInput!) {
    addPlayerNote(input: $input) {
      success
      message
      note { id }
    }
  }
`

const PLAYER_COMM_LOG_QUERY = gql`
  query PlayerCommLog($playerId: ID!, $limit: Int) {
    playerCommLog(playerId: $playerId, limit: $limit) {
      id
      type
      channel
      template
      status
      sentAt
      deliveredAt
      openedAt
      clickedAt
      bounced
      metadata
    }
  }
`


interface Note { id: string; content: string; category?: string; tags?: string[]; isPinned?: boolean; createdBy?: string; createdAt?: string; updatedAt?: string }
interface Communication { id: string; type?: string; channel?: string; template?: string; status?: string; sentAt?: string; deliveredAt?: string; openedAt?: string; bounced?: boolean }
export function NotesCommsTab({ playerId }: { playerId: string }) {
  const { formatDate, formatTime, formatDateTime } = useFormatDate()
  const [noteModalVisible, setNoteModalVisible] = useState(false)
  const [addNote, { loading: savingNote }] = useMutation(ADD_PLAYER_NOTE_MUTATION)
  const notesQuery = useQuery<{ playerNotes: Note[] }>(PLAYER_NOTES_QUERY, { variables: { playerId }, errorPolicy: 'all' })
  const commQuery = useQuery<{ playerCommLog: Communication[] }>(PLAYER_COMM_LOG_QUERY, { variables: { playerId, limit: 50 }, errorPolicy: 'all' })
  const notes = notesQuery.data?.playerNotes || []
  const communications = commQuery.data?.playerCommLog || []
  const pinned = notes.filter((note) => note.isPinned)
  const ordered = [...pinned, ...notes.filter((note) => !note.isPinned)]
  const form = useForm({ schema: playerNoteSchema, initialValues: PLAYER_NOTE_INITIAL, onSubmit: async (values) => {
    const result = await addNote({ variables: { input: playerNoteInput(playerId, values) } })
    if (!result.data?.addPlayerNote?.success) throw new Error(result.data?.addPlayerNote?.message || 'Failed to add note')
    setNoteModalVisible(false); form.reset(); await notesQuery.refetch()
  } })
  const close = () => { setNoteModalVisible(false); form.reset() }
  const busy = savingNote || form.submitting
  const timeCell = (value?: string) => value ? <div><p>{formatDate(value, 'dd MMM yyyy')}</p><p className={styles.subtle}>{formatTime(value, 'HH:mm')}</p></div> : '—'
  const columns: DataTableColumn<Communication>[] = [
    { key: 'type', header: 'Type', cell: (row) => <Tag>{row.type}</Tag> },
    { key: 'channel', header: 'Channel', cell: (row) => row.channel || '—' },
    { key: 'template', header: 'Template', cell: (row) => row.template || '—' },
    { key: 'status', header: 'Status', cell: (row) => <StatusPill tone={row.bounced ? 'neg' : row.status === 'delivered' ? 'ok' : 'warn'}>{row.bounced ? 'Bounced' : row.status}</StatusPill> },
    { key: 'sent', header: 'Sent', cell: (row) => timeCell(row.sentAt) },
    { key: 'delivered', header: 'Delivered', cell: (row) => timeCell(row.deliveredAt) },
    { key: 'opened', header: 'Opened', cell: (row) => timeCell(row.openedAt) },
  ]
  return <div className={styles.stack}>
    <Card title="Internal Notes" sub={`${notes.length} note${notes.length !== 1 ? 's' : ''} • ${pinned.length} pinned`} tools={<RBACGuard required={[{ domain: 'players.notes', actions: ['create'] }]}><Button variant="primary" icon={<IconPlus size={16} stroke={strokeFor(16)} />} onClick={() => setNoteModalVisible(true)}>Add Note</Button></RBACGuard>}>
      {notesQuery.loading ? <div className={styles.loading} role="status"><Spinner /> Loading notes…</div> : null}
      {notesQuery.error ? <Notice tone="error" title="Notes could not be loaded" action={<Button onClick={() => void notesQuery.refetch()}>Retry</Button>}>{notesQuery.error.message}</Notice> : null}
      {!notesQuery.loading && !notes.length && !notesQuery.error ? <EmptyState title="No notes found" /> : null}
      {!notesQuery.loading ? ordered.map((note) => <article key={note.id} className={clsx(styles.note, note.isPinned && styles.pinned)}>
        <div className={styles.row}>{note.isPinned ? <StatusPill tone="warn">Pinned</StatusPill> : null}{note.category ? <Tag>{note.category}</Tag> : null}</div>
        <p className={styles.noteContent}>{note.content}</p>
        <div className={styles.row}>{note.tags?.map((tag, index) => <Tag key={`${tag}-${index}`}>{tag}</Tag>)}<span className={styles.subtle}>By {note.createdBy} • {note.createdAt ? formatDateTime(note.createdAt) : '—'}</span></div>
      </article>) : null}
    </Card>
    <Card title="Communication Log" sub={`${communications.length} ${communications.length === 1 ? 'communication' : 'communications'}`} body="table">
      {commQuery.error && commQuery.data ? <Notice tone="error" title="Some communication data could not be loaded">{commQuery.error.message}</Notice> : null}
      <DataTable rows={communications} columns={columns} rowKey={(row) => row.id} label="Communication Log" pagination={false} state={commQuery.loading ? 'loading' : commQuery.error && !commQuery.data ? 'error' : 'ready'} error={commQuery.error?.message} onRetry={() => void commQuery.refetch()} empty={<EmptyState title="No communication log entries" />} />
    </Card>
    <Dialog open={noteModalVisible} onOpenChange={(next) => { if (!next && !busy) close() }} title="Add Note" size="md" dismissible={!busy}>
      <Form onSubmit={form.handleSubmit} errorAnnouncement={form.errorAnnouncement} errorAnnouncementRevision={form.errorAnnouncementRevision} className={styles.stack}>
        {form.formError ? <Notice tone="error" title="Note not saved" live="assertive">{form.formError}</Notice> : null}
        <Textarea label="Content" {...form.field('content')} required rows={4} disabled={busy} />
        <TextField label="Category" {...form.field('category')} placeholder="e.g., Risk, Support, Payments" disabled={busy} />
        <TextField label="Tags" {...form.field('tags')} placeholder="Comma-separated tags" disabled={busy} />
        <Checkbox label="Pin this note" name="isPinned" checked={form.values.isPinned} onChange={(value) => form.setValue('isPinned', value)} disabled={busy} />
        <div className={styles.actions}><Button onClick={close} disabled={busy}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>OK</Button></div>
      </Form>
    </Dialog>
  </div>
}

