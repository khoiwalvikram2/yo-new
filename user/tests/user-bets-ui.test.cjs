const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  Event: { configurable: true, value: dom.window.Event },
  CustomEvent: { configurable: true, value: dom.window.CustomEvent },
  localStorage: { configurable: true, value: dom.window.localStorage },
});
// JSDOM has no native modal/top-layer implementation. Browser verification
// separately checks focus trapping; here exercise React open/close lifecycle.
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };

const React = require('react');
const { MemoryRouter, useLocation } = require('react-router-dom');
const { act, cleanup, fireEvent, render, waitFor, within } = require('@testing-library/react');
const { loader, root } = require('./load-source.cjs');
const translations = loader()('src/lib/i18n/locales/en.ts').en.translation;
function translate(key, options = {}) {
  let value = key.split('.').reduce((result, part) => result?.[part], translations) ?? options.defaultValue ?? key;
  for (const [name, replacement] of Object.entries(options)) value = value.replaceAll(`{{${name}}}`, replacement);
  return value;
}
function spy(implementation = () => undefined) {
  const fn = (...args) => { fn.calls.push(args); return implementation(...args); };
  fn.calls = [];
  return fn;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const globals = {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  URLSearchParams: dom.window.URLSearchParams, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
};
const ok = data => ({ meta: { code: 200 }, data });
const bet = (overrides = {}) => ({
  id: 'bet-1', eventId: 'event-1', eventName: 'India v Australia', selection: 'India',
  side: 'back', odds: 2.4, stake: 125, status: 'matched', createdAt: '2026-10-10T09:30:00Z', type: 'back',
  ...overrides,
});
function harness(component = 'mobile', options = {}) {
  const auth = { user: { id: 'player-1' }, isAuthenticated: true, isHydrating: false, openAuthModal: spy(), ...options.auth };
  const features = { sportsEnabled: true, casinoEnabled: true, ...options.features };
  const calls = { getUserBets: spy(options.getUserBets ?? (async () => ok([]))), getSportsList: spy(options.getSportsList ?? (async () => ok([]))) };
  const bookmarkedEvents = [];
  const sports = {
    formatStart: () => ({ dayMon: '10 Oct', time: '15:00' }),
    BetListCard: props => React.createElement('article', {
      'data-testid': 'bet-card', 'data-side': props.betType, 'data-odds': props.odds,
      'data-stake': props.stake, 'data-potential': props.potential,
    }, props.selection),
    TopSportsSlider: () => null, SportsTabs: () => null, EventsList: () => null,
    SidebarCard: ({ title, children }) => React.createElement('section', null, title, children),
  };
  const stubs = {
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    '@/lib/auth': { useAuth: () => auth },
    '@/lib/api/user': calls,
    '../hooks/useAppSettings': { useFeatureFlags: () => features },
    '@/hooks/useAppSettings': { useFeatureFlags: () => features },
    '@/components/sports': sports, '../components/sports': sports,
    '../components/sports/utils': { formatStart: sports.formatStart },
    '@/lib/sportsHelpers': {
      generateEventId: value => value.toLowerCase().replaceAll(' ', '-'),
      useSportsEvents: () => ({ bookmarkedEvents, cleanupBookmarks() {} }),
      useBookmarkedEvents: () => ({ toggleBookmark() {} }), storedToEvent: value => value,
    },
    '@/lib/currency': { formatAmount: value => String(value) },
    '@/lib/hooks/useOddsSocket': { useOddsSocket: () => ({}) },
    '../hooks/usePageSEO': { usePageSEO() {} },
    '../components/bonus/SegmentedTabs': { SegmentedTabs: () => null },
  };
  for (const name of ['cricket', 'football', 'tennis', 'basketball', 'ice-hockey', 'baseball']) {
    stubs[path.join(root, `src/assets/images/${name}.png`)] = { __esModule: true, default: `${name}.png` };
  }
  const Component = loader(stubs, globals)(component === 'mobile' ? 'src/components/MobileTabBar.tsx' : 'src/pages/Sports.tsx').default;
  function LocationReport() {
    const location = useLocation();
    return React.createElement('span', { 'data-testid': 'current-route' }, location.pathname + location.search);
  }
  const element = () => React.createElement(MemoryRouter, null, React.createElement(Component), React.createElement(LocationReport));
  const view = render(element());
  return { ...view, auth, features, calls, rerenderPanel: () => view.rerender(element()) };
}
function openMobile(view) { fireEvent.click(view.getByRole('button', { name: 'Open bet slip' })); }
test.beforeEach(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 }); });
test.afterEach(() => { cleanup(); document.body.innerHTML = ''; document.body.style.overflow = ''; localStorage.clear(); });

