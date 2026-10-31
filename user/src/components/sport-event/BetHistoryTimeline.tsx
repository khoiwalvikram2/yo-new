import { memo } from 'react'
import { History } from 'lucide-react'
import type { Bet } from './types'
import { formatAmount, getDefaultLocale } from '@/lib/currency'
import { betsForEvent } from './eventBets'

interface BetHistoryTimelineProps {
  bets: Bet[]
  eventId: string
}

const BetHistoryTimeline = memo(function BetHistoryTimeline({ bets, eventId }: BetHistoryTimelineProps) {
  const eventBets = betsForEvent(bets, eventId)

  if (eventBets.length === 0) {
    return (
      <div className="nova-ev-mybets-empty">
        <History aria-hidden="true" />
        <p>No Bets Yet</p>
        <span>Place a bet to see it here</span>
      </div>
    )
  }

  const getBetStatus = (bet: any) => {
    if (bet.status === 'settled' || bet.settled) {
      return bet.result === 'won' || (bet as any).isWon ? 'won' : 'lost'
    }
    if (bet.status === 'cancelled' || bet.void) return 'cancelled'
    return 'pending'
  }

  const getMarketLabel = (bet: any) => {
    const marketType = (bet as any).marketType || (bet as any).market_type
    const isFancy = marketType === 'fancy'
      || bet.market === bet.selection
      || bet.market?.includes('over run')
      || bet.market?.includes('over Run')
      || bet.market?.toLowerCase().includes('run')
      || bet.market?.toLowerCase().includes('wicket')
      || /^\d+\s+over/i.test(bet.market || '')
    if (isFancy) return 'F'
    if ((bet as any).marketType === 'bookmaker' || bet.market?.toLowerCase().includes('bookmaker')) return 'B'
    return 'MO'
  }

  const computePL = (bet: any) => {
    const odds = Number(bet.odds || 0)
    const stake = Number(bet.stake || 0)
    const sideRaw = (bet.type || bet.side || '').toString().toLowerCase()
    const isBacking = sideRaw === 'back'
    const marketType = (bet as any).marketType || (bet as any).market_type
    const isFancy = marketType === 'fancy'
      || bet.market === bet.selection
      || bet.market?.includes('over run')
      || bet.market?.includes('over Run')
      || bet.market?.toLowerCase().includes('run')
      || bet.market?.toLowerCase().includes('wicket')
      || /^\d+\s+over/i.test(bet.market || '')

    if (bet.pl !== undefined && bet.pl !== null) return Number(bet.pl)
    if (isFancy) {
      const oddsSize = (bet as any).oddsSize || 100
      return isBacking ? stake * (oddsSize / 100) : -stake * (oddsSize / 100)
    }
    return isBacking ? stake * (odds - 1) : -stake * (odds - 1)
  }

  // A fixed-layout table sized for the side column (no sideways scroll), styled like the My Bets page: a soft
  // header row, hairlines, the back/lay colour on each row's left edge. The side and market chips sit under the
  // selection, so the name keeps the room in a column that is under 300px wide.
  return (
    <div className="nova-ev-mybets">
      <table className="nova-ev-mybets-table">
        <colgroup>
          <col />
          <col className="is-odds" />
          <col className="is-stake" />
          <col className="is-pl" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Selection</th>
            <th scope="col" className="is-num">Odds</th>
            <th scope="col" className="is-num">Stake</th>
            <th scope="col" className="is-num">P/L</th>
          </tr>
        </thead>
        <tbody>
          {eventBets.map((bet: any, index: number) => {
            const status = getBetStatus(bet)
            const odds = Number(bet.odds || 0)
            const stake = Number(bet.stake || 0)
            const sideRaw = (bet.type || bet.side || '').toString().toLowerCase()
            const isBacking = sideRaw === 'back'
            const pl = computePL(bet)
            const mktLabel = getMarketLabel(bet)
            const isFancy = mktLabel === 'F'
            const plTone = status === 'won' ? 'is-up' : status === 'lost' ? 'is-down' : pl >= 0 ? 'is-up' : 'is-down'

            return (
              <tr key={bet.id || index} className={isBacking ? 'is-back' : 'is-lay'}>
                <td>
                  <p className="nova-ev-mybets-sel" title={bet.selection || bet.team}>{bet.selection || bet.team}</p>
                  <span className="nova-ev-mybets-tags">
                    <span className="nova-ev-mybets-side">{isBacking ? 'Back' : 'Lay'}</span>
                    <span className={`nova-ev-mybets-mkt ${isFancy ? 'is-fancy' : mktLabel === 'B' ? 'is-book' : ''}`}>
                      {isFancy ? 'Fancy' : mktLabel === 'B' ? 'Book' : 'MO'}
                    </span>
                  </span>
                </td>
                <td className="is-num">
                  {isFancy ? <>{odds.toFixed(0)}<small>/{(bet as any).oddsSize || 100}</small></> : odds.toFixed(2)}
                </td>
                <td className="is-num">{stake.toLocaleString(getDefaultLocale(), { maximumFractionDigits: 0 })}</td>
                <td className="is-num">
                  {status === 'cancelled'
                    ? <span className="nova-ev-mybets-pl is-void">VOID</span>
                    : <span className={`nova-ev-mybets-pl ${plTone}`}>{pl >= 0 ? '+' : '-'}{formatAmount(Math.abs(pl))}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}, (prevProps, nextProps) => {
  return (
    prevProps.eventId === nextProps.eventId &&
    prevProps.bets?.length === nextProps.bets?.length &&
    prevProps.bets?.[0]?.id === nextProps.bets?.[0]?.id
  )
})

export default BetHistoryTimeline

