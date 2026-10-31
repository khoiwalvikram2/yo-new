import { useEffect, useState } from 'react'
import { useMutation, gql } from '@apollo/client'
import { Button } from '@/ui/components/Button'
import { Dialog } from '@/ui/components/Dialog'
import { Form } from '@/ui/components/Form'
import { Notice } from '@/ui/components/Notice'
import { PasswordField } from '@/ui/components/PasswordField'
import { useForm } from '@/ui/form/useForm'
import { PLAYER_PASSWORD_INITIAL, playerPasswordSchema, profileError } from '../profileModel'
import styles from '../PlayerProfile.module.css'

const CHANGE_PLAYER_PASSWORD = gql`
  mutation ChangePlayerPassword($playerId: ID!, $newPassword: String!, $adminPassword: String!) {
    changePlayerPassword(playerId: $playerId, newPassword: $newPassword, adminPassword: $adminPassword) {
      success
      message
    }
  }
`


interface ChangePlayerPasswordModalProps { open: boolean; playerId: string; playerName: string; onClose: () => void; onSuccess?: () => void }
export function ChangePlayerPasswordModal({ open, playerId, playerName, onClose, onSuccess }: ChangePlayerPasswordModalProps) {
  const [changePassword, { loading }] = useMutation(CHANGE_PLAYER_PASSWORD)
  const [error, setError] = useState<string | null>(null)
  const form = useForm({ schema: playerPasswordSchema, initialValues: PLAYER_PASSWORD_INITIAL, onSubmit: async (values) => {
    setError(null)
    try {
      const result = await changePassword({ variables: { playerId, newPassword: values.newPassword, adminPassword: values.adminPassword } })
      if (result.data?.changePlayerPassword?.success) { form.reset(); setError(null); onSuccess?.(); onClose() }
      else setError(result.data?.changePlayerPassword?.message || 'Failed to change player password')
    } catch (cause) { setError(profileError(cause, 'Failed to change player password')) }
  } })
  const { reset } = form
  useEffect(() => { if (!open) { reset(); setError(null) } }, [open, reset])
  const close = () => { form.reset(); setError(null); onClose() }
  const busy = loading || form.submitting
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) close() }} title="Change Player Password" description={playerName} size="sm" dismissible={!busy}>
    <Form onSubmit={form.handleSubmit} errorAnnouncement={form.errorAnnouncement} errorAnnouncementRevision={form.errorAnnouncementRevision} className={styles.stack}>
      {error ? <Notice tone="error" title={error} live="assertive" /> : null}
      <PasswordField label="New Password" {...form.field('newPassword')} placeholder="Enter new password" required autoComplete="new-password" disabled={busy} />
      <PasswordField label="Confirm New Password" {...form.field('confirmPassword')} placeholder="Confirm new password" required autoComplete="new-password" disabled={busy} />
      <Notice title="Authorization Required" tone="warn">Enter your own login password to confirm this action.</Notice>
      <PasswordField label="Your Login Password" {...form.field('adminPassword')} placeholder="Enter your login password" required autoComplete="current-password" disabled={busy} />
      <div className={styles.actions}><Button onClick={close} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" loading={busy}>Change Password</Button></div>
    </Form>
  </Dialog>
}