test('mobile bets request existing UserBets data only, filter exact open statuses, and preserve stake/odds/P/L', async () => {
  const view = harness('mobile', { getUserBets: async () => ok([
    bet({ pl: 80 }), bet({ id: 'unmatched', selection: 'Unmatched selection', status: 'unmatched', side: 'lay', odds: 3, stake: 40 }),
    bet({ id: 'pending', selection: 'Pending selection', status: 'pending' }), bet({ id: 'open', selection: 'Open selection', status: 'open' }),
    bet({ id: 'settled', selection: 'Settled selection', status: 'won' }), bet({ id: 'empty-status', selection: 'Missing status', status: '' }),
  ]) });
  assert.equal(view.calls.getUserBets.calls.length, 0);
  openMobile(view);
  await waitFor(() => assert.equal(view.getAllByTestId('bet-card').length, 4));
  assert.equal(JSON.stringify(view.calls.getUserBets.calls[0]), '[{"openOnly":true}]');
  assert.equal(view.queryByText('Settled selection'), null);
  assert.equal(view.queryByText('Missing status'), null);
  const cards = view.getAllByTestId('bet-card');
  assert.equal(cards[0].dataset.odds, '2.4'); assert.equal(cards[0].dataset.stake, '125'); assert.equal(cards[0].dataset.potential, '80');
  assert.equal(cards[1].dataset.side, 'Lay'); assert.equal(cards[1].dataset.potential, '-80');
});

test('mobile loading is not mistaken for empty, failure offers retry, and successful retry shows empty', async () => {
  const pending = deferred();
  let attempts = 0;
  const view = harness('mobile', { getUserBets: () => ++attempts === 1 ? pending.promise : Promise.resolve(ok([])) });
  openMobile(view);
  assert.match(view.getByRole('status').textContent, /Loading your bets/);
  assert.equal(view.queryByText('No open bets'), null);
  await act(async () => pending.reject(new Error('Offline')));
  assert.match(view.getByRole('alert').textContent, /Could not load your bets/);
  assert.equal(view.queryByText('No open bets'), null);
  fireEvent.click(view.getByRole('button', { name: 'Try again' }));
  await waitFor(() => assert.ok(view.queryByText('No open bets')));
  assert.equal(attempts, 2);
});

test('mobile drawer has translated native dialog name, Escape/cancel closes it and restores scroll/focus', async () => {
  document.body.style.overflow = 'auto';
  const view = harness();
  const trigger = view.getByRole('button', { name: 'Open bet slip' });
  trigger.focus(); openMobile(view);
  const dialog = view.getByRole('dialog', { name: 'My Bets' });
  assert.equal(dialog.tagName, 'DIALOG');
  assert.equal(dialog.open, true); assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.activeElement, within(dialog).getAllByRole('button', { name: 'Close' }).find(button => button.tabIndex !== -1));
  fireEvent(dialog, new dom.window.Event('cancel', { bubbles: false, cancelable: true }));
  await waitFor(() => assert.equal(Boolean(view.queryByRole('dialog')), false));
  assert.equal(document.body.style.overflow, 'auto'); assert.equal(document.activeElement, trigger);
});

test('mobile ignores a queued close event from a previous dialog effect after reopening', () => {
  const view = harness();
  openMobile(view);
  const dialog = view.getByRole('dialog', { name: 'My Bets' });
  fireEvent(dialog, new Event('close'));
  assert.equal(dialog.open, true);
  assert.ok(view.queryByRole('dialog', { name: 'My Bets' }));
  dialog.open = false;
  fireEvent(dialog, new Event('close'));
  assert.equal(view.queryByRole('dialog'), null);
});

test('mobile auth hydration, signed-out and disabled sports never request protected bets', async () => {
  const hydrating = harness('mobile', { auth: { isHydrating: true } });
  assert.equal(hydrating.getByRole('button', { name: 'Open bet slip' }).disabled, true);
  assert.equal(hydrating.calls.getUserBets.calls.length, 0); hydrating.unmount();
  const signedOut = harness('mobile', { auth: { isAuthenticated: false, user: null } });
  openMobile(signedOut); assert.equal(signedOut.auth.openAuthModal.calls[0][0], 'login');
  assert.equal(signedOut.calls.getUserBets.calls.length, 0); assert.equal(signedOut.queryByRole('dialog'), null); signedOut.unmount();
  const disabled = harness('mobile', { features: { sportsEnabled: false } });
  assert.equal(disabled.queryByRole('button', { name: 'Open bet slip' }), null);
  assert.equal(disabled.calls.getUserBets.calls.length, 0);
});

