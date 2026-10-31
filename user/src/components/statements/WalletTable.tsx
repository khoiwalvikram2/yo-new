import { formatAmount } from '@/lib/currency'
import DateCell from './DateCell'
import StatusBadge from './StatusBadge'
import type { WalletTxn } from './types'
import { Eye } from 'lucide-react'
import './statements-ui.css'

function typeBadgeClass(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('deposit')) return 'is-deposit'
  if (t.includes('withdrawal') || t === 'withdraw') return 'is-withdrawal'
  if (t.includes('bonus') || t.includes('instant cash')) return 'is-bonus'
  if (t.includes('referral')) return 'is-referral'
  if (t.includes('adjustment') || t.includes('refund')) return 'is-adjust'
  return 'is-other'
}

/** Money direction, for colouring only (the amount itself is shown unsigned). */
function flowClass(row: WalletTxn): string {
  if (row.status === 'Failed') return 'is-void'
  if (row.direction) return row.direction === 'neutral' ? 'is-void' : `is-${row.direction}`
  const t = (row.type || '').toLowerCase()
  if ((t.includes('withdraw') && !t.includes('refund')) || t.includes('debit') || t.includes('forfeit') || t.includes('switch')) return 'is-debit'
  return 'is-credit'
}

interface WalletTableProps {
  rows: WalletTxn[]
  onRowClick?: (row: WalletTxn) => void
  showViewButton?: boolean
  onViewClick?: (row: WalletTxn) => void
  theme?: 'default' | 'slate'
}

export default function WalletTable({ rows, onRowClick, showViewButton = false, onViewClick, theme = 'default' }: WalletTableProps) {
  const slate = theme === 'slate'

  return (
    <div className={`nova-stmt-table-wrap${slate ? ' is-slate' : ''}`}>
      <div className="nova-stmt-scroll">
        <table className={`nova-stmt-table nova-stmt-wallet${showViewButton ? ' has-actions' : ''}`}>
          <thead>
            <tr>
              <th className="c-date">Date</th>
              <th className="c-kind">Type</th>
              <th className="c-amount is-num">Amount</th>
              <th className="c-status is-center">Status</th>
              <th className="c-id hidden sm:table-cell">Transaction ID</th>
              {showViewButton && (
                <th className="c-actions is-center">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={onRowClick ? 'is-clickable' : undefined}>
                <td className="c-date" onClick={() => onRowClick?.(row)}>
                  <DateCell iso={row.dateISO} />
                </td>
                <td className="c-kind" onClick={() => onRowClick?.(row)}>
                  <div className="nova-stmt-kind-cell">
                    <span className={`nova-stmt-kind ${typeBadgeClass(row.type || 'Credit')}`}>
                      {row.type || '—'}
                    </span>
                    {row.bonusCampaignName && (
                      <span className="nova-stmt-sub">{row.bonusCampaignName}</span>
                    )}
                  </div>
                </td>
                <td className={`c-amount is-num nova-stmt-amount ${flowClass(row)}`} onClick={() => onRowClick?.(row)}>
                  {row.direction === 'debit' ? '−' : row.direction === 'credit' ? '+' : ''}{formatAmount(Math.abs(row.amount))}
                </td>
                <td className="c-status is-center" onClick={() => onRowClick?.(row)}>
                  <StatusBadge value={row.status} />
                </td>
                <td className="c-id hidden sm:table-cell" onClick={() => onRowClick?.(row)}>
                  <span className="nova-stmt-id-kind">{row.type}</span> <span className="nova-stmt-id">{row.id}</span>
                </td>
                {showViewButton && (
                  <td className="c-actions is-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onViewClick?.(row)
                      }}
                      className="nova-stmt-view-btn"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span className="nova-stmt-view-label">View</span>
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


