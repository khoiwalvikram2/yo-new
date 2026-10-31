import { useCallback, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconCircleCheck,
  IconDownload,
  IconEye,
  IconInbox,
  IconPencil,
  IconPlayerPause,
  IconSend,
  IconTrash,
} from '@tabler/icons-react'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useFormatDate } from '@/shared/core/useFormatDate'
import { useTableExport } from '@/shared/hooks/useTableExport'
import { Button } from '@/ui/components/Button'
import { Card } from '@/ui/components/Card'
import { confirm } from '@/ui/components/confirm'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { EmptyState } from '@/ui/components/EmptyState'
import { IconButton } from '@/ui/components/IconButton'
import { strokeFor } from '@/ui/components/icons'
import { StatusPill } from '@/ui/components/StatusPill'
import { Tooltip } from '@/ui/components/Tooltip'
import {
  CONFIRM_LABELS,
  DELETE_CONFIRM,
  bonusAmountDisplay,
  bonusAmountTypeLabel,
  bonusDomainLabel,
  bonusExportColumns,
  bonusPlayersCell,
  bonusStatusAction,
  bonusStatusKey,
  bonusStatusLabel,
  campaignCountLabel,
  canDistribute,
  formatBonusType,
  formatDistributionType,
  isDistributed,
  type BonusCampaignRow,
} from '../bonusesListModel'
import styles from '../BonusesListPage.module.css'

/** A row action may return the mutation's promise, so its confirmation stays busy until the server answers. */
type RowAction = (id: string) => unknown

interface BonusesTableProps {
  campaigns: BonusCampaignRow[]
  loading?: boolean
  onDelete: RowAction
  onActivate?: RowAction
  onDeactivate?: RowAction
  onDistribute?: (id: string) => void
  footer?: ReactNode
}

interface RowActionsProps {
  campaign: BonusCampaignRow
  onView: () => void
  onEdit: () => void
  onDistribute?: () => void
  onStatus?: () => void
  onDelete: () => void
}

/* The legacy icon actions, in their legacy order, as named kit icon buttons with the legacy tooltips
   (`.acts` M:1034-1049 holds them in the sticky end cell). */
function RowActions({ campaign, onView, onEdit, onDistribute, onStatus, onDelete }: RowActionsProps) {
  const status = bonusStatusAction(campaign)
  return (
    <span className={styles.rowActions}>
      {onDistribute ? (
        <Tooltip content="Distribute to users">
          <IconButton
            size="sm"
            label={`Distribute ${campaign.name} to users`}
            icon={<IconSend size={15} stroke={strokeFor(15)} />}
            onClick={onDistribute}
          />
        </Tooltip>
      ) : null}
      <Tooltip content="View Details">
        <IconButton
          size="sm"
          label={`View details of ${campaign.name}`}
          icon={<IconEye size={15} stroke={strokeFor(15)} />}
          onClick={onView}
        />
      </Tooltip>
      <Tooltip content="Edit Campaign">
        <IconButton
          size="sm"
          label={`Edit ${campaign.name}`}
          icon={<IconPencil size={15} stroke={strokeFor(15)} />}
          onClick={onEdit}
        />
      </Tooltip>
      {onStatus ? (
        <Tooltip content={status.tooltip}>
          <IconButton
            size="sm"
            label={`${status.tooltip} ${campaign.name}`}
            icon={status.action === 'deactivate'
              ? <IconPlayerPause size={15} stroke={strokeFor(15)} />
              : <IconCircleCheck size={15} stroke={strokeFor(15)} />}
            onClick={onStatus}
          />
        </Tooltip>
      ) : null}
      <Tooltip content="Delete">
        <IconButton
          size="sm"
          label={`Delete ${campaign.name}`}
          icon={<IconTrash size={15} stroke={strokeFor(15)} />}
          onClick={onDelete}
        />
      </Tooltip>
    </span>
  )
}

