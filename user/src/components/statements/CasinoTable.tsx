import { formatAmount } from '@/lib/currency'
import DateCell from './DateCell'
import StatusBadge from './StatusBadge'
import type { Bet } from './types'
import './statements-ui.css'

function getWalletLabelAndClass(walletType: string | null | undefined): { label: string; className: string } {
  const w = (walletType ?? 'cash').toLowerCase()
  if (w === 'referralbonus' || w === 'referral_bonus') return { label: 'Referral Bonus', className: 'is-referral' }
  if (w === 'bonus') return { label: 'Bonus', className: 'is-bonus' }
  return { label: 'Cash', className: 'is-cash' }
}

export default function CasinoTable({ rows, onRowClick }: { rows: Bet[]; onRowClick?: (row: Bet) => void }) {
  return (
    <div className="nova-stmt-table-wrap">
      <div className="nova-stmt-scroll">
        <table className="nova-stmt-table nova-stmt-casino">
          <thead>
            <tr>
              <th className="c-date">Date</th>
              <th className="c-event">Event</th>
              <th className="c-market hidden md:table-cell">Market</th>
              <th className="c-wallet is-center">Wallet</th>
              <th className="c-stake is-num">Stake</th>
              <th className="c-pl is-num">PL</th>
              <th className="c-status is-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const wallet = getWalletLabelAndClass(row.walletType)
              return (
              <tr key={row.id} className="is-clickable" onClick={() => onRowClick?.(row)}>
                <td className="c-date"><DateCell iso={row.dateISO} /></td>
                <td className="c-event">
                  <div className="nova-stmt-title">{row.title}</div>
                  <div className="nova-stmt-sub md:hidden">{row.market}</div>
                </td>
                <td className="c-market hidden md:table-cell">{row.market}</td>
                <td className="c-wallet is-center">
                  <span className={`nova-stmt-wallet-tag ${wallet.className}`}>
                    {wallet.label}
                  </span>
                </td>
                <td className="c-stake is-num" data-label="Stake">{formatAmount(row.stake)}</td>
                <td className={`c-pl is-num nova-stmt-pl ${row.payout > 0 ? 'is-up' : row.payout < 0 ? 'is-down' : ''}`} data-label="PL">{row.result === 'Pending' ? '—' : `${row.payout > 0 ? '+' : ''}${formatAmount(row.payout)}`}</td>
                <td className="c-status is-center"><StatusBadge value={row.result} /></td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}


