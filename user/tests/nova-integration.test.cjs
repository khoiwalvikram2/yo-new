const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { StaticRouter } = require('react-router-dom');
const { loader, themeEnvironment, root } = require('./load-source.cjs');

const englishTranslation = loader()('src/lib/i18n/locales/en.ts').en.translation;
// Like i18next: a missing key falls back to the call's defaultValue, then to the key itself.
function translate(key, options) {
  return key.split('.').reduce((value, part) => value?.[part], englishTranslation) ?? options?.defaultValue ?? key;
}

// The exchange home (2026-10-15) reads its fixtures through useSportsEventsData; the API mapping behind
// that hook is exercised through SportsEvents below. The casino rows are the existing API-backed adapters.
function app({ features = { sportsEnabled: true, casinoEnabled: true, matkaEnabled: true, bonusesEnabled: true }, auth = { user: null, isAuthenticated: false, openAuthModal() {} }, settings = { hideDW: false }, ads = [], feed = { events: [], loading: true, error: null }, useFeed, globals = {} } = {}) {
  const marker = name => ({ __esModule: true, default: props => React.createElement('div', {
    'data-real-adapter': name,
    ...(props?.compact ? { 'data-compact': 'true' } : {}),
    ...(props?.kind || props?.variant ? { 'data-kind': props.kind || props.variant } : {}),
  }) });
  const stubs = {
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    [path.join(root, 'src/hooks/useAppSettings.ts')]: { useFeatureFlags: () => features, useParsedSettings: () => settings, useAppIdentity: () => ({}), useLogo: () => ({}) },
    [path.join(root, 'src/lib/auth.tsx')]: { useAuth: () => auth },
    [path.join(root, 'src/lib/app-settings.tsx')]: { useAppSettings: () => ({ advertisements: ads }) },
    [path.join(root, 'src/components/sports/useSportsEventsData.ts')]: { useSportsEventsData: useFeed || (() => feed) },
    [path.join(root, 'src/lib/hooks/useOddsSocket.ts')]: { useOddsSocket: () => ({}) },
    // Nothing rendered on the home may reach the network from a test.
    [path.join(root, 'src/lib/api/user.ts')]: {},
    [path.join(root, 'src/components/nova/exchange-home/MatkaStrip.tsx')]: marker('matka-strip'),
    [path.join(root, 'src/components/nova/exchange-home/GameStrip.tsx')]: marker('casino-strip'),
    [path.join(root, 'src/components/nova/exchange-home/FeaturedGameRail.tsx')]: marker('casino-rail'),
    [path.join(root, 'src/components/nova/exchange-home/CasinoLounge.tsx')]: marker('casino-lounge'),
    [path.join(root, 'src/components/nova/exchange-home/ProviderShowcase.tsx')]: marker('casino-providers'),
    [path.join(root, 'src/components/casino/TopCasinoSlider.tsx')]: marker('casino-slider'),
    [path.join(root, 'src/components/casino/UserGamesSection.tsx')]: marker('casino-catalogue'),
    [path.join(root, 'src/components/Banners.tsx')]: marker('advertisements'),
    [path.join(root, 'src/components/sidebar/SportsList.tsx')]: marker('sport-navigation'),
    [path.join(root, 'src/components/sidebar/navData.ts')]: { sports: [] },
  };
  const load = loader(stubs, globals);
  const render = Component => renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' }, React.createElement(Component)));
  return { load, render };
}

// Server rendering has no browser; the home reads matchMedia while rendering (phone advertisements).
const serverWindow = () => ({ matchMedia: query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} });
function renderHome(options = {}) {
  const { JSDOM } = require('jsdom');
  const { load, render } = app({ ...options, globals: { window: serverWindow(), ...options.globals } });
  const html = render(load('src/components/nova/NovaHome.tsx').default);
  const dom = new JSDOM(html);
  return { html, document: dom.window.document, Node: dom.window.Node, close: () => dom.window.close() };
}
// The demo fixtures and promos the exchange home used to invent (demoData.ts, removed 2026-10-15), as they printed.
// None may render again, whatever the API returns.
const placeholderPattern = new RegExp([
  'Olympique Lyonnais', 'Crystal Palace', 'India v Australia', 'Mumbai Indians', 'Chennai Super Kings', 'Carlos Alcaraz',
  'Aryna Sabalenka', 'Los Angeles Lakers', 'Boston Celtics', 'Maiden Plate', 'Grade A4', 'Toronto Maple Leafs', 'New York Yankees',
  'Team Liquid', 'Europa League Treble', 'Welcome Bonus', '20% Rebate on Losses', 'DP World India Champ', 'Champions League Outright',
  'Speed Roulette', 'Andar Bahar', 'Ultimate Sic Bo', 'Hot 777', 'Animals Strike', 'Wild Expedition',
].join('|'));

test('the demo data modules are gone and nothing imports them', () => {
  for (const file of ['src/components/nova/exchange-home/demoData.ts', 'src/components/sports/sportsMocks.ts']) {
    assert.equal(fs.existsSync(path.join(root, file)), false, `${file} is deleted`);
  }
  const sources = ['src/components/nova/exchange-home/NovaExchangeHome.tsx', 'src/components/nova/exchange-home/MatchCard.tsx',
    'src/components/nova/exchange-home/GameStrip.tsx', 'src/components/nova/exchange-home/FeaturedGameRail.tsx', 'src/pages/Sports.tsx', 'src/components/Banners.tsx']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /demoData|sportsMocks|DEMO_|DemoMatch|demoStart|usingDemo|isDemo|homebanner0|homemobile0/);
  for (const file of ['MomentumIndicator', 'OddsMovementGraph']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, `src/components/sport-event/${file}.tsx`), 'utf8'), /Math\.random/, `${file} draws no invented history`);
  }
});

// The owner asked for home page designs on sample data (2026-10-30). They live at /home-designs in development
// builds only, and the live home neither imports nor links them.
test('home design previews on sample data stay out of production builds and off the live home', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const main = read('src/main.tsx');
  assert.match(main, /const HomeDesignsPage = import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/pages\/HomeDesigns\.tsx'\)\) : null/, 'the preview page is imported in development builds only');
  assert.match(main, /\.\.\.\(HomeDesignsPage \? \[\{ path: 'home-designs'/, 'and only then gets a route');
  for (const file of ['src/components/Sidebar.tsx', 'src/components/Topbar.tsx', 'src/components/MobileTabBar.tsx', 'src/components/Footer.tsx', 'src/components/nova/NovaWorkspace.tsx', 'src/components/nova/NovaHome.tsx', 'src/components/nova/exchange-home/NovaExchangeHome.tsx']) {
    assert.doesNotMatch(read(file), /home-designs|HomeDesign|sampleData/, `${file} neither links nor imports the previews`);
  }
  assert.match(read('src/components/home-designs/HomeDesignLab.tsx'), /Design preview with sample data/, 'the preview says its data is sample data');
});

test('exchange home keeps Popular destinations available while sports load, with skeleton cards and no placeholder fixtures', () => {
  const view = renderHome();
  try {
    const home = view.document.querySelector('.nova-home');
    assert.equal(home.className, 'nova-home nova-center-home nova-ex-home');
    assert.equal(home.querySelector('.nova-ex-hero'), null, 'no advertisements configured: no hero, and no invented promotions');
    const popular = home.querySelector('nav.nova-ex-popular-nav');
    assert.ok(popular);
    assert.equal(home.querySelector('.nova-ex-main').firstElementChild, popular, 'Popular destinations lead when no promotions are configured');
    const links = [...popular.querySelectorAll('a')];
    assert.deepEqual(links.map(link => link.getAttribute('href')), ['/sports', '/matka', '/casino', '/slots']);
    assert.deepEqual(links.map(link => link.textContent.trim()), ['Sports', 'Matka', 'Live Casino', 'Slots']);
    assert.deepEqual(links.filter(link => link.getAttribute('aria-current') === 'page'), []);
    const inPlay = popular.querySelector('.nova-ex-sport-tabs').firstElementChild;
    assert.equal(inPlay.tagName, 'BUTTON');
    assert.equal(inPlay.textContent.trim(), translate('nova.inPlay'));
    assert.equal(inPlay.getAttribute('aria-pressed'), 'true');
    assert.equal(inPlay.getAttribute('aria-controls'), 'nova-ex-games');
    assert.ok(inPlay.classList.contains('active'));
    assert.ok(inPlay.querySelector('svg.lucide-radio'), 'the in-play entry uses a live broadcast icon');
    assert.equal(popular.querySelector('small'), null, 'product destinations do not show invented event counts');
    assert.equal(home.querySelector('[role="group"][aria-label="Discover sports"]'), null, 'the home strip now navigates products');
    const region = view.document.getElementById('nova-ex-games');
    assert.ok(region, 'real sport cards still have their own region');
    assert.equal(region.querySelectorAll('[aria-busy="true"] .nova-ex-card.is-skeleton').length, 3);
    assert.equal(home.querySelectorAll('.nova-ex-card:not(.is-skeleton)').length, 0);
    assert.equal(view.document.getElementById('nova-ex-upnext-title'), null, 'side lists wait for data instead of flashing placeholders');
    assert.equal(view.document.getElementById('nova-ex-leagues-title'), null);
    assert.doesNotMatch(home.textContent, placeholderPattern);
    assert.doesNotMatch(home.textContent, /10,000 credits/);
    assert.deepEqual([...home.querySelectorAll('[data-real-adapter]')].map(node => `${node.dataset.realAdapter}:${node.dataset.kind}`),
      ['casino-lounge:undefined', 'casino-strip:live', 'casino-strip:slots', 'matka-strip:undefined', 'casino-providers:undefined', 'casino-rail:default', 'casino-rail:slots'], 'the Casino Lounge leads the API-backed casino rows, Matka follows the slots row and the providers close (2026-10-30)');
    assert.equal(home.querySelector('[data-real-adapter="casino-catalogue"]'), null);
  } finally { view.close(); }
});

// The owner changed Casino Lounge into an admin-curated game collection (2026-10-30).
// Exercise the real loader: there must never be an unfiltered catalogue fallback.
function loungeHarness(respond) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { render, fireEvent } = require('@testing-library/react');
  const calls = [];
  const observed = {};
  const load = loader({
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    [path.join(root, 'src/lib/api/user.ts')]: {
      getCasinoGames: async input => { calls.push(JSON.parse(JSON.stringify(input))); return respond(input, calls.length); },
      getCasinoCategories: () => { throw new Error('Lounge must request its type directly, never guess category names'); },
    },
  }, { window: dom.window, document: dom.window.document, setTimeout, clearTimeout });
  const { useCasinoLoungeGames } = load('src/components/casino/useCasinoLoungeGames.ts');
  function Probe() {
    observed.current = useCasinoLoungeGames();
    return React.createElement('div');
  }
  const view = render(React.createElement(Probe));
  return { ...view, calls, fireEvent, get state() { return observed.current; }, close() { view.unmount(); dom.window.close(); } };
}
const loungeGame = (id, extra = {}) => ({ id: String(id), gameId: `external-${id}`, title: `Tenant game ${id}`, provider: 'Tenant provider', imageUrl: `/tenant-${id}.webp`, ...extra });
const loungePage = (data, hasMore = false) => ({ meta: { code: 200, hasMore }, data });

test('casino lounge requests only LOUNGE memberships across game types, paginates and deduplicates internal game IDs', async () => {
  const first = Array.from({ length: 14 }, (_, index) => loungeGame(index + 1));
  const view = loungeHarness(input => input.page === 1
    ? loungePage(first, true)
    : loungePage([first[0], loungeGame(15, { gameId: 'external-1', provider: 'Another provider' })]));
  try {
    await until(() => assert.equal(view.state.loading, false));
    assert.equal(view.state.error, null);
    assert.equal(view.state.items.length, 14);
    assert.equal(view.state.hasMore, true);
    assert.deepEqual(view.calls, [{ categoryType: 'LOUNGE', page: 1, limit: 14 }], 'no live-only, slots-only or name fallback filter');
    view.state.loadMore();
    await until(() => assert.equal(view.state.items.length, 15));
    assert.equal(view.state.hasMore, false);
    assert.deepEqual(Array.from(view.state.items, game => game.id), Array.from({ length: 15 }, (_, index) => String(index + 1)));
    assert.equal(view.state.items[14].gameId, 'external-1', 'different providers may share an external ID');
    assert.deepEqual(view.calls[1], { categoryType: 'LOUNGE', page: 2, limit: 14 });
  } finally { view.close(); }
});

test('casino lounge preserves an assigned Base64 image from its API through to the homepage card', async () => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const view = loungeHarness(() => loungePage([loungeGame(7, { imageUrl: image })]));
  try {
    await until(() => assert.equal(view.state.loading, false));
    assert.equal(view.state.items[0].image, image);
    const html = renderLounge({ items: view.state.items });
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(html);
    try { assert.equal(dom.window.document.querySelector('.lg-game-image').getAttribute('src'), image); }
    finally { dom.window.close(); }
  } finally { view.close(); }
});

test('casino lounge hides successful empty collections and never fills them from other categories', async () => {
  const view = loungeHarness(() => loungePage([]));
  try {
    await until(() => assert.equal(view.state.loading, false));
    assert.equal(view.state.items.length, 0);
    assert.equal(view.state.error, null);
    assert.equal(view.state.hasMore, false);
    assert.equal(view.calls.length, 1);
  } finally { view.close(); }
});

test('casino lounge exposes initial failures, retries only its category, and rejects unsuccessful or malformed API replies', async () => {
  for (const failure of [() => { throw new Error('offline'); }, () => ({ meta: { code: 403 }, data: [loungeGame('unassigned')] }), () => ({ meta: { code: 200 }, data: { games: [loungeGame('unassigned')] } })]) {
    const view = loungeHarness((input, call) => call === 1 ? failure() : loungePage([loungeGame('assigned')]));
    try {
      await until(() => assert.equal(view.state.loading, false));
      assert.ok(view.state.error);
      assert.equal(view.state.items.length, 0);
      view.state.retry();
      await until(() => assert.equal(view.state.items.length, 1));
      assert.equal(view.state.error, null);
      assert.equal(view.state.items[0].id, 'assigned');
      assert.deepEqual(view.calls, [{ categoryType: 'LOUNGE', page: 1, limit: 14 }, { categoryType: 'LOUNGE', page: 1, limit: 14 }]);
    } finally { view.close(); }
  }
});

test('casino lounge retains assigned games when another page fails and retries the failed page', async () => {
  const first = Array.from({ length: 14 }, (_, index) => loungeGame(index + 1));
  const view = loungeHarness((input, call) => {
    if (input.page === 1) return loungePage(first, true);
    if (call === 2) throw new Error('page unavailable');
    return loungePage([loungeGame(15)]);
  });
  try {
    await until(() => assert.equal(view.state.loading, false));
    view.state.loadMore();
    await until(() => assert.ok(view.state.error));
    assert.equal(view.state.items.length, 14);
    view.state.retry();
    await until(() => assert.equal(view.state.items.length, 15));
    assert.equal(view.state.error, null);
    assert.deepEqual(view.calls.map(call => call.page), [1, 2, 2]);
  } finally { view.close(); }
});

function renderLounge(state, launchIds = []) {
  const load = loader({
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    [path.join(root, 'src/components/casino/useCasinoLoungeGames.ts')]: { useCasinoLoungeGames: () => ({ items: [], loading: false, error: null, hasMore: false, loadMore() {}, retry() {}, ...state }) },
    [path.join(root, 'src/components/casino/useLaunchGame.ts')]: { useLaunchGame: gameId => { launchIds.push(gameId); return { launch() {}, loading: false, error: null }; } },
  });
  return renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' }, React.createElement(load('src/components/nova/exchange-home/CasinoLounge.tsx').default)));
}

test('casino lounge renders actual assigned game artwork and names, with honest loading, empty and retry states', () => {
  assert.equal(renderLounge({}), '', 'an empty curated collection is left out');
  assert.match(renderLounge({ loading: true }), /role="status"/);
  assert.match(renderLounge({ error: 'Collection unavailable' }), /role="alert"/);
  const launchIds = [];
  const html = renderLounge({ items: [{ id: 'selected-7', gameId: 'external-7', title: 'Admin selected table', provider: 'Real provider', image: '/selected-7.webp' }], hasMore: true }, launchIds);
  assert.deepEqual(launchIds, ['external-7'], 'the launch adapter receives the assigned game’s external ID');
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html);
  try {
    const cards = [...dom.window.document.getElementsByClassName('lg-portal')];
    assert.equal(cards.length, 1);
    assert.equal(cards[0].tagName, 'BUTTON', 'the whole card launches a real game');
    assert.equal(cards[0].querySelector('strong').textContent, 'Admin selected table');
    assert.match(cards[0].textContent, /Real provider/);
    assert.equal(cards[0].querySelector('.lg-game-image').getAttribute('src'), '/selected-7.webp');
    assert.equal(cards[0].querySelector('button, a, input, select, textarea'), null, 'no nested controls');
    assert.ok(dom.window.document.querySelector('button.lg-more'));
    assert.doesNotMatch(html, /live-roulette|live-blackjack|live-baccarat|live-teen-patti|top-casino/);
  } finally { dom.window.close(); }
});

