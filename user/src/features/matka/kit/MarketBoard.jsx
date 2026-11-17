import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Icon, IconButton, StatusBadge, MarketChartLinks } from './components';

function FavoriteButton({ market, favorite, onFavorite, className = '' }) {
  return <IconButton icon="star"
    label={`${favorite ? 'Remove' : 'Add'} ${market.name} ${favorite ? 'from' : 'to'} favorites`}
    aria-pressed={favorite}
    className={`m99-market-board-favorite ${className} ${favorite ? 'is-active' : ''}`}
    onClick={() => onFavorite(market.id)} />;
}

// Result columns a market kind never fills: Starline has no close session, Jackpot and Satta Matka only a jodi.
const UNUSED_COLUMNS = { STARLINE: ['close'], JACKPOT: ['open', 'close'], SATTA_MATKA: ['open', 'close'] };

const resultColumns = result => result.split(/\s+–\s+/);
const spokenColumn = value => /\d/.test(value) ? value.includes('*') ? `${value.replaceAll('*', '')} (partly declared)` : value : 'pending';

/** One split-flap module: a frame of cells; a pending cell holds the Matka `*`, a newly declared one drops in once. */
function Flaps({ value, before = '' }) {
  return <span className="dep-mod" aria-hidden="true">
    {[...value].map((digit, place) => <i key={place} className={digit === '*' ? 'is-pending' : undefined} data-fresh={digit !== '*' && before[place] === '*' || undefined}>{digit}</i>)}
  </span>;
}

/** A result time with its am/pm set small, as the board prints it ("05:41 pm"). */
function BoardTime({ value }) {
  const [, clock, meridiem] = /^(.*?)\s*(am|pm)$/i.exec(value || '') || [];
  return <span className="dep-time">{clock ? <>{clock}<small> {meridiem}</small></> : value}</span>;
}

/**
 * The result as a departure board: one row per session (its label, its panna in split flaps, its result time) and
 * the jodi as the gate spanning both rows. The session taking entries now is lit; a declared one settles. A digit
 * declared while the page is open (the directory refetches every few seconds) drops in once: the board remembers
 * the result it last showed and marks only the cells that went from `*` to a digit.
 */
function DepartureBoard({ market }) {
  const [open = '***', jodi = '**', close = '***'] = resultColumns(market.result);
  const shown = useRef(market.result);
  useEffect(() => { shown.current = market.result; });
  const [openBefore, jodiBefore, closeBefore] = resultColumns(shown.current);
  const unused = UNUSED_COLUMNS[market.kind] || [];
  const raw = market.rawResult || {}, closeOnly = ['JACKPOT', 'SATTA_MATKA'].includes(market.kind);
  const done = { open: !!raw.openResult, close: !!raw.closeResult || closeOnly && !!raw.jodi };
  const accepting = side => !!(market.sessions || []).find(session => session.side === side.toUpperCase() && session.enabled)?.accepting;
  const live = ['open', 'close'].find(side => !unused.includes(side) && !done[side] && accepting(side));
  const rows = [['open', 'Open', open, openBefore, market.open], ['close', 'Close', close, closeBefore, market.close]];
  const spoken = [['open', open], ['jodi', jodi], ['close', close]].filter(([column]) => !unused.includes(column)).map(([column, value]) => `${column} ${spokenColumn(value)}`).join(', ');
  return <div className="dep-board">
    <p className="m99-sr-only">{`Result: ${spoken}`}</p>
    <div className="dep-sched">
      {/* a session the market does not run is greyed out; a column without a panna (Jackpot's close) keeps its time */}
      {rows.map(([side, label, value, before, time]) => <div key={side} className={['dep-row', `row-${side}`, done[side] && 'is-done', live === side && 'is-live', unused.includes(side) && time === '—' && 'is-off'].filter(Boolean).join(' ')}>
        <span className="dep-sess">{label}{live === side && <span className="m99-sr-only"> (live)</span>}</span>
        {unused.includes(side) ? <span className="dep-off" aria-hidden="true" /> : <Flaps value={value} before={before} />}
        <BoardTime value={time} />
      </div>)}
      <div className="dep-gate" aria-hidden="true"><span className="dep-gate-cap">Jodi</span><Flaps value={jodi} before={jodiBefore} /></div>
    </div>
  </div>;
}

