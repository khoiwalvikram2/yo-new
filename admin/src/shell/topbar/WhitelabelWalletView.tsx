import { useId, useState } from 'react'
import { Popover } from '@/ui/components/Popover'
import { CREDIT_STATUS_LABEL } from './walletData'
import {
  CreditBody,
  SharingBody,
  WalletPanel,
  WalletTabs,
  WalletTrigger,
  WalletTriggerLoading,
} from './WalletParts'
import type { WalletTab } from './WalletParts'
import type { FormatAmount } from './formatAmount'
import type { WhitelabelCreditState } from './useWhitelabelCredit'

export interface WhitelabelWalletViewProps {
  state: WhitelabelCreditState
  compact: boolean
  formatAmount: FormatAmount
  onViewDetails: () => void
}

const WHITELABEL_TABS: readonly WalletTab[] = ['credit', 'sharing']

/**
 * Whitelabel Admin wallet: trigger plus a Credit | Sharing popover. Props only (no data, auth, currency or
 * UI store imports), so it renders in tests without providers. Owns the popover open state and the active tab; the tab
 * survives close and reopen, as in WhitelabelCreditIndicator.tsx:15. Credit amounts take no currency argument;
 * sharing amounts use the sharing payload currency.
 */
export function WhitelabelWalletView({ state, compact, formatAmount, onViewDetails }: WhitelabelWalletViewProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<WalletTab>('credit')
  const baseId = useId()
  const titleId = `${baseId}-title`
  const idPrefix = `${baseId}-wallet`

  const { credit } = state
  if (state.loading || !credit) {
    return <WalletTriggerLoading />
  }

  const amountText = formatAmount(credit.creditAvailable)
  const isCreditTab = tab === 'credit'

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
          label={`Whitelabel wallet, ${amountText} available`}
          amountText={amountText}
          compact={compact}
          tone={credit.status}
          showDot={credit.isNearLimit || credit.isCritical}
        />
      }
    >
      <WalletPanel
        titleId={titleId}
        title="Whitelabel Wallet"
        subtitle="Credit & Sharing"
        tone={credit.status}
        statusLabel={isCreditTab ? CREDIT_STATUS_LABEL[credit.status] : null}
        tabs={<WalletTabs tabs={WHITELABEL_TABS} value={tab} onChange={setTab} idPrefix={idPrefix} />}
        tabPanelId={`${idPrefix}-panel`}
        tabLabelledBy={`${idPrefix}-tab-${tab}`}
        footer={isCreditTab ? { label: 'View Credit Details', onClick: handleViewDetails } : null}
      >
        {isCreditTab ? (
          <CreditBody credit={credit} formatAmount={formatAmount} />
        ) : (
          <SharingBody
            sharing={state.sharing}
            loading={state.sharingLoading}
            formatAmount={formatAmount}
            periodLabel="Period"
            capped
          />
        )}
      </WalletPanel>
    </Popover>
  )
}
