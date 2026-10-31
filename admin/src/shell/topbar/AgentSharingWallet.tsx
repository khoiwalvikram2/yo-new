import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAgentSharing } from './useAgentSharing'
import { AgentSharingWalletView } from './AgentSharingWalletView'
import type { WalletWidgetProps } from './WalletParts'

export function AgentSharingWallet({ compact }: WalletWidgetProps) {
  const state = useAgentSharing()
  const { formatAmount } = useCurrency()
  return <AgentSharingWalletView state={state} compact={compact} formatAmount={formatAmount} />
}
