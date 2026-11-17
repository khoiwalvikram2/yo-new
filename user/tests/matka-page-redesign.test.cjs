const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'CustomEvent', 'localStorage', 'sessionStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : dom.window[key] });
}
const React = require('react');
const { MemoryRouter, useLocation } = require('react-router-dom');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const { act, cleanup, fireEvent, render, within } = require('@testing-library/react');
const { loader } = require('./load-source.cjs');
const mod = component => ({ __esModule: true, default: component });
const currency = { formatAmount: value => Number(value).toFixed(2), formatWholeAmount: value => String(Math.round(value)), getCurrencyFromStorage: () => 'INR' };
const globals = { window, document, localStorage, sessionStorage, MutationObserver: dom.window.MutationObserver,
  setTimeout, clearTimeout, setInterval, clearInterval, crypto: require('node:crypto').webcrypto };
const common = { '@/lib/theme': { getThemeMode: () => 'light' }, '@/lib/currency': currency,
  '@/components/modals/ModalSurface': mod(() => null), '@/hooks/usePageSEO': { usePageSEO() {} } };
// Vite resolves the kit's extensionless JSX import; the lightweight source loader does not.
common['./components'] = loader(common, globals)('src/features/matka/kit/components.jsx');
const clients = [];
const ok = (data, meta = {}) => ({ meta: { code: 200, ...meta }, data });
const fixture = (overrides = {}) => ({ id: 'zero', code: 'zero-market', name: 'Zero Market', kind: 'WORLI', timezone: 'Asia/Kolkata',
  runDate: '2026-10-25', quoteVersion: 'quote-1', status: 'Open', featured: false,
  result: { openResult: '000', openDigit: '0', closeResult: '', closeDigit: null, jodi: null, complete: false },
  sessions: ['OPEN', 'CLOSE'].map(side => ({ side, enabled: true, accepting: side === 'OPEN', lockAt: '2026-10-25T10:00:00Z', resultAt: '2026-10-25T10:15:00Z' })),
  rates: ['SINGLE', 'JODI', 'SINGLE_PANNA', 'DOUBLE_PANNA', 'TRIPLE_PANNA', 'HALF_SANGAM', 'FULL_SANGAM'].map(bidType => ({ bidType, label: bidType, payoutMultiplier: 9 })),
  ...overrides });
// The player page lists Worli markets only (owner 2026-11-01), so the directory fixtures are Worli markets.
const markets = () => [fixture(), fixture({ id: 'later', code: 'later-market', name: 'Later Market', status: 'Upcoming', result: {} }), fixture({ id: 'closed', code: 'closed-market', name: 'Closed Market', status: 'Closed', result: { jodi: '00' } })];
async function until(check, timeout = 1500) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { check(); return; } catch (error) { if (Date.now() + 15 >= end) throw error; }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
  }
}
function pageHarness(options = {}) {
  const source = options.markets || markets(), tenant = { id: 'tenant-a' }, calls = { list: [], detail: [], chart: [], login: [], private: [] };
  const forbidden = operation => () => { calls.private.push(operation); throw new Error(`Unexpected private operation: ${operation}`); };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } } }); clients.push(client);
  const api = {
    MatkaRequestError: class extends Error {},
    getMatkaMarkets: async input => {
      calls.list.push(input);
      if (options.list) return options.list(input);
      const data = source.filter(item => (!input.kind || item.kind === input.kind) && (!input.search || item.name.toLowerCase().includes(input.search.toLowerCase())));
      return ok(data, { total: data.length, page: 1, hasMore: false });
    },
    getMatkaMarket: async code => { calls.detail.push(code); return ok(source.find(item => item.code === decodeURIComponent(code) || item.id === decodeURIComponent(code))); },
    getMatkaChart: async input => { calls.chart.push(input); return ok([]); },
    getMatkaWallet: forbidden('wallet'), getMyMatkaBets: forbidden('history'), placeMatkaEntries: forbidden('placement'),
  };
  const Page = loader({ ...common, '@/lib/whitelabel': { getWhitelabelId: () => tenant.id },
    '@/lib/auth': { useAuth: () => ({ user: null, isAuthenticated: false, isHydrating: false, openAuthModal: mode => calls.login.push(mode), refreshUser: forbidden('refreshUser') }) },
    '@/lib/api/matka': api,
    '@/features/matka/kit/MarketDetails.jsx': { ...mod(({ market }) => React.createElement('h2', null, `Detail: ${market.name}`)), EntryTable: () => null },
    '@/features/matka/kit/MarketCharts.jsx': mod(({ market, type }) => React.createElement('h2', null, `${market.name} ${type} archive`)),
  }, globals)('src/pages/Matka.tsx').default;
  function Location() { return React.createElement('output', { 'data-testid': 'location' }, useLocation().pathname); }
  const element = () => React.createElement(QueryClientProvider, { client }, React.createElement(MemoryRouter, { initialEntries: [options.route || '/matka'] }, React.createElement(Page), React.createElement(Location)));
  const view = render(element());
  return { ...view, calls, tenant, rerenderPage: () => view.rerender(element()) };
}
const cards = view => Array.from(view.container.querySelectorAll('article[data-market-item]'));
const directoryTableName = /Markets,.*results.*schedules.*timezone/;
const choose = (view, name, option) => { const box = view.getByRole('combobox', { name }); fireEvent.click(box); fireEvent.click(within(view.getByRole('listbox', { name })).getByRole('option', { name: option })); return box; };
test.afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); localStorage.clear(); sessionStorage.clear(); document.body.innerHTML = ''; });

