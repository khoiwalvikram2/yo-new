import { useState, useEffect } from 'react'
import { Dialog } from '@/ui/components/Dialog'
import { Button } from '@/ui/components/Button'
import { Tabs } from '@/ui/components/Tabs'
import { NumberField } from '@/ui/components/NumberField'
import { Textarea } from '@/ui/components/Textarea'
import { Notice } from '@/ui/components/Notice'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { notify } from '@/shared/services/notification'
import styles from '../PlayersSearch.module.css'
import { Select } from '@/ui/components/Select'
import { useMutation, gql } from '@apollo/client'
import type { Player } from '@/shared/types/player'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { hasPermissionWithNested } from '@/shared/core/nestedPermissionMapping'


const AdjustPlayerCredit = gql`
  mutation AdjustPlayerCredit($input: AdjustPlayerCreditInput!) {
    adjustPlayerCredit(input: $input) {
      success
      message
      adjustment {
        id
        playerId
        adjustmentType
        amount
        previousLimit
        newLimit
        previousUsed
        newUsed
        notes
        createdAt
      }
    }
  }
`

interface CreditAdjustmentModalProps {
  open: boolean
  player: Player | null
  onClose: () => void
  onSuccess: () => void
  initialTab?: 'limit' | 'adjust' | 'settle'
}

