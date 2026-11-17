// The Live Casino / Slots lobby (Matchbook theme): page bar, category tabs, toolbar, rows,
// See All grid, search results, the signed-in Recent/Favourites rows and the lobby states.
// Components run in the source VM (tests/load-source.cjs) with hooks shimmed by hand, like the
// top-casino harness in nova-integration.test.cjs: state survives re-renders, effects run on demand.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loader, root } = require('./load-source.cjs');

const english = loader()('src/lib/i18n/locales/en.ts').en.translation;
function t(key, options = {}) {
  const found = key.split('.').reduce((value, part) => value?.[part], english);
  const text = typeof found === 'string' ? found : options.defaultValue ?? key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name] ?? ''));
}
const file = relative => path.join(root, relative);
const flush = () => new Promise(resolve => setImmediate(resolve));
const marker = name => ({ __esModule: true, default: props => React.createElement('div', { 'data-stub': name, 'data-props': JSON.stringify(props, (key, value) => typeof value === 'function' ? undefined : value) }) });

function harness(relative, props, { api = {}, stubs = {}, search = '', immediateTimers = false } = {}) {
  const states = [];
  let effects = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect(callback) { effects.push(callback); },
    useRef(initial) { return { current: initial }; },
    useCallback(callback) { return callback; },
    useMemo(factory) { return factory(); },
  };
  const listeners = new Map();
  const window = {
    innerWidth: 1280,
    innerHeight: 900,
    addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(handler); },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    dispatchEvent(event) { listeners.get(event.type)?.forEach(handler => handler(event)); },
    matchMedia: () => ({ matches: true }),
    scrollTo() {},
  };
  const load = loader({
    react: hooks,
    'react-i18next': { useTranslation: () => ({ t }) },
    'react-router-dom': { useLocation: () => ({ pathname: '/casino', search }), useNavigate: () => () => {} },
    [file('src/lib/api/user.ts')]: api,
    [file('src/components/casino/CasinoCard.tsx')]: { __esModule: true, default: ({ item }) => React.createElement('div', { 'data-game': item.title }) },
    ...stubs,
  }, {
    window,
    document: { getElementById: () => null },
    IntersectionObserver: class { observe() {} disconnect() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    URLSearchParams,
    setTimeout: immediateTimers ? callback => { callback(); return 0; } : setTimeout,
    clearTimeout,
    requestAnimationFrame(callback) { callback(); return 1; },
    cancelAnimationFrame() {},
  });
  const Component = load(relative).default;
  const render = () => { cursor = 0; effects = []; return renderToStaticMarkup(React.createElement(() => Component(props))); };
  const runEffects = () => effects.map(effect => effect()).filter(Boolean);
  return { render, runEffects, states, window };
}

const game = (title, extra = {}) => ({ id: title, gameId: title.toLowerCase().replace(/\s+/g, '-'), title, provider: 'Evolution', imageUrl: `/${title}.webp`, category: 'live', ...extra });

test('category tabs: All first, counts or a dash, the active tab marked', () => {
  const tabs = [
    { id: 'all', name: 'All', count: 248, iconData: null },
    { id: 'roulette', name: 'Roulette', count: 42, iconData: 'AAAA' },
    { id: 'baccarat', name: 'Baccarat', count: null, iconData: null },
  ];
  const html = harness('src/components/casino/LobbyTabs.tsx', { tabs, active: 'roulette', onSelect() {}, label: 'Game categories' }).render();
  assert.match(html, /class="nova-ex-sport-tabs-wrap nova-lobby-tabs"/);
  assert.match(html, /role="group" aria-label="Game categories"/);
  assert.match(html, /data-tab="all"[^>]*aria-pressed="false"[^>]*>.*?<span>All<\/span><small>248<\/small>/);
  assert.match(html, /data-tab="roulette" class="active" aria-pressed="true"[^>]*><img src="data:image\/png;base64,AAAA"/);
  assert.match(html, /<span>Baccarat<\/span><small>–<\/small>/);
});

