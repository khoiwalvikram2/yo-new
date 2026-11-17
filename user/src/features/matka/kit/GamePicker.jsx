/* eslint-disable react/prop-types */
import { Icon } from './components';
import { gameTypes } from './market-data';

export function GameSymbol({ type }) {
  return <svg viewBox="0 0 32 32" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {type.startsWith('die') && <><rect x="5" y="4" width="22" height="24" rx="3" /><circle cx="16" cy="16" r="1.8" fill="currentColor" stroke="none" />{type === 'die-three' && <><circle cx="11" cy="10" r="1.8" fill="currentColor" stroke="none" /><circle cx="21" cy="22" r="1.8" fill="currentColor" stroke="none" /></>}</>}
    {['card', 'cards'].includes(type) && <>{type === 'cards' && <><rect x="3" y="6" width="18" height="24" rx="2" transform="rotate(-13 3 6)" /><rect x="8" y="3" width="18" height="24" rx="2" transform="rotate(8 8 3)" /></>}<rect x="7" y="3" width="19" height="26" rx="2" /><path d="M16.5 21s-6-3.8-6-7.3c0-3.2 3.7-4.3 6-1.5 2.3-2.8 6-1.7 6 1.5 0 3.5-6 7.3-6 7.3Z" fill="currentColor" stroke="none" /></>}
    {type === 'motor' && <><rect x="3" y="11" width="26" height="15" rx="2" /><path d="M8 11V7h16v4M10 26v3m12-3v3M7 16h4l-3 6m6-6h4l-3 6m6-6h4l-3 6" /><path d="m16 2 1 2 2 .4-1.5 1.4.3 2-1.8-1-1.8 1 .3-2L13 4.4l2-.4Z" /></>}
    {type === 'wheel' && <><circle cx="16" cy="16" r="12" /><circle cx="16" cy="16" r="7" /><path d="M16 4v5m0 14v5M4 16h5m14 0h5M7.5 7.5l3.5 3.5m10 10 3.5 3.5m0-17L21 11M11 21l-3.5 3.5" /><path d="m16 11-3.8 5a3 3 0 0 0 3.8 4 3 3 0 0 0 3.8-4Z" fill="currentColor" stroke="none" /></>}
  </svg>;
}

/** The game grid; its category is chosen in the market page's filter strip (MarketDetails). */
export default function GamePicker({ market, category = 'All games', onSelectGame }) {
  const available = market.games || gameTypes;
  const games = available.filter(game => category === 'All games' || game.group === category);
  const configuredCount = available.filter(game => game.rateConfigured !== false).length;
  return <section className="m99-panel m99-game-picker" aria-label="Choose a game type">
    {configuredCount < available.length && <div className="gw-matka-rate-notice" role="status"><Icon name="alert" size={16} /><div><strong>{configuredCount === 0 ? 'Payout rates are being set up' : 'Some payout rates are pending'}</strong><p>All game types are listed below. Entries are unavailable for games marked "Payout rate pending" until their rates are published.</p></div></div>}
    <div className="m99-game-picker-grid">{games.map(game => <button type="button" key={game.id} className="m99-game-card" disabled={game.rateConfigured === false} title={game.rateConfigured === false ? 'Entries unavailable until the payout rate is published' : undefined} style={{ '--m99-game-order': available.indexOf(game), '--m99-game-accent': game.accent }} onClick={() => onSelectGame(game.id)} aria-label={game.label}>
      <span className="m99-game-card-symbol"><GameSymbol type={game.icon} /></span><span className="m99-game-card-sequence">{String(available.indexOf(game) + 1).padStart(2, '0')}</span><span className="m99-game-card-family">{game.group}</span><strong>{game.label}</strong><span className="m99-game-card-description">{game.description}</span><small>{game.rateDisplay}</small><span className="m99-game-card-footer"><span><Icon name="clock" size={11} />{game.closeOnly ? (market.kind === 'WORLI' ? 'Locks at Open' : 'Close session') : (market.kind === 'STARLINE' ? 'Open session' : 'Open / Close')}</span><i><Icon name="arrow" size={13} /></i></span>
    </button>)}</div>
    <div className="m99-picker-foot"><span><Icon name="layers" size={12} />{available.length} game types · {market.name}</span><span>Choose a game to continue<Icon name="arrow" size={12} /></span></div>
  </section>;
}
