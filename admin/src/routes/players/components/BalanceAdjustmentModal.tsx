import { useState } from 'react'
import { Dialog } from '@/ui/components/Dialog'
import { Button } from '@/ui/components/Button'
import { Tabs } from '@/ui/components/Tabs'
import { NumberField } from '@/ui/components/NumberField'
import { Textarea } from '@/ui/components/Textarea'
import { Notice } from '@/ui/components/Notice'
import { notify } from '@/shared/services/notification'
import styles from '../PlayersSearch.module.css'
import { Checkbox } from '@/ui/components/Checkbox'
import { useMutation, gql } from '@apollo/client'
import type { Player } from '@/shared/types/player'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'

const AdjustWallet = gql`
  mutation AdjustWallet($userId: ID!, $amount: Float!, $applyBonus: Boolean, $reason: String) {
    adjustWallet(userId: $userId, amount: $amount, applyBonus: $applyBonus, reason: $reason) {
      userId
      balance
      bonus
      currency
      exposure
      updatedAt
    }
  }
`

interface BalanceAdjustmentModalProps {
  open: boolean
  player: Player | null
  onClose: () => void
  onSuccess: () => void
}

export function BalanceAdjustmentModal({ open, player, onClose, onSuccess }: BalanceAdjustmentModalProps) {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdrawal'>('deposit')
  const [amount, setAmount] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [applyBonus, setApplyBonus] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const fail = (message: string) => { setFormError(message); notify.error(message) }
  const { getCurrencySymbol, formatAmount } = useCurrency()
  const agent = useAuthStore((s) => s.agent)
  const permissions = useAuthStore((s) => s.permissions)
  const canViewWallet = !!agent || hasPermissionWithNested(permissions, 'players.wallet', 'view')
  const mask = '••••'
  const isCommissionAgent = agent?.schemeType === 'COMMISSION'

  const [adjustWallet] = useMutation(AdjustWallet)

  const handleSubmit = async () => {
    // Check if logged-in user is a sharing or commission agent - prevent balance adjustments
    const currentAgent = useAuthStore.getState().agent
    if (currentAgent?.schemeType === 'SHARING') {
      fail('Sharing agents cannot adjust player balances')
      return
    }
    if (currentAgent?.schemeType === 'COMMISSION') {
      fail('Commission agents cannot adjust player balances')
      return
    }
    // adjustWallet refuses every agent login; only administrators adjust balances.
    if (currentAgent) {
      fail('Agents cannot adjust player balances')
      return
    }

    if (!player || !amount || amount <= 0) {
      fail('Please enter a valid amount')
      return
    }

    if (!reason.trim()) {
      fail('Please provide a reason for this adjustment')
      return
    }

    // The typed amount is kept as typed, so this is where a withdrawal above the shown available balance stops. The
    // server checks the live balance again (the figure here can be stale).
    if (activeTab === 'withdrawal' && canViewWallet && amount > availableBalance) {
      fail('Withdrawal amount exceeds available balance')
      return
    }

    try {
      setLoading(true)
      const adjustmentAmount = activeTab === 'deposit' ? amount : -amount
      // The reason is a mutation argument: the server stores it on the ledger rows and the audit row.
      const result = await adjustWallet({
        variables: {
          userId: player.id,
          amount: adjustmentAmount,
          applyBonus: activeTab === 'deposit' ? applyBonus : undefined,
          reason: reason.trim()
        },
        context: {
          uiToast: 'notification'
        }
      })

      if (result.data?.adjustWallet) {
        const newBalance = result.data.adjustWallet.balance
        const balanceMsg = canViewWallet ? ` New balance: ${formatAmount(newBalance)}` : ''
        notify.success(
          `${activeTab === 'deposit' ? 'Deposit' : 'Withdrawal'} of ${formatAmount(amount)} processed successfully.${balanceMsg}`
        )
        handleClose()
        onSuccess()
      }
    } catch (error: unknown) {
      fail(error instanceof Error ? error.message : 'Failed to process adjustment')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setAmount(null)
    setReason('')
    setApplyBonus(false)
    setActiveTab('deposit')
    onClose()
  }

  const currentBalance = player?.wallet?.balance ? Number(player.wallet.balance) : 0
  // What a withdrawal may take: the cash less the open exposure held against it, the figure adjustWallet checks.
  // In cents, as the server works it out: 0.30 - 0.10 in floats is 0.19999999999999998, which refused exactly 0.20.
  const availableBalance = Math.max(0, Math.round(currentBalance * 100) - Math.round(Number(player?.wallet?.exposure ?? 0) * 100)) / 100
  const currencySymbol = player?.wallet?.currency ? getCurrencySymbol(player.wallet.currency) : ''
  // A withdrawal above what may be taken is warned about and refused, so it gets that warning in place of a
  // "New balance will be" figure (which read ₹0.00, as if it would go through).
  const exceedsAvailable = activeTab === 'withdrawal' && amount != null && amount > availableBalance

  return <Dialog title="Adjust Balance" description={player?.name || player?.username || 'Player'} open={open} onOpenChange={next => { if (!next && !loading) handleClose() }} dismissible={!loading} footer={<><span className={styles.secondary}>Balance: {canViewWallet ? formatAmount(currentBalance) : mask}</span><Button disabled={loading} onClick={handleClose}>Cancel</Button><Button variant={activeTab === 'deposit' ? 'primary' : 'dangerSolid'} loading={loading} onClick={() => void handleSubmit()}>{activeTab === 'deposit' ? 'Deposit' : 'Withdraw'}</Button></>}>
    <div className={styles.stack}>
      {agent && <Notice tone="warn">{isCommissionAgent ? 'Commission agents cannot adjust player balances' : 'Agents cannot adjust player balances'}</Notice>}
      <fieldset disabled={loading || !!agent} className={styles.fieldset}>
        <div className={styles.stack}>
          <Tabs label="Balance adjustment" idPrefix="player-balance" value={activeTab} items={[{ value: 'deposit', label: 'Deposit' }, { value: 'withdrawal', label: 'Withdrawal' }]} onChange={key => { setActiveTab(key); setAmount(null); setApplyBonus(false); setFormError('') }} />
          <Notice tone={activeTab === 'deposit' ? 'info' : 'warn'} title={activeTab === 'deposit' ? 'Add funds to player wallet' : 'Remove funds from player wallet'}>{activeTab === 'deposit' ? "This will increase the player's balance" : "This will decrease the player's balance"}</Notice>
          <NumberField label={activeTab === 'deposit' ? 'Deposit Amount' : 'Withdrawal Amount'} min={0} step={0.01} grouping="en-US" prefix={currencySymbol} value={amount} onChange={setAmount} placeholder="0.00" />
          {activeTab === 'withdrawal' && <p className={styles.secondary}>Available balance: {canViewWallet ? formatAmount(availableBalance) : mask}</p>}
          <Textarea label="Reason" required value={reason} onChange={setReason} maxLength={500} showCount rows={3} placeholder={activeTab === 'deposit' ? 'Provide a reason for this deposit (e.g., Manual adjustment, Refund, Bonus credit)' : 'Provide a reason for this withdrawal (e.g., Manual adjustment, Refund, Chargeback)'} />
          {activeTab === 'deposit' && <><Checkbox label="Apply bonus if eligible campaign is active" checked={applyBonus} onChange={setApplyBonus} /><p className={styles.secondary}>If checked, eligible deposit bonus campaigns will be applied to this deposit</p></>}
          {amount != null && amount > 0 && !exceedsAvailable && <Notice tone="info">New balance will be: {canViewWallet ? formatAmount(activeTab === 'deposit' ? currentBalance + amount : Math.max(0, currentBalance - amount)) : mask}</Notice>}
          {exceedsAvailable && <Notice tone="warn">Withdrawal amount exceeds available balance</Notice>}
        </div>
      </fieldset>
      {formError && <Notice tone="error" live="assertive">{formError}</Notice>}
      <p className={styles.secondary}>This action will be logged in the audit trail for compliance and tracking purposes.</p>
    </div>
  </Dialog>
}
