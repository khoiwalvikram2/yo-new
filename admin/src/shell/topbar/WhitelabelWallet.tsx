import { useNavigate } from 'react-router-dom'
import { useCurrency } from '@/shared/core/CurrencyContext'
import type { WalletWidgetProps } from './WalletParts'
import { useWhitelabelCredit } from './useWhitelabelCredit'
import { WhitelabelWalletView } from './WhitelabelWalletView'

/**
 * Topbar wallet for Whitelabel Admins, mounted once by the Topbar with compact = isSmallScreen (decision 2).
 * The Topbar alone decides visibility; this widget has no role check, as WhitelabelCreditIndicator had none.
 */
export function WhitelabelWallet({ compact }: WalletWidgetProps) {
  const navigate = useNavigate()
  const { formatAmount } = useCurrency()
  const state = useWhitelabelCredit()

  return (
    <WhitelabelWalletView
      state={state}
      compact={compact}
      formatAmount={formatAmount}
      onViewDetails={() => navigate('/credit')}
    />
  )
}
