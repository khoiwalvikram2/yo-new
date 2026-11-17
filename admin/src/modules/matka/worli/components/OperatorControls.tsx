import { useRef, useState } from 'react'
import { useMutation, gql } from '@apollo/client'
import { ReasonModal } from './ReasonModal'
import { RBACGuard } from '@/shared/core/RBACGuard'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { TextField } from '@/ui/components/TextField'
import { ADJUST_SUSPEND_WORLI, SET_MESSAGE_WORLI, UNLOCK_WORLI } from '../gql'
import {
  actionErrorText,
  operatorActionTitle,
  parseSuspendMinutes,
  sessionControlEnabled,
  type OperatorAction,
} from '../runningMarketDetailModel'
import styles from '../RunningMarketDetailPage.module.css'

const PAUSE = gql`mutation Pause($id: ID!, $reason: String!) { pauseWorliInstance(id: $id, reason: $reason) { success message } }`
const RESUME = gql`mutation Resume($id: ID!, $reason: String!) { resumeWorliInstance(id: $id, reason: $reason) { success message } }`
const LOCK = gql`mutation Lock($id: ID!, $reason: String!) { lockNowWorliInstance(id: $id, reason: $reason) { success message } }`
const CLOSE = gql`mutation Close($id: ID!, $reason: String!) { closeNowWorliInstance(id: $id, reason: $reason) { success message } }`

/* The session's operator actions, behind matka.worli update as before. Pause, Resume, Lock Now and Close
   Now each ask for a reason first; Set Message sends the note as typed; Adjust Suspend Minutes asks for the
   minutes, then for a reason. The mutations carry no context, so the app's notification link still reports
   each server answer. A failed send now keeps its dialog open with the error. With the session's status, a
   control that can no longer change the session is disabled (Resume unless paused, Lock Now once locked...),
   so a locked or closed session is not offered the actions that answered "Locked" and changed nothing. Unlock
   (owner, 2026-11-04) shows only while the server says it may reopen the session (canUnlock: stopped by Lock Now
   or Close Now, no result ever declared for it, a rolled-back one included, and before the scheduled close) and
   asks for a reason like the others. */