test('mobile ignores late results after logout and coalesces simultaneous placement refreshes', async () => {
  const pending = deferred();
  const view = harness('mobile', { getUserBets: () => pending.promise });
  openMobile(view);
  fireEvent(window, new dom.window.Event('stakex:bet-placed'));
  fireEvent(window, new dom.window.Event('stakex:bet-placed'));
  assert.equal(view.calls.getUserBets.calls.length, 1);
  view.auth.isAuthenticated = false; view.auth.user = null; view.rerenderPanel();
  await act(async () => pending.resolve(ok([bet()])));
  assert.equal(view.queryByRole('dialog'), null); assert.equal(view.queryByTestId('bet-card'), null);
  assert.notEqual(document.body.style.overflow, 'hidden');
});

test('mobile event navigation retains its real event ID and closes the modal', async () => {
  const view = harness('mobile', { getUserBets: async () => ok([bet()]) });
  openMobile(view);
  const link = await view.findByRole('button', { name: 'Open India v Australia' });
  fireEvent.click(link);
  await waitFor(() => assert.equal(Boolean(view.queryByRole('dialog')), false));
  assert.equal(view.getByTestId('current-route').textContent, '/sports/event/india-v-australia?id=event-1');
  assert.equal(document.body.style.overflow, '');
});

test('mobile resizing to the desktop navigation boundary closes the modal and returns scroll', async () => {
  const view = harness();
  openMobile(view);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 801 });
  fireEvent(window, new dom.window.Event('resize'));
  await waitFor(() => assert.equal(Boolean(view.queryByRole('dialog')), false));
  assert.equal(document.body.style.overflow, '');
});

// The sports page lists open bets in its own side panel rows (the mobile drawer above still uses BetListCard).
const sportsBets = view => [...view.container.querySelectorAll('.nova-sx-bet')];

test('sports activity uses the existing UserBets response and retains exact open status scope', async () => {
  const view = harness('sports', { getUserBets: async () => ok([
    bet(), bet({ id: 'unmatched', selection: 'Unmatched selection', status: 'unmatched', side: 'lay', type: 'lay' }),
    bet({ id: 'settled', selection: 'Settled selection', status: 'settled' }),
  ]) });
  await waitFor(() => assert.equal(sportsBets(view).length, 2));
  assert.equal(JSON.stringify(view.calls.getUserBets.calls[0]), '[{"openOnly":true}]');
  assert.ok(view.queryAllByText('India v Australia').length > 0);
  assert.ok(view.getByText('Unmatched selection'), 'open statuses other than matched are listed');
  assert.doesNotMatch(view.container.textContent, /Settled selection/);
  const [matched, unmatched] = sportsBets(view);
  assert.equal(matched.querySelector('.nova-sx-bet-side').textContent, 'Back');
  assert.equal(matched.querySelector('.nova-sx-bet-selection small').textContent, '@ 2.4 · 125', 'odds and stake are the response values');
  assert.equal(unmatched.querySelector('.nova-sx-bet-side').textContent, 'Lay');
});

test('sports failures are distinct from empty and retry calls the real adapter', async () => {
  const pending = deferred(); let attempts = 0;
  const view = harness('sports', { getUserBets: () => ++attempts === 1 ? pending.promise : Promise.resolve(ok([])) });
  assert.ok(view.queryAllByRole('status').some(element => /Loading your bets/.test(element.textContent)));
  assert.equal(view.queryByText('No open bets'), null);
  await act(async () => pending.resolve({ meta: { code: 500 }, data: [] }));
  assert.match(view.getByRole('alert').textContent, /Could not load your bets/);
  fireEvent.click(view.getByRole('button', { name: 'Try again' }));
  await waitFor(() => assert.ok(view.queryByText('No open bets')));
  assert.equal(attempts, 2);
});

