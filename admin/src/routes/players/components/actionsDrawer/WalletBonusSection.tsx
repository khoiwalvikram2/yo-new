import { useState } from 'react'
import { useMutation, gql } from '@apollo/client'
import type { Player } from '@/shared/types/player'
import { Switch } from '@/ui/components/Switch'
import { Notice } from '@/ui/components/Notice'
import styles from '../../PlayersSearch.module.css'
const SetUserBonusAllowed = gql`
  mutation SetUserBonusAllowed($id: ID!, $allow: Boolean!) {
    setUserBonusAllowed(id: $id, allow: $allow) {
      success
      message
      user { id bonusAllowed }
    }
  }
`

const SetWithdrawalLock = gql`
  mutation SetWithdrawalLock($id: ID!, $lock: Boolean!) {
    setWithdrawalLock(id: $id, lock: $lock) {
      success
      message
      user { id withdrawalLock }
    }
  }
`

interface WalletBonusSectionProps {
  user: Player
  saving: Record<string, boolean>
  setSavingFlag: (key: string, val: boolean) => void
  onRefetch: () => void
  withdrawalLock: boolean
  setWithdrawalLock: (val: boolean) => void
  bonusAllowed: boolean
  setBonusAllowed: (val: boolean) => void
}


export function WalletBonusSection({ user, saving, setSavingFlag, onRefetch, withdrawalLock, setWithdrawalLock, bonusAllowed, setBonusAllowed }: WalletBonusSectionProps) {
  void onRefetch
  const [mutSetBonusAllowed] = useMutation(SetUserBonusAllowed)
  const [mutSetWithdrawalLock] = useMutation(SetWithdrawalLock)
  const [error, setError] = useState('')
  async function lock(value: boolean) {
    setError('')
    try { setSavingFlag('withdrawal-' + user.id, true); await mutSetWithdrawalLock({ variables: { id: user.id, lock: value }, context: { uiToast: 'message' }, optimisticResponse: { setWithdrawalLock: { __typename: 'UserPayload', success: true, message: 'Withdrawal lock updated', user: { __typename: 'User', id: user.id, withdrawalLock: value } } } }); setWithdrawalLock(value) }
    catch (cause) { setWithdrawalLock(!value); setError(cause instanceof Error ? cause.message : 'Failed to update withdrawal lock') }
    finally { setSavingFlag('withdrawal-' + user.id, false) }
  }
  async function bonus(value: boolean) {
    setError('')
    try { setSavingFlag('bonus-' + user.id, true); setBonusAllowed(value); await mutSetBonusAllowed({ variables: { id: user.id, allow: value }, context: { uiToast: 'message' } }) }
    catch (cause) { setBonusAllowed(!value); setError(cause instanceof Error ? cause.message : 'Failed to update bonus eligibility') }
    finally { setSavingFlag('bonus-' + user.id, false) }
  }
  return <div className={styles.stack}><div className={styles.row}><div><div className={styles.name}>Withdrawal Lock</div><p className={styles.secondary}>Prevent withdrawals temporarily</p></div><Switch label="Withdrawal Lock" hideLabel checked={withdrawalLock} disabled={!!saving['withdrawal-' + user.id]} onChange={value => void lock(value)} /></div><div className={styles.row}><div><div className={styles.name}>Bonus Eligibility</div><p className={styles.secondary}>Enable bonus features for user</p></div><Switch label="Bonus Eligibility" hideLabel checked={bonusAllowed} disabled={!!saving['bonus-' + user.id]} onChange={value => void bonus(value)} /></div>{error && <Notice tone="error" live="assertive">{error}</Notice>}</div>
}