export function OperatorControls({ id, status, canUnlock, onDone }: { id: string; status?: string | null; canUnlock?: boolean | null; onDone?: () => void }) {
  const off = (control: Parameters<typeof sessionControlEnabled>[1]) => !sessionControlEnabled(status, control)
  const [pause] = useMutation(PAUSE)
  const [resume] = useMutation(RESUME)
  const [lock] = useMutation(LOCK)
  const [close] = useMutation(CLOSE)
  const [unlock] = useMutation(UNLOCK_WORLI)
  const [setMessage] = useMutation(SET_MESSAGE_WORLI)
  const [adjustSuspend] = useMutation(ADJUST_SUSPEND_WORLI)
  const [modal, setModal] = useState<{ action: OperatorAction | null }>({ action: null })
  const [msgOpen, setMsgOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgBusy, setMsgBusy] = useState(false)
  const [msgFailure, setMsgFailure] = useState<string | null>(null)
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [minutes, setMinutes] = useState<string>('5')
  const [suspendReasonOpen, setSuspendReasonOpen] = useState(false)
  const [pendingMinutes, setPendingMinutes] = useState<number>(5)
  const messageRef = useRef<HTMLInputElement | null>(null)
  const minutesRef = useRef<HTMLInputElement | null>(null)
  // The reason prompt opens as the minutes dialog closes, so its opener (that dialog's OK) is gone when it
  // closes; focus goes back to the button that started the flow instead.
  const suspendTriggerRef = useRef<HTMLButtonElement | null>(null)

  async function act(reason: string) {
    if (modal.action === 'PAUSE') await pause({ variables: { id, reason } })
    if (modal.action === 'RESUME') await resume({ variables: { id, reason } })
    if (modal.action === 'LOCK') await lock({ variables: { id, reason } })
    if (modal.action === 'CLOSE') await close({ variables: { id, reason } })
    if (modal.action === 'UNLOCK') await unlock({ variables: { id, reason } })
    onDone?.()
    setModal({ action: null })
  }

  async function saveMessage() {
    if (msgBusy) return
    setMsgFailure(null)
    setMsgBusy(true)
    try {
      await setMessage({ variables: { id, message: msg } })
      setMsgOpen(false)
      setMsg('')
      onDone?.()
    } catch (error) {
      setMsgFailure(actionErrorText(error))
    } finally {
      setMsgBusy(false)
    }
  }

  function continueToSuspendReason() {
    setPendingMinutes(parseSuspendMinutes(minutes))
    setSuspendOpen(false)
    setSuspendReasonOpen(true)
  }

  return (
    <RBACGuard required={[{ domain: 'matka.worli', actions: ['update'] }]}>
      <div className={styles.controls}>
        <Button disabled={off('PAUSE')} onClick={() => setModal({ action: 'PAUSE' })}>Pause</Button>
        <Button variant="primary" disabled={off('RESUME')} onClick={() => setModal({ action: 'RESUME' })}>Resume</Button>
        <Button variant="danger" disabled={off('LOCK')} onClick={() => setModal({ action: 'LOCK' })}>Lock Now</Button>
        <Button variant="danger" disabled={off('CLOSE')} onClick={() => setModal({ action: 'CLOSE' })}>Close Now</Button>
        {canUnlock ? <Button variant="primary" onClick={() => setModal({ action: 'UNLOCK' })}>Unlock</Button> : null}
        <Button
          disabled={off('MESSAGE')}
          onClick={() => {
            setMsgFailure(null)
            setMsgOpen(true)
          }}
        >
          Set Message
        </Button>
        <Button ref={suspendTriggerRef} disabled={off('SUSPEND_ADJUST')} onClick={() => setSuspendOpen(true)}>Adjust Suspend Minutes</Button>
      </div>
      <ReasonModal
        open={modal.action !== null}
        onCancel={() => setModal({ action: null })}
        onOk={act}
        title={operatorActionTitle(modal.action)}
      />
      <Dialog
        title="Set market message"
        open={msgOpen}
        onOpenChange={(next) => {
          if (!next) setMsgOpen(false)
        }}
        size="sm"
        dismissible={!msgBusy}
        initialFocus={messageRef}
        footer={(
          <>
            <Button onClick={() => setMsgOpen(false)} disabled={msgBusy}>Cancel</Button>
            <Button variant="primary" loading={msgBusy} onClick={() => void saveMessage()}>OK</Button>
          </>
        )}
      >
        <div className={styles.dialogBody}>
          <TextField
            ref={messageRef}
            label="Market message"
            hideLabel
            placeholder="Short operator note..."
            value={msg}
            onChange={setMsg}
          />
          {msgFailure ? <p className={styles.dialogError} role="alert">{msgFailure}</p> : null}
        </div>
      </Dialog>
      <Dialog
        title="Adjust suspend minutes"
        open={suspendOpen}
        onOpenChange={(next) => {
          if (!next) setSuspendOpen(false)
        }}
        size="sm"
        initialFocus={minutesRef}
        footer={(
          <>
            <Button onClick={() => setSuspendOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={continueToSuspendReason}>OK</Button>
          </>
        )}
      >
        <div className={styles.dialogBody}>
          <TextField
            ref={minutesRef}
            label="Minutes before close"
            hideLabel
            inputMode="numeric"
            placeholder="Minutes before close"
            value={minutes}
            onChange={setMinutes}
          />
        </div>
      </Dialog>
      <ReasonModal
        open={suspendReasonOpen}
        title="Reason for suspend adjustment"
        restoreFocusTo={suspendTriggerRef}
        onCancel={() => setSuspendReasonOpen(false)}
        onOk={async (reason) => {
          await adjustSuspend({ variables: { id, minutes: pendingMinutes, reason } })
          setSuspendReasonOpen(false)
          onDone?.()
        }}
      />
    </RBACGuard>
  )
}

