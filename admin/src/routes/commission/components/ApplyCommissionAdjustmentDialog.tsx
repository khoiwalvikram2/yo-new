import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { Dialog } from '@/ui/components/Dialog'
import { Button } from '@/ui/components/Button'
import { Select } from '@/ui/components/Select'
import { Notice } from '@/ui/components/Notice'
import { LoadingState } from '@/ui/components/LoadingState'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { notify } from '@/shared/services/notification'
import { APPLY_COMMISSION_ADJUSTMENT_MUTATION, COMMISSION_CYCLES_FOR_AGENT_QUERY } from '@/lib/graphql/settlements'
import { cycleRangeLabel, type CommissionCycleRow } from '../commissionOverviewModel'
import {
  adjustmentEffect,
  adjustmentTargetCycles,
  adjustmentWeekLabel,
  applyAdjustmentInput,
  deductionExceedsPayable,
  type CommissionAdjustmentRow,
} from '../commissionAdjustmentsModel'
import styles from './CommissionAdjustments.module.css'

export interface ApplyCommissionAdjustmentDialogProps {
  open: boolean
  agentId: string
  adjustment: CommissionAdjustmentRow | null
  onClose: () => void
  /** Called after the backend applied the adjustment (the dialog has closed). */
  onSaved?: () => void
}

/**
 * Apply a PENDING adjustment to one unpaid week: a CLOSED_UNSETTLED week or the open week. The amount joins that week's
 * payable, and the week it corrects stops reporting UNRESOLVED_ADJUSTMENT. The backend refuses a paid target.
 */
export function ApplyCommissionAdjustmentDialog({ open, agentId, adjustment, onClose, onSaved }: ApplyCommissionAdjustmentDialogProps) {
  const { formatAmount, convertFromWhitelabelCurrency } = useCurrency()
  const money = (value: number) => formatAmount(convertFromWhitelabelCurrency(Number(value || 0)))
  const [targetKey, setTargetKey] = useState<string | null>(null)

  const { data, loading, error } = useQuery<{ commissionCyclesForAgent?: CommissionCycleRow[] }>(COMMISSION_CYCLES_FOR_AGENT_QUERY, {
    variables: { agentId }, skip: !open || !agentId, fetchPolicy: 'network-only',
  })
  const allCycles = data?.commissionCyclesForAgent
  const targets = useMemo(() => adjustmentTargetCycles(allCycles), [allCycles])
  const target = targets.find((row) => row.from === targetKey) ?? targets[0]

  useEffect(() => { if (!open) setTargetKey(null) }, [open])

  const [applyAdjustment, { loading: saving }] = useMutation<{ applyCommissionAdjustment?: { success: boolean; message?: string | null } | null }>(APPLY_COMMISSION_ADJUSTMENT_MUTATION, {
    onCompleted: (result) => {
      const payload = result.applyCommissionAdjustment
      if (payload?.success) {
        notify.success(payload.message ?? 'Adjustment applied', 'Success')
        onClose()
        onSaved?.()
      } else notify.error(payload?.message ?? 'Apply refused', 'Error')
    },
    onError: (failure) => notify.error(failure.message || 'Apply error', 'Error'),
  })

  const amount = Number(adjustment?.amount ?? 0)
  const input = applyAdjustmentInput(adjustment?.id, target)
  const close = () => { if (!saving) onClose() }
  const targetLabel = (row: CommissionCycleRow) =>
    `${cycleRangeLabel(row)} · ${row.status === 'OPEN' ? 'current week' : `payable ${row.payableAmount != null ? money(Number(row.payableAmount)) : '—'}`}`

  return <Dialog open={open} onOpenChange={(next) => { if (!next) close() }} title="Apply adjustment" size="md" dismissible={!saving}
    footer={<div className={styles.actions}>
      <Button onClick={close} aria-disabled={saving}>Cancel</Button>
      <Button variant="primary" loading={saving} disabled={!input}
        onClick={() => { if (input && !saving) void applyAdjustment({ variables: { input } }).catch(() => undefined) }}>Apply adjustment</Button>
    </div>}>
    <div className={styles.stack}>
      {adjustment && <DescriptionList items={[
        // Coloured and worded: the colour never carries the meaning alone.
        { term: 'Amount', value: <span className={amount < 0 ? styles.negative : styles.positive}>{`${amount < 0 ? '-' : '+'}${money(Math.abs(amount))} · ${adjustmentEffect(amount)}`}</span> },
        { term: 'Week it corrects', value: adjustmentWeekLabel(adjustment.sourceCycleFrom, adjustment.sourceCycleTo) },
        { term: 'Reason', value: adjustment.reason },
      ]} />}
      {loading && !allCycles ? <LoadingState label="Loading unpaid weeks" /> : error ? <Notice tone="error">{error.message}</Notice> :
        !target ? <Notice tone="info" title="No unpaid week">Every week of this agent is paid, so there is nowhere to apply the adjustment. A paid week cannot take one.</Notice> : <>
          <Select label="Apply to week" layout="stacked" value={target.from} onChange={setTargetKey}
            options={targets.map((row) => ({ value: row.from, label: targetLabel(row) }))} />
          {deductionExceedsPayable(amount, target) && <Notice tone="warn" title="Deduction larger than the payable">
            This week's payable is {money(Number(target.payableAmount ?? 0))}. The payable stops at 0, and the rest of the deduction is not carried to another week.
          </Notice>}
          <p className={styles.muted}>The amount joins the chosen week's payable (a deduction lowers it). Unpaid closed weeks and the current week are listed; a paid week cannot take an adjustment.</p>
        </>}
    </div>
  </Dialog>
}
