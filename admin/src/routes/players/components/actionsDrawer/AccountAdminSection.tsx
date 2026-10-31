import { useEffect, useState } from 'react'
import { useMutation, gql } from '@apollo/client'
import type { Player } from '@/shared/types/player'
import { ConfirmDialog } from '@/ui/components/ConfirmDialog'
import { Button } from '@/ui/components/Button'
import { Switch } from '@/ui/components/Switch'
import { Notice } from '@/ui/components/Notice'
import styles from '../../PlayersSearch.module.css'

const SetUserStatus = gql`
  mutation SetUserStatus($id: ID!, $status: PlayerStatus!) {
    setUserStatus(id: $id, status: $status) {
      success
      message
      user { id status }
    }
  }
`

const SetRequirePasswordReset = gql`
  mutation SetRequirePasswordReset($id: ID!, $require: Boolean!) {
    setRequirePasswordReset(id: $id, require: $require) {
      success
      message
      user { id requirePasswordReset }
    }
  }
`

const ForceLogout = gql`
  mutation ForceLogout($id: ID!) {
    forceLogoutUser(id: $id) { success message }
  }
`

interface AccountAdminSectionProps {
  user: Player
  saving: Record<string, boolean>
  setSavingFlag: (key: string, val: boolean) => void
  onRefetch?: () => void
}


export function AccountAdminSection({ user, saving, setSavingFlag, onRefetch }: AccountAdminSectionProps) {
  const [mutSetStatus] = useMutation(SetUserStatus)
  const [mutSetRequire] = useMutation(SetRequirePasswordReset)
  const [mutForceLogout] = useMutation(ForceLogout)
  const [statusLocal, setStatusLocal] = useState(user.status)
  const [resetLocal, setResetLocal] = useState(!!user.requirePasswordReset)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setStatusLocal(user.status) }, [user.status])
  useEffect(() => { setResetLocal(!!user.requirePasswordReset) }, [user.requirePasswordReset])
  async function statusChange(status: Player['status']) {
    setError('')
    try { setSavingFlag('status-' + user.id, true); await mutSetStatus({ variables: { id: user.id, status }, context: { uiToast: 'message' } }); setStatusLocal(status); onRefetch?.() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to update status') }
    finally { setSavingFlag('status-' + user.id, false) }
  }
  async function passwordReset(require: boolean) {
    setError(''); try { await mutSetRequire({ variables: { id: user.id, require }, context: { uiToast: 'message' } }); setResetLocal(require) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to update password reset') }
  }
  return <div className={styles.stack}>
    <div className={styles.row}><div><div className={styles.name}>Account Active</div><p className={styles.secondary}>{statusLocal === 'SUSPENDED' ? 'Unsuspend first to change' : 'Inactive users cannot place any bets'}</p></div><Switch label="Account Active" hideLabel checked={statusLocal === 'ACTIVE'} disabled={statusLocal === 'SUSPENDED' || !!saving['status-' + user.id]} onChange={value => void statusChange(value ? 'ACTIVE' : 'INACTIVE')} /></div>
    <div className={styles.row}><div><div className={styles.name}>Suspended</div><p className={styles.secondary}>Suspended users are force logged out and cannot bet or log in</p></div><Switch label="Suspended" tone="danger" hideLabel checked={statusLocal === 'SUSPENDED'} disabled={!!saving['status-' + user.id]} onChange={value => void statusChange(value ? 'SUSPENDED' : 'ACTIVE')} /></div>
    <div className={styles.row}><div><div className={styles.name}>Force Logout</div><p className={styles.secondary}>Sign out from all devices</p></div><Button variant="danger" size="sm" onClick={() => setConfirmLogout(true)}>Logout</Button></div>
    <div className={styles.row}><div><div className={styles.name}>Password Reset</div><p className={styles.secondary}>Require reset on next login</p></div><Switch label="Password Reset" hideLabel checked={resetLocal} onChange={value => void passwordReset(value)} /></div>
    {error && <Notice tone="error" live="assertive">{error}</Notice>}
    <ConfirmDialog title="Force logout all sessions?" open={confirmLogout} onOpenChange={setConfirmLogout} tone="danger" onConfirm={async () => { await mutForceLogout({ variables: { id: user.id }, context: { uiToast: 'message' } }) }} />
  </div>
}
