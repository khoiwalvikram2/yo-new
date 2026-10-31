import { useState, useEffect } from 'react'
import { useMutation, gql } from '@apollo/client'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { Dialog } from '@/ui/components/Dialog'
import { Button } from '@/ui/components/Button'
import { Tabs } from '@/ui/components/Tabs'
import { tabId, tabPanelId } from '@/ui/components/tabIds'
import { NumberField } from '@/ui/components/NumberField'
import { Textarea } from '@/ui/components/Textarea'
import { Select } from '@/ui/components/Select'
import { Notice } from '@/ui/components/Notice'
import { DescriptionList } from '@/ui/components/DescriptionList'
import { toast } from '@/ui/components/toast'
import styles from './AgentCreditAdjustmentModal.module.css'

const message = { error: (text: string) => toast({ tone: 'error', message: text }) }

const AdjustSubAgentCredit = gql`
  mutation AdjustSubAgentCredit($agentId: ID!, $creditLimit: Float!) {
    agents {
      adjustSubAgentCredit(agentId: $agentId, creditLimit: $creditLimit) {
        success
        message
        agent {
          id
          creditLimit
          creditUsed
          creditAvailable
        }
      }
    }
  }
`

const AdjustAgentCredit = gql`
  mutation AdjustAgentCredit($input: AdjustAgentCreditInput!) {
    agents {
      adjustAgentCredit(input: $input) {
        success
        message
        adjustment {
          id
          agentId
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
  }
`

interface AgentCreditAdjustmentModalProps {
  open: boolean
  agent: { id: string; schemeType?: string; creditLimit?: number; creditUsed?: number; creditAvailable?: number } | null
  onClose: () => void
  onSuccess: () => void
  initialTab?: 'limit' | 'adjust'
}

