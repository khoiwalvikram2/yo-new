const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'CustomEvent', 'localStorage']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] });
}
const React = require('react');
const { MemoryRouter, useLocation } = require('react-router-dom');
const { act, cleanup, fireEvent, render, waitFor, within } = require('@testing-library/react');
const { loader } = require('./load-source.cjs');
const ok = (data, meta = {}) => ({ meta: { code: 200, ...meta }, data });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const sportsBet = (extra = {}) => ({ id: 'sports-1', eventId: 'event-1', eventName: 'India v Australia', marketId: 'market-1', marketName: 'Match Odds', marketType: 'exchange', selection: 'India', side: 'back', type: 'back', odds: 2, stake: 100, liability: 100, payout: 100, status: 'matched', createdAt: '2026-10-25T10:00:00Z', ...extra });
const matkaBet = (extra = {}) => ({ id: 'matka-1', marketId: 'matka-market-1', marketName: 'KALYAN', runDate: '2026-10-25', bidType: 'TRIPLE_PANNA', selection: '222', session: 'OPEN', amount: 100, payoutMultiplier: 1000, potentialWin: 100000, status: 'active', walletType: 'cash', currency: 'INR', settledAt: null, createdAt: '2026-10-25T10:00:00Z', ...extra });
const intervals = new Map(); let timerId = 0;
window.setInterval = fn => { const id = ++timerId; intervals.set(id, fn); return id; };
window.clearInterval = id => intervals.delete(id);
function harness(options = {}) {
  const owner = { isAuthenticated: true, isHydrating: false, user: { id: 'owner-a' }, ...options.auth };
  const calls = { sports: [], matka: [] };
  const load = loader({
    '@/lib/auth': { useAuth: () => owner },
    '@/lib/api/user': { getUserBets: input => { calls.sports.push(input); return (options.sports || (() => Promise.resolve(ok([]))))(input); } },
    '@/lib/api/matka': { getMyMatkaBets: input => { calls.matka.push(input); return (options.matka || (() => Promise.resolve(ok([]))))(input); } },
    '@/hooks/usePageSEO': { usePageSEO() {} },
    '@/components/StakePageHeader': { __esModule: true, default: ({ title }) => React.createElement('h1', null, title) },
    '@/lib/currency': { formatAmount: value => `INR ${Number(value).toFixed(2)}`, getDefaultLocale: () => 'en-IN' },
  }, { window, document, localStorage, URLSearchParams: dom.window.URLSearchParams });
  const Page = load('src/pages/MyBets.tsx').default;
  function Location() { return React.createElement('span', { 'data-testid': 'location' }, useLocation().pathname + useLocation().search); }
  const element = () => React.createElement(MemoryRouter, { initialEntries: [options.url || '/my-bets'] }, React.createElement(Page), React.createElement(Location));
  const view = render(element());
  return { ...view, owner, calls, rerenderPage: () => view.rerender(element()) };
}
test.afterEach(() => { cleanup(); intervals.clear(); localStorage.clear(); document.body.innerHTML = ''; });

test('Sports and Matka tabs isolate requests, keep URL state and group Sports by actual event + market IDs', async () => {
  const view = harness({ sports: async () => ok([
    sportsBet(), sportsBet({ id: 'same-market', selection: 'Australia' }),
    sportsBet({ id: 'fancy', marketId: 'market-2', marketName: '30 Over Runs', marketType: 'fancy' }),
    sportsBet({ id: 'other-event', eventId: 'event-2' }), sportsBet({ id: 'settled', selection: 'Settled', status: 'won' }),
  ]), matka: async () => ok([matkaBet()]) });
  await waitFor(() => assert.equal(view.container.querySelectorAll('.nova-mb-group').length, 3));
  assert.equal(view.container.querySelectorAll('.nova-mb-table tbody tr').length, 4);
  assert.equal(view.calls.matka.length, 0); assert.equal(view.calls.sports[0].openOnly, true);
  assert.equal(view.queryByText('Settled'), null);
  const first = view.container.querySelector('.nova-mb-group');
  assert.match(first.textContent, /Match Odds.*2 open bets/);
  assert.equal(within(first).getByRole('link', { name: 'View Event' }).getAttribute('href'), '/sports/event/event-1');
  assert.equal(view.container.querySelector('button button'), null);
  fireEvent.click(view.getByRole('button', { name: 'Matka', exact: true }));
  await view.findByRole('table', { name: 'Open Matka bets' });
  assert.equal(view.getByTestId('location').textContent, '/my-bets?tab=matka');
  assert.equal(view.calls.matka[0].status, 'open'); assert.equal(view.queryByRole('table', { name: 'Open sports bets' }), null);
});

