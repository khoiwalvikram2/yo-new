// The phone menu's tiles (owner 2026-11-02, from a reference): Top 5 sports, product buttons, every sport as tiles,
// each part following the whitelabel's product switches.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
});

const React = require('react');
const { MemoryRouter, useLocation } = require('react-router-dom');
const { cleanup, fireEvent, render } = require('@testing-library/react');
const { loader, root } = require('./load-source.cjs');

const translations = loader()('src/lib/i18n/locales/en.ts').en.translation;
const translate = (key, options = {}) => key.split('.').reduce((value, part) => value?.[part], translations) ?? options.defaultValue ?? key;

function menu({ features = {}, route = '/' } = {}) {
  const flags = { sportsEnabled: true, casinoEnabled: true, matkaEnabled: true, ...features };
  const appSettings = { useFeatureFlags: () => flags, useSportsIconStyle: () => 'default' };
  const load = loader({
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    '../../hooks/useAppSettings': appSettings,
  }, { window: dom.window, document: dom.window.document, URLSearchParams: dom.window.URLSearchParams });
  const MobileMenuTiles = load('src/components/nova/MobileMenuTiles.tsx').default;
  const closes = [];
  function Route() { const location = useLocation(); return React.createElement('output', { 'data-testid': 'route' }, location.pathname + location.search); }
  const view = render(React.createElement(MemoryRouter, { initialEntries: [route] },
    React.createElement(MobileMenuTiles, { onNavigate: () => closes.push(true) }), React.createElement(Route)));
  const section = id => view.container.querySelector(`section[aria-labelledby="${id}"]`);
  const links = scope => [...(scope?.querySelectorAll('a') ?? [])].map(link => [link.textContent.trim(), link.getAttribute('href')]);
  return { view, closes, section, links, products: () => links(view.container.querySelector('.nova-mm-wide')) };
}
test.afterEach(() => cleanup());

test('the menu leads with Top 5 sports, then products, then every sport A to Z', () => {
  const { view, section, links, products } = menu();
  assert.equal(section('nova-mm-top').querySelector('h3').textContent, 'Top 5 sports');
  assert.deepEqual(links(section('nova-mm-top')), [
    ['Cricket', '/sports?sport=cricket'], ['Soccer', '/sports?sport=football'], ['Tennis', '/sports?sport=tennis'],
    ['Horse Racing', '/sports?sport=horseracing'], [translate('nova.inPlay'), '/sports?sport=live'],
  ]);
  assert.deepEqual(products(), [['Matka', '/matka'], [translate('nav.liveCasino'), '/casino'], [translate('nav.slots'), '/slots'], [translate('nav.myBets'), '/my-bets']]);
  const all = links(section('nova-mm-all'));
  assert.equal(all.length, 18, 'every sport in the catalogue');
  assert.deepEqual(all.map(([label]) => label), [...all.map(([label]) => label)].sort((a, b) => a.localeCompare(b)), 'A to Z');
  assert.ok(all.some(([label, href]) => label === 'Golf' && href === '/sports?sport=golf'));
  assert.equal(view.container.querySelectorAll('.nova-mm-icon img').length, 4 + 18, 'each sport tile shows its glyph');
});

test('switched-off products and sports leave the menu; My Bets stays', () => {
  const noSports = menu({ features: { sportsEnabled: false } });
  assert.ok(noSports.section('nova-mm-top') === null && noSports.section('nova-mm-all') === null, 'no sport tiles without sports');
  assert.deepEqual(noSports.products().map(([, href]) => href), ['/matka', '/casino', '/slots', '/my-bets']);
  cleanup();
  const onlyBets = menu({ features: { casinoEnabled: false, matkaEnabled: false } });
  assert.deepEqual(onlyBets.products(), [[translate('nav.myBets'), '/my-bets']]);
});

test('the current page is marked, and a tap navigates and closes the menu', () => {
  const { view, closes, section } = menu({ route: '/sports?sport=tennis' });
  const current = [...view.container.querySelectorAll('[aria-current="page"]')].map(link => link.getAttribute('href'));
  assert.deepEqual(current, ['/sports?sport=tennis', '/sports?sport=tennis'], 'the Top 5 tile and the grid tile');
  fireEvent.click([...section('nova-mm-all').querySelectorAll('a')].find(link => link.textContent.trim() === 'Golf'));
  assert.equal(view.getByTestId('route').textContent, '/sports?sport=golf');
  assert.equal(closes.length, 1);
});

test('the menu body is charcoal chrome from tokens, and the drawer keeps its theme switch and preferences', () => {
  const css = fs.readFileSync(path.join(root, 'src/components/nova/mobile-menu.css'), 'utf8');
  assert.match(css, /\.nova-navigation-panel \{ color: #FFFFFF; background: var\(--mb-chrome\); \}/);
  assert.match(css, /\.nova-mm-tiles\.is-top \{ grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.nova-mm-tiles\.is-grid \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  const workspace = fs.readFileSync(path.join(root, 'src/components/nova/NovaWorkspace.tsx'), 'utf8');
  assert.match(workspace, /view === 'navigation'[\s\S]*?<MobileMenuTiles onNavigate=\{close\} \/>[\s\S]*?nova-panel-mobile-theme[\s\S]*?to="\/settings"/);
});
