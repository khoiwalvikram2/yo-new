import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Layers, ListOrdered, Ticket, X } from 'lucide-react'
import { SAMPLE_LEAGUES, SAMPLE_MARKET_STATS, SAMPLE_MATCHES, SAMPLE_MOVERS, formatInr, formatSize, ladder } from './sampleData'
import { OddsButton, SectionBar, SportIcon } from './shared'

type Selection = { event: string; runner: string; side: 'back' | 'lay'; price: number }
const STAKES = [100, 500, 1000, 5000]

/**
 * C · Exchange Pro (for traders): market totals on top; competitions, a ladder board with three back and three lay
 * levels per runner, and a bet slip that a price click fills (stake chips, profit or liability worked out live).
 */
export default function ConceptExchange() {
  const board = SAMPLE_MATCHES.slice(0, 4)
  const [selection, setSelection] = useState<Selection | null>({ event: `${board[0].home} v ${board[0].away}`, runner: board[0].home, side: 'back', price: board[0].odds[0][0] })
  const [stake, setStake] = useState(1000)
  const [league, setLeague] = useState(SAMPLE_LEAGUES[0].league)
  const outcome = selection ? Math.round(stake * (selection.price - 1)) : 0

  return <div className="hd-concept hd-exchange">
    <dl className="hd-stats">
      {SAMPLE_MARKET_STATS.map(stat => <div key={stat.label} className="hd-stat">
        <dt>{stat.label}</dt>
        <dd><strong>{stat.value}</strong><small>{stat.delta}</small></dd>
      </div>)}
    </dl>

    <div className="hd-exchange-grid">
      <nav className="hd-panel hd-leagues" aria-label="Competitions">
        <SectionBar icon={<ListOrdered className="nova-ex-strip-icon" aria-hidden="true" />} title="Competitions" />
        <ul>
          {SAMPLE_LEAGUES.map(entry => <li key={entry.league}>
            <button type="button" className={entry.league === league ? 'is-active' : ''} aria-pressed={entry.league === league} onClick={() => setLeague(entry.league)}>
              <SportIcon sport={entry.sport} /><span>{entry.league}</span><small>{entry.count}</small>
            </button>
          </li>)}
        </ul>
      </nav>

      <section className="hd-board" aria-label="Market board">
        <SectionBar icon={<Layers className="nova-ex-strip-icon" aria-hidden="true" />} title="Match odds" count={board.length} action="All markets" />
        {board.map(match => {
          const names = match.odds.length === 3 ? [match.home, 'Draw', match.away] : [match.home, match.away]
          return <article key={match.id} className="hd-market">
            <header>
              <SportIcon sport={match.sport} />
              <strong>{match.home} v {match.away}</strong>
              {match.live ? <span className="hd-live-pill is-small"><i aria-hidden="true" />{match.live.score}</span> : <span className="hd-market-time">{match.time}</span>}
              <small>Matched {match.matched}</small>
            </header>
            <div className="hd-ladder-head" aria-hidden="true"><span /><span>Back</span><span>Lay</span></div>
            {names.map((runner, index) => {
              const levels = ladder(match.odds[index], index + match.id.length)
              const event = `${match.home} v ${match.away}`
              const isPicked = (side: 'back' | 'lay', price: number) => selection?.event === event && selection.runner === runner && selection.side === side && selection.price === price
              return <div key={runner} className="hd-ladder-row">
                <span className="hd-ladder-runner">{runner}</span>
                <span className="hd-ladder-side is-back">
                  {levels.back.map((level, depth) => <OddsButton key={depth} side="back" price={level.price} size={formatSize(level.size)} label={runner} selected={isPicked('back', level.price)} onSelect={() => setSelection({ event, runner, side: 'back', price: level.price })} />)}
                </span>
                <span className="hd-ladder-side is-lay">
                  {levels.lay.map((level, depth) => <OddsButton key={depth} side="lay" price={level.price} size={formatSize(level.size)} label={runner} selected={isPicked('lay', level.price)} onSelect={() => setSelection({ event, runner, side: 'lay', price: level.price })} />)}
                </span>
              </div>
            })}
          </article>
        })}
      </section>

      <aside className="hd-exchange-side" aria-label="Bet slip and movers">
        <section className="hd-panel hd-slip" aria-label="Bet slip">
          <SectionBar icon={<Ticket className="nova-ex-strip-icon" aria-hidden="true" />} title="Bet slip" count={selection ? 1 : 0} />
          {selection ? <div className={`hd-slip-body is-${selection.side}`}>
            <div className="hd-slip-pick">
              <span className="hd-slip-side">{selection.side}</span>
              <span><strong>{selection.runner}</strong><small>{selection.event} · Match odds</small></span>
              <button type="button" aria-label="Remove selection" onClick={() => setSelection(null)}><X aria-hidden="true" /></button>
            </div>
            <div className="hd-slip-fields">
              <label><span>Odds</span><output>{selection.price.toFixed(2)}</output></label>
              <label><span>Stake</span><output>{formatInr(stake)}</output></label>
            </div>
            <div className="hd-slip-stakes" role="group" aria-label="Quick stakes">
              {STAKES.map(value => <button key={value} type="button" className={value === stake ? 'is-active' : ''} aria-pressed={value === stake} onClick={() => setStake(value)}>{formatInr(value)}</button>)}
            </div>
            <p className="hd-slip-outcome">{selection.side === 'back' ? 'Profit if it wins' : 'Liability if it wins'} <strong>{formatInr(outcome)}</strong></p>
            <button type="button" className="hd-cta is-block" disabled title="Design preview">Place {selection.side} bet</button>
          </div> : <p className="hd-slip-empty">Click any price on the board to add a bet.</p>}
        </section>

        <section className="hd-panel hd-movers" aria-label="Odds movers">
          <SectionBar icon={<ArrowDownRight className="nova-ex-strip-icon" aria-hidden="true" />} title="Odds movers" />
          <ul>
            {SAMPLE_MOVERS.map(mover => {
              const shortening = mover.to < mover.from
              return <li key={mover.runner}>
                <span><strong>{mover.runner}</strong><small>{mover.market}</small></span>
                <span className={shortening ? 'hd-mover is-in' : 'hd-mover is-out'}>
                  {shortening ? <ArrowDownRight aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}
                  <s>{mover.from.toFixed(2)}</s> {mover.to.toFixed(2)}
                  <span className="sr-only">{shortening ? ' (shortening)' : ' (drifting)'}</span>
                </span>
              </li>
            })}
          </ul>
        </section>
      </aside>
    </div>
  </div>
}
