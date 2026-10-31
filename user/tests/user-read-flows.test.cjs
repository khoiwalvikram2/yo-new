const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'CustomEvent', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : dom.window[key] });
}
const React = require('react');
const { MemoryRouter } = require('react-router-dom');
const { act, render, cleanup, fireEvent, waitFor } = require('@testing-library/react');
const { loader } = require('./load-source.cjs');
const english = loader()('src/lib/i18n/locales/en.ts').en.translation;
const translate = (key, opts = {}) => String(key.split('.').reduce((v, p) => v?.[p], english) ?? opts.defaultValue ?? key);
const ok = data => ({ meta: { code: 200 }, data });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const spy = implementation => { const f = (...args) => { f.calls.push(args); return implementation(...args); }; f.calls = []; return f; };
const mod = Component => ({ __esModule: true, default: Component });
const auth = () => ({ user: { id: 'owner-a' }, isAuthenticated: true, isHydrating: false });
const baseGlobals = { window, document, localStorage, URL: dom.window.URL, URLSearchParams: dom.window.URLSearchParams,
  CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, setTimeout, clearTimeout, setInterval, clearInterval,
  MutationObserver: dom.window.MutationObserver, process: { env: { NODE_ENV: 'test' } } };
const common = {
  'react-i18next': { useTranslation: () => ({ t: translate }) },
  '@/hooks/usePageSEO': { usePageSEO() {} },
  '@/components/StakePageHeader': mod(({ title }) => React.createElement('h1', null, title)),
  '@/lib/currency': { formatAmount: String, getDefaultLocale: () => 'en-IN' },
};
const bet = (id, eventId = 'event') => ({ id, eventId, eventName: id, selection: id, side: 'back', type: 'back', odds: 2, stake: 50, status: 'matched', createdAt: '2026-10-24T00:00:00Z' });
test.afterEach(() => { cleanup(); localStorage.clear(); document.body.innerHTML = ''; document.head.innerHTML = ''; });

test('open-event bets ignore late event and account responses, retain current refresh, and clear on logout', async () => {
  const owner = auth(), calls = [], pending = [];
  const load = loader({ '@/lib/auth': { useAuth: () => owner }, '@/lib/api/user': { getUserBets: input => {
    calls.push(input); const d = deferred(); pending.push(d); return d.promise;
  } } }, baseGlobals);
  const { useOpenBets } = load('src/hooks/useOpenBets.ts');
  let result;
  function Probe({ eventId }) { result = useOpenBets({ eventId }); return React.createElement('div', null, result.data.map(b => b.id).join(',')); }
  const view = render(React.createElement(Probe, { eventId: 'a' }));
  view.rerender(React.createElement(Probe, { eventId: 'b' }));
  await act(async () => pending[1].resolve(ok([bet('b-bet', 'b')])));
  await act(async () => pending[0].resolve(ok([bet('a-bet', 'a')])));
  assert.equal(view.container.textContent, 'b-bet');
  assert.ok(calls.every(c => c.openOnly === true));
  act(() => { void result.refresh(); });
  assert.equal(view.container.textContent, 'b-bet');
  owner.user = { id: 'owner-b' }; view.rerender(React.createElement(Probe, { eventId: 'b' }));
  assert.equal(view.container.textContent, '');
  await act(async () => pending[3].resolve(ok([bet('new-owner')])));
  await act(async () => pending[2].resolve(ok([bet('old-owner')])));
  assert.equal(view.container.textContent, 'new-owner');
  owner.isAuthenticated = false; owner.user = null; view.rerender(React.createElement(Probe, { eventId: 'b' }));
  assert.equal(view.container.textContent, ''); assert.equal(calls.length, 4);
});

test('My Bets reloads for a different authenticated owner and retries failed reads without reloading the page', async () => {
  const owner = auth(), pending = [], calls = [];
  const MyBets = loader({ ...common, '@/lib/auth': { useAuth: () => owner }, '@/lib/api/user': { getUserBets: input => {
    calls.push(input); const d = deferred(); pending.push(d); return d.promise;
  } } }, baseGlobals)('src/pages/MyBets.tsx').default;
  const element = () => React.createElement(MemoryRouter, null, React.createElement(MyBets));
  const view = render(element());
  owner.user = { id: 'owner-b' }; view.rerender(element());
  await act(async () => pending[1].resolve(ok([bet('new-owner')])));
  await act(async () => pending[0].resolve(ok([bet('old-owner')])));
  assert.match(view.container.textContent, /new-owner/); assert.doesNotMatch(view.container.textContent, /old-owner/);
  owner.user = { id: 'owner-c' }; view.rerender(element());
  assert.doesNotMatch(view.container.textContent, /new-owner/);
  await act(async () => pending[2].reject(new Error('Offline')));
  fireEvent.click(view.getByRole('button', { name: /try again/i }));
  await act(async () => pending[3].resolve(ok([])));
  assert.equal(calls.length, 4); assert.ok(calls.every(c => c.openOnly));
});

