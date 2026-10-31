import { useRef, useState } from 'react'
import { useMutation } from '@apollo/client'
import { AI_CONFIRM_ACTION, AI_REJECT_ACTION } from '@/lib/graphql/aiAssistant'
import { notify } from '@/shared/services/notification'
import { Button } from '@/ui/components/Button'
import { StatusPill } from '@/ui/components/StatusPill'
import styles from './AiAssistant.module.css'

export interface Proposal { id: string; toolName: string; summary: string; expiresAt: string }

/** Queued changes stay unapplied until an administrator explicitly confirms them. */
export function ProposalCard({ proposal, onResolved }: { proposal: Proposal; onResolved: (id: string, outcome: 'confirmed' | 'rejected') => void }) {
  const [resolved, setResolved] = useState<'confirmed' | 'rejected' | null>(null)
  const busyRef = useRef(false)
  const [confirmAction, { loading: confirming }] = useMutation<{ aiConfirmAction: { status: string; message: string } }>(AI_CONFIRM_ACTION, {
    onCompleted: ({ aiConfirmAction: { status, message } }) => {
      if (status === 'confirmed') {
        setResolved('confirmed'); notify.success(message, 'Change applied'); onResolved(proposal.id, 'confirmed')
      } else {
        // The server is authoritative for expired / already-resolved / failed proposals.
        notify.error(message, 'Not applied'); setResolved('rejected'); onResolved(proposal.id, 'rejected')
      }
    },
    onError: (error) => notify.error(error.message, 'Could not apply the change'),
  })
  const [rejectAction, { loading: rejecting }] = useMutation(AI_REJECT_ACTION, {
    onCompleted: () => { setResolved('rejected'); onResolved(proposal.id, 'rejected') },
    onError: (error) => notify.error(error.message, 'Could not discard the change'),
  })
  const busy = confirming || rejecting
  const decide = (outcome: 'confirm' | 'reject') => {
    if (busyRef.current || busy || resolved !== null) return
    busyRef.current = true
    const action = outcome === 'confirm' ? confirmAction : rejectAction
    void action({ variables: { proposalId: proposal.id } }).catch(() => undefined).finally(() => { busyRef.current = false })
  }
  const expiresIn = Math.max(0, Math.round((new Date(proposal.expiresAt).getTime() - Date.now()) / 60000))
  return <section className={styles.proposal} aria-label="Proposed change">
    <div className={styles.row}>
      <StatusPill tone={resolved === 'confirmed' ? 'ok' : resolved === 'rejected' ? 'muted' : 'warn'}>{resolved === 'confirmed' ? 'Applied' : resolved === 'rejected' ? 'Discarded' : 'Awaiting your confirmation'}</StatusPill>
      <span className={styles.secondary}>{proposal.toolName}</span>
    </div>
    <p className={styles.summary}>{proposal.summary}</p>
    {resolved === null && <div className={styles.actions}>
      <Button variant="primary" size="sm" loading={confirming} disabled={busy} onClick={() => decide('confirm')}>Apply this change</Button>
      <Button variant="secondary" size="sm" loading={rejecting} disabled={busy} onClick={() => decide('reject')}>Discard</Button>
      <span className={styles.secondary}>{expiresIn > 0 ? `Expires in ${expiresIn} min` : 'Expired'}</span>
    </div>}
  </section>
}
