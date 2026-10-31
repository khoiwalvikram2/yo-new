import { useNavigate } from 'react-router-dom'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { AgentCommissionWalletView } from './AgentCommissionWalletView'
import { useAgentCommission } from './useAgentCommission'
import type { WalletWidgetProps } from './WalletParts'

/** Topbar commission wallet: useAgentCommission data + the context formatAmount + useNavigate + the props-only view. */
export function AgentCommissionWallet({ compact }: WalletWidgetProps) {
  const navigate = useNavigate()
  const { formatAmount } = useCurrency()
  const state = useAgentCommission()
  return (
    <AgentCommissionWalletView
      state={state}
      compact={compact}
      formatAmount={formatAmount}
      onViewDetails={() => navigate('/commission/overview')}
    />
  )
}