function statementHarness(implementation) {
  const owner = auth(), calls = spy(implementation);
  const Table = ({ rows }) => React.createElement('div', { 'data-testid': 'rows' }, rows.map(r => r.id).join(','));
  const stubs = { ...common, '@/lib/auth': { useAuth: () => owner }, '@/lib/api/user': { getStatementPage: calls },
    '@/components/Pagination': mod(({ total, page, onPageChange }) => React.createElement('div', { 'data-testid': 'pagination' }, `${page}/${total}`,
      React.createElement('button', { onClick: () => onPageChange(page + 1) }, 'Next'), React.createElement('button', { onClick: () => onPageChange(2251) }, 'Last'))),
    '@/components/bonus/SegmentedTabs': { SegmentedTabs: ({ tabs, onChange }) => React.createElement('div', null, tabs.map(t => React.createElement('button', { key: t.key, onClick: () => onChange(t.key) }, t.key))) },
    '@/components/statements/WalletTable': mod(Table), '@/components/statements/SportsTable': mod(Table), '@/components/statements/CasinoTable': mod(Table), '@/components/statements/MatkaTable': mod(Table),
    '@/components/statements/DetailsModal': mod(() => null),
    '@/components/statements/CustomDatePicker': mod(({ value, onChange, placeholder }) => React.createElement('input', { value, placeholder, onChange: e => onChange(e.target.value) })),
  };
  const Statements = loader(stubs, baseGlobals)('src/pages/Statements.tsx').default;
  const element = () => React.createElement(MemoryRouter, { initialEntries: ['/statements'] }, React.createElement(Statements));
  const view = render(element());
  return { ...view, calls, owner, rerenderPanel: () => view.rerender(element()) };
}
const statementResponse = input => ({ meta: { code: 200, total: 22508, page: input.page, hasMore: input.page < 2251 }, walletTypes: ['Deposit'],
  data: [{ id: `${input.domain}-${input.page}`, amount: 20, type: input.domain.toLowerCase(), createdAt: '2026-10-24T00:00:00Z', pl: 10 }] });

test('Statements requests only the selected domain, reaches the final page and sends search/status/custom IST dates to the server', async () => {
  const view = statementHarness(async input => statementResponse(input));
  await waitFor(() => assert.equal(view.getByTestId('rows').textContent, 'WALLET-1'));
  assert.equal(view.calls.calls.length, 1);
  fireEvent.click(view.getByRole('button', { name: 'casino', exact: true }));
  await waitFor(() => assert.equal(view.getByTestId('rows').textContent, 'CASINO-1'));
  fireEvent.click(view.getByRole('button', { name: 'Last', exact: true }));
  await waitFor(() => assert.equal(view.getByTestId('rows').textContent, 'CASINO-2251'));
  assert.equal(view.getByTestId('pagination').textContent.startsWith('2251/22508'), true);
  fireEvent.change(view.getByPlaceholderText('Search by ID, amount, event, market...'), { target: { value: 'fixture-id' } });
  await waitFor(() => assert.equal(view.calls.calls.at(-1)[0].search, 'fixture-id'));
  assert.equal(view.calls.calls.at(-1)[0].page, 1);
  fireEvent.change(view.getAllByRole('combobox')[1], { target: { value: 'Lose' } });
  await waitFor(() => assert.equal(view.calls.calls.at(-1)[0].status, 'Lose'));
  fireEvent.change(view.getAllByRole('combobox')[0], { target: { value: 'custom' } });
  fireEvent.change(view.getByPlaceholderText('Start date'), { target: { value: '2026-10-01' } });
  fireEvent.change(view.getByPlaceholderText('End date'), { target: { value: '2026-10-10' } });
  await waitFor(() => assert.equal(view.calls.calls.at(-1)[0].endDate, '2026-10-10T18:29:59.999Z'));
  assert.equal(view.calls.calls.at(-1)[0].startDate, '2026-09-30T18:30:00.000Z');
});

test('Statements discards late tab/owner reads and Retry repeats only the current request', async () => {
  const pending = [];
  const view = statementHarness(input => { const d = deferred(); pending.push({ ...d, input }); return d.promise; });
  fireEvent.click(view.getByRole('button', { name: 'sports', exact: true }));
  await act(async () => pending[1].resolve(statementResponse(pending[1].input)));
  await act(async () => pending[0].resolve(statementResponse(pending[0].input)));
  assert.equal(view.getByTestId('rows').textContent, 'SPORTS-1');
  view.owner.user = { id: 'owner-b' }; view.rerenderPanel();
  assert.equal(view.getByTestId('rows').textContent, '');
  await act(async () => pending[2].reject(new Error('Offline')));
  fireEvent.click(view.getByRole('button', { name: 'Try again' }));
  await act(async () => pending[3].resolve(statementResponse(pending[3].input)));
  assert.equal(view.getByTestId('rows').textContent, 'SPORTS-1'); assert.equal(pending.length, 4);
});