test('Matka reads every open page and groups market + trading date without showing settled, void or cancelled bets', async () => {
  const first = Array.from({ length: 100 }, (_, i) => matkaBet({ id: `entry-${i}`, selection: String(i).padStart(3, '0') }));
  const view = harness({ url: '/my-bets?tab=matka', matka: async ({ page }) => page === 1 ? ok(first, { hasMore: true }) : ok([
    matkaBet({ id: 'older', runDate: '2026-10-24', session: 'CLOSE' }),
    matkaBet({ id: 'pending', status: 'pending', marketId: 'other-market', marketName: 'SRIDEVI' }),
    ...['won', 'lost', 'void', 'cancelled'].map(status => matkaBet({ id: status, status, selection: 'HIDDEN-' + status })),
    matkaBet({ id: 'inconsistent-settled', settledAt: '2026-10-25T12:00:00Z', selection: 'HIDDEN-settled' }),
  ], { hasMore: false }) });
  await waitFor(() => assert.equal(view.container.querySelectorAll('.nova-mb-table tbody tr').length, 102));
  assert.equal(view.container.querySelectorAll('.nova-mb-group').length, 3);
  assert.equal(view.calls.sports.length, 0); assert.deepEqual(view.calls.matka.map(c => c.page), [1, 2]);
  assert.ok(view.calls.matka.every(c => c.status === 'open' && c.limit === 100));
  assert.doesNotMatch(view.container.textContent, /HIDDEN/);
  assert.match(view.container.textContent, /Trading date: 2026-10-24/); assert.match(view.container.textContent, /CLOSE/);
  assert.match(view.container.textContent, /Triple Pana/); assert.match(view.container.textContent, /INR 100000.00/);
  assert.equal(view.getAllByRole('link', { name: 'View Market' })[0].getAttribute('href'), '/matka/markets/matka-market-1');
});

test('initial errors do not show empty or partial lists; Retry retries the current Matka category', async () => {
  let attempts = 0;
  const pending = deferred();
  const view = harness({ url: '/my-bets?tab=matka', matka: () => ++attempts === 1 ? pending.promise : Promise.resolve(ok([])) });
  assert.match(view.getByRole('status').textContent, /Loading/); assert.equal(view.queryByText('No open Matka bets'), null);
  await act(async () => pending.reject(new Error('Offline')));
  assert.ok(view.getByRole('alert')); assert.equal(view.queryByText('No open Matka bets'), null);
  fireEvent.click(view.getByRole('button', { name: 'Try again' }));
  await view.findByText('No open Matka bets'); assert.equal(attempts, 2); assert.equal(view.calls.sports.length, 0);
});

test('settlements disappear on refresh without blanking the cached table and concurrent refreshes coalesce', async () => {
  const next = deferred(); let attempts = 0;
  const view = harness({ url: '/my-bets?tab=matka', matka: () => ++attempts === 1 ? Promise.resolve(ok([matkaBet()])) : next.promise });
  await view.findByRole('table');
  fireEvent.click(view.getByRole('button', { name: 'Refresh', exact: true }));
  assert.ok(view.getByRole('table')); assert.equal(view.queryByRole('status'), null);
  act(() => { for (const fn of intervals.values()) fn(); });
  assert.equal(attempts, 2);
  await act(async () => next.resolve(ok([])));
  await view.findByText('No open Matka bets'); assert.equal(view.queryByRole('table'), null);
});

test('tab changes cannot show stale rows; owner changes and logout discard late Matka responses', async () => {
  const pending = [];
  const view = harness({ url: '/my-bets?tab=matka', sports: async () => ok([sportsBet()]), matka: () => { const d = deferred(); pending.push(d); return d.promise; } });
  fireEvent.click(view.getByRole('button', { name: 'Sports', exact: true }));
  await view.findByRole('table', { name: 'Open sports bets' });
  await act(async () => pending[0].resolve(ok([matkaBet({ selection: 'OLD-TAB' })])));
  assert.equal(view.queryByText('OLD-TAB'), null);
  fireEvent.click(view.getByRole('button', { name: 'Matka', exact: true }));
  view.owner.user = { id: 'owner-b' }; view.rerenderPage();
  await act(async () => pending[2].resolve(ok([matkaBet({ selection: 'NEW-OWNER' })])));
  await act(async () => pending[1].resolve(ok([matkaBet({ selection: 'OLD-OWNER' })])));
  assert.ok(view.getByText('NEW-OWNER')); assert.equal(view.queryByText('OLD-OWNER'), null);
  fireEvent.click(view.getByRole('button', { name: 'Refresh', exact: true }));
  view.owner.user = null; view.owner.isAuthenticated = false; view.rerenderPage();
  assert.equal(view.queryByText('NEW-OWNER'), null);
  await act(async () => pending[3].resolve(ok([matkaBet({ selection: 'LOGGED-OUT' })])));
  assert.equal(view.queryByText('LOGGED-OUT'), null); assert.equal(intervals.size, 0);
});

test('polling pauses in hidden tabs, only refreshes the active category and is removed on unmount', async () => {
  let matkaRows = [matkaBet()];
  const view = harness({ url: '/my-bets?tab=matka', matka: async () => ok(matkaRows) });
  await view.findByRole('table'); assert.equal(intervals.size, 1);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  act(() => { for (const fn of intervals.values()) fn(); }); assert.equal(view.calls.matka.length, 1);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  matkaRows = [];
  await act(async () => { for (const fn of intervals.values()) fn(); });
  await view.findByText('No open Matka bets'); assert.equal(view.calls.matka.length, 2);
  assert.equal(view.calls.sports.length, 0); view.unmount(); assert.equal(intervals.size, 0);
});

test('a market accordion is keyboard-operable without nesting its View link inside a button', async () => {
  const view = harness({ sports: async () => ok([sportsBet()]) });
  await view.findByRole('table');
  const toggle = view.getByRole('button', { name: /India v Australia.*Match Odds/ });
  fireEvent.click(toggle); assert.equal(toggle.getAttribute('aria-expanded'), 'false'); assert.equal(view.queryByRole('table'), null);
  assert.ok(view.getByRole('link', { name: 'View Event' }));
  fireEvent.click(toggle); assert.ok(view.getByRole('table'));
});