test('lobby tile wraps the shared CasinoCard and hands the hover label to the stylesheet', () => {
  const item = { title: 'Speed Roulette', provider: 'Evolution', gameId: 'speed' };
  const html = harness('src/components/casino/LobbyTile.tsx', { item }).render();
  assert.equal(html, '<div class="nova-lobby-tile" style="--lobby-play-label:&quot;Play Now&quot;"><div data-game="Speed Roulette"></div></div>');
  const css = fs.readFileSync(file('src/components/casino/casino-lobby.css'), 'utf8');
  assert.match(css, /\.nova-lobby \.nova-game-art::after \{\s*content: var\(--lobby-play-label, "Play Now"\);/);
  assert.match(css, /\.nova-lobby \.nova-game-card:hover \.nova-game-art::after,\s*\.nova-lobby \.nova-game-art:focus-visible::after \{ opacity: 1;/);
});

test('live rows: labelled panel with count, See All and arrows over one row of tiles', async () => {
  const reported = [];
  const api = {
    getCasinoCategories: async () => ({ data: [{ name: 'Roulette' }, { name: 'Andar Bahar', iconData: 'data:image/png;base64,BBBB' }] }),
    getCasinoGames: async ({ category }) => category === 'Roulette'
      ? { data: [game('Speed Roulette'), game('Auto Roulette')], meta: { total: 42, page: 1, hasMore: true } }
      : { data: [game('Andar Bahar')], meta: { total: 18, page: 1, hasMore: true } },
    getCasinoSummary: async () => ({ data: [] }),
  };
  const lobby = harness('src/components/casino/CategorySections.tsx', { onCategoriesChange: rows => reported.push(rows) }, { api });
  assert.match(lobby.render(), /role="status" aria-label="Loading games"/);
  lobby.runEffects();
  await flush();

  const html = lobby.render();
  assert.match(html, /<section id="cat-roulette" class="nova-lobby-section" aria-labelledby="cat-title-roulette"><header class="nova-ex-section-head">/);
  assert.match(html, /<h2 id="cat-title-roulette">Roulette<\/h2><span class="nova-ex-section-count">42<\/span>/);
  assert.match(html, /aria-expanded="false" aria-controls="cat-body-roulette">See All<\/button>/);
  assert.match(html, /aria-label="Scroll left" aria-controls="slider-roulette"/);
  assert.match(html, /<div id="slider-roulette" class="nova-ex-strip-track nova-lobby-track">/);
  assert.match(html, /<div class="nova-lobby-tile" style="[^"]*"><div data-game="Speed Roulette">/);
  assert.match(html, /<span class="nova-lobby-cat-icon" aria-hidden="true"><img src="data:image\/png;base64,BBBB"/);

  // The harness re-runs every effect (it has no dependency tracking), so the rows reload once; let them settle.
  lobby.runEffects();
  await flush();
  // Rows are built inside the source VM (another realm), so compare plain copies.
  assert.deepEqual(JSON.parse(JSON.stringify(reported.at(-1))), [
    { id: 'roulette', name: 'Roulette', count: 42, iconData: null },
    { id: 'andar-bahar', name: 'Andar Bahar', count: 18, iconData: 'data:image/png;base64,BBBB' },
  ]);

  // See All: `expanded` is the component's first useState.
  lobby.states[0] = 'roulette';
  const expanded = lobby.render();
  assert.match(expanded, /aria-expanded="true" aria-controls="cat-body-roulette">Show less<\/button>/);
  assert.doesNotMatch(expanded, /aria-controls="slider-roulette"/);
  assert.match(expanded, /<div id="cat-body-roulette"><div class="nova-lobby-grid">/);
  assert.match(expanded, /data-infinite-sentinel/);
  assert.match(expanded, /<div class="nova-lobby-foot"><button type="button" class="nova-lobby-btn">Show less<\/button>/);
  assert.match(expanded, /<div id="slider-andar-bahar"/);
});

test('slots categories typed featured/top render as ordinary rows', async () => {
  const api = {
    getCasinoCategories: async () => ({ data: [{ name: 'Popular', type: 'top', order: 1 }, { name: 'Jackpots', type: 'featured', order: 2 }] }),
    getCasinoGames: async ({ category }) => ({ data: [game(`${category} Reels`, { category: 'slots' })], meta: { total: 9, page: 1 } }),
    getCasinoSummary: async () => ({ data: [] }),
  };
  const lobby = harness('src/components/casino/CategorySections.tsx', { slotsOnly: true }, { api });
  lobby.render();
  lobby.runEffects();
  await flush();
  const html = lobby.render();
  assert.match(html, /id="cat-popular"[\s\S]*data-game="Popular Reels"/);
  assert.match(html, /id="cat-jackpots"[\s\S]*data-game="Jackpots Reels"/);
});

test('rows report a load failure with Retry, and an empty provider filter with Clear providers', async () => {
  const failed = harness('src/components/casino/CategorySections.tsx', {}, {
    api: { getCasinoCategories: async () => { throw new Error('offline'); }, getCasinoGames: async () => ({ data: [] }), getCasinoSummary: async () => ({ data: [] }) },
  });
  failed.render();
  failed.runEffects();
  await flush();
  const error = failed.render();
  assert.match(error, /class="nova-lobby-panel is-error" role="alert"><strong>Games could not be loaded\.<\/strong>/);
  assert.match(error, /class="nova-lobby-btn is-primary">Try again<\/button>/);

  const filtered = harness('src/components/casino/CategorySections.tsx', { providers: ['Evolution'], onClearProviders() {} }, {
    api: { getCasinoCategories: async () => ({ data: [] }), getCasinoGames: async () => ({ data: [] }), getCasinoSummary: async () => ({ data: [] }) },
  });
  filtered.render();
  filtered.runEffects();
  await flush();
  const empty = filtered.render();
  assert.match(empty, /<strong>No games from these providers<\/strong>/);
  assert.match(empty, /class="nova-lobby-btn">Clear providers<\/button>/);
});

test('toolbar: tabs from the rendered rows with All, search, provider count and chips', async () => {
  const api = {
    getCasinoCategories: async () => ({ data: [{ name: 'Roulette', iconData: 'ICON' }, { name: 'Dropped' }] }),
    getCasinoProviders: async () => ({ data: [{ name: 'Evolution', slug: 'evolution' }] }),
    getCasinoGames: async () => ({ data: [], meta: { total: 0 } }),
  };
  const stubs = {
    [file('src/components/casino/LobbyTabs.tsx')]: marker('tabs'),
    [file('src/components/casino/ProviderFilterDrawer.tsx')]: marker('drawer'),
  };
  const props = { selectedProviders: ['Evolution', 'Ezugi'], onProvidersChange() {}, rowCategories: [{ id: 'roulette', name: 'Roulette', count: 42, iconData: null }], totalCount: 248 };
  const search = harness('src/components/casino/CasinoSearch.tsx', props, { api, stubs });
  search.render();
  search.runEffects();
  await flush();
  const html = search.render();
  const tabProps = JSON.parse(html.match(/data-stub="tabs" data-props="([^"]*)"/)[1].replace(/&quot;/g, '"'));
  assert.deepEqual(tabProps.tabs, [
    { id: 'all', name: 'All', count: 248, iconData: null },
    { id: 'roulette', name: 'Roulette', count: 42, iconData: 'ICON' },
  ]);
  assert.equal(tabProps.active, 'all');
  assert.match(html, /<div class="nova-lobby-toolbar"><div class="nova-lobby-search">/);
  assert.match(html, /placeholder="Search games or providers…" aria-label="Search"/);
  assert.match(html, /class="nova-lobby-providers-btn"[^>]*>.*?<span class="nova-lobby-providers-label">Providers<\/span><b>2<\/b><\/button>/);
  assert.match(html, /<div class="nova-lobby-chips"><span>Showing games from<\/span><span class="nova-lobby-chip">Evolution<\/span><span class="nova-lobby-chip">Ezugi<\/span><button type="button">Clear<\/button>/);
  assert.doesNotMatch(html, /Search results/);
});

// Owner 2026-11-01: on refresh the strip must not jump. It is placeholders until every row and the lobby
// total have loaded, then every tab and count at once.
test('category strip: placeholders until the rows and the total have both loaded', async () => {
  const api = {
    getCasinoCategories: async () => ({ data: [{ name: 'Roulette' }, { name: 'Featured Games' }] }),
    getCasinoProviders: async () => ({ data: [] }),
    getCasinoGames: async () => ({ data: [], meta: { total: 0 } }),
  };
  const stubs = { [file('src/components/casino/LobbyTabs.tsx')]: marker('tabs'), [file('src/components/casino/ProviderFilterDrawer.tsx')]: marker('drawer') };
  const rows = [{ id: 'roulette', name: 'Roulette', count: 42, iconData: null }];
  const stripFor = async props => {
    const search = harness('src/components/casino/CasinoSearch.tsx', props, { api, stubs });
    search.render();
    search.runEffects();
    await flush();
    return JSON.parse(search.render().match(/data-stub="tabs" data-props="([^"]*)"/)[1].replace(/&quot;/g, '"'));
  };
  assert.equal((await stripFor({ rowCategories: null, totalCount: 248 })).loading, true, 'rows still loading');
  assert.equal((await stripFor({ rowCategories: rows, totalCount: undefined })).loading, true, 'total still loading');
  const failedTotal = await stripFor({ rowCategories: rows, totalCount: null });
  assert.equal(failedTotal.loading, false, 'a total that could not be read does not hold the strip');
  assert.deepEqual(failedTotal.tabs[0], { id: 'all', name: 'All', count: null, iconData: null });

  const tabs = [{ id: 'all', name: 'All', count: 248, iconData: null }, { id: 'roulette', name: 'Roulette', count: 42, iconData: null }];
  const loading = harness('src/components/casino/LobbyTabs.tsx', { tabs, active: 'all', onSelect() {}, label: 'Game categories', loading: true }).render();
  assert.equal(loading.match(/<span class="nova-lobby-tab-skeleton" aria-hidden="true"><\/span>/g)?.length, 7);
  assert.doesNotMatch(loading, /<button type="button" data-tab=/, 'no real tab shows before everything has loaded');
  assert.match(loading, /role="group" aria-label="Game categories" aria-busy="true"/);
  const loaded = harness('src/components/casino/LobbyTabs.tsx', { tabs, active: 'all', onSelect() {}, label: 'Game categories' }).render();
  assert.doesNotMatch(loaded, /nova-lobby-tab-skeleton|aria-busy/);
  assert.match(loaded, /<span>Roulette<\/span><small>42<\/small>/);
});

test('rows tell the strip nothing while they load, and every row with its count once all have loaded', async () => {
  const reported = [];
  const pending = [];
  const api = {
    getCasinoCategories: async () => ({ data: [{ name: 'Roulette' }, { name: 'Featured Games' }, { name: 'Baccarat', iconData: 'ICON' }] }),
    getCasinoGames: ({ category }) => new Promise(resolve => pending.push(() => resolve({ data: [game(`${category} One`)], meta: { total: category.length, page: 1 } }))),
    getCasinoSummary: async () => ({ data: [] }),
  };
  const lobby = harness('src/components/casino/CategorySections.tsx', { onCategoriesChange: rows => reported.push(rows) }, { api });
  const plain = value => JSON.parse(JSON.stringify(value));
  lobby.render();
  lobby.runEffects();
  await flush();
  // The harness re-runs every effect on each pass (no dependency tracking), so each pass also restarts the load.
  lobby.render();
  lobby.runEffects();
  assert.equal(reported.at(-1), null, 'categories known, games not: still loading');

  pending.shift()();
  await flush();
  assert.match(lobby.render(), /id="cat-featured-games"/, 'the first row renders as soon as it arrives');
  lobby.runEffects();
  assert.equal(reported.at(-1), null, 'one arrived row does not put a one-tab strip up');

  while (pending.length) { pending.shift()(); await flush(); await flush(); }
  lobby.render();
  lobby.runEffects();
  assert.deepEqual(plain(reported.at(-1)), [
    { id: 'featured-games', name: 'Featured Games', count: 14, iconData: null },
    { id: 'roulette', name: 'Roulette', count: 8, iconData: null },
    { id: 'baccarat', name: 'Baccarat', count: 8, iconData: 'ICON' },
  ]);
});

test('search results: labelled panel with total, tile grid and View more', async () => {
  const api = {
    getCasinoCategories: async () => ({ data: [] }),
    getCasinoProviders: async () => ({ data: [] }),
    getCasinoGames: async params => (params.search === 'roul' ? { data: [game('Speed Roulette'), game('Auto Roulette')], meta: { total: 30 } } : { data: [] }),
  };
  const stubs = { [file('src/components/casino/LobbyTabs.tsx')]: marker('tabs') };
  const search = harness('src/components/casino/CasinoSearch.tsx', { slotsOnly: false }, { api, stubs, search: '?q=roul', immediateTimers: true });
  search.render();
  search.runEffects(); // reads ?q= into the query
  search.render();
  search.runEffects(); // searches
  await flush();
  const html = search.render();
  assert.match(html, /<section class="nova-lobby-section" aria-labelledby="nova-lobby-search-title">/);
  assert.match(html, /<h2 id="nova-lobby-search-title">Search results<\/h2><span class="nova-ex-section-count">30<\/span>/);
  assert.match(html, /<div class="nova-lobby-grid"><div class="nova-lobby-tile" style="[^"]*"><div data-game="Speed Roulette">/);
  assert.match(html, /data-game="Auto Roulette"/);
  assert.match(html, /class="nova-lobby-btn is-primary">View more results<small>28<\/small><\/button>/);
});

test('signed-in players get Recently played and Favourites rows; guests get nothing', async () => {
  const api = {
    getLikedCasinoGames: async () => ({ data: [game('Speed Roulette')] }),
    getRecentCasinoGames: async () => ({ data: [game('Andar Bahar'), game('Speed Roulette')] }),
  };
  const stubsFor = isAuthenticated => ({
    [file('src/lib/auth.tsx')]: { useAuth: () => ({ isAuthenticated, openAuthModal() {} }) },
    [file('src/lib/walletUtils.ts')]: { getSelectedWallet: () => 'balance' },
    [file('src/lib/notify.ts')]: { notify: { success() {}, error() {}, message() {} } },
  });
  const signedIn = harness('src/components/casino/UserGamesSection.tsx', {}, { api, stubs: stubsFor(true) });
  signedIn.render();
  signedIn.runEffects();
  await flush();
  const html = signedIn.render();
  assert.match(html, /<h2 id="nova-lobby-user-recent-title">Recently played<\/h2><span class="nova-ex-section-count">2<\/span>/);
  assert.match(html, /<h2 id="nova-lobby-user-liked-title">Favourites<\/h2><span class="nova-ex-section-count">1<\/span>/);
  assert.match(html, /<div id="nova-lobby-user-recent" class="nova-ex-strip-track nova-lobby-track">/);
  assert.match(html, /<div class="nova-lobby-tile" style="[^"]*"><div data-game="Andar Bahar">/);
  assert.doesNotMatch(html, /Your Games|Recent<\/span>|Liked<\/span>/);

  assert.equal(harness('src/components/casino/UserGamesSection.tsx', {}, { api, stubs: stubsFor(false) }).render(), '');
});

test('pages: lobby layout and stylesheets, no banner, a hidden page title; neutral controls stay off text-white', () => {
  for (const [page, key] of [['src/pages/Casino.tsx', 'nav.liveCasino'], ['src/pages/Slots.tsx', 'nav.slots']]) {
    const source = fs.readFileSync(file(page), 'utf8');
    assert.match(source, /className="nova-ex-grid nova-lobby"/, page);
    assert.match(source, /nova-exchange-home\.css/, page);
    assert.match(source, /casino-lobby\.css/, page);
    assert.match(source, new RegExp(`<h1 className="nova-lobby-sr-only">\\{t\\("${key.replace('.', '\\.')}"\\)\\}</h1>`), page);
    assert.doesNotMatch(source, /LobbyHeader|nova-lobby-hero/, page);
  }
  for (const component of ['CasinoSearch', 'CategorySections', 'CategorySlider', 'CategoryHeaderControls', 'UserGamesSection', 'LobbyTabs', 'LobbyTile']) {
    assert.doesNotMatch(fs.readFileSync(file(`src/components/casino/${component}.tsx`), 'utf8'), /text-white/, component);
  }
});
