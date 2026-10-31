import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Notice } from './Notice'
import { confirmationErrorMessage, type ConfirmTone } from './confirm'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  onConfirm: () => void | Promise<void>
  busy?: boolean
  initialError?: string
  themeFrom?: { readonly current: Element | null }
  restoreFocusTo?: { readonly current: HTMLElement | null }
}

/** A focused, promise-aware alert dialog for irreversible or consequential actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  busy = false,
  initialError,
  themeFrom,
  restoreFocusTo,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  const isPending = busy || pending

  useEffect(() => {
    if (open) {
      setPending(false)
      setError(initialError ?? null)
    }
  }, [initialError, open])

  const requestClose = (nextOpen: boolean) => {
    if (!nextOpen && isPending) return
    onOpenChange(nextOpen)
  }

  const submit = async () => {
    if (isPending) return

    setError(null)
    setPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch (reason) {
      setError(confirmationErrorMessage(reason))
    } finally {
      setPending(false)
    }
  }

  const footer = (
    <>
      <Button ref={cancelRef} disabled={isPending} onClick={() => requestClose(false)}>
        {cancelLabel}
      </Button>
      <Button
        variant={tone === 'danger' ? 'dangerSolid' : 'primary'}
        loading={isPending}
        onClick={() => void submit()}
      >
        {confirmLabel}
      </Button>
    </>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={requestClose}
      title={title}
      description={description}
      size="sm"
      role="alertdialog"
      initialFocus={tone === 'danger' ? cancelRef : undefined}
      dismissible={!isPending}
      themeFrom={themeFrom}
      restoreFocusTo={restoreFocusTo}
      footer={footer}
    >
      {error ? (
        <Notice tone="error" live="assertive">
          {error}
        </Notice>
      ) : null}
    </Dialog>
  )
}
