import { useNavigate } from 'react-router-dom'
import { useCurrency } from '@/shared/core/CurrencyContext'
import { useAgentCredit } from './useAgentCredit'
import { AgentCreditWalletView } from './AgentCreditWalletView'
import type { WalletWidgetProps } from './WalletParts'

export function AgentCreditWallet({ compact }: WalletWidgetProps) {
  const state = useAgentCredit()
  const { formatAmount } = useCurrency()
  const navigate = useNavigate()

  return (
    <AgentCreditWalletView
      state={state}
      compact={compact}
      formatAmount={formatAmount}
      onViewDetails={() => navigate('/agent/credit')}
    />
  )
}
