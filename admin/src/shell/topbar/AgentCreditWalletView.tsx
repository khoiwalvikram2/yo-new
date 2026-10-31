import { useId, useState } from 'react'
import { Popover } from '@/ui/components/Popover'
import {
  WalletTrigger,
  WalletTriggerLoading,
  WalletTabs,
  WalletPanel,
  CreditBody,
  SharingBody,
  SettlementBody,
} from './WalletParts'
import { CREDIT_STATUS_LABEL } from './walletData'
import type { AgentCreditState } from './useAgentCredit'
import type { FormatAmount } from './formatAmount'
import type { WalletTab } from './WalletParts'

export interface AgentCreditWalletViewProps {
  state: AgentCreditState
  compact: boolean
  formatAmount: FormatAmount
  onViewDetails: () => void
}

const TABS: readonly WalletTab[] = ['credit', 'sharing', 'settlement']

export function AgentCreditWalletView(props: AgentCreditWalletViewProps) {
  const { state, compact, formatAmount, onViewDetails } = props
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<WalletTab>('credit')
  const idPrefix = useId()
  const titleId = `${idPrefix}-title`
  const panelId = `${idPrefix}-panel`
  const tabId = `${idPrefix}-tab-${tab}`

  if (!state.visible) return null
  if (state.loading || !state.credit) return <WalletTriggerLoading />

  const { credit, settlement, sharing, sharingLoading } = state
  const amountText = formatAmount(credit.creditAvailable)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      labelledBy={titleId}
      trigger={
        <WalletTrigger
          label={`Credit wallet, ${amountText} available`}
          amountText={amountText}
          compact={compact}
          tone={credit.status}
          showDot={credit.isNearLimit || credit.isCritical}
        />
      }
    >
      {({ close }) => (
        <WalletPanel
          titleId={titleId}
          title="Credit Wallet"
          subtitle="Credit & Sharing"
          tone={credit.status}
          statusLabel={tab === 'credit' ? CREDIT_STATUS_LABEL[credit.status] : null}
          tabs={<WalletTabs tabs={TABS} value={tab} onChange={setTab} idPrefix={idPrefix} />}
          tabPanelId={panelId}
          tabLabelledBy={tabId}
          footer={
            tab === 'credit'
              ? {
                  label: 'View Credit Details',
                  onClick: () => {
                    close()
                    onViewDetails()
                  },
                }
              : null
          }
        >
          {tab === 'credit' && <CreditBody credit={credit} formatAmount={formatAmount} />}
          {tab === 'sharing' && (
            <SharingBody sharing={sharing} loading={sharingLoading} formatAmount={formatAmount} periodLabel="Period" capped />
          )}
          {tab === 'settlement' && settlement && <SettlementBody settlement={settlement} formatAmount={formatAmount} />}
        </WalletPanel>
      )}
    </Popover>
  )
}
