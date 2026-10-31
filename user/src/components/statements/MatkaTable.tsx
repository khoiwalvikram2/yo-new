import { formatAmount } from '@/lib/currency'
import DateCell from './DateCell'
import StatusBadge from './StatusBadge'
import type { MatkaStatement } from './types'
import './statements-ui.css'

export default function MatkaTable({ rows, onRowClick }: { rows: MatkaStatement[]; onRowClick?: (row: MatkaStatement) => void }) {
  return <div className="nova-stmt-table-wrap"><div className="nova-stmt-scroll"><table className="nova-stmt-table nova-stmt-matka" aria-label="Matka statements">
    <thead><tr><th className="c-date">Placed at</th><th className="c-event">Market / trading date</th><th className="c-selection">Game / selection</th><th className="c-wallet">Wallet</th><th className="c-stake is-num">Stake</th><th className="c-return is-num">Payout</th><th className="c-pl is-num">Net P/L</th><th className="c-result">Result</th><th className="c-status is-center">Status</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id} className="is-clickable" onClick={() => onRowClick?.(row)}>
      <td className="c-date"><DateCell iso={row.dateISO} /></td>
      <td className="c-event"><div className="nova-stmt-title">{row.market}</div><div className="nova-stmt-sub">{row.runDate} · {row.session.toUpperCase()}</div></td>
      <td className="c-selection"><div className="nova-stmt-title">{row.selection}</div><div className="nova-stmt-sub">{row.bidType.replaceAll('_', ' ')}</div></td>
      <td className="c-wallet"><span className="nova-stmt-wallet-tag">{row.walletType === 'credit' ? 'Credit' : row.walletType === 'bonus' ? 'Bonus' : row.walletType === 'referralBonus' ? 'Referral bonus' : 'Cash'}</span></td>
      <td className="c-stake is-num" data-label="Stake">{formatAmount(row.stake, row.currency)}</td>
      <td className="c-return is-num" data-label="Payout">{row.payout == null ? '—' : formatAmount(row.payout, row.currency)}</td>
      <td className={`c-pl is-num nova-stmt-pl ${row.pl != null && row.pl > 0 ? 'is-up' : row.pl != null && row.pl < 0 ? 'is-down' : ''}`} data-label="Net P/L">{row.pl == null ? '—' : `${row.pl > 0 ? '+' : ''}${formatAmount(row.pl, row.currency)}`}</td>
      <td className="c-result" data-label="Result">{row.eventResult || '—'}</td><td className="c-status is-center"><StatusBadge value={row.result} /></td>
    </tr>)}</tbody>
  </table></div></div>
}
