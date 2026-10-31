import ModalSurface from '../modals/ModalSurface'
import { formatAmount } from '@/lib/currency'
import StatusBadge from './StatusBadge'
import DateCell from './DateCell'
import type { TabKey } from './types'
import './statements-ui.css'

/** Sport > League > Event trail: which part of the title this is. */
const pathPart = (idx: number) => (idx === 0 ? 'is-sport' : idx === 1 ? 'is-league' : idx === 2 ? 'is-event' : 'is-extra')

export default function DetailsModal({ details, onClose }: { details: null | { type: TabKey; row: any }; onClose: () => void }) {
  if (!details) return null

  const row = details.row

  // Format sports bet details in organized format
  const renderSportsDetails = () => {
    const isFancy = (row.oddsSize != null && row.oddsSize > 0) || row.marketType === 'fancy'
    const formattedOdds = row.odds != null
      ? (isFancy ? row.odds.toFixed(0) : row.odds.toFixed(2))
      : '-'

    return (
      <div className="nova-stmt-dl">
        {/* Date */}
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">Date</span>
          <div className="nova-stmt-dl-value">
            <DateCell iso={row.dateISO} />
          </div>
        </div>

        {/* Event: Sport > League > Event */}
        <div className="nova-stmt-dl-row is-top">
          <span className="nova-stmt-dl-label">Event</span>
          <div className="nova-stmt-dl-value nova-stmt-path">
            {row.title?.split(' > ').map((part: string, idx: number) => (
              <span key={idx} className={`nova-stmt-path-part ${pathPart(idx)}`}>
                {idx > 0 && <span className="nova-stmt-path-sep">{' > '}</span>}
                {part}
              </span>
            ))}
          </div>
        </div>

        {/* Market */}
        {row.market && (
          <div className="nova-stmt-dl-row">
            <span className="nova-stmt-dl-label">Market</span>
            <span className="nova-stmt-dl-value">{row.market}</span>
          </div>
        )}

        {/* Selection */}
        {row.selection && (
          <div className="nova-stmt-dl-row">
            <span className="nova-stmt-dl-label">Selection</span>
            <span className="nova-stmt-dl-value">{row.selection}</span>
          </div>
        )}

        {/* Type (Side) */}
        {row.side && (
          <div className="nova-stmt-dl-row">
            <span className="nova-stmt-dl-label">Type</span>
            <span className={`nova-stmt-side ${
              row.side.toLowerCase() === 'back'
                ? 'is-back'
                : 'is-lay'
            }`}>
              {row.side.toUpperCase()}
            </span>
          </div>
        )}

        {/* Stake */}
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">Stake</span>
          <span className="nova-stmt-dl-value is-strong">{formatAmount(row.stake)}</span>
        </div>

        {/* Odds */}
        {row.odds != null && (
          <div className="nova-stmt-dl-row">
            <span className="nova-stmt-dl-label">Odds</span>
            <span className="nova-stmt-dl-value is-num">{formattedOdds}</span>
          </div>
        )}

        {/* Liability */}
        {row.liability != null && (
          <div className="nova-stmt-dl-row">
            <span className="nova-stmt-dl-label">Liability</span>
            <span className="nova-stmt-dl-value is-num">{formatAmount(row.liability)}</span>
          </div>
        )}

        {/* PL */}
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">PL</span>
          <span className={`nova-stmt-dl-value is-strong nova-stmt-pl ${
            row.payout > 0 ? 'is-up' : row.payout < 0 ? 'is-down' : ''
          }`}>
            {['Pending','Matched','Unmatched'].includes(row.result) ? '—' : `${row.payout > 0 ? '+' : ''}${formatAmount(row.payout)}`}
          </span>
        </div>

        {/* Result */}
        {row.eventResult && (
          <div className="nova-stmt-dl-row">
            <span className="nova-stmt-dl-label">Result</span>
            <span className="nova-stmt-dl-value">{row.eventResult}</span>
          </div>
        )}

        {/* Status */}
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">Status</span>
          <StatusBadge value={row.result} />
        </div>
      </div>
    )
  }

  // Format casino bet details in same structure as sports (Date, Event, Market, Stake, PL, Status)
  const renderCasinoDetails = () => {
    return (
      <div className="nova-stmt-dl">
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">Date</span>
          <div className="nova-stmt-dl-value">
            <DateCell iso={row.dateISO} />
          </div>
        </div>
        <div className="nova-stmt-dl-row is-top">
          <span className="nova-stmt-dl-label">Event</span>
          <div className="nova-stmt-dl-value">{row.title}</div>
        </div>
        {row.market && (
          <div className="nova-stmt-dl-row">
            <span className="nova-stmt-dl-label">Market</span>
            <span className="nova-stmt-dl-value">{row.market}</span>
          </div>
        )}
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">Stake</span>
          <span className="nova-stmt-dl-value is-strong">{formatAmount(row.stake)}</span>
        </div>
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">PL</span>
          <span className={`nova-stmt-dl-value is-strong nova-stmt-pl ${row.payout > 0 ? 'is-up' : row.payout < 0 ? 'is-down' : ''}`}>
            {row.result === 'Pending' ? '—' : `${row.payout > 0 ? '+' : ''}${formatAmount(row.payout)}`}
          </span>
        </div>
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">Wallet</span>
          <span className={`nova-stmt-wallet-tag ${
            (row.walletType ?? 'cash').toLowerCase() === 'referralbonus' || (row.walletType ?? '').toLowerCase() === 'referral_bonus'
              ? 'is-referral'
              : row.walletType === 'bonus'
                ? 'is-bonus'
                : 'is-cash'
          }`}>
            {(row.walletType ?? 'cash').toLowerCase() === 'referralbonus' || (row.walletType ?? '').toLowerCase() === 'referral_bonus'
              ? 'Referral Bonus'
              : row.walletType === 'bonus'
                ? 'Bonus'
                : 'Cash'}
          </span>
        </div>
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">Status</span>
          <StatusBadge value={row.result} />
        </div>
      </div>
    )
  }

  // Wallet transaction details: type, amount, status, description, bonus campaign
  const renderWalletDetails = () => {
    return (
      <div className="nova-stmt-dl">
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">Date</span>
          <div className="nova-stmt-dl-value">
            <DateCell iso={row.dateISO} />
          </div>
        </div>
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">Transaction type</span>
          <span className="nova-stmt-dl-value">{row.type || '—'}</span>
        </div>
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">Amount</span>
          <span className={`nova-stmt-dl-value is-strong nova-stmt-amount ${row.direction === 'debit' ? 'is-debit' : row.direction === 'credit' ? 'is-credit' : ''}`}>{row.direction === 'debit' ? '−' : row.direction === 'credit' ? '+' : ''}{formatAmount(row.amount)}</span>
        </div>
        <div className="nova-stmt-dl-row">
          <span className="nova-stmt-dl-label">Status</span>
          <StatusBadge value={row.status} />
        </div>
        {row.description && (
          <div className="nova-stmt-dl-row is-top">
            <span className="nova-stmt-dl-label">Description</span>
            <span className="nova-stmt-dl-value is-plain">{row.description}</span>
          </div>
        )}
        {(row.bonusCampaignName || row.bonusCampaignType) && (
          <>
            {row.bonusCampaignName && (
              <div className="nova-stmt-dl-row">
                <span className="nova-stmt-dl-label">Bonus</span>
                <span className="nova-stmt-dl-value">{row.bonusCampaignName}</span>
              </div>
            )}
            {row.bonusCampaignType && (
              <div className="nova-stmt-dl-row">
                <span className="nova-stmt-dl-label">Bonus type</span>
                <span className="nova-stmt-dl-value is-plain is-capitalize">{String(row.bonusCampaignType).replace(/_/g, ' ')}</span>
              </div>
            )}
          </>
        )}
        <div className="nova-stmt-dl-row is-id">
          <span className="nova-stmt-dl-label">Transaction ID</span>
          <span className="nova-stmt-dl-value nova-stmt-id">{row.id}</span>
        </div>
      </div>
    )
  }

  return (
    <ModalSurface open={Boolean(details)} onClose={onClose} title={`${details.type.charAt(0).toUpperCase()}${details.type.slice(1)} Details`} size="md" className="nova-statement-details-modal">
        <div className="nova-modal-body nova-modal-details">
          {details.type === 'sports' && renderSportsDetails()}
          {details.type === 'casino' && renderCasinoDetails()}
          {details.type === 'wallet' && renderWalletDetails()}
          {details.type === 'matka' && <div className="nova-stmt-dl">
            <div className="nova-stmt-dl-row"><span className="nova-stmt-dl-label">Placed at</span><DateCell iso={row.dateISO} /></div>
            <div className="nova-stmt-dl-row"><span className="nova-stmt-dl-label">Market</span><strong>{row.market}</strong></div>
            <div className="nova-stmt-dl-row"><span className="nova-stmt-dl-label">Trading date / session</span><span>{row.runDate} · {row.session.toUpperCase()}</span></div>
            <div className="nova-stmt-dl-row"><span className="nova-stmt-dl-label">Game / selection</span><span>{row.bidType.replaceAll('_',' ')} · {row.selection}</span></div>
            <div className="nova-stmt-dl-row"><span className="nova-stmt-dl-label">Stake</span><span>{formatAmount(row.stake,row.currency)}</span></div>
            <div className="nova-stmt-dl-row"><span className="nova-stmt-dl-label">Payout multiplier</span><span>{row.multiplier}×</span></div>
            <div className="nova-stmt-dl-row"><span className="nova-stmt-dl-label">Payout</span><span>{row.payout == null ? '—' : formatAmount(row.payout,row.currency)}</span></div>
            <div className="nova-stmt-dl-row"><span className="nova-stmt-dl-label">Net P/L</span><span className={`nova-stmt-pl ${row.pl > 0 ? 'is-up' : row.pl < 0 ? 'is-down' : ''}`}>{row.pl == null ? '—' : `${row.pl > 0 ? '+' : ''}${formatAmount(row.pl,row.currency)}`}</span></div>
            <div className="nova-stmt-dl-row"><span className="nova-stmt-dl-label">Result</span><span>{row.eventResult || '—'}</span></div>
            <div className="nova-stmt-dl-row"><span className="nova-stmt-dl-label">Status</span><StatusBadge value={row.result} /></div>
            <div className="nova-stmt-dl-row"><span className="nova-stmt-dl-label">Wallet</span><span>{row.walletType}</span></div>
            {row.settledAt && <div className="nova-stmt-dl-row"><span className="nova-stmt-dl-label">Settled at</span><DateCell iso={row.settledAt} /></div>}
            <div className="nova-stmt-dl-row is-id"><span className="nova-stmt-dl-label">Bet ID</span><span className="nova-stmt-id">{row.id}</span></div>
          </div>}
        </div>
    </ModalSurface>
  )
}


