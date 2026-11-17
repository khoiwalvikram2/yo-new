import { Plus, CreditCard, Building2, Info, QrCode } from 'lucide-react'
import SectionCard from './SectionCard'

export type UpiAccount = { id: string; upiId: string; holderName: string; isPrimary?: boolean; approvalStatus?: string; rejectionReason?: string }
export type BankAccount = { id: string; holderName: string; accountNumber: string; ifsc: string; bankName?: string; isPrimary?: boolean; approvalStatus?: string; rejectionReason?: string }

function ApprovalBadge({ status, rejectionReason }: { status?: string; rejectionReason?: string }) {
  const s = (status || 'PENDING').toUpperCase()
  if (s === 'APPROVED') {
    return <span className="nova-acct-chip is-success">Approved</span>
  }
  if (s === 'REJECTED') {
    return (
      <span title={rejectionReason || 'Rejected'} className="nova-acct-chip is-failed">
        Rejected{rejectionReason ? ': ' + rejectionReason : ''}
      </span>
    )
  }
  return <span className="nova-acct-chip is-pending">Pending Approval</span>
}

function AdminDisabledBadge() {
  return (
    <span className="nova-acct-chip is-neutral">
      Disabled by admin
    </span>
  )
}

export default function AccountsTab({
  upiAccounts,
  bankAccounts,
  setPrimary,
  onAddUpi,
  onAddBank,
  hideAddUpi = false,
  hideAddBank = false,
  upiDisabled = false,
  bankDisabled = false,
}: {
  upiAccounts: UpiAccount[]
  bankAccounts: BankAccount[]
  setPrimary: (kind: 'upi' | 'bank', id: string) => void
  onAddUpi: () => void
  onAddBank: () => void
  hideAddUpi?: boolean
  hideAddBank?: boolean
  upiDisabled?: boolean
  bankDisabled?: boolean
}) {
  const totalAccounts = upiAccounts.length + bankAccounts.length
  return (
    <div className="wd-accounts">
      <div className="wd-notice is-info">
        <Info className="h-4 w-4" />
        {/* These lists hold live accounts only; the server counts every account ever added, deleted ones too (FIN-05) */}
        <p>{totalAccounts < 2 ? 'Your first 2 accounts are auto-approved (deleted accounts count toward the 2).' : 'New accounts require admin approval before you can withdraw from them.'}</p>
      </div>
      <SectionCard>
        <div className="nova-acct-panel-head wd-section-head">
          <div className="wd-section-icon">
            <CreditCard className="h-4 w-4" />
          </div>
          <div className="wd-section-titles">
            <div className="wd-section-title">UPI IDs <span className="wd-count">{upiAccounts.length}</span></div>
            <div className="wd-section-sub">Saved payout addresses</div>
          </div>
          <div className="wd-section-hint">Primary is used by default</div>
        </div>
        <div className="wd-section-body">
        <div className="wd-saved-grid">
          {upiAccounts.map((u) => (
            <div
              key={u.id}
              className={`wd-saved${upiDisabled ? ' is-disabled' : ''}`}
            >
              <div className="wd-saved-top">
                <div className="wd-acc-icon">
                  <QrCode className="h-5 w-5" />
                </div>
                <div className="wd-saved-main">
                  <div className="wd-saved-label">UPI ID</div>
                  <div className="wd-saved-value">{u.upiId}</div>
                </div>
                {!u.isPrimary && !upiDisabled && (
                  <button
                    type="button"
                    className="wd-set-primary"
                    onClick={() => setPrimary('upi', u.id)}
                  >
                    Set primary
                  </button>
                )}
              </div>
              <div className="wd-saved-rows">
                <div className="wd-saved-row">
                  <span>Account Holder</span>
                  <span className="is-name">{u.holderName}</span>
                </div>
              </div>
              <div className="wd-saved-badges">
                {u.isPrimary && <span className="wd-badge">Primary</span>}
                {upiDisabled ? <AdminDisabledBadge /> : <ApprovalBadge status={u.approvalStatus} rejectionReason={u.rejectionReason} />}
              </div>
            </div>
          ))}

          {!hideAddUpi && (
            <button
              type="button"
              className="wd-add"
              onClick={onAddUpi}
            >
              <span className="wd-add-icon"><Plus className="h-4 w-4" /></span> Add UPI
            </button>
          )}
        </div>
        </div>
      </SectionCard>

      <SectionCard>
        <div className="nova-acct-panel-head wd-section-head">
          <div className="wd-section-icon">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="wd-section-titles">
            <div className="wd-section-title">Bank Accounts <span className="wd-count">{bankAccounts.length}</span></div>
            <div className="wd-section-sub">Linked bank details</div>
          </div>
          <div className="wd-section-hint">IFSC will be verified</div>
        </div>
        <div className="wd-section-body">
        <div className="wd-saved-grid">
          {bankAccounts.map((b) => (
            <div
              key={b.id}
              className={`wd-saved${bankDisabled ? ' is-disabled' : ''}`}
            >
              <div className="wd-saved-top">
                <div className="wd-acc-icon">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="wd-saved-main">
                  <div className="wd-saved-label">Acc. Holder</div>
                  <div className="wd-saved-value is-name">{b.holderName}</div>
                  {b.bankName && <div className="wd-saved-sub">{b.bankName}</div>}
                </div>
                {!b.isPrimary && !bankDisabled && (
                  <button
                    type="button"
                    className="wd-set-primary"
                    onClick={() => setPrimary('bank', b.id)}
                  >
                    Set primary
                  </button>
                )}
              </div>
              <div className="wd-saved-rows">
                <div className="wd-saved-row">
                  <span>Account</span>
                  <span className="is-mono">{maskAccount(b.accountNumber)}</span>
                </div>
                <div className="wd-saved-row">
                  <span>IFSC</span>
                  <span className="is-mono">{b.ifsc}</span>
                </div>
              </div>
              <div className="wd-saved-badges">
                {b.isPrimary && <span className="wd-badge">Primary</span>}
                {bankDisabled ? <AdminDisabledBadge /> : <ApprovalBadge status={b.approvalStatus} rejectionReason={b.rejectionReason} />}
              </div>
            </div>
          ))}

          {!hideAddBank && (
            <button
              type="button"
              className="wd-add"
              onClick={onAddBank}
            >
              <span className="wd-add-icon"><Plus className="h-4 w-4" /></span> Add Account
            </button>
          )}
        </div>
        </div>
      </SectionCard>
    </div>
  )
}

function maskAccount(acc: string) {
  const tail = acc.slice(-4)
  return `•••• ${tail}`
}
