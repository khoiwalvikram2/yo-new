import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { Dialog } from '@/ui/components/Dialog'
import { Button } from '@/ui/components/Button'
import { Select } from '@/ui/components/Select'
import { NumberField } from '@/ui/components/NumberField'
import { SegmentedControl, type SegmentedOption } from '@/ui/components/SegmentedControl'
import { TextField } from '@/ui/components/TextField'
import { Notice } from '@/ui/components/Notice'
import { LoadingState } from '@/ui/components/LoadingState'
import { notify } from '@/shared/services/notification'
import { COMMISSION_CYCLES_FOR_AGENT_QUERY, CREATE_COMMISSION_ADJUSTMENT_MUTATION } from '@/lib/graphql/settlements'
import { cycleRangeLabel, type CommissionCycleRow } from '../commissionOverviewModel'
import {
  ADJUSTMENT_NOTE_MAX,
  ADJUSTMENT_REASONS,
  adjustmentSourceCycles,
  createAdjustmentInput,
  cycleStateWord,
  type AdjustmentDirection,
} from '../commissionAdjustmentsModel'
import styles from './CommissionAdjustments.module.css'

const DIRECTIONS: readonly SegmentedOption<AdjustmentDirection>[] = [
  { value: 'add', label: 'Add (+)' },
  { value: 'deduct', label: 'Deduct (-)' },
]

export interface NewCommissionAdjustmentDialogProps {
  open: boolean
  agentId: string
  username?: string | null
  onClose: () => void
  /** Called after the backend accepted the adjustment (the dialog has closed). */
  onSaved?: () => void
}

/**
 * Raise a commission adjustment against one closed IST week of a COMMISSION agent (admins only). It stays PENDING
 * until it is applied to an unpaid week, and while it is pending the week it corrects cannot be paid
 * (readiness UNRESOLVED_ADJUSTMENT). The backend validates the week, the amount and the agent again.
 */
export function NewCommissionAdjustmentDialog({ open, agentId, username, onClose, onSaved }: NewCommissionAdjustmentDialogProps) {
  const [sourceKey, setSourceKey] = useState<string | null>(null)
  const [direction, setDirection] = useState<AdjustmentDirection>('add')
  const [amount, setAmount] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')

  const { data, loading, error } = useQuery<{ commissionCyclesForAgent?: CommissionCycleRow[] }>(COMMISSION_CYCLES_FOR_AGENT_QUERY, {
    variables: { agentId }, skip: !open || !agentId, fetchPolicy: 'network-only',
  })
  const allCycles = data?.commissionCyclesForAgent
  const cycles = useMemo(() => adjustmentSourceCycles(allCycles), [allCycles])
  const source = cycles.find((row) => row.from === sourceKey) ?? cycles[0]

  useEffect(() => {
    if (!open) { setSourceKey(null); setDirection('add'); setAmount(null); setReason(''); setNote('') }
  }, [open])

  const [createAdjustment, { loading: saving }] = useMutation<{ createCommissionAdjustment?: { success: boolean; message?: string | null } | null }>(CREATE_COMMISSION_ADJUSTMENT_MUTATION, {
    onCompleted: (result) => {
      const payload = result.createCommissionAdjustment
      if (payload?.success) {
        notify.success(payload.message ?? 'Adjustment created', 'Success')
        onClose()
        onSaved?.()
      } else notify.error(payload?.message ?? 'Adjustment refused', 'Error')
    },
    onError: (failure) => notify.error(failure.message || 'Adjustment error', 'Error'),
  })

  const input = createAdjustmentInput(agentId, source, direction, amount, reason, note)
  const close = () => { if (!saving) onClose() }

  return <Dialog open={open} onOpenChange={(next) => { if (!next) close() }} title={`New adjustment — ${username ?? 'Agent'}`} size="md" dismissible={!saving}
    footer={<div className={styles.actions}>
      <Button onClick={close} aria-disabled={saving}>Cancel</Button>
      <Button variant="primary" loading={saving} disabled={!input}
        onClick={() => { if (input && !saving) void createAdjustment({ variables: { input } }).catch(() => undefined) }}>Create adjustment</Button>
    </div>}>
    <div className={styles.stack}>
      {loading && !allCycles ? <LoadingState label="Loading closed weeks" /> : error ? <Notice tone="error">{error.message}</Notice> :
        !source ? <Notice tone="info" title="No closed week yet">An adjustment corrects a closed week (Monday to Monday, IST). This agent has none yet.</Notice> : <>
          <Select label="Week it corrects" layout="stacked" value={source.from} onChange={setSourceKey}
            options={cycles.map((row) => ({ value: row.from, label: `${cycleRangeLabel(row)} · ${cycleStateWord(row)}` }))} />
          <SegmentedControl label="Direction" value={direction} options={DIRECTIONS} onChange={setDirection} />
          <NumberField label="Amount" value={amount} onChange={setAmount} min={0} precision={2} disabled={saving}
            help="In the whitelabel's base currency."
            error={amount !== null && amount <= 0 ? 'Enter an amount above 0. Use Deduct to take commission away.' : undefined} />
          <Select label="Reason" layout="stacked" placeholder="Choose a reason" value={reason} onChange={setReason}
            options={ADJUSTMENT_REASONS.map((value) => ({ value, label: value }))} />
          <TextField label="Note (optional)" value={note} onChange={setNote} maxLength={ADJUSTMENT_NOTE_MAX} disabled={saving} />
          <p className={styles.muted}>The adjustment stays pending until it is applied to an unpaid week. While it is pending, the week it corrects cannot be paid.</p>
        </>}
    </div>
  </Dialog>
}