test('guest directory preserves server status and partial zero results without requesting account data', async () => {
  const view = pageHarness();
  await until(() => assert.equal(cards(view).length, 3));
  assert.equal(cards(view)[0].getAttribute('data-status'), 'Open');
  assert.match(cards(view)[0].textContent, /000/);
  assert.match(cards(view)[0].textContent, /0\*/);
  // The face keeps the result time; the type, result state, timezone and entry cutoff sit behind the rules button.
  assert.match(cards(view)[0].textContent, /03:45 pm/i);
  assert.doesNotMatch(cards(view)[0].textContent, /Worli|Entry cutoff|Awaiting result|Session schedule|IST|03:30 pm/i);
  const rulesButton = within(cards(view)[0]).getByRole('button', { name: 'Zero Market rules' });
  fireEvent.click(rulesButton);
  assert.equal(rulesButton.getAttribute('aria-expanded'), 'true');
  const rules = view.getByRole('region', { name: 'Zero Market rules' });
  assert.match(rules.textContent, /Market typeWorli/);
  assert.match(rules.textContent, /TimezoneIST/);
  assert.match(within(rules).getByRole('row', { name: /Open/ }).textContent, /03:45 pm.*03:30 pm/i);
  assert.equal(document.activeElement, within(rules).getByRole('button', { name: 'Close Zero Market rules' }));
  fireEvent.keyDown(rules, { key: 'Escape' });
  assert.equal(view.queryByRole('region', { name: 'Zero Market rules' }), null);
  assert.equal(document.activeElement, rulesButton);
  choose(view, 'Filter Matka markets', 'Open markets');
  assert.equal(view.queryByRole('listbox'), null);
  assert.equal(cards(view).length, 1);
  assert.match(cards(view)[0].textContent, /Zero Market/);
  assert.deepEqual(view.calls.private, []);
  assert.equal(view.calls.list[0].limit, 100);
});