export function BonusesTable({ campaigns, loading, onDelete, onActivate, onDeactivate, onDistribute, footer }: BonusesTableProps) {
  const navigate = useNavigate()
  const { formatAmount } = useCurrency()
  const { formatDateTime } = useFormatDate()

  const formatDateDisplay = useCallback(
    (date?: string | null) => (date ? formatDateTime(date, 'dd MMM yyyy HH:mm') : '—'),
    [formatDateTime],
  )

  const exportColumns = useMemo(
    () => bonusExportColumns(formatAmount, formatDateDisplay),
    [formatAmount, formatDateDisplay],
  )

  const { exporting, handleExport } = useTableExport({
    data: campaigns,
    columns: exportColumns,
    filename: 'Bonus-Campaigns',
    sheetName: 'Campaigns',
    title: `Bonus Campaigns — ${campaigns.length} campaign(s)`,
  })

  /* The legacy Popconfirms, now the modal confirmation (D5) with the same copy and Yes / No. The
     confirmation stays open, busy, until the mutation answers; its own toasts report the outcome. */
  const requestStatusChange = (campaign: BonusCampaignRow) => {
    const status = bonusStatusAction(campaign)
    const run = status.action === 'deactivate' ? onDeactivate : onActivate
    if (!run) return
    void confirm({
      title: status.title,
      description: status.description,
      ...CONFIRM_LABELS,
      onConfirm: async () => {
        await run(campaign.id)
      },
    })
  }

  const requestDelete = (campaign: BonusCampaignRow) => {
    void confirm({
      title: DELETE_CONFIRM.title,
      description: DELETE_CONFIRM.description,
      ...CONFIRM_LABELS,
      onConfirm: async () => {
        await onDelete(campaign.id)
      },
    })
  }

  const columns: DataTableColumn<BonusCampaignRow>[] = [
    {
      key: 'campaign',
      header: 'Campaign',
      emphasis: 'key',
      cell: (campaign) => (
        <div className={styles.stack}>
          <span className={styles.campaignName}>{campaign.name}</span>
          <span className={styles.domain}>{bonusDomainLabel(campaign.domain)}</span>
        </div>
      ),
    },
    { key: 'type', header: 'Type', cell: (campaign) => formatBonusType(campaign.type) },
    {
      key: 'status',
      header: 'Status',
      cell: (campaign) => (
        <div className={styles.statusCell}>
          <StatusPill status={bonusStatusKey(campaign.status)}>{bonusStatusLabel(campaign.status)}</StatusPill>
          {isDistributed(campaign) ? (
            <>
              <StatusPill tone="ok">Distributed</StatusPill>
              {/* The legacy tag kept its date in a hover tooltip; it is printed so every user can read it. */}
              <span className={styles.distributedOn}>{formatDateDisplay(campaign.distributedAt)}</span>
            </>
          ) : null}
        </div>
      ),
    },
    {
      key: 'distribution',
      header: 'Distribution',
      cell: (campaign) => formatDistributionType(campaign.distributionType),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (campaign) => {
        const amountType = bonusAmountTypeLabel(campaign)
        return (
          <div className={styles.stack}>
            <span className={styles.figure}>{bonusAmountDisplay(campaign, formatAmount)}</span>
            {amountType ? <span className={styles.secondary}>{amountType}</span> : null}
          </div>
        )
      },
    },
    {
      key: 'players',
      header: 'Players',
      align: 'right',
      cell: (campaign) => {
        const players = bonusPlayersCell(campaign)
        return (
          <span className={styles.players}>
            <span className={styles.playerCount}>{players.count}</span>
            {players.perPlayer ? <span className={styles.secondary}>{players.perPlayer}</span> : null}
          </span>
        )
      },
    },
    { key: 'startDate', header: 'Start Date', cell: (campaign) => formatDateDisplay(campaign.startDate) },
    { key: 'endDate', header: 'End Date', cell: (campaign) => formatDateDisplay(campaign.endDate) },
  ]

  const statusHandlerFor = (campaign: BonusCampaignRow) =>
    (bonusStatusAction(campaign).action === 'deactivate' ? onDeactivate : onActivate)

  /* The card repeats the page title (O7, M:3366) as the legacy card did; its count is the rows on this
     page, as before. The legacy gift tile is not drawn: the mockup's card head has none (M:860-867). */
  return (
    <Card
      title="Bonus Campaigns"
      sub={campaignCountLabel(campaigns.length)}
      body="table"
      tools={(
        <Button
          variant="primary"
          size="sm"
          icon={<IconDownload size={15} stroke={strokeFor(15)} />}
          loading={exporting}
          onClick={() => void handleExport()}
          disabled={!campaigns.length || !!loading}
        >
          Export Excel
        </Button>
      )}
    >
      <DataTable
        columns={columns}
        rows={campaigns}
        rowKey={(campaign) => campaign.id}
        label="Bonus campaigns"
        state={loading ? 'loading' : 'ready'}
        width="wide"
        empty={<EmptyState title="No bonus campaigns found" icon={<IconInbox size={20} stroke={strokeFor(20)} />} />}
        rowActions={(campaign) => ({
          primary: (
            <RowActions
              campaign={campaign}
              onView={() => navigate(`/bonuses/${campaign.id}`)}
              onEdit={() => navigate(`/bonuses/${campaign.id}/edit`)}
              onDistribute={canDistribute(campaign) && onDistribute ? () => onDistribute(campaign.id) : undefined}
              onStatus={statusHandlerFor(campaign) ? () => requestStatusChange(campaign) : undefined}
              onDelete={() => requestDelete(campaign)}
            />
          ),
        })}
      />
      {footer}
    </Card>
  )
}