// Game providers at the foot of the home (owner, 2026-10-30): every active provider from the API, original logos
// where we hold one, wordmarks for the rest. Client-rendered; polls read live class lists (JSDOM's selector engine kept
// answering null for a selector first asked before its element rendered).
async function until(check, timeout = 3000) {
  const end = Date.now() + timeout;
  for (;;) {
    try { return check(); } catch (error) { if (Date.now() > end) throw error; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
const byClass = (node, name) => [...node.getElementsByClassName(name)];
function providersHarness({ providers = [], totals = {}, fail = false } = {}) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html class="light"><body></body></html>', { url: 'http://localhost/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  // After the globals: React DOM decides at load whether the browser has input events, and with no window it
  // would fall back and ignore typing. (Waits use until(), not waitFor, which keeps the first window it sees.)
  const { render, fireEvent } = require('@testing-library/react');
  const { MemoryRouter, useLocation } = require('react-router-dom');
  const calls = { providers: 0, games: [] };
  const state = { fail };
  const api = {
    getCasinoProviders: async () => { calls.providers++; if (state.fail) throw new Error('down'); return { meta: { code: 200 }, data: providers.map(name => ({ name, slug: name.toLowerCase() })) }; },
    getCasinoGames: async input => { calls.games.push({ ...input, providers: [...input.providers] }); return { meta: { code: 200, total: (totals[input.providers[0]] || {})[input.slots ? 'slots' : 'live'] || 0 }, data: [] }; },
  };
  const t = (key, options = {}) => String(translate(key, options)).replace(/\{\{(\w+)\}\}/g, (_, name) => options[name] ?? '');
  const load = loader({ 'react-i18next': { useTranslation: () => ({ t }) }, [path.join(root, 'src/lib/api/user.ts')]: api }, { window: dom.window, document: dom.window.document, setTimeout, clearTimeout });
  const ProviderShowcase = load('src/components/nova/exchange-home/ProviderShowcase.tsx').default;
  const route = { current: '/' };
  function Where() { const location = useLocation(); route.current = location.pathname + location.search; return null; }
  const view = render(React.createElement(MemoryRouter, null, React.createElement(ProviderShowcase), React.createElement(Where)));
  return { ...view, calls, state, route, fireEvent, close() { view.unmount(); dom.window.close(); } };
}
const PLATFORM_PROVIDERS = ['PGSoft', 'Hacksaw', 'Evolution Gaming', 'wazdan', 'gg', 'Novomatic_Asia', 'Spinomenal', 'Evolution', "Play'n GO", 'iSoftBet/Roovo', ...Array.from({ length: 14 }, (_, index) => `Studio ${String.fromCharCode(65 + index)}`)];

// Owner, 2026-10-30: only the active studios we hold an original logo for; the rest stay off the home.
test('game providers show only active studios with an original logo, A to Z, and leave the rest out', async () => {
  const view = providersHarness({ providers: PLATFORM_PROVIDERS });
  try {
    // Named tiles only: the loading skeleton is unnamed .pv-tile blocks.
    const tiles = () => byClass(view.container, 'pv-tile').filter(tile => tile.getAttribute('aria-label'));
    await until(() => assert.equal(tiles().length, 5));
    assert.deepEqual(tiles().map(tile => tile.getAttribute('aria-label')), ['Evolution games', 'Evolution Gaming games', "Play'n GO games", 'Spinomenal games', 'Wazdan games'], 'logo holders only, A to Z');
    assert.ok(tiles().every(tile => /^\/src\/assets\/provider-logos\/[a-z-]+\.png$/.test(tile.getElementsByTagName('img')[0]?.getAttribute('src'))), 'every tile shows an original logo');
    assert.equal(byClass(view.container, 'nova-ex-section-count')[0].textContent, '5', 'the count is of the studios shown');
    assert.equal(tiles()[0].getAttribute('href'), '/casino?providers=Evolution');
    assert.equal(view.container.textContent.includes('PGSoft'), false, 'a studio without a logo is left out');
    assert.equal(view.container.getElementsByTagName('input').length + byClass(view.container, 'pv-more').length, 0, 'no search or Show all for a short list');
  } finally { view.close(); }
  const none = providersHarness({ providers: ['PGSoft', 'Hacksaw'] });
  try {
    await until(() => assert.equal(none.calls.providers, 1));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(byClass(none.container, 'pv').length, 0, 'no logo holder active: no section at all');
  } finally { none.close(); }
});

test('provider model: names as people write them, logo holders first, shared logos tagged', () => {
  const model = loader()('src/components/nova/exchange-home/providerModel.ts');
  assert.deepEqual(['wazdan', 'gg', 'Novomatic_Asia', 'PGSoft', 'iSoftBet/Roovo'].map(model.providerLabel), ['Wazdan', 'GG', 'Novomatic Asia', 'PGSoft', 'iSoftBet/Roovo']);
  const list = model.buildProviders(['PGSoft', 'wazdan', 'Evolution', 'PGSoft', ' ', 'gg'], { wazdan: '/w.png', evolution: '/e.png' });
  assert.deepEqual(list.map(entry => entry.label), ['Evolution', 'Wazdan', 'GG', 'PGSoft'], 'unique names, logo holders first, then A to Z');
  assert.ok(list.every(entry => !entry.tagged), 'a logo shown once needs no name tag');
  const twins = model.buildProviders(['Evolution', 'Evolution Gaming', 'Ezugi'], { evolution: '/e.png', evolutiongaming: '/e.png', ezugi: '/z.png' });
  assert.deepEqual(twins.map(entry => [entry.label, Boolean(entry.tagged)]), [['Evolution', true], ['Evolution Gaming', true], ['Ezugi', false]], 'two providers on one logo are told apart by a name tag');
});

test('a provider tile opens the lobby where that studio has more games, filtered to it; a failed list offers a retry', async () => {
  const view = providersHarness({ providers: ['Spinomenal', 'Evolution'], totals: { Spinomenal: { live: 2, slots: 532 }, Evolution: { live: 341, slots: 0 } } });
  try {
    await until(() => assert.equal(byClass(view.container, 'pv-tile').length, 2));
    const spinomenal = byClass(view.container, 'pv-tile').find(tile => tile.getAttribute('aria-label') === 'Spinomenal games');
    view.fireEvent.click(spinomenal, { button: 0 });
    await until(() => assert.equal(view.route.current, '/slots?providers=Spinomenal'));
    assert.deepEqual(view.calls.games.map(call => [call.providers[0], call.liveOnly ? 'live' : 'slots']), [['Spinomenal', 'live'], ['Spinomenal', 'slots']]);
  } finally { view.close(); }
  const evolution = providersHarness({ providers: ['Evolution'], totals: { Evolution: { live: 341, slots: 0 } } });
  try {
    await until(() => assert.equal(byClass(evolution.container, 'pv-tile').length, 1));
    evolution.fireEvent.click(byClass(evolution.container, 'pv-tile')[0], { button: 0 });
    await until(() => assert.equal(evolution.route.current, '/casino?providers=Evolution'));
  } finally { evolution.close(); }
  const failing = providersHarness({ providers: ['Evolution'], fail: true });
  try {
    await until(() => assert.equal(byClass(failing.container, 'pv-note')[0]?.getAttribute('role'), 'alert'));
    failing.state.fail = false;
    failing.fireEvent.click(byClass(failing.container, 'pv-note')[0].getElementsByTagName('button')[0]);
    await until(() => assert.equal(byClass(failing.container, 'pv-tile').length, 1));
    assert.equal(failing.calls.providers, 2);
  } finally { failing.close(); }
});

test('the lobbies follow ?providers= without bouncing the URL', () => {
  const hook = fs.readFileSync(path.join(root, 'src/components/casino/useProvidersParam.ts'), 'utf8');
  for (const page of ['src/pages/Casino.tsx', 'src/pages/Slots.tsx']) {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    assert.match(source, /= useProvidersParam\(\)/, `${page} keeps its provider filter in the URL through the shared hook`);
    assert.doesNotMatch(source, /params\.get\("providers"\)/, `${page} no longer syncs the URL by hand (the two effects ping-ponged)`);
  }
  // The write-back runs only when the selection changes, and compares before writing.
  assert.match(hook, /\}, \[providers, navigate\]\);/);
  assert.match(hook, /parse\(nextSearch\)\.join\(","\) !== parse\(search\)\.join\(","\)/);
});

test('whitelabel feature flags hide disabled sports and casino destinations', () => {
  const { load, render } = app({ features: { sportsEnabled: false, casinoEnabled: false } });
  const html = render(load('src/components/nova/NovaHome.tsx').default);
  assert.doesNotMatch(html, /data-real-adapter="sports"|data-real-adapter="casino|href="\/sports|href="\/casino/);
  assert.doesNotMatch(html, /cricket-light\.webp|Make it a matchday|THE GAME/);
  assert.match(html, /Find your next favourite/);
  assert.match(html, /href="\/settings"/);
});

test('home mounts Matka independently of sports and casino flags, in the main column after the slots row', () => {
  for (const sportsEnabled of [true, false]) {
    for (const casinoEnabled of [true, false]) {
      for (const matkaEnabled of [true, false]) {
        const view = renderHome({ features: { sportsEnabled, casinoEnabled, matkaEnabled, bonusesEnabled: true } });
        try {
          const home = view.document.querySelector('.nova-home');
          const strips = home.querySelectorAll('[data-real-adapter="matka-strip"]');
          assert.equal(strips.length, matkaEnabled ? 1 : 0, `sports=${sportsEnabled}, casino=${casinoEnabled}, matka=${matkaEnabled}`);
          if (!matkaEnabled) {
            assert.equal(home.querySelector('a[href="/matka"]'), null, 'disabled Matka has no home destination or mounted API adapter');
            continue;
          }
          const main = home.querySelector(sportsEnabled ? '.nova-ex-main' : '.nova-home-main');
          assert.equal(strips[0].parentElement, main, 'Matka shares the content column rather than the sidebar');
          if (sportsEnabled) {
            assert.ok(home.querySelector('#nova-ex-games').compareDocumentPosition(strips[0]) & view.Node.DOCUMENT_POSITION_FOLLOWING, 'the sports feed precedes Matka');
          }
          if (casinoEnabled && sportsEnabled) {
            // Owner 2026-10-30: Matka comes after the slots row, and the game providers stay at the bottom.
            const slots = home.querySelector('[data-real-adapter="casino-strip"][data-kind="slots"]');
            const providers = home.querySelector('[data-real-adapter="casino-providers"]');
            assert.ok(slots.compareDocumentPosition(strips[0]) & view.Node.DOCUMENT_POSITION_FOLLOWING, 'the slots row precedes Matka');
            assert.ok(strips[0].compareDocumentPosition(providers) & view.Node.DOCUMENT_POSITION_FOLLOWING, 'Matka precedes the game providers');
          } else if (casinoEnabled) {
            const casino = home.querySelector('.nova-casino-discovery');
            assert.ok(strips[0].compareDocumentPosition(casino) & view.Node.DOCUMENT_POSITION_FOLLOWING, 'without sports, Matka precedes casino discovery (that layout has no slots row)');
          }
        } finally { view.close(); }
      }
    }
  }
});

// Read the real home strip while isolating its query lifecycle. Any attempt to read a wallet or
// place a bet fails immediately; these cards are public catalogue navigation only.
function matkaStrip({ state = {}, auth = { user: null, isAuthenticated: false, isHydrating: false }, tenant = 'matka-tenant-one', response, interactive = false, enabled = true } = {}) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  dom.window.matchMedia = query => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} });
  const query = {};
  const apiCalls = [];
  let retries = 0;
  const result = { data: { meta: { code: 200 }, data: [] }, isPending: false, isLoading: false, isFetching: false, isError: false, error: null, refetch: () => { retries++; }, ...state };
  const api = new Proxy({ getMatkaMarkets: async input => { apiCalls.push(JSON.parse(JSON.stringify(input))); return response ?? result.data; } }, {
    get(target, name) {
      if (Object.hasOwn(target, name)) return target[name];
      throw new Error(`Home Matka must not access ${String(name)}`);
    },
  });
  const load = loader({
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    '@tanstack/react-query': { useQuery: options => { query.options = options; return result; } },
    [path.join(root, 'src/hooks/useAppSettings.ts')]: { useFeatureFlags: () => ({ matkaEnabled: enabled }) },
    [path.join(root, 'src/lib/api/matka.ts')]: api,
    [path.join(root, 'src/lib/auth.tsx')]: { useAuth: () => auth },
    [path.join(root, 'src/lib/whitelabel.ts')]: { getWhitelabelId: () => tenant },
  }, { window: dom.window, document: dom.window.document });
  const Strip = load('src/components/nova/exchange-home/MatkaStrip.tsx').default;
  if (!interactive) {
    dom.window.document.body.innerHTML = renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' }, React.createElement(Strip)));
    return { container: dom.window.document.body, query, apiCalls, get retries() { return retries; }, close: () => dom.window.close() };
  }
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { MemoryRouter, useLocation } = require('react-router-dom');
  const { render, fireEvent } = require('@testing-library/react');
  const route = {};
  function ObserveRoute() { route.pathname = useLocation().pathname; return null; }
  const view = render(React.createElement(MemoryRouter, null, React.createElement(ObserveRoute), React.createElement(Strip)));
  return { ...view, fireEvent, route, query, apiCalls, get retries() { return retries; }, close() { view.unmount(); dom.window.close(); } };
}

const homeMatkaMarket = (extra = {}) => ({
  id: 'catalogue-market-one', code: 'TENANT ONE / NIGHT', name: 'Tenant Night Market', kind: 'WORLI',
  description: null, timezone: 'Asia/Kolkata', runDate: '2026-10-30', quoteVersion: 'catalogue-version',
  status: 'Open', message: null, minStake: 25, maxStake: 5000, featured: false,
  sessions: [
    { side: 'OPEN', enabled: true, accepting: true, startsAt: '2026-10-30T08:00:00Z', lockAt: '2026-10-30T10:15:00Z', resultAt: '2026-10-30T10:30:00Z', status: 'Open' },
    { side: 'CLOSE', enabled: true, accepting: true, startsAt: '2026-10-30T08:00:00Z', lockAt: '2026-10-30T16:45:00Z', resultAt: '2026-10-30T17:00:00Z', status: 'Open' },
  ],
  rates: [{ bidType: 'SINGLE', label: 'Single digit', payoutMultiplier: 98765 }],
  result: { date: '2026-10-30', openResult: '123', closeResult: '456', openDigit: '6', closeDigit: '5', jodi: '65', complete: true },
  ...extra,
});
const homeMatkaPage = data => ({ meta: { code: 200, total: data.length, page: 1, hasMore: false }, data });

test('home Matka queries the real public catalogue, refreshes it and separates tenant and user caches', async () => {
  const guest = matkaStrip();
  const member = matkaStrip({ auth: { user: { id: 'player-one' }, isAuthenticated: true, isHydrating: false } });
  const otherMember = matkaStrip({ auth: { user: { id: 'player-two' }, isAuthenticated: true, isHydrating: false } });
  const otherTenant = matkaStrip({ tenant: 'matka-tenant-two' });
  const hydrating = matkaStrip({ auth: { user: null, isAuthenticated: false, isHydrating: true }, state: { isPending: true } });
  const pendingPlayer = matkaStrip({ auth: { user: { id: '' }, isAuthenticated: true, isHydrating: false }, state: { isPending: true } });
  try {
    const options = guest.query.options;
    assert.equal(options.enabled, true, 'a guest can load the public market catalogue');
    assert.equal(options.refetchInterval, 15000);
    assert.equal(options.staleTime, 5000);
    assert.equal(hydrating.query.options.enabled, false, 'wait for auth hydration before choosing a cache owner');
    assert.equal(pendingPlayer.query.options.enabled, false, 'an authenticated account without an ID does not read another account cache');
    assert.match(JSON.stringify(options.queryKey), /matka-tenant-one/);
    assert.match(JSON.stringify(member.query.options.queryKey), /player-one/);
    const keys = [guest, member, otherMember, otherTenant].map(view => JSON.stringify(view.query.options.queryKey));
    assert.equal(new Set(keys).size, 4, 'neither tenant nor player changes reuse another owner’s cache');
    const page = await options.queryFn();
    assert.deepEqual(guest.apiCalls, [{ page: 1, limit: 12 }], 'the home requests a small page of real markets, without invented catalogue data');
    assert.deepEqual(page, { meta: { code: 200 }, data: [] });
    assert.equal(hydrating.container.querySelector('a.nova-ex-matka-card'), null);
  } finally { for (const view of [guest, member, otherMember, otherTenant, hydrating, pendingPlayer]) view.close(); }
});

test('disabled home Matka never mounts its query, and malformed or unsuccessful catalogue responses are rejected', async () => {
  const disabled = matkaStrip({ enabled: false });
  try {
    assert.equal(disabled.container.textContent, '');
    assert.equal(disabled.query.options, undefined, 'the disabled feature mounts no query or catalogue UI');
    assert.deepEqual(disabled.apiCalls, []);
  } finally { disabled.close(); }
  for (const response of [{ meta: { code: 500 }, data: [] }, { meta: { code: 200 }, data: null }, {}]) {
    const view = matkaStrip({ response });
    try { await assert.rejects(view.query.options.queryFn(), /catalogue/i); }
    finally { view.close(); }
  }
});

test('home Matka cards preserve market identity, API results and market-local cutoff times', () => {
  const first = homeMatkaMarket();
  const second = homeMatkaMarket({ id: 'fallback / id', code: '', name: 'Tenant UTC Market', timezone: 'UTC', status: 'Closed' });
  const view = matkaStrip({ state: { data: homeMatkaPage([first, second]) } });
  try {
    const header = view.container.querySelector('.nova-ex-nameplate');
    assert.equal(header.querySelector('h2').textContent, 'Matka');
    assert.equal(header.querySelector('a.nova-ex-section-all').getAttribute('href'), '/matka');
    const cards = [...view.container.querySelectorAll('a.nova-ex-matka-card')];
    assert.equal(cards.length, 2, 'each API market appears once');
    assert.deepEqual(cards.map(card => card.getAttribute('href')), [`/matka/markets/${encodeURIComponent(first.code)}`, `/matka/markets/${encodeURIComponent(second.id)}`]);
    assert.match(cards[0].textContent, /Tenant Night Market/);
    assert.match(cards[0].textContent, /Open/);
    assert.match(cards[1].textContent, /Closed/);
    for (const card of cards) {
      assert.match(card.textContent, /123/);
      assert.match(card.textContent, /65/);
      assert.match(card.textContent, /456/);
    }
    assert.match(cards[0].textContent, /03:45\s*pm/i, 'open cutoff comes from lockAt in the market timezone');
    assert.match(cards[0].textContent, /10:15\s*pm/i, 'close cutoff comes from lockAt in the market timezone');
    assert.match(cards[1].textContent, /10:15\s*am/i, 'another market uses its own timezone');
    assert.match(cards[1].textContent, /04:45\s*pm/i);
    assert.doesNotMatch(cards[0].textContent, /04:00\s*pm|10:30\s*pm/i, 'resultAt is not mislabeled as the cutoff');
    assert.doesNotMatch(view.container.textContent, /98765|5000|winning|guaranteed|1:/i, 'home does not invent wins or advertise payout numbers');
    assert.equal(view.container.querySelector('input, form, a[href*="wallet"]'), null, 'the home cards remain catalogue navigation');
  } finally { view.close(); }
});

