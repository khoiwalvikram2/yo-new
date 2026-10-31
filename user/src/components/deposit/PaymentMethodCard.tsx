import { useState } from 'react'
import { Building, QrCode, CreditCard, Copy, Check } from 'lucide-react'
import { formatAmount } from '@/lib/currency'

export interface PaymentMethod {
  id: string
  type: 'upi' | 'bank' | 'gateway'
  name: string
  displayName?: string
  accountNumber?: string
  ifscCode?: string
  bankName?: string
  accountHolderName?: string
  branch?: string
  upiId?: string
  qrUrl?: string
  minAmount?: number
  maxAmount?: number
  processingTime?: string
  isActive?: boolean
  iconUrl?: string
  provider?: string
}

interface PaymentMethodCardProps {
  method: PaymentMethod
  isSelected?: boolean
  onClick?: () => void
  disabled?: boolean
  showDetails?: boolean
  prominentAccountLimits?: boolean
}

function CopyableField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="dep-copy">
      <div className="dep-copy-text">
        <span className="dep-copy-label">{label}</span>
        <span className="dep-copy-value">{value}</span>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className={`dep-copy-btn${copied ? ' is-copied' : ''}`}
        title={`Copy ${label}`}
      >
        {copied ? <Check /> : <Copy />}
      </button>
    </div>
  )
}

function SelectCheckbox({ selected, onClick }: { selected: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`dep-select${selected ? ' is-selected' : ''}`}
    >
      <div className="dep-select-box">
        {selected && <Check />}
      </div>
      <span className="dep-select-label">
        {selected ? 'Selected' : 'Select'}
      </span>
    </button>
  )
}

export function PaymentMethodCard({
  method,
  isSelected = false,
  onClick,
  disabled = false,
  showDetails = false,
  prominentAccountLimits = false,
}: PaymentMethodCardProps) {
  const isAvailable = method.isActive !== false

  const methodIconsSmall = {
    upi: <QrCode />,
    bank: <Building />,
    gateway: <CreditCard />,
  }

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!disabled && isAvailable && onClick) onClick()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={disabled || !isAvailable ? undefined : onClick}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && onClick && !disabled && isAvailable) onClick() }}
      className={`dep-method${disabled || !isAvailable ? ' is-disabled' : ''}${isSelected ? ' is-selected' : ''}`}
    >
      {/* Header row */}
      <div className="dep-method-head">
        <div className={`dep-method-icon is-${method.type}`}>
          {method.iconUrl ? (
            <img src={method.iconUrl} alt={method.name} />
          ) : (
            methodIconsSmall[method.type]
          )}
        </div>

        <div className="dep-method-main">
          <div className="dep-method-title">
            <h4 className="dep-method-name">
              {method.displayName || method.name}
            </h4>
            {method.type === 'gateway' && method.provider && (
              <span className="dep-method-provider">
                {method.provider}
              </span>
            )}
          </div>
          {(method.minAmount != null || method.maxAmount != null) &&
            (prominentAccountLimits ? (
              <div className="dep-method-limit-chips">
                {method.minAmount != null && (
                  <span className="dep-limit-chip is-min">
                    Min {formatAmount(method.minAmount)}
                  </span>
                )}
                {method.maxAmount != null && (
                  <span className="dep-limit-chip is-max">
                    Max {formatAmount(method.maxAmount)}
                  </span>
                )}
              </div>
            ) : (
              <div className="dep-method-limits">
                {method.minAmount != null && <span>Min {formatAmount(method.minAmount)}</span>}
                {method.minAmount != null && method.maxAmount != null && ' · '}
                {method.maxAmount != null && <span>Max {formatAmount(method.maxAmount)}</span>}
              </div>
            ))}
        </div>

        <SelectCheckbox selected={isSelected} onClick={handleSelect} />
      </div>

      {/* Full details - always visible */}
      {showDetails && (method.type === 'upi' || method.type === 'bank') && (
        <div className="dep-method-details">
          {method.type === 'upi' && (
            <div className="dep-upi">
              {method.qrUrl && (
                <div className="dep-qr">
                  <img
                    src={method.qrUrl}
                    alt="UPI QR Code"
                    style={{ width: 200, height: 200 }}
                  />
                </div>
              )}
              <div className="dep-copy-list">
                {method.upiId && <CopyableField label="UPI ID" value={method.upiId} />}
                {method.displayName && <CopyableField label="Display Name" value={method.displayName} />}
              </div>
            </div>
          )}

          {method.type === 'bank' && (
            <div className="dep-copy-list is-grid">
              {method.bankName && <CopyableField label="Bank Name" value={method.bankName} />}
              {method.accountHolderName && <CopyableField label="Account Holder" value={method.accountHolderName} />}
              {method.accountNumber && <CopyableField label="Account Number" value={method.accountNumber} />}
              {method.ifscCode && <CopyableField label="IFSC Code" value={method.ifscCode} />}
              {method.branch && <CopyableField label="Branch" value={method.branch} />}
            </div>
          )}
        </div>
      )}

      {!isAvailable && (
        <div className="dep-method-overlay">
          <span>Unavailable</span>
        </div>
      )}
    </div>
  )
}