/** The card's rules, over the card: what its face leaves out (type, listing, result state, timezone, entry cutoffs). */
function MarketRules({ id, market, hasPublishedResult, sessions, onClose }) {
  const close = useRef(null);
  useEffect(() => { close.current?.focus(); }, []);
  return <section id={id} className="m99-market-board-rules" aria-label={`${market.name} rules`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <header><div><strong>{market.name}</strong><span>Market rules</span></div><button ref={close} type="button" aria-label={`Close ${market.name} rules`} onClick={onClose}><Icon name="close" size={16} /></button></header>
    <dl>
      <div><dt>Market type</dt><dd>{market.category}</dd></div>
      {market.tag && <div><dt>Listing</dt><dd>{market.tag}</dd></div>}
      <div><dt>Result</dt><dd>{hasPublishedResult ? 'Session result' : 'Awaiting result'}</dd></div>
      <div><dt>Timezone</dt><dd>{market.timezoneLabel}</dd></div>
    </dl>
    <table>
      <caption>Session schedule ({market.timezoneLabel})</caption>
      <thead><tr><th scope="col"><span className="m99-sr-only">Session</span></th><th scope="col">Result time</th><th scope="col">Entry cutoff</th></tr></thead>
      <tbody>{sessions.map(session => <tr key={session.name}><th scope="row">{session.name}</th><td>{session.result}</td><td>{session.cutoff}</td></tr>)}</tbody>
    </table>
  </section>;
}

// Also the home page's Matka strip card (MatkaStrip, owner 2026-11-02: "UI bhi waise hi").
export function DirectoryMarketCard({ market, index = 0, favorite, onFavorite, onMarket, onChart }) {
  const hasPublishedResult = /\d/.test(market.result);
  const raw = market.rawResult || {}, closeOnly = ['JACKPOT', 'SATTA_MATKA'].includes(market.kind);
  const sessions = [{ name: 'Open', result: market.open, cutoff: market.openBidLast, done: !!raw.openResult }, { name: 'Close', result: market.close, cutoff: market.closeBidLast, done: !!raw.closeResult || closeOnly && !!raw.jodi }];
  const rulesId = useId(), rulesButton = useRef(null), [rulesOpen, setRulesOpen] = useState(false);
  const closeRules = () => { setRulesOpen(false); rulesButton.current?.focus(); };
  // --i staggers the cards' entrance; past the first rows they all arrive together.
  return <article data-market-item className="m99-market-board-card" data-status={market.status} style={{ '--i': Math.min(index, 12) }}>
    <div className="dep-top">
      <p className="dep-remark"><i className="dep-lamp" aria-hidden="true" />{market.status}</p>
      <FavoriteButton market={market} favorite={favorite} onFavorite={onFavorite} className="dep-icon" />
      <button ref={rulesButton} type="button" className="dep-icon m99-market-board-rules-button" aria-label={`${market.name} rules`} aria-expanded={rulesOpen} aria-controls={rulesOpen ? rulesId : undefined} onClick={() => setRulesOpen(open => !open)}><Info size={18} aria-hidden="true" /></button>
    </div>
    <h3 className="m99-market-board-name"><button type="button" onClick={() => onMarket(market)}>{market.name}</button></h3>
    <DepartureBoard market={market} />
    <div className="dep-foot">
      {onChart && <div className="dep-charts" role="group" aria-label={`${market.name} charts`}>
        {!closeOnly && <button type="button" aria-label={`${market.name} Panel Chart`} onClick={() => onChart(market, 'panel')}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 4.5v15h15" /><path d="M9 16v-3.5" /><path d="M13 16V9" /><path d="M17 16v-5.5" /></svg><span>Panel</span></button>}
        {market.kind !== 'STARLINE' && <button type="button" aria-label={`${market.name} Jodi Chart`} onClick={() => onChart(market, 'jodi')}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" /><path d="M4.5 12h15" /><path d="M12 4.5v15" /></svg><span>Jodi</span></button>}
      </div>}
      <button type="button" className="dep-view" aria-label={`View ${market.name} market`} onClick={() => onMarket(market)}><span>View market</span><span className="dep-mod" aria-hidden="true"><i><Icon name="arrow" size={16} /></i></span></button>
    </div>
    {rulesOpen && <MarketRules id={rulesId} market={market} hasPublishedResult={hasPublishedResult} sessions={sessions} onClose={closeRules} />}
    <span className="dep-pot" aria-hidden="true" />
  </article>;
}

export function MarketBoard({ items, favorites, onFavorite, onMarket, onChart, mode = 'grid' }) {
  const cards = <div className={`m99-market-grid m99-market-board-grid ${mode === 'table' ? 'm99-mobile-market-grid' : ''}`}>{items.map((market, index) => <DirectoryMarketCard market={market} index={index} key={market.id} favorite={favorites.includes(market.id)} onFavorite={onFavorite} onMarket={onMarket} onChart={onChart} />)}</div>;
  return <>{mode === 'table' && <div className="m99-table-wrap m99-market-table-wrap m99-market-board-table-wrap"><table className="m99-table m99-market-table m99-market-board-table">
    <caption className="m99-sr-only">Markets, current session results and schedules in each market's local timezone</caption>
    <thead><tr><th scope="col">Market</th><th scope="col">Session result</th><th scope="col">Open session</th><th scope="col">Close session</th><th scope="col">Status</th><th scope="col">Charts</th><th scope="col"><span className="m99-sr-only">Actions</span></th></tr></thead>
    <tbody>{items.map(market => <tr data-market-item key={market.id}>
      <th scope="row"><div className="m99-market-board-table-name"><button type="button" onClick={() => onMarket(market)}>{market.name}</button><small>{market.category}<span aria-hidden="true"> · </span>{market.timezoneLabel}</small></div></th>
      <td><strong className="m99-market-board-table-result">{market.result}</strong></td>
      <td><div className="m99-market-board-table-session"><strong>Result: {market.open}</strong><small>Entry cutoff: {market.openBidLast}</small></div></td>
      <td><div className="m99-market-board-table-session"><strong>Result: {market.close}</strong><small>Entry cutoff: {market.closeBidLast}</small></div></td>
      <td><StatusBadge status={market.status} /></td><td><MarketChartLinks market={market} onChart={onChart} className="m99-market-board-table-charts" /></td>
      <td><div className="m99-market-board-table-actions"><FavoriteButton market={market} favorite={favorites.includes(market.id)} onFavorite={onFavorite} /><IconButton icon="chevron" label={`View ${market.name} market`} onClick={() => onMarket(market)} /></div></td>
    </tr>)}</tbody></table></div>}{cards}</>;
}

