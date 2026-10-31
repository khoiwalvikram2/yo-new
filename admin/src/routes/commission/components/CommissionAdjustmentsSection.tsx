import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { useLocation } from 'react-router-dom'
import { Card } from '@/ui/components/Card'
import { Button } from '@/ui/components/Button'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog'
import { DataTable, type DataTableColumn } from '@/ui/components/DataTable'
import { StatusPill } from '@/ui/components/StatusPill'
import { useAuthStore } from '@/shared/core/authStore'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'
import { notify } from '@/shared/services/notification'
import { CANCEL_COMMISSION_ADJUSTMENT_MUTATION, COMMISSION_ADJUSTMENTS_PAGE_QUERY } from '@/lib/graphql/settlements'
import { paidAtLabel } from '../commissionHistoryModel'
import {
  COMMISSION_ADJUSTMENTS_SECTION_ID,
  adjustmentEffect,
  adjustmentStatusLabel,
  adjustmentStatusTone,
  adjustmentWeekLabel,
  type CommissionAdjustmentRow,
} from '../commissionAdjustmentsModel'
import { ApplyCommissionAdjustmentDialog } from './ApplyCommissionAdjustmentDialog'
import { NewCommissionAdjustmentDialog } from './NewCommissionAdjustmentDialog'
import styles from './CommissionAdjustments.module.css'

export interface CommissionAdjustmentsSectionProps {
  agentId: string
  /** Shown in the New adjustment dialog's title. */
  username?: string | null
}

/**
 * A COMMISSION agent's post-close commission adjustments (agent features, section 2). Admins holding
 * settlements.commission:create raise, apply and cancel them. Agents only read them (owner decision 3): their own on
 * /commission/history and their sub-agents' on the profile. Opening the page at #commission-adjustments, the Pay
 * dialog's "Review adjustments" link, scrolls this card into view.
 */
