import { AlertCircle, IndianRupee, TrendingUp } from 'lucide-react'
import { formatAmount, formatWholeAmount } from '@/lib/currency'
import { useMemo, useState } from 'react'

interface AmountSelectorProps {
  amount: string
  onChange: (amount: string) => void
  minAmount: number
  maxAmount: number
  quickAmounts?: number[]
  accountLimits?: { min?: number; max?: number }
  disabled?: boolean
}

export function AmountSelector({
  amount,
  onChange,
  minAmount,
  maxAmount,
  quickAmounts = [1000, 2000, 5000, 10000, 50000, 100000],
  accountLimits,
  disabled = false,
}: AmountSelectorProps) {
  const [isFocused, setIsFocused] = useState(false)
  const parsedAmount = useMemo(() => Number(amount || 0), [amount])

  const effectiveMin = Math.max(minAmount, accountLimits?.min || 0)
  const effectiveMax = Math.min(maxAmount, accountLimits?.max || Infinity)

  const isValid = parsedAmount >= effectiveMin && parsedAmount <= effectiveMax
  const hasValue = amount.length > 0

  const validationMessage = useMemo(() => {
    if (!hasValue) return 'Choose a quick amount or enter your desired amount'
    if (parsedAmount < effectiveMin) {
      return `Minimum deposit amount is ${formatAmount(effectiveMin)}`
    }
    if (parsedAmount > effectiveMax) {
      return `Maximum deposit amount is ${formatAmount(effectiveMax)}`
    }
    return '' // No message when valid
  }, [hasValue, parsedAmount, effectiveMin, effectiveMax])

  const filteredQuickAmounts = useMemo(() => {
    return quickAmounts.filter(amt => amt >= effectiveMin && amt <= effectiveMax)
  }, [quickAmounts, effectiveMin, effectiveMax])

  return (
    <div className="dep-amount">
      <div className="dep-amount-field">
        <div className={`dep-amount-prefix${hasValue && isValid ? ' is-valid' : isFocused ? ' is-focused' : ''}`}>
          <IndianRupee />
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
          className={`dep-amount-input${hasValue && !isValid ? ' is-invalid' : ''}`}
        />
        {hasValue && isValid && (
          <div className="dep-amount-ok">
            <TrendingUp />
            <span>OK</span>
          </div>
        )}
      </div>

      {filteredQuickAmounts.length > 0 && (
        <div className="dep-presets">
          {filteredQuickAmounts.map((amt) => {
            const isActive = parsedAmount === amt
            return (
              <button
                key={amt}
                type="button"
                onClick={() => onChange(String(amt))}
                disabled={disabled}
                className={`dep-preset${isActive ? ' is-active' : ''}`}
              >
                {formatWholeAmount(amt)}
              </button>
            )
          })}
        </div>
      )}

      {hasValue && !isValid && (
        <p className="dep-field-error"><AlertCircle aria-hidden="true" />{validationMessage}</p>
      )}

      {(accountLimits?.min != null || accountLimits?.max != null) && (
        <p className="dep-limit-hint">
          Limit: {accountLimits?.min != null ? formatAmount(accountLimits.min) : ''}
          {accountLimits?.min != null && accountLimits?.max != null ? ' – ' : ''}
          {accountLimits?.max != null ? formatAmount(accountLimits.max) : ''}
        </p>
      )}
    </div>
  )
}