test('sports authenticates activity, blocks late logout data and refreshes existing update events', async () => {
  const first = deferred(); let attempts = 0;
  const view = harness('sports', { auth: { isAuthenticated: false, user: null }, getUserBets: () => ++attempts === 1 ? first.promise : Promise.resolve(ok([bet()])) });
  assert.equal(attempts, 0);
  fireEvent.click(view.getByRole('button', { name: 'Sign in' })); assert.equal(view.auth.openAuthModal.calls[0][0], 'login');
  view.auth.isAuthenticated = true; view.auth.user = { id: 'player-1' }; view.rerenderPanel();
  assert.equal(attempts, 1);
  fireEvent(window, new dom.window.Event('stakex:my-bets:update')); assert.equal(attempts, 1);
  await act(async () => first.resolve(ok([])));
  fireEvent(window, new dom.window.Event('stakex:bet-placed'));
  await waitFor(() => assert.equal(sportsBets(view).length, 1));
  assert.equal(attempts, 2);
  view.auth.isAuthenticated = false; view.auth.user = null; view.rerenderPanel();
  assert.equal(sportsBets(view).length, 0);
  assert.doesNotMatch(view.container.textContent, /India v Australia/, 'logout clears the previous account\'s bets');
  fireEvent(window, new dom.window.Event('stakex:my-bets:update')); assert.equal(attempts, 2);
});

// The events list is real data only (the demo boards were removed 2026-10-15).
const inventedFixtures = /Olympique Lyonnais|Mumbai Indians|Carlos Alcaraz|Los Angeles Lakers|Maiden Plate|Team Liquid|New York Yankees/;
const eventRows = view => [...view.container.querySelectorAll('#nova-sx-events .nova-sx-row:not(.is-skeleton)')];

test('sports page with no events says so in one line and invents no matches', async () => {
  const view = harness('sports');
  const region = () => view.container.querySelector('#nova-sx-events');
  await waitFor(() => assert.equal(region().querySelector('[role="status"]')?.textContent, translate('nova.noUpcoming')));
  assert.equal(eventRows(view).length, 0, 'no placeholder rows');
  assert.equal(region().querySelector('[role="alert"]'), null, 'an empty list is not reported as a failure');
  assert.doesNotMatch(view.container.textContent, inventedFixtures);
  assert.equal(view.container.querySelector('.nova-sx-head .nova-ex-section-count').textContent, '0');
});

test('sports page load failure shows the error with a retry that refetches real events', async () => {
  let attempts = 0;
  const view = harness('sports', { getSportsList: async () => {
    if (++attempts === 1) throw new Error('Sports API offline');
    return ok([{ name: 'Cricket', leagues: [{ name: 'Real league', events: [{ _id: 'event-real', name: 'Real Home v Real Away', date: '2099-01-01T10:00:00Z', markets: [] }] }] }]);
  } });
  const region = () => view.container.querySelector('#nova-sx-events');
  await waitFor(() => assert.ok(region().querySelector('[role="alert"]')));
  const alert = region().querySelector('[role="alert"]');
  assert.equal(alert.querySelector('strong').textContent, translate('nova.eventLoadError'));
  assert.doesNotMatch(view.container.textContent, /Sports API offline/, 'no raw error text');
  assert.equal(eventRows(view).length, 0, 'no placeholder rows behind the error');
  assert.doesNotMatch(view.container.textContent, inventedFixtures);
  assert.equal(view.container.querySelector('.nova-sx-head .nova-ex-section-count').textContent, '–', 'an unknown count is a dash, not a made-up zero');
  fireEvent.click(within(alert).getByRole('button', { name: translate('nova.tryAgain') }));
  await waitFor(() => assert.equal(eventRows(view).length, 1));
  assert.equal(attempts, 2);
  assert.equal(region().querySelector('[role="alert"]'), null);
  const link = eventRows(view)[0].querySelector('a.nova-sx-row-link');
  assert.equal(link.getAttribute('href'), '/sports/event/real-home-v-real-away?id=event-real', 'the row is the backend event');
});

test('sports discards a previous account response after logout or replacement instead of revealing its bets', async () => {
  const first = deferred(), second = deferred(); let attempts = 0;
  const view = harness('sports', { getUserBets: () => ++attempts === 1 ? first.promise : second.promise });
  assert.equal(attempts, 1);
  view.auth.user = { id: 'player-2' }; view.rerenderPanel();
  assert.equal(attempts, 2);
  await act(async () => first.resolve(ok([bet({ selection: 'Other account bet' })])));
  assert.doesNotMatch(view.container.textContent, /Other account bet/);
  view.auth.isAuthenticated = false; view.auth.user = null; view.rerenderPanel();
  await act(async () => second.resolve(ok([bet({ selection: 'Logged out bet' })])));
  assert.doesNotMatch(view.container.textContent, /Logged out bet/);
  assert.equal(sportsBets(view).length, 0);
});
