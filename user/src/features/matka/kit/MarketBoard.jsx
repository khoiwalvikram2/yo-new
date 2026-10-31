import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Icon, IconButton, StatusBadge, MarketChartLinks } from './components';

function FavoriteButton({ market, favorite, onFavorite }) {
  return <IconButton icon="star"
    label={`${favorite ? 'Remove' : 'Add'} ${market.name} ${favorite ? 'from' : 'to'} favorites`}
    aria-pressed={favorite}
    className={`m99-market-board-favorite ${favorite ? 'is-active' : ''}`}
    onClick={() => onFavorite(market.id)} />;
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

function DirectoryMarketCard({ market, favorite, onFavorite, onMarket, onChart }) {
  const resultParts = market.result.split(/\s+\u2013\s+/);
  const hasPublishedResult = /\d/.test(market.result);
  const sessions = [{ name: 'Open', result: market.open, cutoff: market.openBidLast }, { name: 'Close', result: market.close, cutoff: market.closeBidLast }];
  const rulesId = useId(), rulesButton = useRef(null), [rulesOpen, setRulesOpen] = useState(false);
  const closeRules = () => { setRulesOpen(false); rulesButton.current?.focus(); };
  return <article data-market-item className="m99-market-board-card" data-status={market.status}>
    <header className="m99-market-board-card-header">
      <StatusBadge status={market.status} />
      <button ref={rulesButton} type="button" className="m99-market-board-rules-button" aria-label={`${market.name} rules`} aria-expanded={rulesOpen} aria-controls={rulesOpen ? rulesId : undefined} onClick={() => setRulesOpen(open => !open)}><Info size={16} aria-hidden="true" /></button>
    </header>
    <h3 className="m99-market-board-name"><button type="button" onClick={() => onMarket(market)}>{market.name}</button></h3>

    <div className="m99-market-board-result">
      <strong aria-label={market.result}>{resultParts.map((part, index) => <span key={index} className={index === 1 ? 'is-middle' : ''}>{index > 0 && <i>{'\u2013'}</i>}<b>{part}</b></span>)}</strong>
    </div>

    <div className="m99-market-board-schedule">
      <div className="m99-market-board-sessions">
        {sessions.map(session => <section className="m99-market-board-session" key={session.name} aria-label={`${market.name} ${session.name.toLowerCase()} session in ${market.timezoneLabel}`}>
          <h4>{session.name}</h4><p>{session.result}</p>
        </section>)}
      </div>
    </div>

    <footer className="m99-market-board-card-footer">
      {onChart && <div className="m99-market-board-charts" role="group" aria-label={`${market.name} charts`}>
        {!['JACKPOT', 'SATTA_MATKA'].includes(market.kind) && <button type="button" aria-label={`${market.name} Panel Chart`} onClick={() => onChart(market, 'panel')}><Icon name="chart" size={13} />Panel</button>}
        {market.kind !== 'STARLINE' && <button type="button" aria-label={`${market.name} Jodi Chart`} onClick={() => onChart(market, 'jodi')}>{['JACKPOT', 'SATTA_MATKA'].includes(market.kind) && <Icon name="chart" size={13} />}Jodi</button>}
      </div>}
      <FavoriteButton market={market} favorite={favorite} onFavorite={onFavorite} />
      <button type="button" className="m99-market-board-view" aria-label={`View ${market.name} market`} onClick={() => onMarket(market)}>View market<Icon name="arrow" size={15} /></button>
    </footer>
    {rulesOpen && <MarketRules id={rulesId} market={market} hasPublishedResult={hasPublishedResult} sessions={sessions} onClose={closeRules} />}
  </article>;
}

export function MarketBoard({ items, favorites, onFavorite, onMarket, onChart, mode = 'grid' }) {
  const cards = <div className={`m99-market-grid m99-market-board-grid ${mode === 'table' ? 'm99-mobile-market-grid' : ''}`}>{items.map(market => <DirectoryMarketCard market={market} key={market.id} favorite={favorites.includes(market.id)} onFavorite={onFavorite} onMarket={onMarket} onChart={onChart} />)}</div>;
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

