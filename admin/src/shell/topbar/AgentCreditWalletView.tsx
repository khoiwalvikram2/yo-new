import { useId, useState } from 'react'
import { Popover } from '@/ui/components/Popover'
import { roundChips } from '@/modules/chips/chipModel'
import { WalletTrigger, WalletTriggerLoading, WalletPanel, ChipBody } from './WalletParts'
import type { AgentCreditState } from './useAgentCredit'
import type { FormatAmount } from './formatAmount'

export interface AgentCreditWalletViewProps {
  state: AgentCreditState
  compact: boolean
  formatAmount: FormatAmount
  onViewDetails: () => void
}

/**
 * A CREDIT agent's topbar wallet on Deposit/Withdraw chips (spec 2026-11-02 §8): the trigger shows the
 * agent's balance, and the panel its balance, downline balance, credit reference and Ref P/L. The
 * credit-limit meter, its alert dot and the Settlement tab are gone with the credit-limit model, and so is
 * the Sharing tab: CREDIT has no partnership split (spec decision 2), so a CREDIT agent has no share to show.
 */
export function AgentCreditWalletView(props: AgentCreditWalletViewProps) {
  const { state, compact, formatAmount, onViewDetails } = props
  const [open, setOpen] = useState(false)
  const titleId = useId()

  if (!state.visible) return null
  if (state.loading || !state.chips) return <WalletTriggerLoading />

  const { chips } = state
  const amountText = formatAmount(roundChips(chips.balance), chips.currency)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      labelledBy={titleId}
      trigger={
        <WalletTrigger
          label={`Chips wallet, balance ${amountText}`}
          amountText={amountText}
          compact={compact}
          tone={null}
          showDot={false}
        />
      }
    >
      {({ close }) => (
        <WalletPanel
          titleId={titleId}
          title="Chips Wallet"
          subtitle="Deposit & Withdraw"
          tone={null}
          statusLabel={null}
          footer={{
            label: 'Open Chips',
            onClick: () => {
              close()
              onViewDetails()
            },
          }}
        >
          <ChipBody chips={chips} formatAmount={formatAmount} />
        </WalletPanel>
      )}
    </Popover>
  )
}
