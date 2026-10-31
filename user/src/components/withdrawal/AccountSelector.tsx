import { Building, QrCode, Check, AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'

export interface WithdrawalAccount {
  id: string
  type: 'upi' | 'bank'
  holderName: string
  accountNumber?: string
  upiId?: string
  ifsc?: string
  bankName?: string
  isPrimary?: boolean
  label?: string
}

interface AccountSelectorProps {
  accounts: WithdrawalAccount[]
  selectedAccountId?: string
  onSelect: (account: WithdrawalAccount) => void
  loading?: boolean
  error?: string | null
  disabled?: boolean
}

const accountIcons: Record<string, ReactNode> = {
  upi: <QrCode className="h-5 w-5" />,
  bank: <Building className="h-5 w-5" />,
}

function maskAccount(acc: string) {
  if (!acc) return '—'
  const tail = acc.slice(-4)
  return `•••• ${tail}`
}

export function AccountSelector({
  accounts,
  selectedAccountId,
  onSelect,
  loading,
  error,
  disabled = false,
}: AccountSelectorProps) {
  if (loading) {
    return (
      <div className="wd-loading">
        <p>Loading accounts...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="wd-empty is-error">
        <div className="wd-empty-icon">
          <AlertCircle className="h-8 w-8" />
        </div>
        <p className="wd-empty-title">{error}</p>
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="wd-empty">
        <div className="wd-empty-icon">
          <Building className="h-6 w-6" />
        </div>
        <p className="wd-empty-title">No withdrawal accounts found</p>
        <p className="wd-empty-text">Please add an account in the Accounts tab</p>
      </div>
    )
  }

  return (
    <div className="wd-pane">
      <div>
        <h3 className="wd-title">Select Withdrawal Account</h3>
        <p className="wd-sub">Choose where you want to receive funds</p>
      </div>

      <div className="wd-acc-grid">
        {accounts.map((account) => {
          const isSelected = selectedAccountId === account.id

          return (
            <button
              key={account.id}
              onClick={() => onSelect(account)}
              disabled={disabled}
              className={`wd-acc${isSelected ? ' is-selected' : ''}`}
            >
              {/* Selection Indicator */}
              {isSelected && (
                <span className="wd-acc-check">
                  <Check className="h-4 w-4" />
                </span>
              )}

              {/* Header with Icon and Title */}
              <div className="wd-acc-head">
                <div className="wd-acc-icon">
                  {accountIcons[account.type]}
                </div>
                <div className="min-w-0">
                  <div className="wd-acc-name">
                    <h4>
                      {account.type === 'upi' ? 'UPI Account' : account.bankName || 'Bank Account'}
                    </h4>
                    {account.isPrimary && (
                      <span className="wd-badge">
                        Primary
                      </span>
                    )}
                  </div>
                  <p className="wd-acc-holder">
                    {account.holderName}
                  </p>
                </div>
              </div>

              {/* Account Details */}
              <div className="wd-acc-rows">
                {account.type === 'upi' ? (
                  <div className="wd-acc-row">
                    <p>UPI ID</p>
                    <p>{account.upiId}</p>
                  </div>
                ) : (
                  <>
                    <div className="wd-acc-row">
                      <p>Account Number</p>
                      <p>{maskAccount(account.accountNumber || '')}</p>
                    </div>
                    {account.ifsc && (
                      <div className="wd-acc-row">
                        <p>IFSC Code</p>
                        <p>{account.ifsc}</p>
                      </div>
                    )}
                    {account.bankName && (
                      <div className="wd-acc-row">
                        <p>Bank Name</p>
                        <p className="is-text">{account.bankName}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