test('Matka statements have independent paging and send outcome/session filters to the server', async () => {
  const view = statementHarness(async input => statementResponse(input));
  await waitFor(() => assert.equal(view.getByTestId('rows').textContent, 'WALLET-1'));
  fireEvent.click(view.getByRole('button', { name: 'matka', exact: true }));
  await waitFor(() => assert.equal(view.getByTestId('rows').textContent, 'MATKA-1'));
  fireEvent.click(view.getByRole('button', { name: 'Next', exact: true }));
  await waitFor(() => assert.equal(view.getByTestId('rows').textContent, 'MATKA-2'));
  fireEvent.change(view.getByRole('combobox', { name: 'Matka status' }), { target: { value: 'Lose' } });
  fireEvent.change(view.getByRole('combobox', { name: 'Matka session' }), { target: { value: 'close' } });
  await waitFor(() => { const input = view.calls.calls.at(-1)[0]; assert.equal(input.domain, 'MATKA'); assert.equal(input.page, 1); assert.equal(input.status, 'Lose'); assert.equal(input.type, 'close'); });
});

function settingsHarness(api) {
  const owner = auth(), intervals = new Set();
  const calls = { getAppSettings: spy(api.getAppSettings), getAppSettingsVersion: spy(api.getAppSettingsVersion), getAdvertisements: spy(api.getAdvertisements), getAllAppSettings: spy(() => { throw new Error('Duplicate settings read'); }) };
  const load = loader({ '@/lib/auth': { useAuth: () => owner }, './auth': { useAuth: () => owner },
    './api/user': calls, './whitelabel': { getWhitelabelId: () => 'fixture-tenant' },
    './currency': { setWhitelabelCurrencyDefaults() {} }, './dateUtils': { setWhitelabelTimezone() {} },
    './pwa': { updatePWAManifest() {} }, 'sonner': { toast: { error() {} } },
  }, { ...baseGlobals, setInterval: callback => { intervals.add(callback); return callback; }, clearInterval: id => intervals.delete(id) });
  const settings = load('src/lib/app-settings.tsx'); let current;
  function Probe() { current = settings.useAppSettings(); return React.createElement('div', null, current.isLoading ? 'loading' : current.parsedSettings.appName); }
  const element = () => React.createElement(settings.AppSettingsProvider, null, React.createElement(Probe));
  const view = render(element());
  return { ...view, calls, owner, settings, current: () => current, rerenderPanel: () => view.rerender(element()), tick: async () => act(async () => { for (const callback of intervals) callback(); }) };
}
const settingsResponse = (name, version = name) => ({ meta: { code: 200 }, version, data: [{ key: 'appName', value: name }] });

test('startup waits for effective settings only, coalesces reads and polls a tiny revision until configuration changes', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  const ads = deferred(); let version = 'one';
  const view = settingsHarness({ getAppSettings: async () => settingsResponse(version), getAppSettingsVersion: async () => version, getAdvertisements: () => ads.promise });
  await waitFor(() => assert.equal(view.current().isLoading, false));
  assert.equal(view.calls.getAppSettings.calls.length, 1); assert.equal(view.calls.getAllAppSettings.calls.length, 0);
  await view.tick(); assert.equal(view.calls.getAppSettingsVersion.calls.length, 1); assert.equal(view.calls.getAppSettings.calls.length, 1);
  version = 'two'; await view.tick();
  assert.equal(view.calls.getAppSettings.calls.length, 2);
  await act(async () => ads.resolve(ok([{ id: 'ad', image: '/ad.png' }])));
  assert.equal(view.current().advertisements.length, 1);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  fireEvent(document, new Event('visibilitychange')); await view.tick();
  assert.equal(view.calls.getAppSettingsVersion.calls.length, 2);
});