test('favorite filtering persists locally and is isolated by tenant for public guests', async () => {
  const view = pageHarness();
  await until(() => assert.equal(cards(view).length, 3));
  fireEvent.click(view.getByRole('button', { name: 'Add Zero Market to favorites' }));
  assert.equal(view.getByRole('button', { name: 'Remove Zero Market from favorites' }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(JSON.parse(localStorage.getItem('gw:matka:favorites:tenant-a:anonymous')), ['zero']);
  choose(view, 'Filter Matka markets', 'Favorites');
  assert.equal(cards(view).length, 1);
  view.tenant.id = 'tenant-b'; view.rerenderPage();
  await until(() => assert.equal(view.getByRole('heading', { name: 'No favorite markets yet' }).textContent, 'No favorite markets yet'));
  assert.equal(cards(view).length, 0);
  view.tenant.id = 'tenant-a'; view.rerenderPage();
  await until(() => assert.equal(cards(view).length, 1));
  assert.deepEqual(view.calls.private, []);
});

test('search is debounced and trimmed, and the market type offers and requests Worli only', async () => {
  const view = pageHarness({ markets: [...markets(), fixture({ id: 'star', code: 'star-market', name: 'Star Market', kind: 'STARLINE' })] });
  await until(() => assert.equal(cards(view).length, 3));
  assert.ok(view.calls.list.every(call => call.kind === 'WORLI'), 'every list request asks for Worli markets');
  assert.equal(cards(view).some(card => /Star Market/.test(card.textContent)), false, 'a Starline market is never listed');
  const initialCalls = view.calls.list.length;
  fireEvent.change(view.getByRole('textbox', { name: 'Search Matka markets' }), { target: { value: '  Market  ' } });
  assert.equal(view.calls.list.length, initialCalls);
  await until(() => assert.equal(view.calls.list.at(-1).search, 'Market'));
  const types = view.getByRole('combobox', { name: 'Matka market type' });
  assert.equal(types.textContent, 'Worli');
  fireEvent.click(types);
  const options = within(view.getByRole('listbox', { name: 'Matka market type' })).getAllByRole('option');
  assert.deepEqual(options.map(option => option.textContent), ['Worli']);
  assert.equal(options[0].getAttribute('aria-selected'), 'true');
  fireEvent.keyDown(types, { key: 'Escape' });
  assert.equal(types.getAttribute('aria-expanded'), 'false');
  assert.equal(view.calls.list.at(-1).kind, 'WORLI');
  assert.equal(view.calls.list.at(-1).search, 'Market');
  assert.equal(view.calls.list.at(-1).page, 1);
  assert.equal(view.calls.list.at(-1).limit, 100);
  assert.deepEqual(view.calls.private, []);
});

test('explicit grid and table controls preserve the selected public market list', async () => {
  const view = pageHarness();
  await until(() => assert.equal(cards(view).length, 3));
  choose(view, 'Filter Matka markets', 'Open markets');
  const layout = choose(view, 'Market layout', 'Table view');
  const table = view.getByRole('table', { name: directoryTableName });
  assert.equal(within(table).getAllByRole('row').length, 2);
  assert.match(table.textContent, /Zero Market/);
  assert.equal(layout.textContent, 'Table view');
  choose(view, 'Market layout', 'Grid view');
  assert.equal(view.queryByRole('table', { name: directoryTableName }), null);
  assert.equal(cards(view).length, 1);
  assert.equal(layout.textContent, 'Grid view');
  // The keyboard works the list as the admin's does: open, move down a row, choose it.
  fireEvent.keyDown(layout, { key: 'ArrowDown' });
  fireEvent.keyDown(layout, { key: 'ArrowDown' });
  assert.equal(layout.getAttribute('aria-activedescendant'), view.getByRole('option', { name: 'Table view' }).id);
  fireEvent.keyDown(layout, { key: 'Enter' });
  assert.equal(layout.textContent, 'Table view');
  assert.ok(view.getByRole('table', { name: directoryTableName }));
  assert.deepEqual(view.calls.private, []);
});

test('guest market and chart navigation use the selected market code and never place entries', async () => {
  const selected = fixture({ id: 'selected', code: 'MORNING + A', name: 'Morning A' });
  const view = pageHarness({ markets: [selected] });
  await until(() => assert.equal(cards(view).length, 1));
  fireEvent.click(view.getByRole('button', { name: 'Morning A Panel Chart' }));
  await until(() => assert.equal(view.getByTestId('location').textContent, '/matka/markets/MORNING%20%2B%20A/charts/panel'));
  await until(() => assert.ok(view.getByRole('heading', { name: 'Morning A panel archive' })));
  assert.deepEqual(view.calls.detail, ['MORNING%20%2B%20A']);
  assert.equal(view.calls.chart[0].marketId, 'selected');
  assert.deepEqual(view.calls.private, []);
});

test('guest entries route requires sign in without requesting private history or wallet', async () => {
  const view = pageHarness({ route: '/matka/my-bets' });
  assert.equal(view.getByTestId('location').textContent, '/matka/my-bets');
  assert.equal(view.getByRole('link', { name: 'My entries', exact: true }).getAttribute('aria-current'), 'page');
  assert.ok(view.getByRole('heading', { name: 'Sign in to view your entries' }));
  const actions = view.getAllByRole('button', { name: 'Sign in', exact: true });
  fireEvent.click(actions.at(-1));
  assert.deepEqual(view.calls.login, ['login']);
  assert.deepEqual(view.calls.private, []);
});

test('table and card actions retain market identity, chart capabilities and favorite state', () => {
  const load = loader(common, globals), { asKitMarket } = load('src/features/matka/model.ts');
  const { MarketBoard } = load('src/features/matka/kit/MarketBoard.jsx');
  // The board itself still renders every kind (the page only asks for Worli): chart buttons follow each kind.
  const mixed = [fixture(), fixture({ id: 'later', code: 'later-market', name: 'Later Market', kind: 'STARLINE', status: 'Upcoming', result: {} }), fixture({ id: 'closed', code: 'closed-market', name: 'Closed Market', kind: 'JACKPOT', status: 'Closed', result: { jodi: '00' } })];
  const items = mixed.map(item => asKitMarket(item)), calls = { favorite: [], market: [], chart: [] };
  const view = render(React.createElement(MarketBoard, { items, favorites: ['zero'], mode: 'table',
    onFavorite: id => calls.favorite.push(id), onMarket: item => calls.market.push(item.id), onChart: (item, type) => calls.chart.push([item.id, type]) }));
  const table = within(view.getByRole('table', { name: directoryTableName }));
  fireEvent.click(table.getByRole('button', { name: 'Remove Zero Market from favorites' }));
  fireEvent.click(table.getByRole('button', { name: 'View Closed Market market' }));
  fireEvent.click(table.getByRole('button', { name: 'Zero Market Jodi Chart' }));
  assert.deepEqual(calls, { favorite: ['zero'], market: ['closed'], chart: [['zero', 'jodi']] });
  assert.ok(table.queryByRole('button', { name: 'Later Market Jodi Chart' }) === null, 'a Starline market has no Jodi chart');
  assert.ok(table.queryByRole('button', { name: 'Closed Market Panel Chart' }) === null, 'a Jackpot market has no Panel chart');
  assert.match(table.getByRole('row', { name: /Closed Market/ }).textContent, /00/);
});
