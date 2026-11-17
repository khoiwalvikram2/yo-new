import { useState } from 'react'
import { Building, QrCode, CreditCard, Coins, Copy, Check } from 'lucide-react'
import { formatAmount } from '@/lib/currency'
import { CRYPTO_COIN, cryptoBonusFor, cryptoBonusPercent, cryptoNetworkWarning, formatBonusPercent, formatUsdt, usdtFor } from '@/lib/cryptoDeposit'

export interface PaymentMethod {
  id: string
  type: 'upi' | 'bank' | 'gateway' | 'crypto'
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
  // type 'crypto' only: a USDT wallet and the whitelabel rate (wallet currency per 1 USDT)
  walletAddress?: string
  network?: string
  cryptoRate?: number
  /** Extra % of the deposit paid into the cash wallet on approval (unset = no bonus) */
  cryptoBonusPercent?: number
}

interface PaymentMethodCardProps {
  method: PaymentMethod
  isSelected?: boolean
  onClick?: () => void
  disabled?: boolean
  showDetails?: boolean
  prominentAccountLimits?: boolean
  /** Deposit amount entered so far; a crypto wallet shows the USDT it costs */
  amount?: number
}

/**
 * `copyValue` is what lands on the clipboard when it differs from the text shown (an amount without
 * its unit). `wrap` shows a long value in full instead of cutting it off: a wallet address must be
 * readable to the last character.
 */
export function CopyableField({ label, value, copyValue, wrap = false }: { label: string; value: string; copyValue?: string; wrap?: boolean }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(copyValue ?? value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="dep-copy">
      <div className="dep-copy-text">
        <span className="dep-copy-label">{label}</span>
        <span className={`dep-copy-value${wrap ? ' is-wrap' : ''}`}>{value}</span>
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

/** The coin a crypto wallet takes and the network it is on: the two things a player must not get wrong. */
export function CryptoCoinBadge({ network }: { network?: string }) {
  return (
    <span className="dep-crypto-badge">
      {CRYPTO_COIN}{network ? ` · ${network}` : ''}
    </span>
  )
}

/** '+5% bonus' on a crypto wallet whose deposits earn one */
export function CryptoBonusBadge({ percent }: { percent?: number }) {
  const p = cryptoBonusPercent(percent)
  if (p === null) return null
  return <span className="dep-crypto-bonus">+{formatBonusPercent(p)} bonus</span>
}

/** What a crypto deposit of `amount` credits with its bonus. The server fixes the bonus when the request is made. */
export function CryptoBonusSummary({ amount, percent }: { amount: number; percent?: number }) {
  const p = cryptoBonusPercent(percent)
  const bonus = p === null ? 0 : cryptoBonusFor(amount, p)
  if (p === null || bonus <= 0) return null
  return (
    <p className="dep-crypto-summary">
      You get <strong>{formatAmount(amount + bonus)}</strong> on approval:{' '}
      {formatAmount(amount)} + {formatAmount(bonus)} bonus ({formatBonusPercent(p)})
    </p>
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
  amount,
}: PaymentMethodCardProps) {
  const isAvailable = method.isActive !== false
  const usdtToSend = method.type === 'crypto' && amount != null ? usdtFor(amount, method.cryptoRate) : null

  const methodIconsSmall = {
    upi: <QrCode />,
    bank: <Building />,
    gateway: <CreditCard />,
    crypto: <Coins />,
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
          <div className={`dep-method-title${method.type === 'crypto' ? ' is-wrap' : ''}`}>
            <h4 className="dep-method-name">
              {method.displayName || method.name}
            </h4>
            {method.type === 'gateway' && method.provider && (
              <span className="dep-method-provider">
                {method.provider}
              </span>
            )}
            {method.type === 'crypto' && <CryptoCoinBadge network={method.network} />}
            {method.type === 'crypto' && <CryptoBonusBadge percent={method.cryptoBonusPercent} />}
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
      {showDetails && (method.type === 'upi' || method.type === 'bank' || method.type === 'crypto') && (
        <div className="dep-method-details">
          {method.type === 'crypto' && (
            <>
              <div className="dep-crypto">
                {method.qrUrl && (
                  // White in both themes: a QR code only scans dark-on-light
                  <div className="dep-qr is-scan">
                    <img
                      src={method.qrUrl}
                      alt="Wallet QR Code"
                      style={{ width: 200, height: 200 }}
                    />
                  </div>
                )}
                <div className="dep-copy-list">
                  {method.walletAddress && <CopyableField label="Wallet Address" value={method.walletAddress} wrap />}
                  {usdtToSend !== null && <CopyableField label="Amount to Send" value={formatUsdt(usdtToSend)} copyValue={usdtToSend.toFixed(2)} />}
                  {usdtToSend !== null && amount != null && <CryptoBonusSummary amount={amount} percent={method.cryptoBonusPercent} />}
                </div>
              </div>
              <div className="dep-crypto-meta">
                {method.cryptoRate != null && (
                  <span className="dep-crypto-rate">1 {CRYPTO_COIN} = {formatAmount(method.cryptoRate)}</span>
                )}
                {method.network && <span className="dep-crypto-net">{cryptoNetworkWarning(method.network)}</span>}
              </div>
            </>
          )}

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

