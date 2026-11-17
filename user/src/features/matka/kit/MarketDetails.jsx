/* eslint-disable react/prop-types */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Icon, IconButton, Modal, Segmented, StatusBadge } from './components';
import { displayDate, money } from './data';
import { gameTypes, getMarketHistory } from './market-data';
import GamePicker, { GameSymbol } from './GamePicker';
import EntryBuilder from './EntryBuilder';
import { FilterSelect } from '../FilterSelect';
import { gameBid } from '../model';

const GAME_CATEGORIES = ['All games', 'Digits', 'Pana', 'Bulk', 'Motor', 'Sangam'].map(value => ({ value, label: value }));

export function EntryTable({ entries, showMarket = false }) {
  return <div className="m99-table-wrap"><table className="m99-table m99-entry-table"><caption className="m99-sr-only">Your market entries</caption><thead><tr>{showMarket && <th>Market</th>}<th>Game / number</th><th>Session</th><th>Amount</th><th>Payout rate</th><th>Return / net</th><th>Date</th><th>Status</th></tr></thead><tbody>
    {entries.map(entry => <tr key={entry.id}>{showMarket && <td>{entry.marketName}</td>}<td><strong>{entry.number}</strong><small>{entry.game}</small></td><td>{entry.session}</td><td>{money(entry.amount)}<small>{entry.walletType === 'referralBonus' ? 'Referral bonus' : entry.walletType}</small></td><td>1:{entry.payoutMultiplier}</td><td>{entry.actualWin == null ? <small>Potential: {money(entry.potentialWin)}</small> : <><strong>{money(entry.actualWin)}</strong><small>Net: {money(entry.netProfit)}</small></>}</td><td>{displayDate(entry.date)}<small>{entry.time} {entry.timezoneLabel}</small></td><td><StatusBadge status={entry.status} /></td></tr>)}
  </tbody></table>{!entries.length && <EmptyState title="No entries in this market" description="Your accepted entries will appear here." />}</div>;
}

export function HistoryTable({ market, compact = false, chartType = 'Panna chart' }) {
  return <div className="m99-table-wrap"><table className={`m99-table m99-history-table ${compact ? 'is-compact' : ''}`}><caption className="m99-sr-only">Result history for {market.name}</caption><thead><tr><th>Date</th>{chartType === 'Panna chart' && !['JACKPOT', 'SATTA_MATKA'].includes(market.kind) && <th>Open Patti</th>}<th>{market.kind === 'STARLINE' ? 'Digit' : market.kind === 'SATTA_MATKA' ? 'AB' : 'Jodi'}</th>{chartType === 'Panna chart' && !['JACKPOT', 'SATTA_MATKA'].includes(market.kind) && <th>Close Patti</th>}<th>Status</th></tr></thead><tbody>
    {getMarketHistory(market).map(row => <tr key={row.date}><td>{displayDate(row.date)}</td>{chartType === 'Panna chart' && !['JACKPOT', 'SATTA_MATKA'].includes(market.kind) && <td>{row.open}</td>}<td><strong className="m99-text-orange">{row.jodi}</strong></td>{chartType === 'Panna chart' && !['JACKPOT', 'SATTA_MATKA'].includes(market.kind) && <td>{row.close}</td>}<td><Badge tone={row.jodi.includes('*') ? 'orange' : 'green'}>{row.jodi.includes('*') ? 'Awaiting' : 'Published'}</Badge></td></tr>)}
  </tbody></table></div>;
}

