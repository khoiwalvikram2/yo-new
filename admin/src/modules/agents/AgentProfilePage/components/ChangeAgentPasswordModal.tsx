import { useState } from 'react'
import { useMutation } from '@apollo/client'
import { ADMIN_RESET_AGENT_PASSWORD_MUTATION } from '@/lib/graphql/agents'
import { Dialog } from '@/ui/components/Dialog'
import { Button } from '@/ui/components/Button'
import { PasswordField } from '@/ui/components/PasswordField'
import { Notice } from '@/ui/components/Notice'
import styles from './AgentProfileComponents.module.css'

interface ChangeAgentPasswordModalProps {
  open: boolean
  agentId: string
  agentName: string
  onClose: () => void
  onSuccess?: () => void
}

export function ChangeAgentPasswordModal({
  open,
  agentId,
  agentName,
  onClose,
  onSuccess,
}: ChangeAgentPasswordModalProps) {
  const [resetPassword, { loading }] = useMutation(ADMIN_RESET_AGENT_PASSWORD_MUTATION)
  const [values, setValues] = useState({ newPassword: '', confirmPassword: '', adminPassword: '' })
  const [errors, setErrors] = useState<{ newPassword?: string; confirmPassword?: string; adminPassword?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const clear = () => { setValues({ newPassword: '', confirmPassword: '', adminPassword: '' }); setErrors({}); setError(null) }
  const cancel = () => { clear(); onClose() }
  const submit = async () => {
    const next = {
      newPassword: !values.newPassword ? 'Please enter the new password' : values.newPassword.length < 6 ? 'Password must be at least 6 characters' : undefined,
      confirmPassword: !values.confirmPassword ? 'Please confirm the new password' : values.newPassword !== values.confirmPassword ? 'Passwords do not match' : undefined,
      adminPassword: !values.adminPassword ? 'Please enter your login password to confirm' : undefined,
    }
    setErrors(next); setError(null)
    if (next.newPassword || next.confirmPassword || next.adminPassword) return
    try {
      const result = await resetPassword({ variables: { agentId, newPassword: values.newPassword, adminPassword: values.adminPassword } })
      if (result.data?.agents?.adminResetAgentPassword?.success) { clear(); onSuccess?.(); onClose() }
      else setError(result.data?.agents?.adminResetAgentPassword?.message || 'Failed to reset agent password')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Failed to reset agent password') }
  }
  return <Dialog open={open} onOpenChange={value => { if (!value && !loading) cancel() }} title="Reset Agent Password" description={agentName} size="md" dismissible={!loading}>
    <form className={styles.stack} onSubmit={event => { event.preventDefault(); void submit() }}>
      {error && <Notice tone="error">{error}</Notice>}
      <PasswordField label="New Password" value={values.newPassword} autoComplete="new-password" onChange={newPassword => setValues(previous => ({ ...previous, newPassword }))} placeholder="Enter new password" error={errors.newPassword} disabled={loading} />
      <PasswordField label="Confirm New Password" value={values.confirmPassword} autoComplete="new-password" onChange={confirmPassword => setValues(previous => ({ ...previous, confirmPassword }))} placeholder="Confirm new password" error={errors.confirmPassword} disabled={loading} />
      <Notice tone="warn" title="Authorization Required">Enter your own login password to confirm this action.</Notice>
      <PasswordField label="Your Login Password" value={values.adminPassword} autoComplete="current-password" onChange={adminPassword => setValues(previous => ({ ...previous, adminPassword }))} placeholder="Enter your login password" error={errors.adminPassword} disabled={loading} />
      <div className={styles.actions}><Button disabled={loading} onClick={cancel}>Cancel</Button><Button variant="dangerSolid" type="submit" loading={loading}>Reset Password</Button></div>
    </form>
  </Dialog>
}
