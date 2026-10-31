/* eslint-disable react/prop-types */
import { useMemo, useState } from 'react';
import { Badge, Button, Field, Icon, Segmented } from './components';
import { money } from './data';
import { generateMotorNumbers, getGameNumbers } from './market-data';

export default function EntryBuilder({ game, market, onAdd }) {
  const [session, setSession] = useState(() => (game.sessions || (game.closeOnly ? ['Close'] : ['Open', 'Close'])).find(value => market.accepts(game, value)) || (game.sessions || (game.closeOnly ? ['Close'] : ['Open']))[0]);
  const [selected, setSelected] = useState([]);
  const [amount, setAmount] = useState(String(Math.min(market.maxStake, Math.max(market.minStake, 100))));
  const [bulkAmounts, setBulkAmounts] = useState({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [page, setPage] = useState(0);
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [direction, setDirection] = useState('Open digit + Close Pana');
  const [error, setError] = useState('');
  const isOpen = market.accepts(game, session);
  const min = market.minStake, max = market.maxStake;
  const invalidAmount = value => !Number.isFinite(Number(value)) || Math.abs(Number(value) * 100 - Math.round(Number(value) * 100)) > 0.00001 || Number(value) < min || Number(value) > max;
  const numbers = useMemo(() => game.motor ? getGameNumbers('single') : getGameNumbers(game.id), [game]);
  const generated = useMemo(() => generateMotorNumbers(game.id, selected), [game.id, selected]);
  const pageSize = game.bulk ? 25 : 50;
  const filtered = numbers.filter(number => {
    if (!number.includes(search)) return false;
    if (filter === 'All') return true;
    if (game.combined) return new Set(number).size === { SP: 3, DP: 2, TP: 1 }[filter];
    return Number(number) % 2 === (filter === 'Even' ? 0 : 1);
  });
  const visible = filtered.slice(page * pageSize, page * pageSize + pageSize);
  const filledBulk = Object.entries(bulkAmounts).filter(([, value]) => value !== '');
  const isHalf = game.id === 'half-sangam';
  const reverseHalf = isHalf && direction === 'Open Pana + Close digit';
  const firstLabel = isHalf && !reverseHalf ? 'Open single digit' : 'Open Pana';
  const secondLabel = reverseHalf ? 'Close single digit' : 'Close Pana';
  const firstLength = isHalf && !reverseHalf ? 1 : 3;
  const secondLength = reverseHalf ? 1 : 3;

  function toggle(number) { setSelected(previous => previous.includes(number) ? previous.filter(n => n !== number) : [...previous, number]); setError(''); }
  function applyBulkAmount() {
    if (!selected.length) { setError('Select numbers before applying a common amount.'); return; }
    if (invalidAmount(amount)) { setError(`Enter an amount between ${money(min)} and ${money(max)} per entry, with at most two decimals.`); return; }
    setBulkAmounts(previous => ({ ...previous, ...Object.fromEntries(selected.map(number => [number, amount])) })); setSelected([]); setError('');
  }
  function submit(event) {
    event.preventDefault();
    if (!isOpen) return;
    let picks;
    if (game.bulk) picks = filledBulk.map(([number, value]) => ({ number, amount: Number(value) }));
    else {
      let chosen = selected;
      if (game.motor) {
        if (selected.length < (game.id === 'sp-motor' ? 3 : 2)) { setError(`Choose at least ${game.id === 'sp-motor' ? 3 : 2} different digits to generate Pana.`); return; }
        chosen = generated;
      }
      if (game.combination) {
        if (first.length !== firstLength || second.length !== secondLength) { setError(`Enter ${firstLength} digit${firstLength === 1 ? '' : 's'} for ${firstLabel.toLowerCase()} and ${secondLength} for ${secondLabel.toLowerCase()}.`); return; }
        chosen = [`${first} / ${second}`];
      }
      picks = chosen.map(number => ({ number, amount: Number(amount) }));
    }
    if (!picks.length) { setError(game.bulk ? 'Enter an amount for at least one number.' : 'Select at least one number to add an entry.'); return; }
    if (picks.some(pick => invalidAmount(pick.amount))) { setError(`Enter an amount between ${money(min)} and ${money(max)} per entry, with at most two decimals.`); return; }
    const result = onAdd(game, session, picks);
    if (result) { setError(result); return; }
    setSelected([]); setBulkAmounts({}); setFirst(''); setSecond(''); setError('');
  }
  const pendingCount = game.bulk ? filledBulk.length : game.motor ? generated.length : selected.length;

  return <section className="m99-panel m99-entry-builder"><div className="m99-compact-panel-title"><h2>{game.label}</h2><Badge tone="orange">{game.bulk ? 'Bulk amounts' : game.motor ? 'Motor generator' : 'Number selection'}</Badge></div>
    {!isOpen && <div className="m99-market-unavailable"><Icon name="lock" size={16} /><span>{game.rateConfigured === false ? 'Entries are unavailable until the payout rate is published.' : market.status === 'Upcoming' ? 'This market has not opened yet.' : 'Betting is closed for this session or game.'} Results and history are available.</span></div>}
    <form onSubmit={submit} noValidate><fieldset className="m99-entry-fieldset" disabled={market.frozen}>
      <div className="m99-entry-controls"><div className="m99-session-control"><span>Session</span>{game.closeOnly || game.sessions?.length === 1 ? <Badge>{game.sessions?.[0] || 'Close'} session</Badge> : <Segmented options={game.sessions || ['Open', 'Close']} value={session} onChange={value => { setSession(value); setSelected([]); setBulkAmounts({}); setError(''); }} label="Entry session" />}</div><span className="m99-game-range">{game.bulk ? 'Set an amount against each number' : game.motor ? 'Choose source digits to generate Pana' : game.combination ? 'Combine open & close numbers' : `${numbers.length} numbers · Multi-select enabled`}</span></div>
      <fieldset className="m99-entry-fieldset" disabled={!isOpen}>
      {game.combination ? <>
        {isHalf && <div className="m99-sangam-direction"><Segmented options={['Open digit + Close Pana', 'Open Pana + Close digit']} value={direction} onChange={value => { setDirection(value); setFirst(''); setSecond(''); setError(''); }} label="Half Sangam combination" /></div>}
        <div className="m99-combination-fields"><Field label={firstLabel} inputMode="numeric" maxLength={firstLength} placeholder={firstLength === 1 ? 'e.g. 7' : 'e.g. 123'} value={first} onChange={e => { setFirst(e.target.value.replace(/\D/g, '')); setError(''); }} /><span>/</span><Field label={secondLabel} inputMode="numeric" maxLength={secondLength} placeholder={secondLength === 1 ? 'e.g. 7' : 'e.g. 456'} value={second} onChange={e => { setSecond(e.target.value.replace(/\D/g, '')); setError(''); }} /></div>
      </> : <>
        <div className="m99-number-toolbar"><label className="m99-number-search"><Icon name="search" size={14} /><input aria-label="Search numbers" placeholder="Find number" inputMode="numeric" value={search} onChange={e => { setSearch(e.target.value.replace(/\D/g, '')); setPage(0); }} /></label>{(game.combined || game.digits <= 2 || game.motor) && <Segmented options={game.combined ? ['All', 'SP', 'DP', 'TP'] : ['All', 'Even', 'Odd']} value={filter} onChange={value => { setFilter(value); setPage(0); }} label={game.combined ? 'Pana type filter' : 'Number filter'} />}<button type="button" onClick={() => { setSelected(previous => [...new Set([...previous, ...visible])]); setError(''); }}>Select page</button><button type="button" disabled={!selected.length && !filledBulk.length} onClick={() => { setSelected([]); setBulkAmounts({}); setError(''); }}>{game.bulk ? 'Clear amounts' : 'Clear'}</button></div>
        {game.bulk ? <div className="m99-bulk-number-grid" role="group" aria-label={`${game.label} amounts`}>{visible.map(number => <div key={number} className={selected.includes(number) ? 'is-selected' : ''}><button type="button" aria-pressed={selected.includes(number)} aria-label={`Select ${number}`} onClick={() => toggle(number)}><span className="m99-bulk-checkbox">{selected.includes(number) && <Icon name="check" size={10} />}</span>{number}</button><input type="number" inputMode="numeric" min={min} max={max} step="0.01" placeholder="Amount" aria-label={`Amount for ${number}`} value={bulkAmounts[number] ?? ''} onChange={e => { const value = e.target.value; setBulkAmounts(previous => ({ ...previous, [number]: value })); setError(''); }} /></div>)}</div> : <div className="m99-number-grid" role="group" aria-label={`Select ${game.label} numbers`}>{visible.map(number => <button type="button" aria-pressed={selected.includes(number)} className={selected.includes(number) ? 'is-active' : ''} key={number} onClick={() => toggle(number)}>{number}{selected.includes(number) && <Icon name="check" size={9} />}</button>)}</div>}
        {!filtered.length && <div className="m99-number-empty">No matching numbers. Try another search.</div>}
        <div className="m99-number-footer"><span>{game.bulk ? `${filledBulk.length} amounts entered` : `${selected.length} selected`} <b>·</b> {filtered.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length} numbers</span>{filtered.length > pageSize && <div><button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>{page + 1} / {Math.ceil(filtered.length / pageSize)}</span><button type="button" disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage(p => p + 1)}>Next</button></div>}</div>
        {game.motor && <div className="m99-motor-preview"><div><strong>{generated.length} generated Pana</strong><span>{selected.length ? `Source digits: ${selected.join(', ')}` : 'Select source digits above'}</span></div>{generated.length ? <div className="m99-generated-numbers">{generated.map(number => <span key={number}>{number}</span>)}</div> : <p>{game.id === 'sp-motor' ? 'Select 3 or more digits for Single Pana combinations.' : 'Select 2 or more digits for Double Pana combinations.'}</p>}</div>}
      </>}
      <div className="m99-entry-amount-row"><Field label={game.bulk ? 'Common amount' : 'Amount per number'} type="number" inputMode="numeric" min={min} max={max} step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setError(''); }} /><div className="m99-entry-presets">{[10, 50, 100, 500].map(value => <button type="button" key={value} className={Number(amount) === value ? 'is-active' : ''} onClick={() => { setAmount(String(value)); setError(''); }}>{money(value)}</button>)}</div>{game.bulk ? <Button variant="secondary" onClick={applyBulkAmount}>Apply to selected</Button> : <Button type="submit" icon="plus">{game.combination ? 'Add combination' : `Add ${pendingCount || ''} ${pendingCount === 1 ? 'entry' : 'entries'}`}</Button>}</div>
      {game.bulk && <div className="m99-bulk-summary"><span>{filledBulk.length} numbers <b>·</b> {money(filledBulk.reduce((sum, [, value]) => sum + (Number(value) || 0), 0))} total</span><Button type="submit" icon="plus">Add bulk entries</Button></div>}
      {error && <p className="m99-entry-error" role="alert"><Icon name="alert" size={14} />{error}</p>}
      </fieldset>
    </fieldset></form>
  </section>;
}