test('home Matka uses native detail navigation for guests and an honest awaiting message when no result exists', () => {
  const market = homeMatkaMarket({ result: { date: '2026-10-30', openResult: null, closeResult: null, openDigit: null, closeDigit: null, jodi: null, complete: false } });
  const view = matkaStrip({ state: { data: homeMatkaPage([market]) }, interactive: true });
  try {
    const card = view.container.querySelector('a.nova-ex-matka-card');
    assert.ok(card);
    assert.match(card.textContent, /awaiting|pending|not published/i);
    assert.doesNotMatch(card.textContent, /123|456|\*\*\*/);
    view.fireEvent.click(card);
    assert.equal(view.route.pathname, `/matka/markets/${encodeURIComponent(market.code)}`, 'a guest opens the real details route without login or betting calls');
  } finally { view.close(); }
});

test('home Matka loading, empty and failed requests have honest states and a working retry', () => {
  const loading = matkaStrip({ state: { data: undefined, isPending: true, isLoading: true } });
  const empty = matkaStrip();
  const failed = matkaStrip({ state: { data: undefined, isError: true, error: new Error('secret backend catalogue error') }, interactive: true });
  try {
    assert.ok(loading.container.querySelector('[role="status"]'), 'loading is announced');
    assert.ok(loading.container.querySelector('.nova-ex-matka-loading i'), 'loading shows a skeleton rather than invented markets');
    assert.equal(loading.container.querySelector('a.nova-ex-matka-card'), null, 'skeletons are not fake markets');
    assert.ok(empty.container.querySelector('[role="status"]'), 'successful empty data has a status message');
    assert.equal(empty.container.querySelector('[role="alert"], a.nova-ex-matka-card'), null);
    const alert = failed.container.querySelector('[role="alert"]');
    assert.ok(alert);
    assert.doesNotMatch(alert.textContent, /secret backend catalogue error/);
    assert.equal(failed.container.querySelector('a.nova-ex-matka-card'), null);
    const retry = alert.querySelector('button');
    assert.ok(retry);
    failed.fireEvent.click(retry);
    assert.equal(failed.retries, 1);
    for (const view of [loading, empty, failed]) assert.doesNotMatch(view.container.textContent, /Tenant Night Market|123|456/);
  } finally { for (const view of [loading, empty, failed]) view.close(); }
});

test('configured advertisements render once before Popular navigation and content in both homepage branches', () => {
  const ads = [{ image: '/configured-ad.webp', title: 'Configured offer', url: '/bonus' }, { image: '/second-configured-ad.webp', title: 'Second offer' }, { image: '/phone-only-ad.webp', title: 'Phone offer', deviceType: 'MOBILE' }];
  for (const sportsEnabled of [true, false]) {
    for (const casinoEnabled of [true, false]) {
      const view = renderHome({ features: { sportsEnabled, casinoEnabled, bonusesEnabled: true }, ads });
      try {
        const home = view.document.querySelector('.nova-home');
        if (sportsEnabled) {
          // The exchange home carries advertisements in its hero, ahead of Popular navigation.
          const heroes = home.querySelectorAll('.nova-ex-hero');
          assert.equal(heroes.length, 1, 'configured advertisements have exactly one homepage slot');
          assert.equal(home.querySelector('.nova-ex-main').firstElementChild, heroes[0], 'the promotions slot precedes all center content');
          assert.equal(heroes[0].getAttribute('aria-label'), translate('nova.platformPromotions'));
          // One complete full-width slide per advertisement, with overlay navigation and no bottom rail.
          const slides = [...heroes[0].querySelectorAll('.nova-ex-hero-ad')];
          assert.deepEqual(slides.map(slide => slide.querySelector('img').getAttribute('alt')), ['Configured offer', 'Second offer'], 'only the configured advertisements, in order');
          assert.ok(slides[0].classList.contains('is-active'), 'the first advertisement shows first');
          assert.equal(heroes[0].querySelector('.nova-ex-hero-rail, .nova-ex-hero-tabs'), null, 'no control rail under the banner');
          assert.ok(heroes[0].querySelector('button.nova-promo-previous'), 'the carousel offers previous-promotion navigation');
          const nextPromotion = heroes[0].querySelector('button.nova-promo-next');
          assert.ok(nextPromotion, 'the next control advances the full-width carousel');
          assert.equal(heroes[0].querySelector('.nova-promo-peek, .nova-promo-heading, .nova-promo-next-cover'), null, 'one banner fills the section without side previews or an editorial sidebar');
          assert.equal(slides.filter(slide => slide.classList.contains('is-active')).length, 1, 'exactly one complete advertisement is active');
          const lighting = heroes[0].querySelector('.nova-promo-stage .nova-promo-lighting');
          assert.ok(lighting, 'the torch effect stays over the artwork');
          assert.equal(lighting.getAttribute('aria-hidden'), 'true', 'decorative lighting is hidden from assistive technology');
          assert.equal(lighting.querySelectorAll('.nova-promo-beam').length, 2, 'both torch beams are present');
          assert.ok(lighting.querySelector('.nova-promo-touch-light'), 'the interactive light is present');
          assert.ok(!slides.some(slide => slide.querySelector('img').getAttribute('alt') === 'Phone offer'), 'a phone-only advertisement is not shown on desktop');
          assert.equal(home.querySelectorAll('img[src="/configured-ad.webp"]').length, 1, 'the current advertisement is shown once');
          assert.equal(heroes[0].querySelector('a.nova-ex-hero-ad').getAttribute('href'), '/bonus');
          assert.equal(home.querySelectorAll('[data-real-adapter="advertisements"]').length, 0, 'there is no duplicate lower banner adapter');
          const navigation = home.querySelector('nav.nova-ex-popular-nav');
          assert.ok(navigation, 'Popular navigation remains present');
          assert.ok(heroes[0].compareDocumentPosition(navigation) & view.Node.DOCUMENT_POSITION_FOLLOWING);
        } else {
          const banners = home.querySelectorAll('.nova-promotions');
          assert.equal(banners.length, 1, 'configured advertisements have exactly one homepage slot');
          assert.equal(home.firstElementChild, banners[0], 'existing banner slot precedes all center content');
          assert.equal(banners[0].getAttribute('aria-label'), translate('nova.platformPromotions'));
          assert.equal(banners[0].querySelectorAll('[data-real-adapter="advertisements"]').length, 1, 'the original Banners adapter is mounted once');
          assert.equal(home.querySelectorAll('[data-real-adapter="advertisements"]').length, 1, 'there is no duplicate lower banner adapter');
          const heading = home.querySelector('.nova-page-heading');
          assert.ok(heading, 'the original branch heading remains present');
          assert.ok(banners[0].compareDocumentPosition(heading) & view.Node.DOCUMENT_POSITION_FOLLOWING);
          const navigation = home.querySelector('nav.nova-ex-popular-nav');
          assert.ok(navigation, 'Popular destinations remain available when sports are disabled');
          assert.ok(banners[0].compareDocumentPosition(navigation) & view.Node.DOCUMENT_POSITION_FOLLOWING);
          assert.ok(navigation.compareDocumentPosition(heading) & view.Node.DOCUMENT_POSITION_FOLLOWING);
        }
      } finally { view.close(); }
    }
  }
});

test('empty or image-less advertisement settings do not mount an advertisement in either branch', () => {
  for (const sportsEnabled of [true, false]) {
    for (const ads of [[], [{ image: '' }, { title: 'Not an image', url: '/bonus' }]]) {
      const view = renderHome({ features: { sportsEnabled, casinoEnabled: true, bonusesEnabled: true }, ads });
      try {
        assert.doesNotMatch(view.html, /data-real-adapter="advertisements"/);
        assert.doesNotMatch(view.html, /class="nova-promotions(?:\s|")/);
        assert.doesNotMatch(view.html, /nova-ex-hero-ad|Not an image/, 'an image-less advertisement never becomes a slide');
        assert.doesNotMatch(view.html, /class="nova-ex-hero"/, 'and no hero is invented in its place');
        assert.doesNotMatch(view.document.body.textContent, placeholderPattern);
        assert.ok(view.document.querySelector('nav.nova-ex-popular-nav'), 'Popular navigation remains available without advertisements');
      } finally { view.close(); }
    }
  }
});

test('hero promotions are the configured advertisements only and never link a bonus page the player cannot open', () => {
  const credit = { isAuthenticated: true, user: { playerType: 'AGENT_CREDIT' }, openAuthModal() {} };
  const ads = [{ id: 'bonus-ad', image: '/bonus-ad.webp', title: 'Bonus offer', url: '/bonus' }, { id: 'sports-ad', image: '/sports-ad.webp', title: 'Sports offer', url: '/sports' }];
  for (const [bonusesEnabled, auth, linked] of [[true, undefined, true], [false, undefined, false], [true, credit, false]]) {
    const view = renderHome({ features: { sportsEnabled: true, casinoEnabled: true, bonusesEnabled }, auth, ads });
    try {
      const hero = view.document.querySelector('.nova-ex-hero');
      assert.deepEqual([...hero.querySelectorAll('.nova-ex-hero-ad img')].map(image => image.getAttribute('alt')), ['Bonus offer', 'Sports offer'], 'nothing is added to the configured advertisements');
      assert.equal(hero.querySelectorAll('img[src="/bonus-ad.webp"]').length, 1, 'the advertisement itself still shows');
      assert.equal(Boolean(hero.querySelector('a[href="/bonus"]')), linked, linked ? 'bonus destination is open to this player' : 'no link to a bonus page this player cannot open');
      assert.doesNotMatch(view.document.body.textContent, placeholderPattern);
    } finally { view.close(); }
    const empty = renderHome({ features: { sportsEnabled: true, casinoEnabled: true, bonusesEnabled }, auth });
    try {
      assert.equal(empty.document.querySelector('.nova-ex-hero'), null, 'no advertisements: no hero in any bonus configuration');
    } finally { empty.close(); }
  }
});

test('signed-out sports desk stays focused on matches without duplicating a wallet stack', () => {
  const { load, render } = app();
  const html = render(load('src/components/nova/NovaWorkspace.tsx').NovaMatchDesk);
  assert.doesNotMatch(html, /Sign in to view your actual balance|<dl>|href="\/deposit"|nova-wallet-card/);
  assert.match(html, /nova-desk-session/);
});

test('cash player balance is not repeated inside the sports match desk', () => {
  const { load, render } = app({ auth: { isAuthenticated: true, user: { balance: 123.45, exposure: -20 }, openAuthModal() {} } });
  const html = render(load('src/components/nova/NovaWorkspace.tsx').NovaMatchDesk);
  assert.doesNotMatch(html, /Main balance|123\.45|Open exposure|20\.00|href="\/statements"|href="\/deposit"/);
  assert.match(html, /href="\/settings"/);
});

test('credit account values are not repeated inside the sports match desk', () => {
  const { load, render } = app({ auth: { isAuthenticated: true, user: { playerType: 'AGENT_CREDIT', creditAvailable: 750, balance: 999, exposure: 25 }, openAuthModal() {} }, settings: { hideDW: true } });
  const html = render(load('src/components/nova/NovaWorkspace.tsx').NovaMatchDesk);
  assert.doesNotMatch(html, /Available credit|750\.00|999\.00|href="\/deposit"|href="\/withdrawal"/);
  assert.match(html, /href="\/settings"/);
});

test('account panel keeps funding shortcuts behind both tenant and credit-account guards', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/nova/AccountLinks.tsx'), 'utf8');
  assert.match(source, /!settings\.hideDW && !isCreditPlayer/);
});

test('utility rail respects sports flag and native dialog is accessibly named', () => {
  const { load, render } = app({ features: { sportsEnabled: false, casinoEnabled: true } });
  const html = render(load('src/components/nova/NovaWorkspace.tsx').NovaUtilityRail);
  assert.match(html, /aria-label="Preferences"/);
  assert.match(html, /<dialog[^>]+aria-label="Workspace panel"/);
  assert.doesNotMatch(html, /aria-label="Match centre"/);
  assert.match(html, /href="\/my-bets"/, "accepted Sports/Matka bets remain accessible when sports is disabled");
});

test('mobile navigation exposes a labelled dialog trigger', () => {
  const { load, render } = app();
  const html = render(load('src/components/nova/NovaWorkspace.tsx').NovaNavigationButton);
  const source = fs.readFileSync(path.join(root, 'src/components/nova/NovaWorkspace.tsx'), 'utf8');
  assert.match(html, /aria-label="Open navigation"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(source, /view === 'navigation'[\s\S]*?nova-panel-mobile-theme[\s\S]*?<ThemeSwitch/);
});

test('theme button labels the next action and reflects the applied mode, even with blocked storage', () => {
  const environment = themeEnvironment({}, true);
  environment.theme.setThemeMode('dark');
  const load = loader({}, environment.globals);
  const html = renderToStaticMarkup(React.createElement(load('src/components/ThemeSwitch.tsx').default));
  assert.match(html, /aria-label="Switch to light theme"/);
  assert.match(html, /aria-pressed="true"/);
});

test('startup stays light and final refresh uses semantic surfaces, accessible controls and reduced motion', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/styles/nova.css'), 'utf8');
  const refresh = fs.readFileSync(path.join(root, 'src/styles/panel-refresh.css'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
  assert.match(html, /<html[^>]+class="light"/);
  assert.match(html, /href="\/nova\/favicon\.svg"/);
  assert.match(html, /<title>%VITE_API_APP_NAME%<\/title>/);
  for (const selector of [':root:not(.dark)', ':root.dark', '.nova-navigation-panel', '(max-width: 639px)', '(prefers-reduced-motion: reduce)']) assert.ok(css.includes(selector), selector);
  assert.ok(main.indexOf("'./styles/panel-refresh.css'") > main.indexOf("'./styles/nova.css'"), 'final refresh follows the legacy base');
  for (const rule of ['background: var(--surface)', 'color: var(--text)', 'min-height: 44px', 'grid-template-columns: minmax(0, 1fr)', '.nova-mobile-bets-dialog', '(prefers-reduced-motion: reduce)']) assert.ok(refresh.includes(rule), rule);
  assert.match(css, /--background: var\(--background-dark\)/);
  for (const asset of ['cricket-light.webp', 'football-light.webp', 'tennis-light.webp']) assert.ok(fs.statSync(path.join(root, 'public/nova', asset)).size > 1000);
});

test('NOVA translations have identical keys in every supported locale', () => {
  const resources = ['en', 'hi', 'ta', 'te'].map(language => loader()(`src/lib/i18n/locales/${language}.ts`)[language].translation.nova);
  const expected = Object.keys(resources[0]).sort();
  for (const resource of resources) {
    assert.deepEqual(Object.keys(resource).sort(), expected);
    for (const value of Object.values(resource)) assert.equal(typeof value, 'string');
  }
});

test('footer translations have identical native key coverage in every supported locale', () => {
  const resources = ['en', 'hi', 'ta', 'te'].map(language =>
    loader()(`src/lib/i18n/locales/${language}.ts`)[language].translation.footer
  );
  const expected = Object.keys(resources[0]).sort();
  for (const resource of resources) {
    assert.deepEqual(Object.keys(resource).sort(), expected);
    for (const value of Object.values(resource)) assert.equal(typeof value, 'string');
  }
});

test('NOVA accessibility copy is translated instead of hardcoded in components', () => {
  const home = fs.readFileSync(path.join(root, 'src/components/nova/NovaHome.tsx'), 'utf8');
  const workspace = fs.readFileSync(path.join(root, 'src/components/nova/NovaWorkspace.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(root, 'src/components/Sidebar.tsx'), 'utf8');
  for (const literal of ['Platform promotions', 'Discover sports', 'Helpful guides', 'Casino discovery', 'Frequently asked questions', 'Workspace shortcuts', 'Main navigation', 'Sidebar navigation']) {
    assert.equal(home.includes(`aria-label="${literal}"`) || workspace.includes(`aria-label="${literal}"`) || sidebar.includes(`aria-label="${literal}"`), false, literal);
  }
});

test('light neutral sports and casino controls do not use white text', () => {
  const noWhiteText = [
    'src/components/sports/SportsTabs.tsx',
    'src/components/sports/EventsList.tsx',
    'src/components/sports/LeagueAccordion.tsx',
    'src/components/sports/TopSportsSlider.tsx',
    'src/components/sport-event/MarketHeader.tsx',
    'src/components/casino/CasinoSearch.tsx',
  ];
  for (const relative of noWhiteText) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /text-white/, relative);
  }
  // The event header is the dark matchbook bar: its light text comes from the page stylesheet with the bar colour, never a bare utility.
  const eventHeader = fs.readFileSync(path.join(root, 'src/components/sport-event/EventHeader.tsx'), 'utf8');
  const eventCss = fs.readFileSync(path.join(root, 'src/components/sport-event/nova-sports-event.css'), 'utf8');
  assert.match(eventHeader, /className="nova-ev-head"/);
  assert.doesNotMatch(eventHeader, /text-white/);
  assert.match(eventCss, /\.nova-ev-head \{[^}]*color: #FFFFFF; background: var\(--ex-bar\)/);
});

test('league toggles expose their expanded state and controlled region', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/sports/SportsEvents.tsx'), 'utf8');
  assert.match(source, /aria-expanded=\{!isCollapsed\}/);
  assert.match(source, /aria-controls=\{leagueRegionId\}/);
  assert.match(source, /id=\{leagueRegionId\}/);
});

test('workspace package exposes NOVA regression tests through its standard test script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'npm run test:nova');
});

test('mobile navigation hides sports and bet slip together when sports is disabled', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/MobileTabBar.tsx'), 'utf8');
  assert.match(source, /tab\.key === 'sports' \|\| tab\.key === 'bet-slip'/);
  assert.match(source, /return features\.sportsEnabled/);
});

test('tablet header keeps one responsive logo while desktop sidebar owns its logo', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/Topbar.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(root, 'src/components/Sidebar.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/styles/nova.css'), 'utf8');
  assert.equal((source.match(/<Logo className="nova-header-logo"/g) || []).length, 1);
  assert.match(sidebar, /hidden min-\[801px\]:flex/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*?\.nova-header-logo \{ display: flex/);
  assert.doesNotMatch(source, /Logo Row - Only visible on mobile/);
});

