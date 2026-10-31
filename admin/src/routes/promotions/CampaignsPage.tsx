import { useMutation, useQuery } from '@apollo/client'
import { useState } from 'react'
import { IconSpeakerphone } from '@tabler/icons-react'
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
import { strokeFor } from '@/ui/components/icons'
import { toast } from '@/ui/components/toast'
import { CreatePromotion, PausePromotion, PromotionsQuery, PublishPromotion } from './campaignsGraphql'
import {
  CAMPAIGN_FAILURE_MESSAGES,
  DEFAULT_CAMPAIGN_NAME,
  actionKey,
  createPromotionVariables,
  listState,
  promotionIdVariables,
  promotionRows,
  rowActionLabel,
  runThenRefetch,
  scheduleLabel,
  updatedLabel,
  type PromotionRow,
} from './campaignsPageModel'
import styles from './CampaignsPage.module.css'

/* /promotions/campaigns on the kit (page migration Task 110). The mockup has no page for it, so it
   takes the generic page template (M:1845-1854): the page head, then cards. The documents and the
   data hooks are the legacy page's; the guard still wraps everything, so a denied caller starts no
   query and no mutation hook. */

export default function CampaignsPage() {
  return (
    <RBACGuard required={[{ domain: 'promotions.campaigns', actions: ['view'] }]}>
      <CampaignsPageContent />
    </RBACGuard>
  )
}

function CampaignsPageContent() {
  const { formatDate, formatDateTime } = useFormatDate()
  const { data, loading, error, refetch } = useQuery(PromotionsQuery, { errorPolicy: 'all' })
  const [create] = useMutation(CreatePromotion)
  const [publish] = useMutation(PublishPromotion)
  const [pause] = useMutation(PausePromotion)
  const [name, setName] = useState(DEFAULT_CAMPAIGN_NAME)
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
  const pageEyebrow = usePageEyebrow()

  const rows = promotionRows(data)

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

  const columns: DataTableColumn<PromotionRow>[] = [
    { key: 'id', header: 'ID', emphasis: 'id', cell: (row) => row.id },
    { key: 'name', header: 'Name', emphasis: 'key', cell: (row) => row.name },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusPill status={row.status}>{row.status}</StatusPill>,
    },
    { key: 'schedule', header: 'Schedule', cell: (row) => scheduleLabel(row, formatDate) },
    { key: 'updated', header: 'Updated', cell: (row) => updatedLabel(row.updatedAt, formatDateTime) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      sticky: 'end',
      cell: (row) => {
        const publishKey = actionKey('publish', row.id)
        const pauseKey = actionKey('pause', row.id)
        return (
          <div className={styles.rowActions}>
            <Button
              size="xs"
              loading={busy.has(publishKey)}
              aria-label={rowActionLabel('Publish', row)}
              onClick={() => void run(
                publishKey,
                () => publish({ variables: promotionIdVariables(row.id) }),
                CAMPAIGN_FAILURE_MESSAGES.publish,
              )}
            >
              Publish
            </Button>
            <Button
              size="xs"
              loading={busy.has(pauseKey)}
              aria-label={rowActionLabel('Pause', row)}
              onClick={() => void run(
                pauseKey,
                () => pause({ variables: promotionIdVariables(row.id) }),
                CAMPAIGN_FAILURE_MESSAGES.pause,
              )}
            >
              Pause
            </Button>
          </div>
        )
      },
    },
  ]

  const createKey = actionKey('create')

  return (
    <Page maxWidth="wide">
      <PageHeader eyebrow={pageEyebrow} title="Campaigns" />

      <div className={styles.content}>
        <Card title="Create Campaign">
          <div className={styles.createRow}>
            <TextField
              className={styles.nameField}
              label="Campaign name"
              placeholder="Campaign name"
              value={name}
              onChange={setName}
            />
            <Button
              variant="primary"
              loading={busy.has(createKey)}
              onClick={() => void run(
                createKey,
                () => create({ variables: createPromotionVariables(name) }),
                CAMPAIGN_FAILURE_MESSAGES.create,
              )}
            >
              Create
            </Button>
          </div>
        </Card>

        <Card title="Campaigns" body="table">
          <DataTable
            label="Campaigns"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            state={listState(loading, error)}
            error={error?.message}
            onRetry={() => void refetch().catch(() => undefined)}
            empty={(
              <EmptyState
                title="No campaigns"
                icon={<IconSpeakerphone size={20} stroke={strokeFor(20)} />}
              />
            )}
          />
        </Card>
      </div>
    </Page>
  )
}