export function AgentCreditAdjustmentModal({ open, agent, onClose, onSuccess, initialTab = 'limit' }: AgentCreditAdjustmentModalProps) {
  const [activeTab, setActiveTab] = useState<'limit' | 'adjust'>(initialTab)
  const [amount, setAmount] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [adjustmentType, setAdjustmentType] = useState<'INCREASE' | 'DECREASE'>('INCREASE')
  const [loading, setLoading] = useState(false)
  const { formatAmount } = useCurrency()
  
  const [adjustCredit] = useMutation(AdjustSubAgentCredit)
  const [adjustAgentCredit] = useMutation(AdjustAgentCredit)

  useEffect(() => { if (open) setActiveTab(initialTab) }, [open, initialTab])

  // Reset form when modal opens/closes or agent changes
  const agentId = agent?.id
  const agentCreditLimit = agent?.creditLimit
  useEffect(() => {
    if (open && agentId) {
      if (activeTab === 'limit') {
        setAmount(Number(agentCreditLimit || 0))
      } else {
        setAmount(null)
      }
      setReason('')
      setAdjustmentType('INCREASE')
    } else if (!open) {
      setAmount(null)
      setReason('')
    }
  }, [open, agentId, agentCreditLimit, activeTab])

  const handleClose = () => {
    setAmount(null)
    setReason('')
    onClose()
  }

  const handleSubmit = async () => {
    if (!agent) {
      message.error('Agent not found')
      return
    }

    if (agent.schemeType !== 'CREDIT') {
      message.error('Credit adjustments are only available for CREDIT agents')
      return
    }

    if (activeTab === 'limit') {
      // Adjust Limit logic
      if (amount === null || amount === undefined) {
        message.error('Please enter a valid credit limit')
        return
      }

      if (amount < 0) {
        message.error('Credit limit cannot be negative')
        return
      }

      const currentUsed = Number(agent.creditUsed || 0)
      if (amount < currentUsed) {
        message.error(`Credit limit cannot be less than current used credit (${formatAmount(currentUsed)})`)
        return
      }

      // Reason is optional - no validation needed

      try {
        setLoading(true)
        const result = await adjustCredit({
          variables: {
            agentId: agent.id,
            creditLimit: amount,
          },
          context: { uiToast: 'notification' },
        })

        if (result.data?.agents?.adjustSubAgentCredit?.success) {
          onSuccess()
          handleClose()
        } else {
          message.error(result.data?.agents?.adjustSubAgentCredit?.message || 'Failed to adjust credit limit')
        }
      } catch (err: unknown) {
        message.error((err instanceof Error ? err.message : 'Failed to adjust credit limit') || 'Failed to adjust credit limit')
      } finally {
        setLoading(false)
      }
    } else if (activeTab === 'adjust') {
      // Add/Remove Credit logic
      if (amount === null || amount === undefined || amount <= 0) {
        message.error('Please enter a valid amount greater than 0')
        return
      }

      const currentLimit = Number(agent.creditLimit || 0)
      const currentUsed = Number(agent.creditUsed || 0)

      if (adjustmentType === 'INCREASE') {
        // When increasing credit used, check if it would exceed the limit
        const newUsed = currentUsed + amount
        if (newUsed > currentLimit) {
          message.error(`Increasing credit by ${formatAmount(amount)} would exceed the credit limit of ${formatAmount(currentLimit)}. Maximum increase allowed: ${formatAmount(Math.max(0, currentLimit - currentUsed))}`)
          return
        }
      } else if (adjustmentType === 'DECREASE') {
        // When decreasing credit used, check if amount doesn't exceed current used
        if (amount > currentUsed) {
          message.error(`Decrease amount cannot be greater than current used credit (${formatAmount(currentUsed)})`)
          return
        }
      }

      // Reason is optional - no validation needed

      try {
        setLoading(true)
        
        let mutationType: string
        let mutationAmount: number

        if (adjustmentType === 'INCREASE') {
          mutationType = 'INCREASE'
          mutationAmount = amount
        } else {
          mutationType = 'DECREASE'
          mutationAmount = amount
        }

        const result = await adjustAgentCredit({
          variables: {
            input: {
              agentId: agent.id,
              adjustmentType: mutationType,
              amount: mutationAmount,
              notes: reason.trim()
            }
          },
          context: { uiToast: 'notification' }
        })

        if (result.data?.agents?.adjustAgentCredit?.success) {
          onSuccess()
          handleClose()
        } else {
          message.error(result.data?.agents?.adjustAgentCredit?.message || 'Failed to process credit adjustment')
        }
      } catch (err: unknown) {
        message.error((err instanceof Error ? err.message : 'Failed to process credit adjustment') || 'Failed to process credit adjustment')
      } finally {
        setLoading(false)
      }
    }
  }

  const currentLimit = Number(agent?.creditLimit || 0)
  const currentUsed = Number(agent?.creditUsed || 0)
  const currentAvailable = Number(agent?.creditAvailable || 0)
  const newAvailable = amount !== null && amount !== undefined ? Math.max(0, amount - currentUsed) : currentAvailable

  const disabled = loading || (activeTab === 'limit'
    ? amount === null || amount <= 0 || amount < currentUsed
    : amount === null || amount <= 0 || (adjustmentType === 'INCREASE' ? currentUsed + amount > currentLimit : amount > currentUsed))
  return <Dialog open={open} onOpenChange={value => { if (!value && !loading) handleClose() }} title="Adjust Credit" size="md" dismissible={!loading}
    footer={<div className={styles.footer}><span className={styles.summary}>Limit: {formatAmount(currentLimit)} · Used: {formatAmount(currentUsed)} · Available: {formatAmount(currentAvailable)}</span><div className={styles.actions}><Button onClick={handleClose} disabled={loading}>Cancel</Button><Button variant="primary" onClick={() => void handleSubmit()} loading={loading} disabled={disabled}>{activeTab === 'limit' ? 'Update Limit' : adjustmentType === 'INCREASE' ? 'Add Credit' : 'Remove Credit'}</Button></div></div>}>
    <div className={styles.stack}><div className={styles.tabs}><Tabs value={activeTab} items={[{ value: 'limit', label: 'Adjust Limit' }, { value: 'adjust', label: 'Add/Remove Credit' }]} onChange={value => { setActiveTab(value); setAmount(null); setReason(''); setAdjustmentType('INCREASE') }} label="Credit adjustment type" idPrefix="agent-credit-adjustment" /></div>
      <div className={styles.stack} role="tabpanel" id={tabPanelId('agent-credit-adjustment', activeTab)} aria-labelledby={tabId('agent-credit-adjustment', activeTab)}>
        <Notice tone="info" title={activeTab === 'limit' ? 'Change credit limit' : 'Adjust credit used'}>{activeTab === 'limit' ? "This will update the agent's maximum credit limit" : 'Increase or decrease the amount of credit used by the agent'}</Notice>
        {activeTab === 'adjust' && <Select layout="stacked" label="Adjustment Type" value={adjustmentType} onChange={value => setAdjustmentType(value as 'INCREASE' | 'DECREASE')} disabled={loading} options={[{ value: 'INCREASE', label: 'Increase Credit Used (Add)' }, { value: 'DECREASE', label: 'Decrease Credit Used (Remove)' }]} />}
        <NumberField label={activeTab === 'limit' ? 'New Credit Limit' : 'Amount'} value={amount} onChange={value => setAmount(value || null)} min={activeTab === 'limit' ? currentUsed : 0} step={activeTab === 'limit' ? 1000 : .01} grouping="en-US" disabled={loading} placeholder="0.00"
          help={activeTab === 'limit' ? `Current limit: ${formatAmount(currentLimit)}` : `Current used: ${formatAmount(currentUsed)} / ${formatAmount(currentLimit)}`}
          error={activeTab === 'limit' && amount !== null && amount < currentUsed ? `Credit limit cannot be less than current used credit (${formatAmount(currentUsed)})` : undefined} />
        <Textarea label="Reason" rows={3} value={reason} onChange={setReason} placeholder={activeTab === 'limit' ? 'Provide a reason for changing the credit limit (optional)' : 'Provide a reason for this credit adjustment (optional)'} maxLength={500} showCount disabled={loading} />
        {amount !== null && amount > 0 && <div className={activeTab === 'limit' ? styles.preview : adjustmentType === 'INCREASE' ? styles.previewIncrease : styles.previewDecrease}>
          <DescriptionList items={[{ term: activeTab === 'limit' ? 'New limit will be' : 'New credit used will be', value: formatAmount(activeTab === 'limit' ? amount : adjustmentType === 'INCREASE' ? currentUsed + amount : Math.max(0, currentUsed - amount)) }, { term: 'Available credit will be', value: formatAmount(activeTab === 'limit' ? newAvailable : Math.max(0, currentLimit - (adjustmentType === 'INCREASE' ? currentUsed + amount : Math.max(0, currentUsed - amount)))) }]} />
        </div>}
      </div>
    </div>
  </Dialog>
}