const PHONE_QUERY = '(max-width: 760px)';
function usePhoneLayout() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(PHONE_QUERY).matches));
  useEffect(() => {
    const query = window.matchMedia?.(PHONE_QUERY);
    if (!query) return undefined;
    const update = () => setPhone(query.matches);
    update(); query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return phone;
}

// Phones: the slip opens the way the sports bet slip does, as a modal bottom sheet that springs up from the screen edge
// over a backdrop (above the header and the dock) and locks the page scroll. Its close button, the backdrop, Escape or
// pulling the handle down past 100px close it. It stays inside the page so the Matka theme and styles still reach it.
function SlipSheet({ id, labelledBy, open, onClose, children }) {
  const ref = useRef(null), dragFrom = useRef(null), timer = useRef(0), openRef = useRef(open);
  const [closing, setClosing] = useState(false), [drag, setDrag] = useState(0), [dragging, setDragging] = useState(false);
  openRef.current = open;
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return undefined;
    if (!dialog.open) dialog.showModal?.();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);
  // the scroll lock is a passive effect so it runs after a closing review modal has handed the page back
  useEffect(() => {
    if (!open) return undefined;
    const body = document.body, overflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => { body.style.overflow = overflow; };
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  function finish() { clearTimeout(timer.current); dragFrom.current = null; setClosing(false); setDragging(false); setDrag(0); onClose(); }
  function close() { if (closing) return; setClosing(true); timer.current = setTimeout(finish, 250); }
  function release() { if (dragFrom.current == null) return; dragFrom.current = null; setDragging(false); if (drag > 100) close(); else setDrag(0); }
  return <dialog ref={ref} id={id} className={`m99-slip-sheet${closing ? ' is-closing' : ''}`} aria-labelledby={labelledBy}
    onCancel={event => { event.preventDefault(); close(); }} onClose={() => { if (openRef.current) finish(); }}
    onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className={`m99-slip-sheet-panel${dragging ? ' is-dragging' : ''}`} style={drag ? { transform: `translateY(${drag}px)` } : undefined}>
      <div className="m99-slip-sheet-grip" aria-hidden="true" onPointerDown={event => { if (closing) return; dragFrom.current = event.clientY; setDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId); }}
        onPointerMove={event => { if (dragFrom.current != null) setDrag(Math.max(0, event.clientY - dragFrom.current)); }} onPointerUp={release} onPointerCancel={() => { dragFrom.current = null; setDragging(false); setDrag(0); }}><i /></div>
      {children(close)}
    </div>
  </dialog>;
}

export default function MarketDetails({ market, selectedGameId, onSelectGame, balance, favorite, onFavorite, onMarket, onChart, onBack, entries, onConfirm }) {
  const [tab, setTab] = useState(selectedGameId ? 'Place entry' : 'Game types');
  const [draft, setDraft] = useState([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const historyFilter = market.entryFilter || 'All entries';
  const [reviewError, setReviewError] = useState('');
  const availableGames = market.games || gameTypes;
  const [submitting, setSubmitting] = useState(false);
  const game = availableGames.find(item => item.id === selectedGameId);
  const isOpen = market.status === 'Open';
  const [category, setCategory] = useState('All games');
  const shownGames = availableGames.filter(item => category === 'All games' || item.group === category).length;
  const closeOnly = ['JACKPOT', 'SATTA_MATKA'].includes(market.kind);
  const sections = [game ? 'Place entry' : 'Game types', 'My entries', 'Market info'].map(value => ({ value, label: value }));
  const total = draft.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0) / 100;
  const accentOf = id => availableGames.find(item => item.id === id)?.accent;
  const slipId = useId(), [slipOpen, setSlipOpen] = useState(false), phone = usePhoneLayout();
  const marketEntries = entries.filter(entry => entry.marketId === market.id);
  const visibleEntries = marketEntries;
  useEffect(() => { setTab(selectedGameId ? 'Place entry' : 'Game types'); setReviewOpen(false); setReviewError(''); setSlipOpen(false); }, [selectedGameId]);
  useEffect(() => { if (!phone) setSlipOpen(false); }, [phone]);

  function addEntries(type, session, picks) {
    if (!isOpen || !market.accepts(type, session)) return 'Betting is closed for this game or session.';
    if (!market.canBet) { market.onLogin?.(); return market.accountMessage || 'Please sign in to place entries.'; }
    if (picks.some(pick => (draft.find(entry => entry.key === `${type.id}:${session}:${pick.number}`)?.amount || 0) + pick.amount > market.maxStake)) return `The combined amount for one number cannot exceed ${money(market.maxStake)}.`;
    if (total + picks.reduce((sum, pick) => sum + pick.amount, 0) > balance) return 'Your entry total exceeds the available balance.';
    setDraft(previous => {
      const updated = [...previous];
      picks.forEach(pick => {
        const key = `${type.id}:${session}:${pick.number}`;
        const index = updated.findIndex(entry => entry.key === key);
        if (index >= 0) updated[index] = { ...updated[index], amount: (Math.round(updated[index].amount * 100) + Math.round(pick.amount * 100)) / 100 };
        else updated.push({ key, gameId: type.id, game: type.label, number: pick.number, session, amount: pick.amount });
      });
      return updated;
    });
    setReviewError('');
    if (phone) setSlipOpen(true);
    return '';
  }
  async function confirm() {
    if (!draft.length || submitting) return;
    setSubmitting(true); setReviewError('');
    try {
      const accepted = await onConfirm(market, draft, total);
      if (!accepted) { setReviewError('Entries could not be confirmed. Review the market and available balance.'); return; }
      setDraft([]); setReviewOpen(false); setTab('My entries');
    } catch (error) { setReviewError(error?.message || 'Could not confirm entries. Retry the same request to check its status.'); }
    finally { setSubmitting(false); }
  }

  // Review groups the slip by game and session; each entry shows what it pays (stake x the market's payout rate)
  const reviewGroups = Object.values(draft.reduce((groups, entry) => {
    const type = availableGames.find(item => item.id === entry.gameId), key = `${entry.gameId}:${entry.session}`;
    const rate = market.rates?.find(item => item.bidType === gameBid(entry.gameId, entry.number))?.payoutMultiplier;
    const group = groups[key] || (groups[key] = { key, label: entry.game, icon: type?.icon || 'die', accent: type?.accent, session: entry.session, rates: [], total: 0, entries: [] });
    if (rate && !group.rates.includes(rate)) group.rates.push(rate);
    group.total = Math.round(group.total * 100 + entry.amount * 100) / 100;
    group.entries.push({ ...entry, win: rate ? Math.round(entry.amount * 100 * rate) / 100 : null });
    return groups;
  }, {}));

  // The slip: in the side column on wider screens, inside the bottom sheet on phones (where it gets a close button)
  const renderSlip = close => <section className="m99-panel m99-entry-slip m99-ticket"><div className="m99-ticket-head"><h2 id={`${slipId}-title`}>Entry slip <span className="m99-ticket-count">{draft.length}</span></h2><Button variant="text" disabled={!draft.length || market.frozen} onClick={() => { setDraft([]); setReviewError(''); }}>Clear all</Button>{close && <IconButton icon="close" label="Close entry slip" onClick={close} />}</div>{draft.length ? <div className="m99-draft-list">{draft.map(entry => <div className="m99-draft-row" key={entry.key} style={{ '--m99-game-accent': accentOf(entry.gameId) }}><span className="m99-draft-number">{entry.number}</span><div><strong>{entry.game}</strong><small>{entry.session} session</small></div><b>{money(entry.amount)}</b><IconButton icon="close" label={`Remove ${entry.game} ${entry.number} ${entry.session}`} disabled={market.frozen} onClick={() => { setDraft(previous => previous.filter(item => item.key !== entry.key)); setReviewError(''); }} /></div>)}</div> : <div className="m99-slip-empty"><Icon name="layers" size={25} /><strong>Your selections appear here</strong><p>Choose numbers and an amount, <br />then add them to your slip.</p></div>}
    <div className="m99-ticket-perf" aria-hidden="true" />
    <div className="m99-slip-summary"><div><span>Entries</span><strong>{draft.length}</strong></div><div className="m99-slip-total"><span>Total amount</span><strong>{money(total, true)}</strong></div><Button className="m99-full-width" disabled={!draft.length || !isOpen || market.frozen} endIcon="arrow" onClick={() => { setSlipOpen(false); setReviewOpen(true); }}>{draft.length ? `Review ${draft.length} ${draft.length === 1 ? 'entry' : 'entries'}` : 'Review entries'}</Button>{reviewError && <p role="alert" className="m99-field-error">{reviewError}</p>}<p><Icon name="shield" size={11} /> Entries are accepted after confirmation</p></div></section>;

  return <div className="m99-market-details" data-market-status={market.status}>
    {game && <div className="m99-game-breadcrumb"><Button variant="text" icon="arrow" onClick={() => onSelectGame(null)}>All game types</Button><Icon name="chevron" size={12} /><strong>{game.label}</strong>{draft.length > 0 && <Badge>{draft.length} entries in slip</Badge>}</div>}
    {/* One filter strip, as on the Matka directory: the section, the game category, the count and the two charts */}
    <div className="gw-matka-detail-filters"><section className="gw-matka-filterbar" aria-label="Market controls">
      <FilterSelect label="Market details section" value={tab} options={sections} onChange={setTab} />
      {tab === 'Game types' && <FilterSelect label="Filter game types" value={category} options={GAME_CATEGORIES} onChange={setCategory} />}
      <span className="gw-matka-filter-info">{tab === 'Game types' ? `${shownGames} ${shownGames === 1 ? 'game type' : 'game types'}` : ''}</span>
      {onChart && !closeOnly && <button type="button" className="gw-matka-filter-action" aria-label={`${market.name} Panel Chart`} onClick={() => onChart(market, 'panel')}><Icon name="chart" size={16} />Panel Chart</button>}
      {onChart && market.kind !== 'STARLINE' && <button type="button" className="gw-matka-filter-action" aria-label={`${market.name} Jodi Chart`} onClick={() => onChart(market, 'jodi')}><Icon name="grid" size={16} />Jodi Chart</button>}
    </section></div>

    {tab === 'Game types' && <GamePicker market={market} category={category} onSelectGame={onSelectGame} />}
    {/* Place entry: the builder and the ticket-style slip (recent results, market activity and the footnote were removed) */}
    {tab === 'Place entry' && game && <div className="m99-entry-layout"><div className="m99-entry-main"><EntryBuilder key={game.id} game={game} market={market} onAdd={addEntries} /></div>
      <aside className="m99-entry-side">
        <button type="button" className="m99-slip-toggle" aria-haspopup="dialog" aria-expanded={slipOpen} aria-controls={slipId} onClick={() => setSlipOpen(true)}><span className="m99-slip-toggle-title"><Icon name="layers" size={16} />Entry slip <span key={draft.length} className="m99-ticket-count">{draft.length}</span></span><span className="m99-slip-toggle-total">{money(total, true)}</span><Icon name="chevron" size={16} /></button>
        {phone ? <SlipSheet id={slipId} labelledBy={`${slipId}-title`} open={slipOpen} onClose={() => setSlipOpen(false)}>{renderSlip}</SlipSheet> : renderSlip()}</aside></div>}

    {tab === 'My entries' && <section className="m99-panel"><div className="m99-compact-panel-title"><h2>My entries · {market.name}</h2><Segmented options={['All entries', 'Today', 'Pending']} value={historyFilter} onChange={market.onEntryFilter} label="Filter market entries" /></div>{market.entriesLoading ? <p role="status">Loading entries...</p> : market.entriesError ? <EmptyState title="Could not load entries" description={market.entriesError} action={<Button onClick={market.onEntriesRetry}>Try again</Button>} /> : <EntryTable entries={visibleEntries} />}<div className="gw-matka-pager"><span>{market.entryTotal || 0} entries / Page {market.entryPage || 1}</span><div><Button variant="secondary" disabled={market.entryPage <= 1 || market.entriesLoading} onClick={() => market.onEntryPage(market.entryPage - 1)}>Previous</Button><Button variant="secondary" disabled={market.entryPage * 20 >= market.entryTotal || market.entriesLoading} onClick={() => market.onEntryPage(market.entryPage + 1)}>Next</Button></div><span>Times in {market.timezoneLabel}</span></div></section>}

    {tab === 'Market info' && <div className="m99-market-info-grid"><section className="m99-panel"><div className="m99-compact-panel-title"><h2>Market information</h2><StatusBadge status={market.status} /></div><dl className="m99-market-info-list">{[['Market', market.name], ['Category', `${market.category} session`], ['Open result time', `${market.open} ${market.timezoneLabel}`], ['Open Bid Last Time', `${market.openBidLast} ${market.timezoneLabel}`], ['Close result time', `${market.close} ${market.timezoneLabel}`], ['Close Bid Last Time', `${market.closeBidLast} ${market.timezoneLabel}`], ['Currency', market.currency], ['Minimum per entry', money(market.minStake)], ['Maximum per entry', money(market.maxStake)], ['Available games', `${availableGames.length} game options`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section><section className="m99-panel"><div className="m99-compact-panel-title"><h2>Game guide</h2><Badge tone="orange">Game rules</Badge></div><div className="m99-game-guide">{availableGames.map(type => <div key={type.id}><strong>{type.label}</strong><span>{type.description}</span><Badge>{type.sessions?.join(' / ')}</Badge><small>{type.rateDisplay}</small></div>)}</div><p className="m99-info-footnote">Check the listed payout rates, session deadlines and limits before confirming.</p></section></div>}
    {/* Review: entries grouped by game and session, each number with its stake and what it pays, then the total,
        the wallet and Edit / Confirm */}
    {reviewOpen && <Modal className="gw-matka-review" title="Review entries" subtitle={`${market.name} · ${displayDate(market.runDate)}`} onClose={() => { if (!submitting) setReviewOpen(false); }}>
      <div className="m99-review-body">{reviewGroups.map(group => <section className="m99-review-group" key={group.key} style={{ '--m99-game-accent': group.accent }}>
        <header><span className="m99-review-icon"><GameSymbol type={group.icon} /></span><div><strong>{group.label}</strong><small>{group.session} session{group.rates.length ? ` · pays 1:${group.rates.join(' / 1:')}` : ''}</small></div><b>{money(group.total)}</b></header>
        <ul>{group.entries.map(entry => <li key={entry.key}><strong>{entry.number}</strong><span>{money(entry.amount)}</span>{entry.win != null && <small>Win {money(entry.win)}</small>}</li>)}</ul>
      </section>)}</div>
      <div className="m99-review-foot"><div className="m99-review-perf" aria-hidden="true" />
        <div className="m99-review-facts"><div><span>Entries</span><strong>{draft.length}</strong></div><div><span>Paid from</span><strong><Icon name="wallet" size={14} />{market.walletLabel}</strong></div></div>
        <div className="m99-review-total"><span>Total amount</span><strong>{money(total, true)}</strong></div>
        <p className="m99-review-note"><Icon name="shield" size={13} />Entries are final once confirmed. Check every number, session and amount.</p>
        {reviewError && <p role="alert" className="m99-field-error">{reviewError}</p>}
        <div className="m99-review-actions"><Button variant="secondary" disabled={submitting} onClick={() => { setReviewOpen(false); if (phone) setSlipOpen(true); }}>Edit slip</Button><Button disabled={submitting} icon="check" onClick={confirm}>{submitting ? 'Placing entries...' : `Confirm ${money(total, true)}`}</Button></div></div>
    </Modal>}
  </div>;
}
