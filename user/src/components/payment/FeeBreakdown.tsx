import { useMemo } from 'react'
import { Info } from 'lucide-react'
import { formatAmount } from '@/lib/currency'
import { usePaymentConfig } from '@/hooks/useAppSettings'
import '../../styles/account/fee-breakdown.css'

type FeeBreakdownProps = {
  amount: number
  type: 'deposit' | 'withdrawal'
}

export default function FeeBreakdown({ amount, type }: FeeBreakdownProps) {
  const paymentConfig = usePaymentConfig()

  const feePercent = type === 'deposit'
    ? paymentConfig.depositFeePercent
    : paymentConfig.withdrawalFeePercent

  const feeDetails = useMemo(() => {
    if (!feePercent || feePercent === 0) {
      return null
    }

    const fee = (amount * feePercent) / 100
    const total = type === 'deposit' ? amount + fee : amount - fee
    const netAmount = type === 'deposit' ? amount : total

    return {
      amount,
      fee,
      total,
      netAmount,
      feePercent,
    }
  }, [amount, feePercent, type])

  if (!feeDetails) {
    return null
  }

  return (
    <div className="nova-fee">
      <div className="nova-fee-head">
        <Info aria-hidden="true" />
        <span>Fee</span>
      </div>
      <div className="nova-fee-row">
        <span className="nova-fee-label">{type === 'deposit' ? 'Amount' : 'Amount'}</span>
        <span className="nova-fee-value">{formatAmount(feeDetails.amount)}</span>
      </div>
      <div className="nova-fee-row">
        <span className="nova-fee-label">Fee ({feeDetails.feePercent}%)</span>
        <span className="nova-fee-value">{formatAmount(feeDetails.fee)}</span>
      </div>
      <div className="nova-fee-row is-total">
        <span className="nova-fee-label">{type === 'deposit' ? 'Total' : 'You receive'}</span>
        <span className="nova-fee-value">{formatAmount(feeDetails.total)}</span>
      </div>
    </div>
  )
}
