import { formatAmount } from '@/lib/currency'
import DateCell from './DateCell'
import StatusBadge from './StatusBadge'
import type { Bet } from './types'
import './statements-ui.css'

/** Sport > League > Event trail: which part of the title this is. */
const pathPart = (idx: number) => (idx === 0 ? 'is-sport' : idx === 1 ? 'is-league' : idx === 2 ? 'is-event' : 'is-extra')

export default function SportsTable({ rows, onRowClick }: { rows: Bet[]; onRowClick?: (row: Bet) => void }) {
  return (
    <div className="nova-stmt-table-wrap">
      <div className="nova-stmt-scroll">
        <table className="nova-stmt-table nova-stmt-sports">
          <thead>
            <tr>
              <th className="c-date">Date</th>
              <th className="c-event">Event</th>
              <th className="c-market hidden md:table-cell">Market</th>
              <th className="c-selection hidden lg:table-cell">Selection</th>
              <th className="c-type is-center">Type</th>
              <th className="c-stake is-num">Stake</th>
              <th className="c-odds is-num">Odds</th>
              <th className="c-liab is-num">Liability</th>
              <th className="c-pl is-num">PL</th>
              <th className="c-result hidden md:table-cell">Result</th>
              <th className="c-status is-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const side = row.side ? (row.side.toLowerCase() === 'back' ? 'is-back' : 'is-lay') : ''
              return (
              <tr key={row.id} className={`is-clickable ${side}`} onClick={() => onRowClick?.(row)}>
                {/* Date */}
                <td className="c-date"><DateCell iso={row.dateISO} /></td>
                {/* Event */}
                <td className="c-event">
                  <div className="nova-stmt-path">
                    {row.title.split(' > ').map((part, idx) => (
                      <span key={idx} className={`nova-stmt-path-part ${pathPart(idx)}`}>
                        {idx > 0 && <span className="nova-stmt-path-sep">{' > '}</span>}
                        {part}
                      </span>
                    ))}
                  </div>
                  <div className="nova-stmt-sub md:hidden">{row.market}</div>
                  <div className="nova-stmt-sub lg:hidden">{row.selection ?? ''}</div>
                </td>
                {/* Market */}
                <td className="c-market hidden md:table-cell">{row.market}</td>
                {/* Selection */}
                <td className="c-selection hidden lg:table-cell">{row.selection ?? '-'}</td>
                {/* Type (Back/Lay) */}
                <td className="c-type is-center">
                  {row.side ? (
                    <span className={`nova-stmt-side ${side}`}>
                      {row.side.toUpperCase()}
                    </span>
                  ) : (
                    <span className="nova-stmt-none">-</span>
                  )}
                </td>
                {/* Stake */}
                <td className="c-stake is-num" data-label="Stake">{formatAmount(row.stake)}</td>
                {/* Odds */}
                <td className="c-odds is-num" data-label="Odds">
                  {row.odds != null ? (
                    (row.oddsSize != null && row.oddsSize > 0) || row.marketType === 'fancy'
                      ? row.odds.toFixed(0)
                      : row.odds.toFixed(2)
                  ) : '-'}
                </td>
                {/* Liability */}
                <td className="c-liab is-num" data-label="Liability">
                  {row.liability != null ? formatAmount(row.liability) : '-'}
                </td>
                {/* PL */}
                <td className={`c-pl is-num nova-stmt-pl ${
                  row.payout > 0 ? 'is-up' : row.payout < 0 ? 'is-down' : ''
                }`} data-label="PL">
                  {['Pending','Matched','Unmatched'].includes(row.result) ? '—' : `${row.payout > 0 ? '+' : ''}${formatAmount(row.payout)}`}
                </td>
                {/* Result */}
                <td className="c-result hidden md:table-cell">{row.eventResult ?? '-'}</td>
                {/* Status */}
                <td className="c-status is-center"><StatusBadge value={row.result} /></td>
              </tr>
            )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
