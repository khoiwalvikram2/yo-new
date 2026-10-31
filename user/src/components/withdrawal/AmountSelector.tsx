import { IndianRupee, CheckCircle2, AlertCircle } from 'lucide-react'
import { formatAmount, formatWholeAmount } from '@/lib/currency'
import { useMemo, useState } from 'react'

interface WithdrawalAmountSelectorProps {
  amount: string
  onChange: (amount: string) => void
  minAmount: number
  maxAmount: number
  quickAmounts?: number[]
  availableBalance?: number
  disabled?: boolean
}

export function WithdrawalAmountSelector({
  amount,
  onChange,
  minAmount,
  maxAmount,
  quickAmounts = [200, 500, 1000, 5000, 10000],
  availableBalance,
  disabled = false,
}: WithdrawalAmountSelectorProps) {
  const [isFocused, setIsFocused] = useState(false)
  const parsedAmount = useMemo(() => Number(amount || 0), [amount])
  
  const effectiveMax = Math.min(maxAmount, availableBalance || Infinity)
  
  const isValid = parsedAmount >= minAmount && parsedAmount <= effectiveMax
  const hasValue = amount.length > 0
  const exceedsBalance = availableBalance !== undefined && parsedAmount > availableBalance

  const validationMessage = useMemo(() => {
    if (!hasValue) return 'Choose a preset amount or enter your desired withdrawal amount'
    if (exceedsBalance) {
      return `Insufficient balance. Available: ${formatAmount(availableBalance || 0)}`
    }
    if (parsedAmount < minAmount) {
      return `Minimum withdrawal amount is ${formatAmount(minAmount)}`
    }
    if (parsedAmount > effectiveMax) {
      return `Maximum withdrawal amount is ${formatAmount(effectiveMax)}`
    }
    return '' // No message when valid
  }, [hasValue, parsedAmount, minAmount, effectiveMax, exceedsBalance, availableBalance])

  const filteredQuickAmounts = useMemo(() => {
    return quickAmounts.filter(amt => 
      amt >= minAmount && 
      amt <= effectiveMax &&
      (availableBalance === undefined || amt <= availableBalance)
    )
  }, [quickAmounts, minAmount, effectiveMax, availableBalance])

  return (
    <div className="wd-pane">
      {/* Header */}
      <div>
        <h3 className="wd-title">Select Withdrawal Amount</h3>
        <p className="wd-sub">Choose from preset amounts or enter a custom value</p>
      </div>

      {/* Input Field */}
      <div className={`wd-amount${hasValue && !isValid ? ' is-invalid' : hasValue && isValid ? ' is-valid' : ''}`}>
        <div className={`wd-amount-prefix${
          hasValue && isValid
            ? ' is-valid'
            : isFocused
            ? ' is-focus'
            : ''
        }`}>
          <IndianRupee className="h-5 w-5" />
        </div>
        <input
          type="tel"
          inputMode="numeric"
          placeholder="Enter amount"
          value={amount}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={disabled}
          className="wd-amount-input"
        />
        {hasValue && isValid && (
          <div className="wd-amount-ok">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Verified</span>
          </div>
        )}
      </div>

      {/* Validation Message - Only show errors */}
      {hasValue && !isValid && (
        <div className="wd-field-alert">
          <AlertCircle className="h-4 w-4" />
          <p>
            {validationMessage}
          </p>
        </div>
      )}

      {/* Quick Amount Buttons */}
      {filteredQuickAmounts.length > 0 && (
        <div>
          <div className="wd-presets-head">
            <p className="wd-label">Preset Amounts</p>
          </div>
          <div className="wd-presets">
            {filteredQuickAmounts.map((amt) => {
              const isActive = parsedAmount === amt
              return (
                <button
                  key={amt}
                  onClick={() => onChange(String(amt))}
                  disabled={disabled}
                  className={`wd-chip${isActive ? ' is-active' : ''}`}
                >
                  {formatWholeAmount(amt)}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Limits Display */}
      <div className="wd-limits">
        <span className="wd-limits-label">Withdrawal Limits:</span>
        <span className="wd-limits-values">
          <span>
            Min {formatAmount(minAmount)}
          </span>
          <span className="wd-limits-sep">•</span>
          <span>
            Max {formatAmount(effectiveMax)}
          </span>
        </span>
      </div>
    </div>
  )
}

