import { useMutation, useQuery } from '@apollo/client'
import { useState } from 'react'
import { IconFileText } from '@tabler/icons-react'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { usePageEyebrow } from '@/shell/PageEyebrowContext'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { Page } from '@/ui/components/Page'
import { PageHeader } from '@/ui/components/PageHeader'
import { StatusPill } from '@/ui/components/StatusPill'
import { TextField } from '@/ui/components/TextField'
import { Textarea } from '@/ui/components/Textarea'
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import { ContentQuery, CreateContent, PublishContent, UpdateContent } from './contentGraphql'
import {
  CONTENT_FAILURE_MESSAGES,
  DEFAULT_CONTENT_DRAFT,
  actionKey,
  contentRows,
  createContentVariables,
  listState,
  publishContentVariables,
  rowActionLabel,
  runThenRefetch,
  updateContentVariables,
  updatedLabel,
  type ContentDraft,
  type ContentRow,
} from './contentPageModel'
import styles from './ContentPage.module.css'

/* /promotions/content on the kit (page migration Task 111). The mockup has no page for it, so it
   takes the generic page template (M:1845-1854): the page head, then cards. The documents and the
   data hooks are the legacy page's; the guard still wraps everything, so a denied caller starts no
   query and no mutation hook. */

export default function ContentPage() {
  return (
    <RBACGuard required={[{ domain: 'promotions.content', actions: ['view'] }]}>
      <ContentPageContent />
    </RBACGuard>
  )
}

function ContentPageContent() {
  const { formatDateTime } = useFormatDate()
  const { data, loading, error, refetch } = useQuery(ContentQuery, { errorPolicy: 'all' })
  const [create] = useMutation(CreateContent)
  const [update] = useMutation(UpdateContent)
  const [publish] = useMutation(PublishContent)
  const [draft, setDraft] = useState<ContentDraft>({ ...DEFAULT_CONTENT_DRAFT })
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
  const pageEyebrow = usePageEyebrow()

  const rows = contentRows(data)

  // Each button runs its own mutation and then the list refetch, as before. While that is in flight
  // the button shows a spinner and swallows clicks (kit Button `loading`), so a double click no
  // longer sends the mutation twice; a rejected mutation now says so in an error toast.
  const run = async (key: string, mutate: () => Promise<unknown>, fallback: string) => {
    setBusy((current) => new Set(current).add(key))
    const outcome = await runThenRefetch(mutate, () => refetch(), fallback)
    setBusy((current) => {
      const next = new Set(current)
      next.delete(key)
      return next
    })
    if (!outcome.ok) toast({ message: outcome.message, tone: 'error' })
  }

  const columns: DataTableColumn<ContentRow>[] = [
    { key: 'id', header: 'ID', emphasis: 'id', cell: (row) => row.id },
    { key: 'name', header: 'Name', emphasis: 'key', cell: (row) => row.name },
    { key: 'locale', header: 'Locale', cell: (row) => row.locale },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusPill status={row.status}>{row.status}</StatusPill>,
    },
    { key: 'updated', header: 'Updated', cell: (row) => updatedLabel(row.updatedAt, formatDateTime) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      sticky: 'end',
      cell: (row) => {
        const updateKey = actionKey('update', row.id)
        const publishKey = actionKey('publish', row.id)
        return (
          <div className={styles.rowActions}>
            <Button
              size="xs"
              loading={busy.has(updateKey)}
              aria-label={rowActionLabel('Update', row)}
              onClick={() => void run(
                updateKey,
                () => update({ variables: updateContentVariables(row) }),
                CONTENT_FAILURE_MESSAGES.update,
              )}
            >
              Update
            </Button>
            <Button
              size="xs"
              loading={busy.has(publishKey)}
              aria-label={rowActionLabel('Publish', row)}
              onClick={() => void run(
                publishKey,
                () => publish({ variables: publishContentVariables(row.id) }),
                CONTENT_FAILURE_MESSAGES.publish,
              )}
            >
              Publish
            </Button>
          </div>
        )
      },
    },
  ]

  const createKey = actionKey('create')

  return (
    <Page maxWidth="wide">
      <PageHeader eyebrow={pageEyebrow} title="Content" />

      <div className={styles.content}>
        <Card title="Create Content">
          <div className={styles.createForm}>
            <div className={styles.createGrid}>
              <TextField
                label="Name"
                placeholder="Name"
                value={draft.name}
                onChange={(name) => setDraft({ ...draft, name })}
              />
              <TextField
                label="Locale"
                placeholder="Locale"
                value={draft.locale}
                onChange={(locale) => setDraft({ ...draft, locale })}
              />
              <Textarea
                className={styles.fullRow}
                label="Body"
                placeholder="Body"
                value={draft.body}
                onChange={(body) => setDraft({ ...draft, body })}
              />
              <div className={styles.createActions}>
                <Button
                  variant="primary"
                  loading={busy.has(createKey)}
                  onClick={() => void run(
                    createKey,
                    () => create({ variables: createContentVariables(draft) }),
                    CONTENT_FAILURE_MESSAGES.create,
                  )}
                >
                  Create
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Content" body="table">
          <DataTable
            label="Content"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            state={listState(loading, error)}
            error={error?.message}
            onRetry={() => void refetch().catch(() => undefined)}
            empty={(
              <EmptyState
                title="No content"
                icon={<IconFileText size={20} stroke={strokeFor(20)} />}
              />
            )}
          />
        </Card>
      </div>
    </Page>
  )
}