// The owner put Home/Sports/Live Casino/Slots inline in the header (2026-10-15), then moved them to the
// sidebar's Popular section (2026-10-29); the sidebar links are checked by the rendered sidebar tests.
test('Matchbook header keeps one search control and its account controls, with no product links', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/Topbar.tsx'), 'utf8');
  assert.equal((source.match(/aria-label=\{t\('nova\.searchTeamsMarkets'\)\}/g) || []).length, 1, 'one search control, whatever the width');
  assert.match(source, /className=\{`nova-header-search \$\{phoneHeader \? "nova-mobile-search" : "nova-desktop-search"\}`\}/);
  assert.doesNotMatch(source, /<nav className="nova-matchbook-product-nav"/);
  assert.match(source, /className="nova-wallet-summary"/);
  assert.match(source, /className="nova-header-primary"/);
  assert.doesNotMatch(source, /const navItems = useMemo/);
});

test('sidebar sports tree has no invented IPL fallback matches', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/sidebar/SportsList.tsx'), 'utf8');
  assert.doesNotMatch(source, /Chennai vs Rajasthan|Mumbai vs Bengaluru/);
  assert.match(source, /sportsError|noSportsAvailable/);
});

test('desktop sidebar follows the Matchbook hierarchy without a duplicate search or boxed SPORTS live bar', () => {
  const sidebar = fs.readFileSync(path.join(root, 'src/components/Sidebar.tsx'), 'utf8');
  const sportsList = fs.readFileSync(path.join(root, 'src/components/sidebar/SportsList.tsx'), 'utf8');

  assert.doesNotMatch(`${sidebar}\n${sportsList}`, /type=["']search["']|<Search\b|Search sports/);
  assert.doesNotMatch(sidebar, /SPORTS section bar|<Circle(?:\s|>)/);
  // Popular (the product links), then All Sports A-Z; the owner removed the Matka, Casino and Help sections
  // (2026-10-29). The rendered gates are checked below.
  const order = ['sidebar.popular', 'sidebar.allSports'].map(key => sidebar.indexOf(`t("${key}"`));
  assert.ok(order.every(index => index > 0), 'every section is headed');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'sections keep the Matchbook order');
  assert.doesNotMatch(sidebar, /t\("(?:nav\.casino|sidebar\.help)"|nova\.helpSupport|to=["']\/settings["']|\/matka\/my-bets/);
});

test('sidebar sports navigation is a native compact priority tree without legacy tile or image adapters', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/sidebar/SportsList.tsx'), 'utf8');
  assert.match(source, /<details\b/);
  assert.match(source, /<summary\b/);
  assert.match(source, /nova\.allSports/);
  assert.doesNotMatch(source, /\bNavItem\b|assets\/images\/|createImgIcon|sport-img-sidebar/);

  const priorityDeclaration = source.match(/const\s+\w*priority\w*\s*=\s*\[[\s\S]*?\]/i)?.[0];
  assert.ok(priorityDeclaration, 'a named priority-sports list should drive the compact sidebar');
  for (const sport of ['cricket', 'football', 'tennis', 'basketball', 'horseracing']) {
    assert.ok(priorityDeclaration.includes(sport), `priority sidebar includes ${sport}`);
  }
});

test('home casino rows stay compact, behind the casino flag, and omit the full catalogue', () => {
  const home = fs.readFileSync(path.join(root, 'src/components/nova/NovaHome.tsx'), 'utf8');
  const exchange = fs.readFileSync(path.join(root, 'src/components/nova/exchange-home/NovaExchangeHome.tsx'), 'utf8');
  const slider = fs.readFileSync(path.join(root, 'src/components/casino/TopCasinoSlider.tsx'), 'utf8');
  const exchangeStart = home.indexOf('nova-home nova-center-home nova-ex-home');
  assert.ok(exchangeStart >= 0, 'exchange sports branch exists');
  assert.match(home.slice(exchangeStart), /<NovaExchangeHome \/>/);
  // Sports off: the account branch keeps the four-card compact slider.
  assert.match(home.slice(0, exchangeStart), /features\.casinoEnabled && <section className="nova-casino-discovery"[\s\S]*?<TopCasinoSlider\s+compact\s*\/>/);
  assert.match(slider, /compact\s*\?\s*items\.slice\(0,\s*4\)\s*:\s*items/);
  // Sports on: the Casino Lounge, one live-casino and one slots row, then Matka, then the game providers (2026-10-30)
  // in the main column; featured rails in the side column.
  assert.match(exchange, /\{features\.casinoEnabled && <>\s*<CasinoLounge \/>\s*<GameStrip kind="live"[^>]*\/>\s*<GameStrip kind="slots"[^>]*\/>\s*<\/>\}[\s\S]*?\{features\.matkaEnabled && <MatkaStrip \/>\}\s*\{features\.casinoEnabled && <ProviderShowcase \/>\}/);
  assert.match(exchange, /features\.casinoEnabled\s*\?\s*<>\s*<FeaturedGameRail variant="default"[^>]*\/>\s*<FeaturedGameRail variant="slots"[^>]*\/>/);
  assert.doesNotMatch(`${home}\n${exchange}`, /<UserGamesSection\b/);
});

// The home casino rows with their API hooks stubbed: real games only, honest empty / error lines.
function casinoRow(file, { list, featured } = {}) {
  const load = loader({
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    [path.join(root, 'src/components/casino/useCasinoGameList.ts')]: { useCasinoGameList: () => list },
    [path.join(root, 'src/components/casino/useFeaturedCasinoGames.ts')]: { useFeaturedCasinoGames: () => featured },
    [path.join(root, 'src/components/casino/useLaunchGame.ts')]: { useLaunchGame: () => ({ launch() {}, loading: false, error: null }) },
  }, { window: serverWindow() });
  const Component = load(file).default;
  return props => renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' }, React.createElement(Component, props)));
}
const tenantGame = { key: 'tenant-1-0', title: 'Tenant table', provider: 'Tenant provider', image: '/tenant.webp', gameId: 'tenant-1' };

test('home game strips show only API games: loading holds the row, an empty list is one line', () => {
  const strip = 'src/components/nova/exchange-home/GameStrip.tsx';
  for (const [kind, key] of [['live', 'nova.noTopCasino'], ['slots', 'nova.noTopSlots']]) {
    const html = casinoRow(strip, { list: { items: [], loading: false } })({ kind, title: 'Row', allTo: '/casino' });
    assert.match(html, new RegExp(`<p class="nova-ex-section-note" role="status">${translate(key)}</p>`));
    assert.doesNotMatch(html, /nova-ex-tile|nova-ex-section-arrows/, 'no stand-in tiles and no scroll arrows over nothing');
    assert.doesNotMatch(html, placeholderPattern);
    assert.match(html, /href="\/casino"/, 'See All still opens the lobby');
  }
  const loading = casinoRow(strip, { list: { items: [], loading: true } })({ kind: 'live', title: 'Row', allTo: '/casino' });
  assert.equal((loading.match(/nova-ex-tile is-skeleton/g) || []).length, 8, 'skeleton tiles hold the row height while loading');
  assert.doesNotMatch(loading, /role="status"/);
  const real = casinoRow(strip, { list: { items: [tenantGame], loading: false } })({ kind: 'live', title: 'Row', allTo: '/casino' });
  assert.match(real, /<button type="button" class="nova-ex-tile"/, 'a real game launches');
  assert.match(real, /Tenant table/);
  assert.doesNotMatch(real, /nova-ex-section-note/);
});

test('featured casino rails show only the admin featured category: none is left out, a failure says so', () => {
  const rail = 'src/components/nova/exchange-home/FeaturedGameRail.tsx';
  const props = { variant: 'default', title: 'Live Casino', seeAllTo: '/casino' };
  assert.equal(casinoRow(rail, { featured: { items: [], loading: false, error: null } })(props), '', 'no featured category: the rail is left out');
  const failed = casinoRow(rail, { featured: { items: [], loading: false, error: 'Casino offline' } })(props);
  assert.match(failed, new RegExp(`<p class="nova-ex-section-note" role="alert">${translate('nova.casinoLoadError').replace(/\./g, '\\.')}</p>`));
  assert.doesNotMatch(failed, /nova-ex-slide|Casino offline/);
  assert.doesNotMatch(failed, placeholderPattern);
  const loading = casinoRow(rail, { featured: { items: [], loading: true, error: null } })(props);
  assert.match(loading, /nova-ex-games-skeleton/, 'the skeleton holds the rail while loading');
  const real = casinoRow(rail, { featured: { items: [{ title: 'Tenant table', provider: 'Tenant provider', image: '/tenant.webp', game_id: 'tenant-1' }], loading: false, error: null } })(props);
  assert.match(real, /class="nova-ex-slide-art"/);
  assert.match(real, /Tenant table/);
  assert.doesNotMatch(real, /nova-ex-section-note|<a [^>]*class="nova-ex-slide-art"/, 'a real game launches; nothing opens a lobby in its place');
});

test('event analytics show no invented prices before the market has priced', () => {
  const load = loader({ 'react-i18next': { useTranslation: () => ({ t: translate }) } });
  const render = (file, props) => renderToStaticMarkup(React.createElement(load(`src/components/sport-event/${file}.tsx`).default, props));
  const note = new RegExp(`role="status">${translate('eventAnalytics.noPriceData').replace(/\./g, '\\.')}<`);
  const widgets = {
    MomentumIndicator: { homeTeam: 'Home', awayTeam: 'Away', momentumData: [], currentMomentum: 0 },
    OddsMovementGraph: { data: [], selection: 'Match Odds' },
    MarketDepthChart: { backDepth: [], layDepth: [], selection: 'Match Odds' },
    WinProbabilityMeter: { homeTeam: 'Home', awayTeam: 'Away', homeProbability: 0, awayProbability: 0 },
  };
  for (const [file, props] of Object.entries(widgets)) {
    const html = render(file, props);
    assert.match(html, note, `${file} says there is no price data`);
    // Chart markup (the odds line's 600-wide plot, the meter's arcs) and the old stand-in values never appear.
    assert.doesNotMatch(html, /viewBox="0 0 600|stroke-dasharray|50%|2\.50|12K|Balanced|Last 10 minutes/, `${file} draws no invented values`);
  }
  const depth = render('MarketDepthChart', { backDepth: [{ price: 1.9, volume: 300 }], layDepth: [], selection: 'Match Odds' });
  assert.match(depth, /1\.90/, 'a real one-sided ladder is shown as it is');
  assert.doesNotMatch(depth, /2\.46|2\.56/, 'and is not padded with invented levels');
});

test('sports match desk keeps one compact session shortcut without duplicating wallet balances', () => {
  const { load, render } = app();
  const html = render(load('src/components/nova/NovaWorkspace.tsx').NovaMatchDesk);
  assert.equal((html.match(/class="nova-desk-session"/g) || []).length, 1);
  assert.match(html, /nova-desk-card nova-slip-card/);
  assert.match(html, /nova-desk-card nova-quick-card/);
  assert.match(html, /href="\/settings"/);
  assert.doesNotMatch(html, /nova-wallet-card|Sign in to view your actual balance|<dl>/);
});

test('home sports API failures do not replace real events with NOVA/mock matches', () => {
  // The request moved into the shared hook that SportsEvents and the exchange home both read.
  const source = fs.readFileSync(path.join(root, 'src/components/sports/SportsEvents.tsx'), 'utf8');
  const data = fs.readFileSync(path.join(root, 'src/components/sports/useSportsEventsData.ts'), 'utf8');
  assert.match(source, /useSportsEventsData\(\)/);
  assert.match(data, /await getSportsList\(\)/);
  assert.doesNotMatch(`${source}\n${data}`, /mockEvents|sportsMocks|demoData|DEMO_/);
  assert.match(data, /catch \(e: any\) \{\s*if \(!cancelled\) \{\s*setError\([^)]*\)\s*setAllEvents\(\[\]\)/);
});

function sportsRequest(getSportsList) {
  const states = [], effects = [];
  const hooks = { ...React,
    useState(initial) { const index = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useEffect(callback) { effects.push(callback); }, useMemo: callback => callback(), useCallback: callback => callback,
  };
  const load = loader({ react: hooks,
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    [path.join(root, 'src/lib/api/user.ts')]: { getSportsList },
    [path.join(root, 'src/components/sports/LeaguesEventsList.tsx')]: { ListRow: () => null },
  });
  load('src/components/sports/SportsEvents.tsx').default({});
  const cleanup = effects.map(effect => effect());
  return { states, cleanup };
}

test('actual sports loader shows request failure and no fabricated events', async () => {
  const { states } = sportsRequest(async () => { throw new Error('Local API unavailable'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states[0].length, 0);
  assert.equal(states[1], false);
  assert.equal(states[2], 'Local API unavailable');
});

test('actual sports loader maps backend event identifiers without inventing odds', async () => {
  const { states } = sportsRequest(async () => ({ data: [{ name: 'Cricket', leagues: [{ name: 'Local test league', events: [{ _id: 'test-event-1', name: 'Local test match', date: '2099-01-01T12:00:00Z', markets: [{ marketId: 'test-market-1', marketName: 'Match Odds' }] }] }] }] }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states[0].length, 1);
  const event = states[0][0];
  assert.equal(event.eventId, 'test-event-1');
  assert.equal(event.primaryMarketCode, 'test-market-1');
  assert.equal(event.eventName, 'Local test match');
  assert.equal(event.runners.length, 0);
  for (const runner of event.runners) assert.equal(runner.back, undefined);
  assert.equal(states[1], false);
  assert.equal(states[2], null);
});

test('home sports loader rejects malformed events and never infers live status from time alone', async () => {
  const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { states } = sportsRequest(async () => ({ data: [{ name: 'Soccer', leagues: [{ name: 'Verified league', events: [
    { _id: 'missing-date', name: 'Missing date' },
    { _id: 'recent', name: 'Recent but not live', date: recent, markets: [] },
  ] }] }] }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states[0].length, 1);
  assert.equal(states[0][0].sport, 'football');
  assert.equal(states[0][0].isLive, false);
});

test('home overview receives the full real event set while its market list stays compact', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/sports/SportsEvents.tsx'), 'utf8');
  assert.match(source, /onStateChange\?\.\(\{ events: allEvents, loading, error \}\)/);
  assert.doesNotMatch(source, /onStateChange\?\.\(\{ events: visibleEvents/);
  assert.match(source, /slice\(0, COMPACT_EVENT_LIMIT\)/);
});

test('homepage times use IST explicitly and production event rows have no mock import or nested row button', () => {
  // Exchange home and sports page times go through the shared IST helpers (rendered check: actual exchange home tests).
  const shared = fs.readFileSync(path.join(root, 'src/components/nova/exchange-home/exchangeShared.ts'), 'utf8');
  const exchange = fs.readFileSync(path.join(root, 'src/components/nova/exchange-home/NovaExchangeHome.tsx'), 'utf8');
  const cards = fs.readFileSync(path.join(root, 'src/components/nova/exchange-home/MatchCard.tsx'), 'utf8');
  const workspace = fs.readFileSync(path.join(root, 'src/components/nova/NovaWorkspace.tsx'), 'utf8');
  const rows = fs.readFileSync(path.join(root, 'src/components/sports/LeaguesEventsList.tsx'), 'utf8');
  const times = fs.readFileSync(path.join(root, 'src/components/sports/utils.ts'), 'utf8');
  assert.match(shared, /export const istClock = [^\n]*timeZone: 'Asia\/Kolkata'/);
  assert.match(shared, /export const istDayKey = [^\n]*timeZone: 'Asia\/Kolkata'/);
  for (const source of [exchange, cards]) {
    assert.match(source, /istClock\(/);
    assert.doesNotMatch(source, /toLocale(?:Time|Date)?String\(/, 'no browser-zone formatting');
  }
  assert.match(times, /Asia\/Kolkata/);
  assert.doesNotMatch(workspace, /deskEventTime|toLocaleTimeString/);
  assert.doesNotMatch(rows, /sportsMocks|role="button"/);
  assert.match(rows, /aria-label=\{`\$\{t\('nova\.openMatch'\)\}/);
});

test('unmounted home ignores a late sports request', async () => {
  let resolveRequest;
  const { states, cleanup } = sportsRequest(() => new Promise(resolve => { resolveRequest = resolve; }));
  cleanup.forEach(close => close?.());
  resolveRequest({ data: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states[0].length, 0);
  assert.equal(states[1], true); // No state updates after cleanup.
});

test('actual theme-button click synchronizes multiple toggles through its mode event', () => {
  const environment = themeEnvironment({}, true);
  environment.theme.applyThemeAtStartup();
  const mounts = [];
  function mount() {
    const state = { value: null }, cleanup = [];
    const hooks = { ...React, useState(initial) { state.value = initial(); return [state.value, value => { state.value = value; }]; }, useEffect(effect) { cleanup.push(effect()); } };
    const Component = loader({ react: hooks }, environment.globals)('src/components/ThemeSwitch.tsx').default;
    const button = Component();
    mounts.push({ state, cleanup });
    return button;
  }
  const first = mount();
  mount();
  first.props.onClick();
  assert.equal(environment.rootElement.classList.contains('dark'), true);
  for (const mounted of mounts) assert.equal(mounted.state.value, 'dark');
  const current = mount();
  current.props.onClick();
  for (const mounted of mounts) assert.equal(mounted.state.value, 'light');
  for (const mounted of mounts) mounted.cleanup.forEach(close => close?.());
});

test('sports-disabled match desk uses neutral translated account copy and aria label', () => {
  const { load, render } = app({ features: { sportsEnabled: false, casinoEnabled: true } });
  const html = render(load('src/components/nova/NovaWorkspace.tsx').NovaMatchDesk);
  assert.match(html, /aria-label="Account workspace"/);
  assert.match(html, /Your wallet/);
  assert.match(html, /Sign in to view your actual balance and account activity\./);
  assert.match(html, /Account &amp; preferences/);
  assert.doesNotMatch(html, /<dl>|href="\/deposit"|href="\/withdrawal"/);
  assert.doesNotMatch(html, /Account and match workspace|Stay in the game|Matches, markets and your account|href="\/sports/);
});

test('live support is hidden without a configured number and uses only the tenant number', () => {
  const renderSupport = whatsappSupportPhone => {
    const load = loader({
      'react-i18next': { useTranslation: () => ({ t: translate }) },
      [path.join(root, 'src/hooks/useAppSettings.ts')]: { useAppIdentity: () => ({ whatsappSupportPhone }) },
    });
    return renderToStaticMarkup(React.createElement(load('src/components/LiveSupportStrip.tsx').default));
  };
  assert.equal(renderSupport(undefined), '');
  const configured = renderSupport('+91 98765 43210');
  assert.match(configured, /href="https:\/\/wa\.me\/919876543210"/);
  assert.match(configured, /\+91 98765 43210/);
  const source = fs.readFileSync(path.join(root, 'src/components/LiveSupportStrip.tsx'), 'utf8');
  assert.doesNotMatch(source, /DEFAULT_WHATSAPP|919209823038/);
});

test('sports-only footer destination follows the sports feature flag', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/Footer.tsx'), 'utf8');
  assert.match(source, /features\.sportsEnabled && \([\s\S]*?footer\.inPlay/);
  assert.match(source, /to="\/sports\?sport=live"/);
  assert.match(source, /to="\/terms#responsible"/);
  assert.doesNotMatch(source, /CASINO_PARTNERS|PAYMENT_METHODS|100% Safe|Fast Payouts|SSL Secured/);
});

test('tenant favicon absence preserves the bundled NOVA favicon', () => {
  const source = fs.readFileSync(path.join(root, 'src/lib/app-settings.tsx'), 'utf8');
  assert.match(source, /DEFAULT_FAVICON_PATH = '\/nova\/favicon\.svg'/);
  assert.match(source, /favicon\.href = DEFAULT_FAVICON_PATH/);
  assert.doesNotMatch(source, /favicon\.remove\(\)/);
});

test('tenant logo width uses a stable class instead of alt-text matching', () => {
  const logo = fs.readFileSync(path.join(root, 'src/components/Logo.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/styles/nova.css'), 'utf8');
  assert.match(logo, /className=\{`nova-logo-image /);
  assert.match(css, /\.nova-logo-image \{ max-width: 180px;/);
  assert.match(css, /\.nova-topbar \.nova-logo-image \{ max-width: 105px;/);
  assert.doesNotMatch(css, /img\[alt=['"]Logo['"]\]/);
});

function casinoSliderHarness(api, props = {}) {
  const states = [];
  const effects = [];
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
  };
  const browser = {
    innerWidth: 1280,
    addEventListener() {},
    removeEventListener() {},
  };
  const load = loader({
    react: hooks,
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    [path.join(root, 'src/lib/api/user.ts')]: api,
    [path.join(root, 'src/components/casino/CasinoCard.tsx')]: {
      __esModule: true,
      default: ({ item }) => React.createElement('div', { 'data-game': item.title }),
    },
  }, {
    window: browser,
    requestAnimationFrame(callback) { callback(); return 1; },
    cancelAnimationFrame() {},
  });
  const Component = load('src/components/casino/TopCasinoSlider.tsx').default;
  const invoke = () => { cursor = 0; return Component(props); };
  const initial = renderToStaticMarkup(invoke());
  const cleanup = effects.map(effect => effect());
  return { initial, render: () => renderToStaticMarkup(invoke()), cleanup };
}

test('top casino has no invented games and treats an empty override as authoritative', async () => {
  let calls = 0;
  const harness = casinoSliderHarness({
    getCasinoCategories: async () => { calls++; return { data: [] }; },
    getCasinoGames: async () => { calls++; return { data: [] }; },
  }, { itemsOverride: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
  assert.match(harness.render(), /No top casino games are available right now/);
  harness.cleanup.forEach(close => close?.());

  const source = fs.readFileSync(path.join(root, 'src/components/casino/TopCasinoSlider.tsx'), 'utf8');
  assert.doesNotMatch(source, /fallbackCasino|fallbackSlots|dreamdelhi|dreamcasino|dice-bg\.svg/);
  assert.match(source, /itemsOverride !== undefined/);
});

test('top casino exposes honest loading, API error and real API game states', async () => {
  const failed = casinoSliderHarness({
    getCasinoCategories: async () => { throw new Error('Casino API offline'); },
    getCasinoGames: async () => ({ data: [] }),
  });
  assert.match(failed.initial, /role="status"[^>]*>Loading casino games/);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(failed.render(), /role="alert"[^>]*>Casino games could not be loaded\. Please try again\./);
  failed.cleanup.forEach(close => close?.());

  const real = casinoSliderHarness({
    getCasinoCategories: async () => ({ data: [{ name: 'Tenant top', type: 'top' }] }),
    getCasinoGames: async () => ({ data: [{ id: 'real-1', title: 'Tenant game', provider: 'Tenant provider', imageUrl: '/tenant.webp' }] }),
  });
  await new Promise(resolve => setImmediate(resolve));
  const html = real.render();
  assert.match(html, /data-game="Tenant game"/);
  assert.doesNotMatch(html, /No top casino games|Loading casino games|role="alert"/);
  real.cleanup.forEach(close => close?.());
});

async function renderSportsEvents(events, compact, extraProps = {}) {
  const states = [];
  const effects = [];
  const effectDependencies = [];
  let cursor = 0;
  let effectCursor = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect(callback, dependencies) {
      const index = effectCursor++;
      const previous = effectDependencies[index];
      if (!previous || dependencies.some((value, depIndex) => !Object.is(value, previous[depIndex]))) effects.push(callback);
      effectDependencies[index] = dependencies;
    },
    useMemo: callback => callback(),
    useCallback: callback => callback,
  };
  const load = loader({
    react: hooks,
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    [path.join(root, 'src/lib/api/user.ts')]: {
      getSportsList: async () => ({ data: [{ name: 'Cricket', leagues: [{ name: 'Test league', events }] }] }),
    },
    [path.join(root, 'src/components/sports/LeaguesEventsList.tsx')]: {
      ListRow: ({ e }) => React.createElement('div', { 'data-event': e.eventName }),
    },
  });
  const Component = load('src/components/sports/SportsEvents.tsx').default;
  cursor = 0;
  Component({ compact, ...extraProps });
  const cleanup = effects.splice(0).map(effect => effect());
  await new Promise(resolve => setImmediate(resolve));
  cursor = 0;
  effectCursor = 0;
  const tree = Component({ compact, ...extraProps });
  effects.splice(0).forEach(effect => cleanup.push(effect()));
  const html = renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' }, tree));
  cleanup.forEach(close => close?.());
  return html;
}

test('compact sports feed prioritizes live then nearest upcoming and caps only the homepage', async () => {
  const events = [
    { _id: 'past', name: 'Past event', date: '2000-01-01T00:00:00Z' },
    { _id: 'later', name: 'Later upcoming', date: '2099-06-01T00:00:00Z' },
    { _id: 'live-old', name: 'Live older', date: '2020-01-01T00:00:00Z', isLive: true },
    { _id: 'near', name: 'Nearest upcoming', date: '2099-01-01T00:00:00Z' },
    { _id: 'live-new', name: 'Live newer', date: '2021-01-01T00:00:00Z', inplay: true },
    ...Array.from({ length: 7 }, (_, index) => ({ _id: `extra-${index}`, name: `Extra ${index}`, date: `2099-08-${String(index + 1).padStart(2, '0')}T00:00:00Z` })),
  ];
  const compact = await renderSportsEvents(events, true);
  assert.equal((compact.match(/data-event=/g) || []).length, 8);
  assert.ok(compact.indexOf('Live newer') < compact.indexOf('Live older'));
  assert.ok(compact.indexOf('Live older') < compact.indexOf('Nearest upcoming'));
  assert.ok(compact.indexOf('Nearest upcoming') < compact.indexOf('Later upcoming'));

  const full = await renderSportsEvents(events, false);
  assert.equal((full.match(/data-event=/g) || []).length, events.length);
  assert.ok(full.indexOf('Past event') < full.indexOf('Later upcoming'));
});

test('home status filters apply before the compact event limit and keep overview data complete', async () => {
  const events = [
    ...Array.from({ length: 10 }, (_, index) => ({ id: `live-${index}`, name: `Live ${index}`, date: '2026-01-01T00:00:00Z', isLive: true })),
    { id: 'future', name: 'Future fixture', date: '2099-01-01T00:00:00Z' },
    { id: 'past', name: 'Past fixture', date: '2000-01-01T00:00:00Z' },
  ];
  const snapshots = [];
  const upcoming = await renderSportsEvents(events, true, { statusFilter: 'upcoming', onStateChange: state => snapshots.push(state) });
  assert.match(upcoming, /data-event="Future fixture"/);
  assert.doesNotMatch(upcoming, /data-event="Live|data-event="Past fixture"/);
  assert.equal(snapshots.at(-1).events.length, events.length);
  const live = await renderSportsEvents(events, true, { statusFilter: 'live' });
  assert.equal((live.match(/data-event=/g) || []).length, 8);
  assert.doesNotMatch(live, /data-event="Future fixture"|data-event="Past fixture"/);
});

test('an unmatched sport offers a filter reset without reporting an API failure', async () => {
  const html = await renderSportsEvents([{ id: 'cricket', name: 'Cricket fixture', date: '2099-01-01T00:00:00Z' }], true, { sportFilter: 'football', onResetFilters() {} });
  assert.match(html, /No matches for these filters/);
  assert.match(html, /Clear filters/);
  assert.doesNotMatch(html, /data-event=|role="alert"/);
});

test('casino card uses the semantic NOVA anatomy, accessible controls and honest errors', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/casino/CasinoCard.tsx'), 'utf8');
  const userGames = fs.readFileSync(path.join(root, 'src/components/casino/UserGamesSection.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/styles/nova.css'), 'utf8');
  assert.match(source, /nova-game-card group/);
  assert.match(source, /className="nova-game-art"/);
  assert.match(source, /className="nova-game-copy"/);
  assert.match(source, /aria-pressed=\{liked\}/);
  assert.match(source, /role="alert"/);
  assert.doesNotMatch(source, /aspect-\[3\/4\]|from-emerald-400|showRank|rankClasses/);
  assert.match(css, /\.nova-game-name \{[\s\S]*?color: var\(--text\)/);
  assert.match(css, /html\.dark \.nova-game-art-shade/);
  assert.match(source, /const isLikeControlled = item\.isLiked !== undefined/);
  assert.match(source, /if \(isLikeControlled\) return/);
  assert.match(userGames, /isLiked: game\.isLiked \?\? false/);
  assert.match(userGames, /onLike=\{onLike \? \(nextLiked\)/);
  assert.doesNotMatch(source, /catch \(err\) \{\s*\/\/ rollback/);
});

test('casino catalogue follows NOVA four-three-two geometry and removes invented featured games', () => {
  const css = fs.readFileSync(path.join(root, 'src/styles/nova.css'), 'utf8');
  const featured = fs.readFileSync(path.join(root, 'src/components/FeaturedGames.tsx'), 'utf8');
  const casino = fs.readFileSync(path.join(root, 'src/pages/Casino.tsx'), 'utf8');
  assert.match(css, /\.nova-game-grid \{[^}]*repeat\(4,/);
  assert.match(css, /@media \(max-width: 1250px\)[\s\S]*?\.nova-game-grid \{ grid-template-columns: repeat\(3,/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.nova-game-grid \{ grid-template-columns: repeat\(2,/);
  assert.doesNotMatch(featured, /andar_bahar|speed_roulette|ultimate_sic_bo|fallbackItems|demoData/);
  // An override (even an empty one) is authoritative: the API hook is disabled and nothing is merged in.
  assert.match(featured, /useFeaturedCasinoGames\(variant, itemsOverride === undefined\)/);
  assert.match(featured, /const featuredList = itemsOverride \?\? dynamicItems;/);
  // The lobby (2026-10-15) uses the home page's Matchbook bar and rows; see tests/casino-lobby.test.cjs.
  assert.match(casino, /className="nova-ex-grid nova-lobby"/);
  assert.doesNotMatch(casino, /<FeaturedGames|<TopCasinoSlider/);
});

test('redesigned footer has explicit dark surfaces and replaces the detached support strip', () => {
  const footer = fs.readFileSync(path.join(root, 'src/components/Footer.tsx'), 'utf8');
  const layout = fs.readFileSync(path.join(root, 'src/layouts/MainLayout.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/styles/nova.css'), 'utf8');
  assert.match(footer, /className="nova-site-footer"/);
  assert.match(footer, /safeExternalUrl/);
  assert.match(footer, /hasSupport &&/);
  assert.doesNotMatch(layout, /LiveSupportStrip/);
  assert.match(css, /html\.dark \.nova-site-footer/);
  assert.match(css, /--footer-bg: #0c1420/);
  assert.doesNotMatch(css, /footer div:has/);
});

test('casino provider filter is a rail drawer and sticky category headers do not collide', () => {
  const drawer = fs.readFileSync(path.join(root, 'src/components/casino/ProviderFilterDrawer.tsx'), 'utf8');
  const lobbyCss = fs.readFileSync(path.join(root, 'src/components/casino/casino-lobby.css'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
  assert.match(drawer, /matchMedia\('\(min-width: 801px\)'\)/);
  assert.match(drawer, /className="nova-panel nova-rail-panel nova-provider-panel"/);
  assert.doesNotMatch(drawer, /charAt\(0\)/, 'providers are listed by name, not grouped A-Z');
  // Only the lobby's category strip sticks (under the site header); rows scroll beneath it.
  assert.match(lobbyCss, /\.nova-lobby-tabs \{ position: sticky; top: var\(--header-height, 64px\);/);
  assert.match(lobbyCss, /\.nova-lobby-section \{[^}]*scroll-margin-top: calc\(var\(--header-height, 64px\) \+ 62px\)/);
  assert.match(css, /--category-bar-height: 3\.75rem/);
});

test('sports activity remains discoverable below desktop and legacy visual utilities are emitted', () => {
  const sports = fs.readFileSync(path.join(root, 'src/pages/Sports.tsx'), 'utf8');
  const novaCss = fs.readFileSync(path.join(root, 'src/styles/nova.css'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
  assert.doesNotMatch(sports, /nova-sports-companion[^"\n]*hidden/);
  assert.match(novaCss, /@media \(max-width: 1279px\)[\s\S]*?\.nova-sports-companion[\s\S]*?width: 100% !important/);
  for (const utility of ['shadow-soft', 'animate-in', 'animate-scale-in', 'scrollbar-hide']) {
    assert.match(css, new RegExp(`\\.${utility}`));
  }
});

test('production branding and privacy contact do not fall back to the retired StakeX identity', () => {
  const viteConfig = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  const privacy = fs.readFileSync(path.join(root, 'src/pages/Privacy.tsx'), 'utf8');
  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');

  assert.doesNotMatch(viteConfig, /env\.VITE_API_APP_NAME \|\| ['"]StakeX['"]/);
  assert.match(viteConfig, /env\.VITE_API_APP_NAME \|\| ['"]NOVA['"]/);
  assert.doesNotMatch(privacy, /support@stakex\.app|VITE_API_CONTACT_NO/);
  assert.match(privacy, /useAppIdentity/);
  assert.match(envExample, /^VITE_API_APP_NAME=NOVA$/m);
});

test('registration WhatsApp CTA uses only the tenant-configured support number', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/modals/RegisterModal.tsx'), 'utf8');
  assert.doesNotMatch(source, /DEFAULT_WHATSAPP|919209823038/);
  assert.match(source, /whatsappSupportPhone/);
  assert.match(source, /waNumber\.length >= 8/);
  assert.match(source, /\{whatsAppRegisterUrl && (?:\(|<a\b)/);
});

// Exercise the actual exchange home with React DOM. Only its data seams are isolated: the shared events
// hook (its real API mapping is exercised through SportsEvents above), the odds socket and the casino rows.
let homeDom;
function homeInteractions(snapshot, options = {}) {
  if (!homeDom) {
    const { JSDOM } = require('jsdom');
    homeDom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    // Desktop layout; reduced motion keeps the promotions hero from auto-advancing during a test.
    homeDom.window.matchMedia = query => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener() {}, removeEventListener() {} });
  }
  for (const [key, value] of Object.entries({ window: homeDom.window, document: homeDom.window.document, navigator: homeDom.window.navigator, HTMLElement: homeDom.window.HTMLElement, Event: homeDom.window.Event, CustomEvent: homeDom.window.CustomEvent })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { MemoryRouter, useLocation } = require('react-router-dom');
  const { render, fireEvent, act, within } = require('@testing-library/react');
  const observed = { mounted: 0 };
  function useFeed() {
    React.useEffect(() => { observed.mounted++; }, []);
    return snapshot;
  }
  const { load } = app({ ...options, useFeed, globals: { window: homeDom.window, document: homeDom.window.document } });
  const route = { pathname: '/' };
  function ObserveRoute() {
    route.pathname = useLocation().pathname;
    return null;
  }
  const Home = load('src/components/nova/NovaHome.tsx').default;
  const element = () => React.createElement(MemoryRouter, null, React.createElement(ObserveRoute), React.createElement(Home));
  const view = render(element());
  const cards = () => [...view.container.querySelectorAll('#nova-ex-games .nova-ex-card:not(.is-skeleton)')];
  const teams = () => cards().map(card => card.querySelector('.nova-ex-card-teams').textContent);
  const popular = () => view.container.querySelector('nav.nova-ex-popular-nav');
  const links = () => [...popular().querySelectorAll('a')];
  const link = label => links().find(anchor => anchor.textContent.trim() === label);
  const inPlay = () => within(popular()).getByRole('button', { name: translate('nova.inPlay') });
  return { ...view, fireEvent, act, within, observed, cards, teams, popular, links, link, inPlay, route, rerenderHome: () => view.rerender(element()) };
}

test('full-width promotion carousel navigates real advertisements, supports keyboard focus and touch swipe, and omits controls for one ad', () => {
  const ads = [
    { id: 'folio-one', title: 'Campaign one', image: '/folio-one.webp', url: '/sports' },
    { id: 'folio-two', title: 'Campaign two', image: '/folio-two.webp', url: '/casino' },
    { id: 'folio-three', title: 'Campaign three', image: '/folio-three.webp', url: '/bonus' },
  ];
  const view = homeInteractions({ events: [], loading: false, error: null }, { ads });
  try {
    const hero = view.container.querySelector('.nova-ex-hero');
    const active = () => [...hero.querySelectorAll('.nova-ex-hero-ad')].find(slide => slide.classList.contains('is-active'));
    const activeTitle = () => active().querySelector('img').getAttribute('alt');
    const next = () => hero.querySelector('button.nova-promo-next');
    const previous = () => hero.querySelector('button.nova-promo-previous');
    assert.equal(activeTitle(), 'Campaign one');
    assert.equal(hero.querySelectorAll('.nova-promo-peek').length, 0, 'side previews are removed so the active banner gets the full section');
    assert.equal([...hero.querySelectorAll('.nova-ex-hero-ad')].filter(slide => slide.classList.contains('is-active')).length, 1);
    assert.ok(previous().getAttribute('aria-label').includes(translate('promotionFolio.previous')));
    assert.equal(hero.querySelector('.nova-ex-hero-atmosphere, .nova-ex-hero-backplate, .nova-ex-hero-reflection, .nova-ex-hero-torches, .nova-ex-hero-edge'), null, 'the previous decorative scene is fully removed');
    assert.equal(hero.querySelector('.nova-promo-heading, .nova-promo-next-cover, .nova-promo-next-copy'), null, 'full-width artwork has no editorial heading or sidebar');
    const lighting = hero.querySelector('.nova-promo-stage .nova-promo-lighting');
    assert.equal(lighting.getAttribute('aria-hidden'), 'true');
    assert.equal(lighting.querySelectorAll('.nova-promo-beam').length, 2);
    assert.ok(lighting.querySelector('.nova-promo-touch-light'));
    view.act(() => view.fireEvent.click(next()));
    assert.equal(activeTitle(), 'Campaign two');
    view.act(() => view.fireEvent.click(next()));
    assert.equal(activeTitle(), 'Campaign three');
    view.act(() => view.fireEvent.click(next()));
    assert.equal(activeTitle(), 'Campaign one', 'advancing the last advertisement wraps to the first');
    view.act(() => view.fireEvent.click(previous()));
    assert.equal(activeTitle(), 'Campaign three', 'previous from the first wraps to the last');
    view.act(() => active().focus());
    view.act(() => view.fireEvent.keyDown(active(), { key: 'ArrowRight' }));
    assert.equal(activeTitle(), 'Campaign one');
    assert.ok(homeDom.window.document.activeElement === active(), 'keyboard focus follows the newly active advertisement');
    view.act(() => view.fireEvent.keyDown(active(), { key: 'ArrowLeft' }));
    assert.equal(activeTitle(), 'Campaign three');
    assert.ok(homeDom.window.document.activeElement === active(), 'keyboard focus follows the advertisement when moving back');
    assert.equal(hero.querySelectorAll('img').length, ads.length, 'lighting does not duplicate the semantic artwork');
    const stage = hero.querySelector('.nova-promo-stage');
    const pointer = (type, x, y) => {
      const event = new homeDom.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y }, pointerType: { value: 'touch' }, pointerId: { value: 1 }, isPrimary: { value: true } });
      view.act(() => view.fireEvent(stage, event));
    };
    pointer('pointerdown', 290, 50);
    pointer('pointerup', 280, 155);
    assert.equal(activeTitle(), 'Campaign three', 'a vertical scroll does not change the banner');
    pointer('pointerdown', 290, 75);
    pointer('pointerup', 120, 80);
    assert.equal(activeTitle(), 'Campaign one', 'a horizontal touch swipe advances and wraps the banner');
    const swipeClick = new homeDom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    view.act(() => view.fireEvent(active(), swipeClick));
    assert.equal(swipeClick.defaultPrevented, true, 'the click generated at the end of a swipe is canceled');
    assert.equal(view.route.pathname, '/', 'swiping does not navigate to the promotion destination');
    pointer('pointerdown', 150, 80);
    pointer('pointerup', 150, 80);
    view.act(() => view.fireEvent.click(active()));
    assert.equal(view.route.pathname, '/sports', 'a normal tap still opens the active advertisement');
  } finally { view.unmount(); }

  const originalMatchMedia = homeDom.window.matchMedia;
  homeDom.window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  const single = homeInteractions({ events: [], loading: false, error: null }, { ads: ads.slice(0, 1) });
  try {
    const hero = single.container.querySelector('.nova-ex-hero');
    assert.equal(hero.querySelector('.nova-ex-hero-ad.is-active img').getAttribute('alt'), 'Campaign one');
    assert.equal(hero.querySelector('.nova-promo-next, .nova-promo-previous, .nova-promo-peek'), null, 'one advertisement uses the whole carousel without redundant navigation or previews');
    assert.equal(hero.querySelector('.nova-promo-lighting').getAttribute('aria-hidden'), 'true', 'a single banner retains its decorative torch effect');
    assert.equal(hero.querySelectorAll('.nova-promo-beam').length, 2);
    const stage = hero.querySelector('.nova-promo-stage');
    stage.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 240, width: 400, height: 240 });
    const touch = (type, x, y) => {
      const event = new homeDom.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y }, pointerType: { value: 'touch' }, pointerId: { value: 1 }, isPrimary: { value: true } });
      single.act(() => single.fireEvent(stage, event));
    };
    touch('pointerdown', 80, 60);
    assert.equal(stage.dataset.torchActive, 'true');
    assert.equal(stage.style.getPropertyValue('--torch-x'), '20%');
    assert.equal(stage.style.getPropertyValue('--torch-y'), '25%');
    touch('pointermove', 200, 120);
    assert.equal(stage.style.getPropertyValue('--torch-x'), '50%', 'the touch light follows a finger even when no carousel swipe is needed');
    assert.equal(stage.style.getPropertyValue('--torch-y'), '50%');
    touch('pointercancel', 200, 120);
    assert.equal(stage.dataset.torchActive, undefined, 'canceling a touch clears its interactive light');
  } finally { single.unmount(); homeDom.window.matchMedia = originalMatchMedia; }
});

const professionalHomeEvents = [
  { eventId: 'cricket-live', sport: 'cricket', league: 'Test Cricket League', eventName: 'Test Cricket One v Two', startISO: '2020-01-01T00:00:00Z', isLive: true },
  { eventId: 'football-live', sport: 'football', league: 'Test Football League', eventName: 'Test Football One v Two', startISO: '2021-01-01T00:00:00Z', isLive: true },
  { eventId: 'cricket-next', sport: 'cricket', league: 'Test Cricket League', eventName: 'Test Cricket Three v Four', startISO: '2099-01-01T00:00:00Z', isLive: false },
  { eventId: 'football-next', sport: 'football', league: 'Test Football League', eventName: 'Test Football Three v Four', startISO: '2099-01-02T00:00:00Z', isLive: false },
  { eventId: 'tennis-next', sport: 'tennis', league: 'Test Tennis League', eventName: 'Test Tennis One v Two', startISO: '2099-01-03T00:00:00Z', isLive: false },
];

test('actual exchange home defaults to In-play and shows only live sports boards while preserving backend event identity', () => {
  const view = homeInteractions({ events: professionalHomeEvents, loading: false, error: null });
  try {
    assert.deepEqual(view.links().map(link => link.getAttribute('href')), ['/sports', '/matka', '/casino', '/slots']);
    assert.equal(view.inPlay().getAttribute('aria-pressed'), 'true');
    assert.equal(view.inPlay().getAttribute('aria-controls'), 'nova-ex-games');
    assert.equal(view.popular().querySelector('a[href="/"]'), null, 'In-play replaces Home in this strip');
    assert.deepEqual([...view.container.querySelectorAll('#nova-ex-games .nova-ex-sport-section')].map(section => [section.querySelector('h2').textContent, section.querySelector('.nova-ex-section-count').textContent]),
      [['Cricket', '1'], ['Soccer', '1']]);
    assert.deepEqual(view.cards().map(card => card.querySelector('a.nova-ex-card-link').getAttribute('href')), [
      '/sports/event/test-cricket-one-v-two?id=cricket-live',
      '/sports/event/test-football-one-v-two?id=football-live',
    ], 'only live matches appear in the main list, each linking to its backend event');
    assert.ok(view.cards().every(card => card.classList.contains('is-live')));
    const upNext = view.container.querySelector('[aria-labelledby="nova-ex-upnext-title"]');
    const rows = [...upNext.querySelectorAll('a.nova-ex-upnext')];
    assert.deepEqual(rows.map(row => row.getAttribute('href')), ['/sports/event/test-cricket-three-v-four?id=cricket-next', '/sports/event/test-football-three-v-four?id=football-next', '/sports/event/test-tennis-one-v-two?id=tennis-next']);
    assert.equal(upNext.querySelector('.nova-ex-widget-zone').textContent, 'IST');
    assert.equal(rows[0].querySelector('.nova-ex-upnext-time strong').textContent, '05:30AM');
    assert.doesNotMatch(view.container.textContent, placeholderPattern, 'only the real events are shown');
    assert.equal(view.container.querySelector('.nova-ex-hero'), null, 'no advertisements configured: no hero and no invented promotions');
    assert.equal(view.observed.mounted, 1);
  } finally { view.unmount(); }
});

test('home product links retain native navigation beside the default In-play filter', () => {
  for (const [label, destination] of [['Sports','/sports'],['Matka','/matka'],['Live Casino','/casino'],['Slots','/slots']]) {
    const view = homeInteractions({ events: professionalHomeEvents, loading: false, error: null });
    try {
      const link = view.link(label);
      assert.ok(link, label);
      assert.equal(link.getAttribute('href'), destination, 'native links support modified clicks and opening another tab');
      view.fireEvent.click(link);
      assert.equal(view.route.pathname, destination);
      assert.equal(view.observed.mounted, 1, 'changing the route does not remount this isolated home feed');
      assert.equal(view.cards().length, 2, 'product navigation does not change the live-only selection');
      assert.doesNotMatch(view.container.textContent, placeholderPattern);
    } finally { view.unmount(); }
  }
});

test('In-play stays selected when no matches are live and falls back to real upcoming matches', () => {
  const view = homeInteractions({ events: professionalHomeEvents.filter(event => !event.isLive), loading: false, error: null });
  try {
    assert.deepEqual(view.links().map(link => link.textContent.trim()), ['Sports','Matka','Live Casino','Slots']);
    assert.equal(view.inPlay().getAttribute('aria-pressed'), 'true');
    assert.ok(view.inPlay().classList.contains('active'));
    assert.equal(view.popular().querySelector('small'), null);
    assert.ok(view.links().every(link => !link.hasAttribute('aria-controls')), 'product links navigate instead of controlling the sports region');
    assert.equal(view.container.querySelector('[role="group"][aria-label="Discover sports"]'), null);
    assert.equal(view.cards().length, 3);
    assert.ok(view.cards().every(card => !card.classList.contains('is-live')));
    assert.equal(view.cards()[0].querySelector('.nova-ex-card-time').textContent, '01 Jan, 05:30 AM', 'upcoming start times remain in IST');
    assert.equal(view.observed.mounted, 1);
  } finally { view.unmount(); }
});

test('upcoming fallback excludes past and invalid matches, sorts each rail by start time and leads with the soonest sport', () => {
  const recentPast = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const fixture = (eventId, sport, startISO, isLive = false) => ({ eventId, sport, startISO, isLive, league: `Fallback ${sport}`, eventName: `${eventId} One v Two` });
  const view = homeInteractions({ events: [
    fixture('cricket-late', 'cricket', '2099-01-04T00:00:00Z'),
    fixture('recent-finished', 'cricket', recentPast),
    fixture('football-late', 'football', '2099-01-02T00:00:00Z'),
    fixture('bad-start', 'cricket', 'invalid-date'),
    fixture('cricket-first', 'cricket', '2099-01-03T00:00:00Z'),
    fixture('football-first', 'football', '2099-01-01T00:00:00Z'),
    fixture('old-finished', 'tennis', '2020-01-01T00:00:00Z'),
  ], loading: false, error: null });
  try {
    assert.deepEqual([...view.container.querySelectorAll('#nova-ex-games .nova-ex-sport-section h2')].map(node => node.textContent), ['Soccer', 'Cricket'], 'the first upcoming time leads instead of the fixed Cricket priority');
    assert.deepEqual(view.cards().map(card => new URL(card.querySelector('a.nova-ex-card-link').getAttribute('href'), 'http://localhost').searchParams.get('id')), ['football-first', 'football-late', 'cricket-first', 'cricket-late']);
    assert.deepEqual([...view.container.querySelectorAll('#nova-ex-games .nova-ex-section-count')].map(node => node.textContent), ['2', '2'], 'counts describe eligible matches only');
    assert.equal(view.inPlay().getAttribute('aria-pressed'), 'true');
  } finally { view.unmount(); }
});

test('In-play refreshes the feed in place and follows feed updates from upcoming fallback to live-only and back', () => {
  let reloads = 0;
  const snapshot = { events: professionalHomeEvents.filter(event => !event.isLive), loading: false, error: null, reload: () => { reloads++; } };
  const view = homeInteractions(snapshot);
  try {
    assert.equal(view.cards().length, 3);
    view.fireEvent.click(view.inPlay());
    assert.equal(reloads, 1, 'the default selected filter remains a working refresh control');
    assert.equal(view.route.pathname, '/');
    assert.equal(view.inPlay().getAttribute('aria-pressed'), 'true');
    snapshot.events = [...professionalHomeEvents].reverse();
    view.rerenderHome();
    assert.equal(view.cards().length, 2);
    assert.ok(view.cards().every(card => card.classList.contains('is-live')));
    snapshot.events = professionalHomeEvents.filter(event => !event.isLive);
    view.rerenderHome();
    assert.equal(view.cards().length, 3);
    assert.ok(view.cards().every(card => !card.classList.contains('is-live')));
    assert.equal(view.observed.mounted, 1, 'feed selection updates without remounting the home');
  } finally { view.unmount(); }
});

test('live-only selection orders real starts within each rail and ignores invalid live dates', () => {
  const cricketLive = professionalHomeEvents.find(event => event.eventId === 'cricket-live');
  const view = homeInteractions({ events: [
    { ...cricketLive, eventId: 'later-live', eventName: 'Later Live One v Two', startISO: '2021-01-01T00:00:00Z' },
    { ...cricketLive, eventId: 'bad-live', eventName: 'Invalid Live One v Two', startISO: 'invalid-date' },
    cricketLive,
    ...professionalHomeEvents.filter(event => !event.isLive),
  ], loading: false, error: null });
  try {
    assert.deepEqual(view.cards().map(card => new URL(card.querySelector('a.nova-ex-card-link').getAttribute('href'), 'http://localhost').searchParams.get('id')), ['cricket-live', 'later-live']);
    assert.ok(view.cards().every(card => card.classList.contains('is-live')));
    assert.equal(view.container.querySelector('#nova-ex-games .nova-ex-section-count').textContent, '2');
  } finally { view.unmount(); }
});

test('a feed containing only finished or invalid matches has an honest empty main list', () => {
  const view = homeInteractions({ events: [
    { ...professionalHomeEvents[2], eventId: 'finished', startISO: new Date(Date.now() - 30 * 60 * 1000).toISOString() },
    { ...professionalHomeEvents[2], eventId: 'invalid', startISO: 'invalid-date' },
  ], loading: false, error: null });
  try {
    assert.equal(view.cards().length, 0);
    const region = view.container.querySelector('#nova-ex-games');
    assert.equal(view.within(region).getByRole('status').textContent, translate('nova.noUpcoming'));
    assert.equal(view.within(region).queryByRole('alert'), null);
    assert.equal(view.inPlay().getAttribute('aria-pressed'), 'true');
  } finally { view.unmount(); }
});

// Real data only: a failed request is an error with a retry, never a board of placeholder matches.
test('actual home API failure shows the error with a working retry and no invented matches', () => {
  let reloads = 0;
  const view = homeInteractions({ events: [], loading: false, error: 'Fixture API unavailable', reload: () => { reloads++; } });
  try {
    const region = view.container.querySelector('#nova-ex-games');
    const alert = view.within(region).getByRole('alert');
    assert.equal(alert.querySelector('strong').textContent, translate('nova.eventLoadError'));
    assert.doesNotMatch(view.container.textContent, /Fixture API unavailable|10,000 credits/, 'no raw error text or invented credit');
    assert.equal(view.cards().length, 0, 'no placeholder cards');
    assert.doesNotMatch(view.container.textContent, placeholderPattern);
    assert.deepEqual(view.links().map(link => link.getAttribute('href')), ['/sports', '/matka', '/casino', '/slots'], 'a failed sports request does not remove product navigation');
    assert.equal(view.inPlay().getAttribute('aria-pressed'), 'true');
    assert.equal(view.popular().querySelector('small'), null, 'product destinations carry no unknown event counts');
    assert.equal(view.container.querySelector('a[href*="/sports/event/"], a[href*="id="]'), null, 'no invented event identity');
    assert.equal(view.container.querySelector('[aria-labelledby="nova-ex-upnext-title"], [aria-labelledby="nova-ex-leagues-title"]'), null, 'no side lists without events');
    view.fireEvent.click(view.within(alert).getByRole('button', { name: translate('nova.tryAgain') }));
    assert.equal(reloads, 1, 'retry asks the shared feed to load again');
    assert.equal(view.observed.mounted, 1, 'the retry reloads in place without remounting');
  } finally { view.unmount(); }
});

test('loading and successful-empty homes show neither zero counts, a false error nor placeholder side lists before data', () => {
  const loading = homeInteractions({ events: [], loading: true, error: null });
  try {
    assert.deepEqual(loading.links().map(link => link.getAttribute('href')), ['/sports', '/matka', '/casino', '/slots']);
    assert.equal(loading.inPlay().getAttribute('aria-pressed'), 'true');
    assert.equal(loading.popular().querySelector('small'), null);
    assert.equal(loading.container.querySelectorAll('#nova-ex-games [aria-busy="true"] .nova-ex-card.is-skeleton').length, 3);
    assert.equal(loading.container.querySelector('[aria-labelledby="nova-ex-upnext-title"], [aria-labelledby="nova-ex-leagues-title"]'), null);
    assert.doesNotMatch(loading.container.textContent, placeholderPattern);
    assert.equal(loading.queryByText(translate('nova.eventLoadError')), null);
    assert.equal(loading.observed.mounted, 1);
  } finally { loading.unmount(); }
  const empty = homeInteractions({ events: [], loading: false, error: null });
  try {
    assert.equal(empty.queryByText(translate('nova.eventLoadError')), null, 'an empty list is not reported as a failure');
    assert.deepEqual(empty.links().map(link => link.getAttribute('href')), ['/sports', '/matka', '/casino', '/slots']);
    assert.equal(empty.inPlay().getAttribute('aria-pressed'), 'true');
    assert.equal(empty.popular().querySelector('small'), null);
    assert.equal(empty.container.querySelector('a[href*="/sports/event/"]'), null);
    const region = empty.container.querySelector('#nova-ex-games');
    assert.equal(empty.within(region).getByRole('status').textContent, translate('nova.noUpcoming'), 'one honest line instead of placeholder matches');
    assert.equal(empty.cards().length, 0);
    assert.doesNotMatch(empty.container.textContent, placeholderPattern);
    assert.equal(empty.container.querySelector('[aria-labelledby="nova-ex-upnext-title"], [aria-labelledby="nova-ex-leagues-title"]'), null, 'no side lists without events');
  } finally { empty.unmount(); }
});

test('sports-only exchange home with no events features no invented competition', () => {
  const view = homeInteractions({ events: [], loading: false, error: null }, { features: { sportsEnabled: true, casinoEnabled: false, bonusesEnabled: true } });
  try {
    assert.equal(view.container.querySelector('.nova-ex-brand-card').getAttribute('href'), '/sports', 'the brand card stays: it carries no data');
    assert.equal(view.container.querySelector('.nova-ex-featured'), null, 'no busiest competition to feature');
    assert.doesNotMatch(view.container.textContent, /Europa League|UEFA/);
  } finally { view.unmount(); }
});

test('sports-only exchange home never renders disabled casino destinations or adapters', () => {
  const view = homeInteractions({ events: professionalHomeEvents, loading: false, error: null }, { features: { sportsEnabled: true, casinoEnabled: false, bonusesEnabled: true } });
  try {
    assert.equal(view.container.querySelector('a[href^="/casino"], a[href^="/slots"], [data-real-adapter^="casino"]'), null);
    // The side column keeps exchange content instead: the brand card opens the exchange, the busiest competition is featured.
    assert.equal(view.container.querySelector('.nova-ex-brand-card').getAttribute('href'), '/sports');
    const featured = view.container.querySelector('.nova-ex-featured h2 a');
    assert.equal(featured.textContent, 'Cricket - Test Cricket League');
    assert.equal(featured.getAttribute('href'), '/sports?sport=cricket');
    assert.equal(view.container.querySelector('.nova-ex-featured-art img').getAttribute('alt'), '', 'art is decorative; the heading names the destination');
    const faq = view.container.querySelector('.nova-ex-faq');
    assert.ok(faq, 'sports-only tenants retain the guidance section');
    assert.equal(faq.querySelector('summary').textContent, translate('homeFaq.q1'));
    assert.equal(faq.querySelector('.nova-ex-section-all').getAttribute('href'), '/terms');
    assert.equal(view.observed.mounted, 1);
  } finally { view.unmount(); }
});

test('professional user panel copy has complete native key coverage in every supported locale', () => {
  const resources = ['en', 'hi', 'ta', 'te'].map(language => loader()(`src/lib/i18n/locales/${language}.ts`)[language].translation.userPanel);
  const expected = Object.keys(resources[0]).sort();
  for (const key of ['betsLoading', 'betsError', 'betsEmpty', 'openEvent']) assert.ok(expected.includes(key), `player-panel copy localizes ${key}`);
  for (const resource of resources) {
    assert.deepEqual(Object.keys(resource).sort(), expected);
    for (const value of Object.values(resource)) assert.equal(typeof value, 'string');
  }
});

test('shared page heading shows only the title while preserving icon, IDs and back navigation', () => {
  const { load } = app();
  const Header = load('src/components/PageHeader.tsx').default;
  const html = renderToStaticMarkup(React.createElement(StaticRouter, { location: '/settings' }, React.createElement(Header, { title: 'Preview Settings', subtitle: 'Preview preferences', icon: React.createElement('span', { 'data-preview-icon': true }), id: 'preview-heading', className: 'preview-extra' })));
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /id="preview-heading"/);
  assert.match(html, /user-page-header preview-extra/);
  assert.match(html, /class="user-page-title">Preview Settings/);
  assert.doesNotMatch(html, /user-page-subtitle|Preview preferences/);
  assert.doesNotMatch(html, /data-preview-icon="true"/);
  assert.match(html, /aria-label="Go back"/);
  const withoutBack = renderToStaticMarkup(React.createElement(StaticRouter, null, React.createElement(Header, { title: 'No back', icon: React.createElement('span', { 'data-preview-icon': true }), showBack: false })));
  assert.doesNotMatch(withoutBack, /aria-label="Go back"/);
  assert.match(withoutBack, /data-preview-icon="true"/);
});

test('shared account heading renders contextual help only when a supplied action exists', () => {
  const { load } = app();
  const Header = load('src/components/StakePageHeader.tsx').default;
  const noAction = renderToStaticMarkup(React.createElement(StaticRouter, null, React.createElement(Header, { title: 'Account activity' })));
  assert.equal((noAction.match(/<h1\b/g) || []).length, 1);
  assert.match(noAction, /class="user-account-title">Account activity/);
  assert.doesNotMatch(noAction, /user-account-help/);
  const { render, fireEvent } = require('@testing-library/react');
  const { MemoryRouter } = require('react-router-dom');
  let helpCalls = 0;
  const view = render(React.createElement(MemoryRouter, null, React.createElement(Header, { title: 'Account activity', onHelpClick: () => helpCalls++ })));
  try {
    fireEvent.click(view.getByRole('button', { name: translate('footer.help'), exact: true }));
    assert.equal(helpCalls, 1);
  } finally { view.unmount(); }
});

test('funding headings retain their localized titles and VIP hero does not duplicate the page h1', () => {
  const { load } = app();
  for (const [file, title] of [['src/components/deposit/DepositPageHeader.tsx', 'Deposit'], ['src/components/withdrawal/WithdrawalPageHeader.tsx', 'Withdrawal']]) {
    const html = renderToStaticMarkup(React.createElement(StaticRouter, null, React.createElement(load(file).default)));
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.ok(html.includes(`>${title}</h1>`));
    assert.doesNotMatch(html, /user-account-help/);
  }
  const vipHero = renderToStaticMarkup(React.createElement(load('src/components/vip/VipHeroBanner.tsx').default, { totalTiers: 7 }));
  assert.doesNotMatch(vipHero, /<h1\b/);
  assert.match(vipHero, /<h2 class="user-vip-hero-title"/);
  assert.match(vipHero, /<strong>7<\/strong>/);
});

// Render the real navigation chrome. Only its existing data/auth/locale adapters
// are isolated; the separate layers suite retains the real search/modal tests.
function chromeHarness(component, options = {}) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html class="light"><body></body></html>', { url: 'http://localhost/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, localStorage: dom.window.localStorage })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  dom.window.HTMLDialogElement.prototype.show = function() { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function() { this.open = false; };
  // JSDOM has no matchMedia; `phone` opts a test into a viewport for the header's 800px breakpoint.
  if (options.matchMedia) dom.window.matchMedia = options.matchMedia;
  else if (options.phone !== undefined) dom.window.matchMedia = query => ({ matches: options.phone && query === '(max-width: 800px)', media: query, addEventListener() {}, removeEventListener() {} });
  const { MemoryRouter, useLocation } = require('react-router-dom');
  const { render, fireEvent, act, waitFor, within } = require('@testing-library/react');
  const features = { sportsEnabled: true, casinoEnabled: true, bonusesEnabled: true, referralsEnabled: true, registerEnabled: true, ...options.features };
  const settings = { hideDW: false, baseCurrency: 'INR', timeZone: 'Asia/Kolkata', ...options.settings };
  const calls = { sports: [], auth: [], language: [] };
  const auth = { user: null, isAuthenticated: false, openAuthModal: mode => calls.auth.push(mode), logout() {}, refreshUser() {}, ...options.auth };
  const i18n = { resolvedLanguage: 'en', language: 'en', ...options.i18n };
  const initialLanguage = options.initialLanguage || 'en';
  const globals = { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, URLSearchParams: dom.window.URLSearchParams, CustomEvent: dom.window.CustomEvent, setTimeout, clearTimeout, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout };
  const t = (key, values = {}) => String(translate(key)).replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? `{{${name}}}`);
  const api = { getSportsList: (...args) => { calls.sports.push(args); return (options.getSportsList || (async () => ({ meta: { code: 200 }, data: options.sportsData || [] })))(...args); } };
  const stubs = {
    'react-i18next': { useTranslation: () => ({ t, i18n }) },
    [path.join(root, 'src/hooks/useAppSettings.ts')]: { useFeatureFlags: () => features, useParsedSettings: () => settings, useAppIdentity: () => options.identity || {}, useLogo: () => ({ siteTitle: options.siteTitle || 'NOVA' }) },
    [path.join(root, 'src/lib/auth.tsx')]: { useAuth: () => auth },
    [path.join(root, 'src/lib/locale.ts')]: { getLanguageFromStorage: () => initialLanguage, applyLanguage: language => { calls.language.push(language); i18n.resolvedLanguage = language; i18n.language = language; } },
    [path.join(root, 'src/lib/api/user.ts')]: api,
    [path.join(root, 'src/components/sidebar/navData.ts')]: { sports: [] },
    [path.join(root, 'src/components/sports/allSportsList.ts')]: { ALL_SPORTS_SIDEBAR: ['cricket', 'football', 'tennis', 'basketball', 'horseracing', 'esports'].map(key => ({ key, label: key })) },
    [path.join(root, 'src/components/sports/utils.ts')]: { formatStart: () => ({ dayMon: '10 Oct', time: '15:00' }) },
    [path.join(root, 'src/components/modals/SearchModal.tsx')]: { __esModule: true, default: () => null },
    [path.join(root, 'src/components/modals/ChangePasswordModal.tsx')]: { __esModule: true, default: () => null },
    [path.join(root, 'src/components/nova/NovaWorkspace.tsx')]: { NovaNavigationButton: () => React.createElement('button', { type: 'button', 'aria-label': translate('nova.openNavigation') }), TOGGLE_PANEL_EVENT: 'nova:toggle-panel', PANEL_CHANGE_EVENT: 'nova:panel-change' },
  };
  // The rail itself is the component under test there, so it is loaded for real.
  if (component === 'NovaUtilityRail') delete stubs[path.join(root, 'src/components/nova/NovaWorkspace.tsx')];
  const load = loader(stubs, globals);
  const files = { Sidebar: 'src/components/Sidebar.tsx', SportsList: 'src/components/sidebar/SportsList.tsx', SidebarFooter: 'src/components/sidebar/SidebarFooter.tsx', Topbar: 'src/components/Topbar.tsx', NovaUtilityRail: 'src/components/nova/NovaWorkspace.tsx' };
  const Component = component === 'NovaUtilityRail' ? load(files[component]).NovaUtilityRail : load(files[component]).default;
  const props = component === 'SportsList' ? { items: [], initialActive: '' } : component === 'SidebarFooter' ? { languages: load('src/components/sidebar/localeData.ts').languages, initialLanguage, baseCurrency: settings.baseCurrency, timeZone: settings.timeZone } : {};
  function RouteObserver() { const location = useLocation(); return React.createElement('span', { 'data-testid': 'chrome-route' }, location.pathname + location.search); }
  const element = () => React.createElement(MemoryRouter, { initialEntries: [options.route || '/'] }, React.createElement(Component, props), React.createElement(RouteObserver));
  const view = render(element());
  return { ...view, dom, calls, auth, features, settings, i18n, fireEvent, act, waitFor, within, rerenderChrome: () => view.rerender(element()), close() { view.unmount(); dom.window.close(); } };
}

// The owner moved Home/Sports/Matka/Live Casino/Slots out of the header into the sidebar's Popular section, then
// cut the sidebar to Popular and All Sports (2026-10-29); My Bets, Bonus and Play controls are in the account menu.
test('homepage replaces only Home with In-play for sports tenants while retaining sidebar destinations and feature gates', () => {
  for (const sportsEnabled of [true,false]) for (const matkaEnabled of [true,false]) for (const casinoEnabled of [true,false]) {
    const features = { sportsEnabled, matkaEnabled, casinoEnabled, bonusesEnabled: false };
    const products = [...(sportsEnabled ? ['/sports'] : []), ...(matkaEnabled ? ['/matka'] : []), ...(casinoEnabled ? ['/casino','/slots'] : [])];
    const expected = sportsEnabled ? products : ['/', ...products];
    const home = renderHome({ features });
    try {
      const navigation = home.document.querySelector('nav.nova-ex-popular-nav');
      assert.ok(navigation, 'Popular navigation remains available independently of sports');
      assert.deepEqual([...navigation.querySelectorAll('a')].map(link => link.getAttribute('href')), expected);
      const inPlay = [...navigation.querySelectorAll('button')].find(button => button.textContent.trim() === translate('nova.inPlay'));
      assert.equal(Boolean(inPlay), sportsEnabled, 'the in-play control is available only with the sports feature');
      if (inPlay) {
        assert.equal(inPlay.getAttribute('aria-pressed'), 'true');
        assert.equal(inPlay.getAttribute('aria-controls'), 'nova-ex-games');
      }
      assert.equal(navigation.querySelector('small'), null, 'product links do not invent counts');
      const sidebar = chromeHarness('Sidebar', { features });
      try {
        const popular = sidebar.container.querySelector('#nova-mb-popular').parentElement;
        assert.deepEqual([...popular.querySelectorAll('a')].map(link => link.getAttribute('href')), ['/', ...products], 'the sidebar keeps Home and the same enabled product destinations');
        assert.equal(popular.querySelector('a[href="/"]').textContent.trim(), 'Home');
      } finally { sidebar.close(); }
    } finally { home.close(); }
  }
});

test('actual sidebar product links select only the intended primary destination and the header has none', () => {
  for (const [route, sidebarActive] of [
    ['/', '/'], ['/sports', '/sports'], ['/sports?sport=live', '/sports'], ['/sports?sport=cricket', '/sports?sport=cricket'],
    ['/my-bets', null], ['/casino', '/casino'], ['/slots', '/slots'], ['/bonus', null],
    ['/settings', null], ['/settings?sport=live', null],
  ]) {
    const view = chromeHarness('Sidebar', { route });
    try {
      const sidebar = view.getByRole('complementary', { name: translate('nova.sidebarNavigation') });
      const active = [...sidebar.querySelectorAll('a[aria-current="page"]')];
      assert.deepEqual(active.map(link => link.getAttribute('href')), sidebarActive ? [sidebarActive] : [], route);
      assert.ok(active.every(link => link.classList.contains('active')), 'the visual and announced selection agree');
      assert.equal(sidebar.querySelectorAll('a.active:not([aria-current="page"])').length, 0, `${route}: nothing else looks selected`);
      assert.equal(sidebar.querySelectorAll('nav[aria-labelledby] > h2').length, 2, 'Popular and All Sports are the labelled navigation sections');
      for (const href of ['/sports', '/sports?sport=cricket', '/casino', '/slots']) assert.ok(sidebar.querySelector(`a[href="${href}"]`), href);
      for (const href of ['/sports?sport=live', '/bonus', '/settings', '/matka/my-bets']) assert.equal(sidebar.querySelector(`a[href="${href}"]`), null, `no ${href} link`);
      const popular = sidebar.querySelector('#nova-mb-popular').parentElement;
      assert.deepEqual([...popular.querySelectorAll('a')].map(link => link.getAttribute('href')), ['/', '/sports', '/casino', '/slots'], 'Popular is the product links only');
    } finally { view.close(); }
    const header = chromeHarness('Topbar', { route });
    try {
      assert.equal(header.queryByRole('navigation', { name: translate('nova.mainNavigation') }), null, `header ${route}: no product links`);
    } finally { header.close(); }
  }
});

test('actual sidebar retains feature gates and carries no bonus or support links', () => {
  for (const sportsEnabled of [true, false]) {
    for (const casinoEnabled of [true, false]) {
      const view = chromeHarness('Sidebar', { features: { sportsEnabled, casinoEnabled, bonusesEnabled: false } });
      try {
        assert.ok(view.container.querySelector('#nova-mb-popular'), 'Popular always leads with Home');
        assert.ok(view.container.querySelector('a[href="/"]'));
        assert.equal(Boolean(view.container.querySelector('#nova-mb-all-sports')), sportsEnabled);
        assert.equal(Boolean(view.container.querySelector('a[href^="/sports"]')), sportsEnabled, 'no sport destination when sports are off');
        assert.equal(Boolean(view.container.querySelector('a[href="/sports"]')), sportsEnabled);
        for (const href of ['/casino', '/slots']) assert.equal(Boolean(view.container.querySelector(`a[href="${href}"]`)), casinoEnabled);
        assert.equal(view.container.querySelector('#nova-mb-casino'), null, 'no Casino section');
        assert.equal(view.container.querySelector('a[href="/bonus"]'), null);
        assert.equal(view.calls.sports.length, 0, 'the sidebar sports list is static and requests nothing');
      } finally { view.close(); }
      const header = chromeHarness('Topbar', { features: { sportsEnabled, casinoEnabled }, auth: { isAuthenticated: true, user: { username: 'tenant-player', balance: 10 } } });
      try {
        header.fireEvent.click(header.getByRole('button', { name: 'tenant-player' }));
        const account = header.getByRole('dialog', { name: translate('nova.yourAccount') });
        assert.ok(account.querySelector('a[href="/my-bets"]'), 'accepted Sports/Matka bets remain accessible regardless of product flags');
      } finally { header.close(); }
    }
  }
  // Bonus (header, account menu, footer) and Help & support (right rail) left the sidebar with its Casino and Help sections.
  const view = chromeHarness('Sidebar', { auth: { user: { playerType: 'REGULAR' }, isAuthenticated: true }, identity: { supportEmail: 'support@tenant.test', supportPhone: '+91 12345 67890' } });
  try {
    assert.equal(view.container.querySelector('a[href="/bonus"]'), null);
    assert.equal(view.queryByRole('link', { name: translate('nova.helpSupport') }), null);
    assert.equal(view.container.querySelector('a[href^="mailto:"], a[href^="tel:"]'), null);
  } finally { view.close(); }
});

test('actual sports tree scopes query aliases to sports routes and keeps native sport navigation', () => {
  for (const [route, label] of [['/sports?sport=cricket', 'Cricket'], ['/sports/event/fixture?sport=soccer', 'Football'], ['/sports?sport=horse_racing', 'Horse racing'], ['/casino?sport=cricket', null], ['/settings?sport=football', null]]) {
    const view = chromeHarness('SportsList', { route });
    try {
      const active = [...view.container.querySelectorAll('.nova-sport-branch > summary[aria-current="page"]')];
      assert.equal(active.length, label ? 1 : 0, route);
      if (label) { assert.equal(active[0].querySelector('span').textContent, label); assert.equal(active[0].parentElement.open, true); }
      assert.equal(view.container.querySelectorAll('.nova-sport-branch').length, 5, 'only the original priority sports appear');
      assert.ok(view.container.querySelector('a[href="/sports"]'));
    } finally { view.close(); }
  }
  const view = chromeHarness('SportsList', { route: '/settings?sport=cricket' });
  try {
    const football = [...view.container.querySelectorAll('.nova-sport-branch > summary')].find(summary => summary.querySelector('span').textContent === 'Football');
    view.fireEvent.click(football);
    assert.equal(view.getByTestId('chrome-route').textContent, '/sports?sport=football');
    assert.equal(football.getAttribute('aria-current'), 'page');
  } finally { view.close(); }
});

test('actual sports tree derives counts from named backend events and preserves encoded event and league IDs', async () => {
  const view = chromeHarness('SportsList', { route: '/sports?sport=football', sportsData: [{ name: 'Soccer', leagues: [{ id: 'league-1', name: 'Tenant League & Cup', events: [{ id: 'real/id & 1', name: 'One vs Two', date: '2000-01-01T00:00:00Z' }, { id: 'live-2', name: 'Three v Four', markets: [{ inplay: true }] }, { id: 'blank', name: ' ' }] }, { name: '', events: [{ id: 'ignored', name: 'Missing league' }] }] }] });
  try {
    await view.waitFor(() => assert.equal(view.container.querySelector('.nova-sports-tree').getAttribute('aria-busy'), 'false'));
    const football = view.container.querySelector('.nova-sport-branch > summary[aria-current="page"]');
    assert.equal(football.querySelector('.nova-sport-count').textContent, '2');
    const original = view.container.querySelector('a[href="/sports/event/one-v-two?id=real%2Fid%20%26%201"]');
    assert.ok(original, 'backend identifier is encoded, not regenerated');
    assert.equal(original.querySelector('small').classList.contains('live'), false, 'old date alone never implies live');
    assert.ok(view.container.querySelector('a[href="/sports/event/three-v-four?id=live-2"] small.live'));
    assert.equal(view.container.querySelector('.nova-view-league').getAttribute('href'), '/sports?sport=football&league=Tenant%20League%20%26%20Cup');
    assert.doesNotMatch(view.container.textContent, /Missing league|Mumbai Indians|Chennai Super Kings/);
    assert.equal(view.calls.sports.length, 1);
  } finally { view.close(); }
});

test('actual sports tree distinguishes pending, successful empty, network, malformed and non-2xx states', async () => {
  let resolve;
  const pending = chromeHarness('SportsList', { getSportsList: () => new Promise(done => { resolve = done; }) });
  try {
    assert.equal(pending.container.querySelector('.nova-sports-tree').getAttribute('aria-busy'), 'true');
    assert.equal(pending.container.querySelectorAll('.nova-sport-count').length, 5);
    assert.equal(pending.container.querySelectorAll('.nova-sport-state').length, 5);
    assert.ok([...pending.container.querySelectorAll('.nova-sport-count')].every(node => node.textContent === '\u2014'));
    assert.ok([...pending.container.querySelectorAll('.nova-sport-state')].every(node => node.textContent === translate('nova.loadingEvents')));
    await pending.act(async () => { resolve({ data: [] }); });
    assert.equal(pending.container.querySelector('.nova-sports-tree').getAttribute('aria-busy'), 'false');
    assert.ok([...pending.container.querySelectorAll('.nova-sport-count')].every(node => node.textContent === '0'));
    assert.ok([...pending.container.querySelectorAll('.nova-sport-state')].every(node => node.textContent === translate('nova.noUpcoming') && node.getAttribute('role') === 'status'));
  } finally { pending.close(); }
  for (const getSportsList of [async () => { throw new Error('Offline'); }, ...[199, 300, 500].map(code => async () => ({ meta: { code }, data: [] })), async () => ({ meta: { code: 200 }, data: null })]) {
    const failed = chromeHarness('SportsList', { getSportsList });
    try {
      await failed.waitFor(() => assert.equal(failed.container.querySelector('.nova-sports-tree').getAttribute('aria-busy'), 'false'));
      assert.equal(failed.container.querySelectorAll('.nova-sport-count').length, 5);
      assert.equal(failed.container.querySelectorAll('.nova-sport-state').length, 5);
      assert.ok([...failed.container.querySelectorAll('.nova-sport-count')].every(node => node.textContent === '\u2014'));
      assert.ok([...failed.container.querySelectorAll('.nova-sport-state')].every(node => node.getAttribute('role') === 'alert' && node.textContent === translate('nova.eventLoadError')));
      assert.doesNotMatch(failed.container.textContent, new RegExp(translate('nova.noUpcoming')));
      assert.equal(failed.container.querySelector('.nova-league-branch'), null);
    } finally { failed.close(); }
  }
});

test('native sidebar language select follows current locale and calls only the existing language adapter', () => {
  const view = chromeHarness('SidebarFooter', { i18n: { resolvedLanguage: 'en-IN' }, initialLanguage: 'ta' });
  try {
    const select = view.getByRole('combobox', { name: translate('settings.language') });
    assert.equal(select.tagName, 'SELECT');
    assert.equal(select.value, 'en');
    assert.deepEqual([...select.options].map(option => option.value), ['en', 'hi', 'ta', 'te']);
    view.i18n.resolvedLanguage = 'hi_IN'; view.rerenderChrome(); assert.equal(select.value, 'hi');
    view.i18n.resolvedLanguage = 'xx'; view.rerenderChrome(); assert.equal(select.value, 'ta', 'unsupported current language uses the configured initial fallback');
    view.i18n.resolvedLanguage = ''; view.i18n.language = 'te-IN'; view.rerenderChrome(); assert.equal(select.value, 'te');
    view.fireEvent.change(select, { target: { value: 'en' } });
    assert.deepEqual(view.calls.language, ['en']);
    view.rerenderChrome(); assert.equal(select.value, 'en');
    assert.equal(view.queryByRole('menu'), null, 'native language selection does not add a competing custom popup');
  } finally { view.close(); }
});

test('sidebar locale retains tenant currency and timezone labels with safe fallbacks', () => {
  for (const [settings, currency, zone] of [[{ baseCurrency: 'USD', timeZone: 'Asia/Calcutta' }, 'USD', 'IST'], [{ baseCurrency: 'bad-currency', timeZone: 'Unknown/Zone' }, 'bad-currency', 'Unknown/Zone'], [{ baseCurrency: 'INR', timeZone: null }, 'INR', translate('nova.localTime')]]) {
    const view = chromeHarness('SidebarFooter', { settings });
    try {
      assert.equal(view.container.querySelector('.nova-locale-currency > span').textContent, currency);
      assert.equal(view.container.querySelector('.nova-locale-language small').textContent, zone);
      assert.equal(view.getByRole('combobox', { name: translate('settings.language') }).options.length, 4);
    } finally { view.close(); }
  }
});

test('professional topbar retains named search shortcuts, real theme switching and original authentication actions', () => {
  for (const registerEnabled of [true, false]) {
    const view = chromeHarness('Topbar', { features: { registerEnabled } });
    try {
      assert.equal(view.getByRole('banner', { name: translate('nova.yourWorkspace') }).tagName, 'HEADER');
      const search = view.getByRole('button', { name: translate('nova.searchTeamsMarkets') });
      assert.equal(search.getAttribute('aria-haspopup'), 'dialog');
      assert.equal(search.getAttribute('aria-keyshortcuts'), 'Control+K Meta+K');
      view.fireEvent.click(view.getByRole('button', { name: translate('nav.login') }));
      assert.deepEqual(view.calls.auth, ['login']);
      const register = view.queryByRole('button', { name: translate('nav.register') });
      assert.equal(Boolean(register), registerEnabled);
      if (register) { view.fireEvent.click(register); assert.deepEqual(view.calls.auth, ['login', 'register']); }
      assert.equal(view.queryByRole('button', { name: translate('wallet.choose') }), null, 'anonymous visitors do not acquire wallet controls');
      view.fireEvent.click(view.getByRole('button', { name: 'Switch to dark theme' }));
      assert.equal(view.dom.window.document.documentElement.classList.contains('dark'), true);
      assert.equal(view.dom.window.localStorage.getItem('stakex_theme_mode'), 'dark');
      view.fireEvent.click(view.getByRole('button', { name: 'Switch to light theme' }));
      assert.equal(view.dom.window.document.documentElement.classList.contains('light'), true);
      assert.equal(view.calls.sports.length, 0, 'closed search does not trigger sport queries');
    } finally { view.close(); }
  }
});

test('header renders exactly one named search control: the pill above 800px, the icon button on phones', () => {
  const name = translate('nova.searchTeamsMarkets');
  for (const phone of [false, true]) {
    for (const auth of [{}, { isAuthenticated: true, user: { username: 'tenant-player', balance: 10 } }]) {
      const view = chromeHarness('Topbar', { phone, auth });
      try {
        const searches = view.getAllByRole('button', { name });
        assert.equal(searches.length, 1, `phone=${phone} signedIn=${Boolean(auth.isAuthenticated)}`);
        assert.ok(searches[0].classList.contains(phone ? 'nova-mobile-search' : 'nova-desktop-search'));
        assert.equal(Boolean(searches[0].querySelector('kbd')), !phone, 'the shortcut hint belongs to the desktop pill');
        assert.equal(searches[0].getAttribute('aria-keyshortcuts'), 'Control+K Meta+K');
      } finally { view.close(); }
    }
  }
  // Crossing the breakpoint restyles the same control, so a focused search keeps focus.
  const listeners = new Set();
  const viewport = { phone: false };
  const matchMedia = query => ({ get matches() { return query === '(max-width: 800px)' && viewport.phone; }, media: query, addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) });
  const view = chromeHarness('Topbar', { matchMedia });
  try {
    const search = view.getByRole('button', { name });
    search.focus();
    viewport.phone = true;
    view.act(() => listeners.forEach(listener => listener()));
    assert.equal(view.getByRole('button', { name }), search);
    assert.ok(search.classList.contains('nova-mobile-search'));
    assert.equal(view.dom.window.document.activeElement, search);
  } finally { view.close(); }
  assert.equal(listeners.size, 0, 'the media listener is removed on unmount');
});

// On the desktop shell (801px and up) the header's account button opens the rail's own "Your account" drawer, so
// both entry points show one drawer; phones, without the rail, keep the header's profile sheet.
const desktopMedia = query => ({ matches: query === '(min-width: 801px)', media: query, addEventListener() {}, removeEventListener() {} });

test('desktop header account button opens the rail account drawer instead of a second drawer of its own', () => {
  const view = chromeHarness('Topbar', { auth: { isAuthenticated: true, user: { username: 'tenant-player', balance: 1000 } }, matchMedia: desktopMedia });
  try {
    const received = [];
    view.dom.window.addEventListener('nova:toggle-panel', event => received.push(event.detail));
    const profile = view.getByRole('button', { name: 'tenant-player' });
    view.fireEvent.click(profile);
    assert.equal(received.length, 1);
    assert.equal(received[0].panel, 'account');
    assert.equal(received[0].opener, profile, 'focus can return to the header button');
    assert.equal(view.dom.window.document.querySelector('[data-profile-drawer]'), null, 'no separate profile drawer on desktop');
    assert.equal(profile.getAttribute('aria-expanded'), 'false');
    view.act(() => { view.dom.window.dispatchEvent(new view.dom.window.CustomEvent('nova:panel-change', { detail: { panel: 'account' } })); });
    assert.equal(profile.getAttribute('aria-expanded'), 'true', 'the header button reports the rail drawer as its popup');
    view.act(() => { view.dom.window.dispatchEvent(new view.dom.window.CustomEvent('nova:panel-change', { detail: { panel: 'support' } })); });
    assert.equal(profile.getAttribute('aria-expanded'), 'false');
  } finally { view.close(); }
});

test('the rail account drawer opens from the header event, toggles closed again and signs out from its foot', () => {
  let signedOut = 0;
  const view = chromeHarness('NovaUtilityRail', { auth: { isAuthenticated: true, user: { username: 'tenant-player' }, logout() { signedOut += 1; } } });
  try {
    const { window } = view.dom;
    const dialog = window.document.querySelector('dialog.nova-rail-panel');
    assert.equal(window.document.querySelector(`.nova-utility-rail [aria-label="${translate('nova.yourAccount')}"]`), null, 'the rail has no account button; the header opens the drawer');
    const changes = [];
    window.addEventListener('nova:panel-change', event => changes.push(event.detail.panel));
    const toggle = () => view.act(() => { window.dispatchEvent(new window.CustomEvent('nova:toggle-panel', { detail: { panel: 'account', opener: window.document.body } })); });
    toggle();
    assert.equal(dialog.open, true);
    assert.equal(dialog.getAttribute('aria-label'), translate('nova.yourAccount'));
    assert.equal(changes.at(-1), 'account');
    assert.deepEqual([...dialog.querySelectorAll('a')].map(link => link.getAttribute('href')), ['/deposit', '/withdrawal', '/bonus', '/referral', '/my-bets', '/statements', '/settings'], 'every account route of the old profile drawer');
    assert.ok(view.within(dialog).getByRole('button', { name: translate('settings.changePassword') }));
    toggle();
    assert.equal(dialog.open, false, 'a second header click closes the same drawer');
    assert.equal(changes.at(-1), null);
    toggle();
    view.fireEvent.click(view.within(dialog).getByRole('button', { name: translate('nav.logout') }));
    assert.equal(signedOut, 1);
    assert.equal(dialog.open, false);
  } finally { view.close(); }
});

test('credit players and hideDW keep funding, bonus and referral routes out of the rail account drawer', () => {
  for (const [options, expected] of [
    [{ auth: { isAuthenticated: true, user: { username: 'credit', playerType: 'AGENT_CREDIT' } } }, ['/my-bets', '/statements', '/settings']],
    [{ auth: { isAuthenticated: true, user: { username: 'cash' } }, settings: { hideDW: true } }, ['/bonus', '/referral', '/my-bets', '/statements', '/settings']],
  ]) {
    const view = chromeHarness('NovaUtilityRail', options);
    try {
      const { window } = view.dom;
      view.act(() => { window.dispatchEvent(new window.CustomEvent('nova:toggle-panel', { detail: { panel: 'account' } })); });
      const dialog = window.document.querySelector('dialog.nova-rail-panel');
      assert.deepEqual([...dialog.querySelectorAll('a')].map(link => link.getAttribute('href')), expected, options.auth.user.username);
    } finally { view.close(); }
  }
});

test('topbar cash and credit wallet values agree across trigger and popup while funding remains guarded', () => {
  for (const [playerType, exposure, expected] of [['REGULAR', -100, '900.00'], ['REGULAR', 100, '900.00'], ['AGENT_CREDIT', 100, '700.00'], ['WHITELABEL_CREDIT', -100, '700.00']]) {
    const view = chromeHarness('Topbar', { auth: { isAuthenticated: true, user: { username: 'tenant-player', playerType, balance: 1000, creditAvailable: 700, exposure, bonusBalance: 50, referralBonusBalance: 30 } } });
    try {
      const credit = playerType !== 'REGULAR';
      const expectedAmount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(expected));
      const trigger = view.getByRole('button', { name: translate('wallet.choose') });
      const selected = trigger.querySelector('.nova-wallet-selected');
      assert.equal(selected.querySelector('small').textContent, translate(credit ? 'nova.availableCredit' : 'wallet.main'));
      assert.equal(selected.querySelector('strong').textContent, expectedAmount);
      const profile = view.getByRole('button', { name: 'tenant-player' });
      assert.equal(profile.getAttribute('aria-haspopup'), 'dialog');
      assert.equal(profile.querySelector('.nova-profile-copy strong').textContent, 'tenant-player');
      assert.equal(Boolean(view.container.querySelector('a[href="/deposit"]')), !credit);
      assert.equal(Boolean(view.container.querySelector('a[href="/withdrawal"]')), !credit, 'Withdraw follows the Deposit guard');
      assert.equal(Boolean(view.container.querySelector('a[href="/bonus"]')), !credit);
      view.fireEvent.click(trigger);
      const panel = view.getByRole('dialog', { name: translate('wallet.choose') });
      const main = view.within(panel).getByRole('button', { name: new RegExp(translate(credit ? 'nova.availableCredit' : 'wallet.main')) });
      const popupAmount = main.querySelector('.nova-wallet-option-amount').textContent.trim();
      assert.equal(popupAmount, expectedAmount, `${playerType}: popup and trigger must show the same actual amount`);
      assert.equal(Boolean(view.within(panel).queryByRole('button', { name: /Bonus Wallet/ })), !credit);
      view.fireEvent.keyDown(view.dom.window.document, { key: 'Escape' });
      assert.equal(view.queryByRole('dialog'), null);
      assert.equal(view.dom.window.document.activeElement, trigger);
    } finally { view.close(); }
  }
  const hidden = chromeHarness('Topbar', { auth: { isAuthenticated: true, user: { username: 'tenant-player', balance: 1000 } }, settings: { hideDW: true } });
  try {
    assert.equal(hidden.container.querySelector('a[href="/deposit"]'), null);
    assert.equal(hidden.container.querySelector('a[href="/withdrawal"]'), null);
  } finally { hidden.close(); }
});

test('header news ticker shows the admin News Ticker text one item per line, and nothing when it is empty', () => {
  const view = chromeHarness('Topbar', { settings: { newsTicker: ' Withdrawals are processed 24x7 \r\n\nIndia v Australia is live ' } });
  try {
    const ticker = view.container.querySelector('section.nova-news-ticker');
    assert.ok(ticker.getAttribute('aria-label'), 'a named region');
    const [shown, copy] = ticker.querySelectorAll('ul');
    assert.deepEqual([...shown.querySelectorAll('li')].map(item => item.textContent), ['Withdrawals are processed 24x7', 'India v Australia is live'], 'trimmed lines, blank ones dropped');
    assert.equal(shown.getAttribute('aria-hidden'), null);
    assert.equal(copy.getAttribute('aria-hidden'), 'true', 'the loop copy is hidden from assistive tech');
    assert.ok(view.container.querySelector('.nova-topbar-inner > .nova-news-ticker'), 'a band under the header row');
  } finally { view.close(); }
  for (const newsTicker of [undefined, null, '', '  \n ']) {
    const empty = chromeHarness('Topbar', { settings: { newsTicker } });
    try { assert.equal(empty.container.querySelector('.nova-news-ticker'), null, `no ticker for ${JSON.stringify(newsTicker)}`); } finally { empty.close(); }
  }
});
