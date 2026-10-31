import { useId, useState } from 'react'
import { Popover } from '@/ui/components/Popover'
import type { FormatAmount } from './formatAmount'
import type { AgentCommissionState } from './useAgentCommission'
import { SharingBody, WalletPanel, WalletTrigger, WalletTriggerLoading } from './WalletParts'

export interface AgentCommissionWalletViewProps {
  state: AgentCommissionState
  compact: boolean
  formatAmount: FormatAmount
  onViewDetails: () => void
}

/**
 * Commission wallet for COMMISSION agents: neutral trigger with the current-period total, and a popover
 * with the total, per-domain All-Time / Current Period figures and a "View Commission Details" footer.
 * No tabs, no status pill. Props only: the container supplies the hook state, formatAmount and onViewDetails.
 */
export function AgentCommissionWalletView({ state, compact, formatAmount, onViewDetails }: AgentCommissionWalletViewProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()

  if (!state.visible) return null
  if (state.loading || state.commission === null) return <WalletTriggerLoading />

  const { commission } = state
  const amountText = formatAmount(commission.currentPeriodTotal, commission.currency)

  const handleViewDetails = () => {
    setOpen(false)
    onViewDetails()
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      labelledBy={titleId}
      trigger={
        <WalletTrigger
          label={`Commission wallet, ${amountText} current period total`}
          amountText={amountText}
          compact={compact}
          tone={null}
          showDot={false}
        />
      }
    >
      <WalletPanel
        titleId={titleId}
        title="Commission Wallet"
        subtitle="Agent Commission"
        tone={null}
        statusLabel={null}
        footer={{ label: 'View Commission Details', onClick: handleViewDetails }}
      >
        <SharingBody
          sharing={commission}
          loading={false}
          formatAmount={formatAmount}
          periodLabel="Current Period"
          capped={false}
        />
      </WalletPanel>
    </Popover>
  )
}
