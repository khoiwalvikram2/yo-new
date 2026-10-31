/* eslint-disable react/prop-types */
import { useEffect, useState } from 'react';
import { Badge, Button, EmptyState, Icon, IconButton, Modal, MarketChartLinks, Segmented, StatusBadge } from './components';
import { displayDate, money } from './data';
import { gameTypes, getMarketHistory } from './market-data';
import GamePicker from './GamePicker';
import EntryBuilder from './EntryBuilder';

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
  const total = draft.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0) / 100;
  const marketEntries = entries.filter(entry => entry.marketId === market.id);
  const visibleEntries = marketEntries;
  useEffect(() => { setTab(selectedGameId ? 'Place entry' : 'Game types'); setReviewOpen(false); setReviewError(''); }, [selectedGameId]);

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

  return <div className="m99-market-details" data-market-status={market.status}>
    <div className="m99-market-context"><div className="m99-market-context-actions"><IconButton icon="star" label={`${favorite ? 'Remove' : 'Add'} ${market.name} ${favorite ? 'from' : 'to'} favorites`} aria-pressed={favorite} className={favorite ? 'm99-favorite is-active' : 'm99-favorite'} onClick={() => onFavorite(market.id)} /><label className="m99-workspace-switch"><span>Market</span><select aria-label="Switch market" value={market.id} onChange={event => onMarket(market.options.find(item => item.id === event.target.value))}>{market.options.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></div>
    <header className="m99-market-hero" data-page-header="title-only"><div className="m99-market-identity"><IconButton icon="back" label="Back to markets" className="m99-page-back" onClick={onBack} /><div><h1>{market.name}</h1></div></div><div className="m99-workspace-result"><span><i />Latest result <StatusBadge status={market.status} /><small>{displayDate(market.runDate)} · {market.timezoneLabel}</small></span><strong aria-label={market.result}>{market.result.split(' – ').map((part, index) => <span key={index} className={index === 1 ? 'is-jodi' : ''}>{index > 0 && <i>–</i>}{part}</span>)}</strong></div></header>
    <section className="m99-market-summary" aria-label="Market schedule and account summary"><div><span><Icon name="clock" size={13} />Open result time</span><strong>{market.open}</strong><small>Bid Last Time<b>{market.openBidLast}</b></small></div><div><span><Icon name="clock" size={13} />Close result time</span><strong>{market.close}</strong><small>Bid Last Time<b>{market.closeBidLast}</b></small></div><div><span><Icon name="wallet" size={13} />Selected wallet</span><strong>{money(balance, true)}</strong><small>Available balance<span>{market.currency}</span></small></div><div><span><Icon name="shield" size={13} />Entry limits / number</span><strong>{money(market.minStake)} - {money(market.maxStake)}</strong><small>Per number<span>{availableGames.length} game types</span></small></div></section>
    {game && <div className="m99-game-breadcrumb"><Button variant="text" icon="arrow" onClick={() => onSelectGame(null)}>All game types</Button><Icon name="chevron" size={12} /><strong>{game.label}</strong>{draft.length > 0 && <Badge>{draft.length} entries in slip</Badge>}</div>}
    <div className="m99-detail-tabs"><Segmented options={[game ? 'Place entry' : 'Game types', 'My entries', 'Market info']} value={tab} onChange={setTab} label="Market details section" /><MarketChartLinks market={market} onChart={onChart} /></div>

    {tab === 'Game types' && <GamePicker market={market} onSelectGame={onSelectGame} />}
    {tab === 'Place entry' && game && <div className="m99-entry-layout"><div className="m99-entry-main"><EntryBuilder key={game.id} game={game} market={market} onAdd={addEntries} />
      <section className="m99-panel m99-inline-history"><div className="m99-compact-panel-title"><h2>Recent results</h2><Button variant="text" endIcon="arrow" onClick={() => onChart(market, 'panel')}>Full chart</Button></div><HistoryTable market={market} compact /></section></div>
      <aside className="m99-entry-side"><section className="m99-panel m99-entry-slip"><div className="m99-compact-panel-title"><h2>Entry slip <Badge tone="orange">{draft.length}</Badge></h2><Button variant="text" disabled={!draft.length || market.frozen} onClick={() => { setDraft([]); setReviewError(''); }}>Clear all</Button></div>{draft.length ? <div className="m99-draft-list">{draft.map(entry => <div className="m99-draft-row" key={entry.key}><span className="m99-draft-number">{entry.number}</span><div><strong>{entry.game}</strong><small>{entry.session} session</small></div><b>{money(entry.amount)}</b><IconButton icon="close" label={`Remove ${entry.game} ${entry.number} ${entry.session}`} disabled={market.frozen} onClick={() => { setDraft(previous => previous.filter(item => item.key !== entry.key)); setReviewError(''); }} /></div>)}</div> : <div className="m99-slip-empty"><Icon name="layers" size={25} /><strong>Your selections appear here</strong><p>Choose numbers and an amount,<br />then add them to your slip.</p></div>}
        <div className="m99-slip-summary"><div><span>Entries</span><strong>{draft.length}</strong></div><div><span>Available balance</span><strong>{money(balance)}</strong></div><div className="m99-slip-total"><span>Total amount</span><strong>{money(total, true)}</strong></div><Button className="m99-full-width" disabled={!draft.length || !isOpen || market.frozen} endIcon="arrow" onClick={() => setReviewOpen(true)}>Review entries</Button>{reviewError && <p role="alert" className="m99-field-error">{reviewError}</p>}<p><Icon name="shield" size={11} /> Entries are accepted after confirmation</p></div></section>
        <section className="m99-panel m99-market-snapshot"><div className="m99-compact-panel-title"><h2>My market activity</h2><Button variant="text" onClick={() => setTab('My entries')}>View all</Button></div><div className="m99-activity-totals"><div><strong>{market.entryTotal || 0}</strong><span>Total entries</span></div><div><strong>{money(marketEntries.reduce((sum, item) => sum + item.amount, 0))}</strong><span>Amount on this page</span></div></div>{marketEntries.slice(0, 3).map(entry => <div className="m99-market-mini-entry" key={entry.id}><div><strong>{entry.game} <b>{entry.number}</b></strong><span>{entry.session} · {money(entry.amount)}</span></div><StatusBadge status={entry.status} /></div>)}{!marketEntries.length && <p className="m99-no-entries">No entries saved in this market yet.</p>}</section><div className="m99-detail-note"><Icon name="alert" size={13} /><span>{market.message || 'Combination games lock at the Open cutoff. Rates and limits are checked when you confirm.'}</span></div></aside></div>}

    {tab === 'My entries' && <section className="m99-panel"><div className="m99-compact-panel-title"><h2>My entries · {market.name}</h2><Segmented options={['All entries', 'Today', 'Pending']} value={historyFilter} onChange={market.onEntryFilter} label="Filter market entries" /></div>{market.entriesLoading ? <p role="status">Loading entries...</p> : market.entriesError ? <EmptyState title="Could not load entries" description={market.entriesError} action={<Button onClick={market.onEntriesRetry}>Try again</Button>} /> : <EntryTable entries={visibleEntries} />}<div className="gw-matka-pager"><span>{market.entryTotal || 0} entries / Page {market.entryPage || 1}</span><div><Button variant="secondary" disabled={market.entryPage <= 1 || market.entriesLoading} onClick={() => market.onEntryPage(market.entryPage - 1)}>Previous</Button><Button variant="secondary" disabled={market.entryPage * 20 >= market.entryTotal || market.entriesLoading} onClick={() => market.onEntryPage(market.entryPage + 1)}>Next</Button></div><span>Times in {market.timezoneLabel}</span></div></section>}

    {tab === 'Market info' && <div className="m99-market-info-grid"><section className="m99-panel"><div className="m99-compact-panel-title"><h2>Market information</h2><StatusBadge status={market.status} /></div><dl className="m99-market-info-list">{[['Market', market.name], ['Category', `${market.category} session`], ['Open result time', `${market.open} ${market.timezoneLabel}`], ['Open Bid Last Time', `${market.openBidLast} ${market.timezoneLabel}`], ['Close result time', `${market.close} ${market.timezoneLabel}`], ['Close Bid Last Time', `${market.closeBidLast} ${market.timezoneLabel}`], ['Currency', market.currency], ['Minimum per entry', money(market.minStake)], ['Maximum per entry', money(market.maxStake)], ['Available games', `${availableGames.length} game options`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section><section className="m99-panel"><div className="m99-compact-panel-title"><h2>Game guide</h2><Badge tone="orange">Game rules</Badge></div><div className="m99-game-guide">{availableGames.map(type => <div key={type.id}><strong>{type.label}</strong><span>{type.description}</span><Badge>{type.sessions?.join(' / ')}</Badge><small>{type.rateDisplay}</small></div>)}</div><p className="m99-info-footnote">Check the listed payout rates, session deadlines and limits before confirming.</p></section></div>}
    {reviewOpen && <Modal title="Review entries" subtitle={`${market.name} · ${draft.length} entries · ${displayDate(market.runDate)}`} onClose={() => { if (!submitting) setReviewOpen(false); }}><div className="m99-review-entries">{draft.map(entry => <div key={entry.key}><span><strong>{entry.number}</strong><small>{entry.game} · {entry.session}</small><small>{availableGames.find(game => game.id === entry.gameId)?.rateDisplay}</small></span><b>{money(entry.amount)}</b></div>)}</div><div className="m99-review-total"><span>Total amount</span><strong>{money(total, true)}</strong></div><p className="m99-review-note">This places the listed entries using your selected wallet. Check every number, session and amount before confirming.</p><p><strong>Wallet:</strong> {market.walletLabel}</p>{reviewError && <p role="alert" className="m99-field-error">{reviewError}</p>}<Button className="m99-full-width" disabled={submitting} icon="check" onClick={confirm}>{submitting ? 'Placing entries...' : 'Confirm entries'}</Button></Modal>}
  </div>;
}