test('settings and cache are owner scoped and a late old-owner response cannot overwrite the new owner', async () => {
  const pending = [], ads = [];
  const view = settingsHarness({ getAppSettings: () => { const d = deferred(); pending.push(d); return d.promise; },
    getAppSettingsVersion: async () => 'revision', getAdvertisements: () => { const d = deferred(); ads.push(d); return d.promise; } });
  act(() => { void view.current().refreshAppSettings(false); void view.current().refreshAppSettings(false); });
  assert.equal(pending.length, 1);
  view.owner.user = { id: 'owner-b' }; view.rerenderPanel();
  await act(async () => pending[1].resolve(settingsResponse('owner-b')));
  await act(async () => pending[0].resolve(settingsResponse('owner-a')));
  await act(async () => ads[1].resolve(ok([{ id: 'new' }])));
  await act(async () => ads[0].resolve(ok([{ id: 'old' }])));
  assert.equal(view.current().parsedSettings.appName, 'owner-b');
  assert.equal(view.current().advertisements[0].id, 'new');
  assert.ok(view.settings.getCachedSettings('fixture-tenant:owner-b'));
  assert.equal(view.settings.getCachedSettings('fixture-tenant:owner-a'), null);
});

test('casino concurrency is bounded and results preserve the configured order', async () => {
  const { mapConcurrent } = loader()('src/lib/mapConcurrent.ts');
  let active = 0, peak = 0; const pending = new Map();
  const promise = mapConcurrent([1, 2, 3, 4, 5], 3, async value => { active++; peak = Math.max(peak, active); const d = deferred(); pending.set(value, d); await d.promise; active--; return value * 2; });
  assert.equal(pending.size, 3);
  pending.get(3).resolve(); await new Promise(setImmediate); pending.get(4).resolve(); await new Promise(setImmediate);
  pending.get(2).resolve(); pending.get(5).resolve(); pending.get(1).resolve();
  assert.equal(JSON.stringify(await promise), '[2,4,6,8,10]'); assert.equal(peak, 3);
});

test('casino publishes the first ready category, ignores obsolete providers, and loads slots page 2 without overlapping page 1', async () => {
  const observers = [], pending = [], calls = [];
  class IO { constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); } observe(target) { this.targets.push(target); } disconnect() { this.targets = []; } }
  const game = (id, provider) => ({ gameId: String(id), name: `Game ${id}`, category: 'slots', provider });
  const api = { getCasinoCategories: async () => ok([{ name: 'Featured', type: 'slots' }, { name: 'Video Slots', type: 'slots' }]),
    getCasinoGames: input => { calls.push(input); const d = deferred(); pending.push({ ...d, input }); return d.promise; }, getCasinoSummary: async () => ok([]) };
  const tile = ({ item }) => React.createElement('span', { 'data-testid': 'game' }, item.gameId);
  const CategorySections = loader({ 'react-i18next': common['react-i18next'], '@/lib/api/user': api,
    './CategorySlider': mod(({ items }) => React.createElement('div', null, items.map(item => React.createElement(tile, { key: item.gameId, item })))),
    './LobbyTile': mod(tile), './CategoryHeaderControls': mod(({ onToggle }) => React.createElement('button', { onClick: onToggle }, 'Expand')),
    './lobbyScroll': { scrollBehavior: () => 'auto' }, './lobbyModel': { categoryIconSrc: value => value },
  }, { ...baseGlobals, IntersectionObserver: IO })('src/components/casino/CategorySections.tsx').default;
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const element = providers => React.createElement(MemoryRouter, null, React.createElement(CategorySections, { slotsOnly: true, providers }));
  const view = render(element(['old']));
  await waitFor(() => assert.equal(pending.length, 2));
  await act(async () => pending[0].resolve({ meta: { total: 96, page: 1, hasMore: true }, data: Array.from({ length: 48 }, (_, i) => game(i + 1, 'old')) }));
  assert.equal(view.getAllByTestId('game').length, 48); // second category is still pending
  view.rerender(element(['new'])); assert.equal(view.queryByTestId('game'), null);
  await waitFor(() => assert.equal(pending.length, 4));
  await act(async () => pending[2].resolve({ meta: { total: 96, page: 1, hasMore: true }, data: Array.from({ length: 48 }, (_, i) => game(i + 1, 'new')) }));
  await act(async () => pending[1].resolve({ meta: { total: 1, page: 1 }, data: [game('obsolete', 'old')] }));
  assert.doesNotMatch(view.container.textContent, /obsolete/);
  fireEvent.click(view.getByRole('button', { name: 'Expand' }));
  const infinite = observers.findLast(o => o.targets.some(t => t.hasAttribute('data-infinite-sentinel')));
  act(() => { void infinite.callback([{ isIntersecting: true }]); });
  assert.equal(calls.at(-1).page, 2); assert.equal(calls.at(-1).limit, 48);
  await act(async () => pending[4].resolve({ meta: { total: 96, page: 2, hasMore: false }, data: Array.from({ length: 48 }, (_, i) => game(i + 49, 'new')) }));
  const ids = view.getAllByTestId('game').map(node => node.textContent);
  assert.equal(ids.length, 96); assert.equal(new Set(ids).size, 96);
  await act(async () => pending[3].resolve(ok([])));
});
