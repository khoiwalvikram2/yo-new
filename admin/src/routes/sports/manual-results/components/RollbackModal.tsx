import { useEffect, useId, useRef, useState } from 'react'
import { IconAlertTriangle } from '@tabler/icons-react'
import { Button } from '@/ui/components/Button'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { Dialog } from '@/ui/components/Dialog'
import { Notice } from '@/ui/components/Notice'
import { Select } from '@/ui/components/Select'
import { TextField } from '@/ui/components/TextField'
import { Textarea } from '@/ui/components/Textarea'
import { strokeFor } from '@/ui/components/icons'
import type { SportsResult } from '../../../../modules/sports/results'
import {
  ROLLBACK_CONFIRM_WORD,
  ROLLBACK_TAG_OPTIONS,
  canConfirmRollback,
  rollbackFacts,
  rollbackReasonError,
} from '../manualResultsModel'
import styles from '../ManualResultsPage.module.css'

interface RollbackModalProps {
  open: boolean
  onClose: () => void
  onConfirm: (reason: string, tag?: string) => void
  result: SportsResult | null
  busy?: boolean
  restoreFocusTo?: { readonly current: HTMLElement | null }
}

export function RollbackModal({ open, onClose, onConfirm, result, busy = false, restoreFocusTo }: RollbackModalProps) {
  const [reason, setReason] = useState('')
  const [tag, setTag] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [reasonChecked, setReasonChecked] = useState(false)
  const reasonRef = useRef<HTMLTextAreaElement | null>(null)
  const confirmHintId = useId()

  useEffect(() => {
    if (!open) return
    setReason('')
    setTag('')
    setConfirmText('')
    setReasonChecked(false)
  }, [open])

  const confirmable = canConfirmRollback(confirmText)
  const reasonError = reasonChecked ? rollbackReasonError(reason) : undefined

  const handleSubmit = () => {
    setReasonChecked(true)
    if (rollbackReasonError(reason)) {
      reasonRef.current?.focus()
      return
    }
    if (confirmable) onConfirm(reason, tag || undefined)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title="Rollback Result"
      size="md"
      role="alertdialog"
      initialFocus={reasonRef}
      restoreFocusTo={restoreFocusTo}
      footer={(
        <div className={styles.dialogFooter}>
          <Button size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="dangerSolid"
            size="sm"
            loading={busy}
            aria-disabled={!confirmable || undefined}
            aria-describedby={confirmable ? undefined : confirmHintId}
            onClick={handleSubmit}
          >
            Confirm Rollback
          </Button>
          <span id={confirmHintId} className={styles.srOnly}>
            Type &apos;{ROLLBACK_CONFIRM_WORD}&apos; to confirm
          </span>
        </div>
      )}
    >
      <div className={styles.dialogBody}>
        <Notice tone="warn" icon={<IconAlertTriangle size={17} stroke={strokeFor(17)} />} title="Warning">
          Rolling back a result will mark it as invalid and may trigger settlement recalculations. This action
          should only be performed when a correction is needed.
        </Notice>
        {result ? <DescriptionList className={styles.facts} items={rollbackFacts(result)} /> : null}
        <Textarea
          ref={reasonRef}
          label="Rollback Reason"
          required
          rows={4}
          placeholder="Explain why this result needs to be rolled back..."
          value={reason}
          error={reasonError}
          onChange={(value) => {
            setReason(value)
            setReasonChecked(true)
          }}
        />
        <Select
          label="Category"
          layout="stacked"
          placeholder="Select category"
          value={tag}
          options={ROLLBACK_TAG_OPTIONS}
          onChange={setTag}
        />
        <TextField
          label="Confirmation"
          placeholder={`Type '${ROLLBACK_CONFIRM_WORD}' to confirm`}
          value={confirmText}
          onChange={setConfirmText}
          autoComplete="off"
        />
      </div>
    </Dialog>
  )
}