export function CommissionAdjustmentsSection({ agentId, username }: CommissionAdjustmentsSectionProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(Number(value || 0)))
  const signed = (amount: number) => `${amount < 0 ? '-' : '+'}${money(Math.abs(amount))}`
  const agentLogin = useAuthStore((state) => state.agent)
  const permissions = useAuthStore((state) => state.permissions)
  const canManage = !agentLogin && hasPermissionWithNested(permissions, 'settlements.commission', 'create')
  const { hash } = useLocation()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [creating, setCreating] = useState(false)
  const [applying, setApplying] = useState<CommissionAdjustmentRow | null>(null)
  const [cancelling, setCancelling] = useState<CommissionAdjustmentRow | null>(null)

  const { data, loading, error, refetch } = useQuery<{ commissionAdjustmentsPage?: { items: CommissionAdjustmentRow[]; total: number } | null }>(COMMISSION_ADJUSTMENTS_PAGE_QUERY, {
    variables: { agentId, limit: pageSize, offset: (page-1)*pageSize }, skip: !agentId, fetchPolicy: 'cache-and-network', notifyOnNetworkStatusChange: true, errorPolicy: 'all',
  })
  const rows = data?.commissionAdjustmentsPage?.items ?? []
  const reload = () => { void refetch() }
  const [cancelAdjustment] = useMutation<{ cancelCommissionAdjustment?: { success: boolean; message?: string | null } | null }>(CANCEL_COMMISSION_ADJUSTMENT_MUTATION)

  useEffect(() => {
    if (hash === `#${COMMISSION_ADJUSTMENTS_SECTION_ID}`) document.getElementById(COMMISSION_ADJUSTMENTS_SECTION_ID)?.scrollIntoView({ block: 'start' })
  }, [hash])

  // ConfirmDialog shows a thrown error in place and stays open; it closes itself when this resolves.
  const confirmCancel = async () => {
    if (!cancelling) return
    const result = await cancelAdjustment({ variables: { adjustmentId: cancelling.id } })
    const payload = result.data?.cancelCommissionAdjustment
    if (!payload?.success) throw new Error(payload?.message ?? 'The adjustment could not be cancelled')
    notify.success(payload.message ?? 'Adjustment cancelled', 'Success')
    reload()
  }

  const actionsColumn: DataTableColumn<CommissionAdjustmentRow> = {
    key: 'actions',
    header: 'Actions',
    cell: (row) => row.status === 'PENDING'
      ? <span className={styles.rowActions}>
        <Button size="sm" onClick={() => setApplying(row)}>Apply</Button>
        <Button size="sm" variant="danger" onClick={() => setCancelling(row)}>Cancel</Button>
      </span>
      : null,
  }
  const columns: DataTableColumn<CommissionAdjustmentRow>[] = [
    { key: 'amount', header: 'Amount', align: 'right', cell: (row) => <span className={styles.amount}>
      <strong className={row.amount < 0 ? styles.negative : styles.positive}>{signed(row.amount)}</strong>
      <span className={styles.muted}>{adjustmentEffect(row.amount)}</span>
    </span> },
    { key: 'source', header: 'Week it corrects', cell: (row) => adjustmentWeekLabel(row.sourceCycleFrom, row.sourceCycleTo) },
    { key: 'target', header: 'Applied to week', cell: (row) => adjustmentWeekLabel(row.targetCycleFrom, row.targetCycleTo) },
    { key: 'status', header: 'Status', cell: (row) => <StatusPill tone={adjustmentStatusTone(row.status)}>{adjustmentStatusLabel(row.status)}</StatusPill> },
    { key: 'reason', header: 'Reason', cell: (row) => row.reason },
    { key: 'createdAt', header: 'Created at', cell: (row) => paidAtLabel(row.createdAt) },
    { key: 'appliedAt', header: 'Applied at', cell: (row) => (row.appliedAt ? paidAtLabel(row.appliedAt) : '—') },
    ...(canManage ? [actionsColumn] : []),
  ]

  return <Card id={COMMISSION_ADJUSTMENTS_SECTION_ID} title="Adjustments" body="table"
    sub={canManage
      ? 'Post-close corrections. A pending adjustment blocks payment of the week it corrects until it is applied or cancelled.'
      : 'Post-close corrections made by the administrator. A pending one blocks payment of the week it corrects until the administrator applies or cancels it.'}
    tools={<div className={styles.actions}>
      {canManage && <Button size="sm" variant="primary" onClick={() => setCreating(true)}>New adjustment</Button>}
      <Button size="sm" loading={loading} onClick={reload}>Refresh</Button>
    </div>}>
    <DataTable label="Commission adjustments" columns={columns} rows={rows} rowKey={(row) => row.id}
      state={loading ? 'loading' : error && !data ? 'error' : 'ready'} error={error?.message || 'Failed to load adjustments'} onRetry={reload}
      empty="No adjustments" pagination={{ current: page, pageSize, total: data?.commissionAdjustmentsPage?.total ?? 0, onChange: setPage, onPageSizeChange: size => { setPageSize(size); setPage(1) } }} />
    {canManage && <>
      <NewCommissionAdjustmentDialog open={creating} agentId={agentId} username={username} onClose={() => setCreating(false)} onSaved={reload} />
      <ApplyCommissionAdjustmentDialog open={!!applying} agentId={agentId} adjustment={applying} onClose={() => setApplying(null)} onSaved={reload} />
      <ConfirmDialog open={!!cancelling} onOpenChange={(next) => { if (!next) setCancelling(null) }} tone="danger"
        title="Cancel this adjustment?" confirmLabel="Cancel adjustment" cancelLabel="Keep it"
        description={cancelling
          ? `${signed(cancelling.amount)} for ${adjustmentWeekLabel(cancelling.sourceCycleFrom, cancelling.sourceCycleTo)} (${cancelling.reason}). A cancelled adjustment is never counted, and it stops blocking that week's payment.`
          : undefined}
        onConfirm={confirmCancel} />
    </>}
  </Card>
}
