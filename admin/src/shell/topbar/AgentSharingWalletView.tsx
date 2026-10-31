import { useId, useState } from 'react'
import { Popover } from '@/ui/components/Popover'
import { WalletTrigger, WalletTriggerLoading, WalletPanel, SharingBody } from './WalletParts'
import type { AgentSharingState } from './useAgentSharing'
import type { FormatAmount } from './formatAmount'

export interface AgentSharingWalletViewProps {
  state: AgentSharingState
  compact: boolean
  formatAmount: FormatAmount
}

export function AgentSharingWalletView({ state, compact, formatAmount }: AgentSharingWalletViewProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()

  if (!state.visible) return null
  if (state.loading || !state.sharing) return <WalletTriggerLoading />

  const amountText = formatAmount(state.sharing.currentPeriodTotal, state.sharing.currency)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      labelledBy={titleId}
      trigger={
        <WalletTrigger
          label={`Sharing Wallet, ${amountText}`}
          amountText={amountText}
          compact={compact}
          tone={null}
          showDot={false}
        />
      }
    >
      <WalletPanel
        titleId={titleId}
        title="Sharing Wallet"
        subtitle={state.subtitle}
        tone={null}
        statusLabel={null}
        footer={null}
      >
        <SharingBody
          sharing={state.sharing}
          loading={state.loading}
          formatAmount={formatAmount}
          periodLabel="Current Period"
          capped={false}
        />
      </WalletPanel>
    </Popover>
  )
}