export function CreditAdjustmentModal({ open, player, onClose, onSuccess, initialTab = 'limit' }: CreditAdjustmentModalProps) {
  const [activeTab, setActiveTab] = useState<'limit' | 'adjust' | 'settle'>(initialTab)
  const [amount, setAmount] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [adjustmentType, setAdjustmentType] = useState<'INCREASE' | 'DECREASE'>('INCREASE')
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const fail = (message: string) => { setFormError(message); notify.error(message) }
  const { getCurrencySymbol, formatAmount: rawFormatAmount } = useCurrency()
  const loggedInAgent = useAuthStore(s => s.agent)
  const permissions = useAuthStore(s => s.permissions)
  const canViewCredit = !!loggedInAgent || hasPermissionWithNested(permissions, 'players.credit', 'view')
  const mask = '••••'
  const formatAmount = (v: number | null | undefined, c?: string) => canViewCredit ? rawFormatAmount(v as number, c) : mask
  
  const [adjustCredit] = useMutation(AdjustPlayerCredit)

  const handleSubmit = async () => {
    // Validate player exists
    if (!player) {
      fail('Player not found')
      return
    }

    // Check if player type is supported for credit adjustments
    const isWhitelabelCredit = player.playerType === 'WHITELABEL_CREDIT'
    const isAgentCredit = player.playerType === 'AGENT_CREDIT'
    const isPlayerOwnedByLoggedInAgent = loggedInAgent?.id && player.agentId && loggedInAgent.id === player.agentId
    // A whitelabel credit player's credit is the whitelabel's: the API refuses every agent login.
    if (isWhitelabelCredit && loggedInAgent) {
      fail('Only an administrator can change a whitelabel credit player\'s credit.')
      return
    }

    // Allow adjustments for:
    // 1. WHITELABEL_CREDIT players (always)
    // 2. AGENT_CREDIT players if logged-in agent owns them
    if (!isWhitelabelCredit && !(isAgentCredit && isPlayerOwnedByLoggedInAgent)) {
      if (isAgentCredit) {
        fail('Credit adjustments for AGENT_CREDIT players are only available when you are the player\'s agent.')
      } else {
        fail('Credit adjustments are only available for WHITELABEL_CREDIT players or AGENT_CREDIT players managed by you.')
      }
      return
    }

    // Validate amount (skip for settle tab as it uses settlementBalance)
    if (activeTab !== 'settle') {
      if (amount === null || amount === undefined) {
        fail('Please enter a valid amount')
        return
      }
      // For LIMIT_CHANGE, allow 0 (setting limit to 0 is valid)
      // For INCREASE/DECREASE, amount must be > 0
      if (activeTab === 'adjust' && amount <= 0) {
        fail('Adjustment amount must be greater than 0')
        return
      }
      // For LIMIT_CHANGE, backend requires > 0, so we need to prevent 0
      if (activeTab === 'limit' && amount <= 0) {
        fail('Credit limit must be greater than 0')
        return
      }
      
      // Additional business logic validations
      if (activeTab === 'limit') {
        // Credit limit cannot be less than current used credit
        const currentUsed = Number(player.creditUsed || 0)
        if (amount < currentUsed) {
          fail(`Credit limit cannot be less than current used credit (${formatAmount(currentUsed, player?.wallet?.currency)})`)
          return
        }
      } else if (activeTab === 'adjust') {
        const currentLimit = Number(player.creditLimit || 0)
        const currentUsed = Number(player.creditUsed || 0)
        if (adjustmentType === 'INCREASE') {
          // When increasing credit used, check if it would exceed the limit
          const newUsed = currentUsed + amount
          if (newUsed > currentLimit) {
            fail(`Increasing credit by ${formatAmount(amount, player?.wallet?.currency)} would exceed the credit limit of ${formatAmount(currentLimit, player?.wallet?.currency)}. Maximum increase allowed: ${formatAmount(Math.max(0, currentLimit - currentUsed), player?.wallet?.currency)}`)
            return
          }
        } else if (adjustmentType === 'DECREASE') {
          // When decreasing credit used, check if amount doesn't exceed current used
          if (amount > currentUsed) {
            fail(`Decrease amount cannot be greater than current used credit (${formatAmount(currentUsed, player?.wallet?.currency)})`)
            return
          }
        }
      }
    }

    // Reason is optional - no validation needed

    // For settle tab, check if there's settlement balance to settle
    if (activeTab === 'settle') {
      const settlementBalance = Number(player.settlementBalance || 0)
      if (settlementBalance === 0) {
        fail('No settlement balance to settle. Settlement balance is already zero.')
        return
      }
    }

    try {
      setLoading(true)
      
      let mutationType: string
      let mutationAmount: number

      if (activeTab === 'limit') {
        mutationType = 'LIMIT_CHANGE'
        mutationAmount = amount!
      } else if (activeTab === 'settle') {
        // A settlement is its own adjustment type: SETTLE zeroes the settlement balances (and moves
        // them off the agent's or whitelabel's). The amount must equal |settlementBalance|; the
        // backend refuses it if the balance changed meanwhile. (DECREASE would lower credit used.)
        mutationType = 'SETTLE'
        mutationAmount = Math.abs(Number(player.settlementBalance || 0))
      } else {
        // For adjust tab
        mutationType = adjustmentType
        mutationAmount = amount!
      }

      const result = await adjustCredit({
        variables: {
          input: {
            playerId: player.id,
            adjustmentType: mutationType,
            amount: mutationAmount,
            notes: reason.trim()
          }
        },
        context: { uiToast: 'notification' }
      })

      if (result.data?.adjustPlayerCredit?.success) {
        // Notification is already shown by notificationLink via context: { uiToast: 'notification' }
        handleClose()
        onSuccess()
      } else {
        fail(result.data?.adjustPlayerCredit?.message || 'Failed to process credit adjustment')
      }
    } catch (error: unknown) {
      fail(error instanceof Error ? error.message : 'Failed to process credit adjustment')
    } finally {
      setLoading(false)
    }
  }

  // Reset to initial tab when modal opens or player changes
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab)
      setAmount(null)
      setReason('')
      setAdjustmentType('INCREASE')
    }
  }, [open, initialTab, player?.id])

  const handleClose = () => {
    setAmount(null)
    setReason('')
    setAdjustmentType('INCREASE')
    onClose()
  }

  const currentLimit = player?.creditLimit ? Number(player.creditLimit) : 0
  const currentUsed = player?.creditUsed ? Number(player.creditUsed) : 0
  const currentAvailable = player?.creditAvailable ? Number(player.creditAvailable) : 0
  const currentSettlementBalance = player?.settlementBalance ? Number(player.settlementBalance) : 0
  const currencySymbol = player?.wallet?.currency ? getCurrencySymbol(player.wallet.currency) : ''

  const invalidAmount = (activeTab === 'limit' && (amount == null || amount <= 0 || amount < currentUsed)) || (activeTab === 'adjust' && (amount == null || amount <= 0 || (adjustmentType === 'INCREASE' && currentUsed + amount > currentLimit) || (adjustmentType === 'DECREASE' && amount > currentUsed)))
  const previewUsed = adjustmentType === 'INCREASE' ? currentUsed + (amount || 0) : Math.max(0, currentUsed - (amount || 0))
  const summary = [{ term: 'Credit Limit', value: formatAmount(currentLimit, player?.wallet?.currency) }, { term: 'Credit Used', value: formatAmount(currentUsed, player?.wallet?.currency) }, { term: 'Available Credit', value: formatAmount(currentAvailable, player?.wallet?.currency) }]
  return <Dialog title="Credit Management" description={player?.name || player?.username || 'Player'} open={open} onOpenChange={next => { if (!next && !loading) handleClose() }} dismissible={!loading} footer={<><Button disabled={loading} onClick={handleClose}>Cancel</Button><Button variant={activeTab === 'settle' ? 'dangerSolid' : 'primary'} loading={loading} disabled={invalidAmount || (activeTab === 'settle' && currentSettlementBalance === 0)} onClick={() => void handleSubmit()}>{activeTab === 'limit' ? 'Update Limit' : activeTab === 'adjust' ? adjustmentType === 'INCREASE' ? 'Add Credit' : 'Remove Credit' : 'Settle Credit'}</Button></>}>
    <div className={styles.stack}>
      <DescriptionList items={summary} />
      <fieldset disabled={loading} className={styles.fieldset}><div className={styles.stack}>
        <Tabs label="Credit management" idPrefix="player-credit" value={activeTab} items={[{ value: 'limit', label: 'Adjust Limit' }, { value: 'adjust', label: 'Add/Remove Credit' }, { value: 'settle', label: 'Settle' }]} onChange={key => { setActiveTab(key); setAmount(null); setReason(''); setAdjustmentType('INCREASE'); setFormError('') }} />
        <Notice tone={activeTab === 'settle' ? 'warn' : 'info'} title={activeTab === 'limit' ? 'Change credit limit' : activeTab === 'adjust' ? 'Adjust credit used' : 'Settle Settlement Balance'}>{activeTab === 'limit' ? "This will update the player's maximum credit limit" : activeTab === 'adjust' ? 'Increase or decrease the amount of credit used by the player' : 'This will reset the settlement balance to zero (wins/losses settlement)'}</Notice>
        {activeTab === 'adjust' && <Select label="Adjustment Type" layout="stacked" value={adjustmentType} onChange={value => setAdjustmentType(value as 'INCREASE' | 'DECREASE')} options={[{ value: 'INCREASE', label: 'Increase Credit Used (Add)' }, { value: 'DECREASE', label: 'Decrease Credit Used (Remove)' }]} />}
        {activeTab !== 'settle' && <NumberField label={activeTab === 'limit' ? 'New Credit Limit' : 'Amount'} value={amount} onChange={setAmount} min={0} step={0.01} grouping="en-US" prefix={currencySymbol} placeholder="0.00" />}
        {activeTab === 'limit' && amount != null && amount >= 0 && <Notice tone="info">New limit will be: {formatAmount(amount, player?.wallet?.currency)}. Available credit will be: {formatAmount(Math.max(0, amount - currentUsed), player?.wallet?.currency)}</Notice>}
        {activeTab === 'adjust' && amount != null && amount > 0 && <Notice tone="info">New credit used will be: {formatAmount(previewUsed, player?.wallet?.currency)}. Available credit will be: {formatAmount(Math.max(0, currentLimit - previewUsed), player?.wallet?.currency)}</Notice>}
        {activeTab === 'settle' && <>
          {player?.settlementBalanceSports !== undefined && player?.settlementBalanceCasino !== undefined && player?.settlementBalanceMatka !== undefined && <DescriptionList items={[{ term: 'Sports', value: formatAmount(player.settlementBalanceSports, player.wallet?.currency) }, { term: 'Casino', value: formatAmount(player.settlementBalanceCasino, player.wallet?.currency) }, { term: 'Matka', value: formatAmount(player.settlementBalanceMatka, player.wallet?.currency) }]} />}
          <Notice tone="warn">Settlement Balance: {formatAmount(currentSettlementBalance, player?.wallet?.currency)}. After Settlement: Settlement Balance: {formatAmount(0, player?.wallet?.currency)}. Available Credit: {formatAmount(Math.max(0, currentLimit - currentUsed), player?.wallet?.currency)}</Notice>
          <p className={styles.secondary}>This is a permanent action.</p>
        </>}
        <Textarea label={activeTab === 'settle' ? 'Settlement Reason' : 'Reason'} value={reason} onChange={setReason} maxLength={500} showCount rows={3} placeholder={activeTab === 'limit' ? 'Provide a reason for changing the credit limit (optional)' : activeTab === 'adjust' ? 'Provide a reason for this credit adjustment (optional)' : 'Provide a reason for settling this credit (e.g., Monthly settlement, Payment received)'} />
      </div></fieldset>
      {formError && <Notice tone="error" live="assertive">{formError}</Notice>}
      <p className={styles.secondary}>This action will be logged in the audit trail for compliance and tracking purposes.</p>
    </div>
  </Dialog>
}
