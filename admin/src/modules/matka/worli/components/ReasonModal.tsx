import { useRef, useState } from 'react'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { Textarea } from '@/ui/components/Textarea'
import { actionErrorText, reasonError } from '../runningMarketDetailModel'
import styles from '../RunningMarketDetailPage.module.css'

/* The reason prompt every operator action and the bet void go through: a required Reason, then Confirm.
   onOk is awaited: the caller closes the dialog when its work is done, and a rejected onOk keeps the dialog
   open with the error so the operator can try again. The reason starts empty each time the dialog opens.
   restoreFocusTo names the trigger focus returns to on close, for a prompt opened from another dialog whose
   button is gone by then. */
export function ReasonModal({
  open,
  onOk,
  onCancel,
  title = 'Reason required',
  restoreFocusTo,
}: {
  open: boolean
  title?: string
  onOk: (reason: string) => void | Promise<void>
  onCancel: () => void
  restoreFocusTo?: { readonly current: HTMLElement | null }
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  const fieldRef = useRef<HTMLTextAreaElement | null>(null)

  // Opening starts a fresh prompt (adjusted during render, so the first open frame is already clean).
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setReason('')
      setError(undefined)
      setFailure(null)
      setBusy(false)
    }
  }

  const submit = async () => {
    if (busy) return
    const invalid = reasonError(reason)
    setError(invalid)
    if (invalid) {
      fieldRef.current?.focus()
      return
    }
    setFailure(null)
    setBusy(true)
    try {
      await onOk(reason)
    } catch (reasonForFailure) {
      setFailure(actionErrorText(reasonForFailure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      title={title}
      size="sm"
      dismissible={!busy}
      initialFocus={fieldRef}
      restoreFocusTo={restoreFocusTo}
      footer={(
        <>
          <Button onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Confirm</Button>
        </>
      )}
    >
      <div className={styles.dialogBody}>
        <Textarea
          ref={fieldRef}
          label="Reason"
          required
          rows={3}
          placeholder="Enter reason"
          value={reason}
          error={error}
          onChange={(value) => {
            setReason(value)
            if (error) setError(reasonError(value))
          }}
        />
        {failure ? (
          <p className={styles.dialogError} role="alert">{failure}</p>
        ) : null}
      </div>
    </Dialog>
  )
}

