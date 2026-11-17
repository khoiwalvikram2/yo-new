// user/tests/player-theme.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loader } = require('./load-source.cjs');

const plain = value => JSON.parse(JSON.stringify(value)); // objects made inside the loader's realm
const lib = loader()('src/lib/playerTheme.ts');
const shared = loader()('../shared/src/theme/playerTheme.ts');
const preset = id => plain(shared.PLAYER_THEME_PRESETS.find(item => item.id === id).colors);

test('applyPlayerTheme writes one style block for a custom theme, keeps it last, updates and removes it', () => {
  const doc = new JSDOM('<!doctype html><html><head><link rel="stylesheet" href="app.css"></head><body></body></html>').window.document;
  lib.applyPlayerTheme({ colors: preset('royal-blue') }, doc);
  const style = doc.getElementById('mb-player-theme');
  assert.ok(style);
  assert.equal(doc.head.lastElementChild, style);
  assert.match(style.textContent, /^html:root:not\(\.dark\)\{--mb-red:#1D4ED8;/);

  doc.head.appendChild(doc.createElement('style')); // a stylesheet injected later (Vite does this in dev)
  lib.applyPlayerTheme({ colors: { ...preset('royal-blue'), action: '#047857' } }, doc);
  assert.equal(doc.querySelectorAll('#mb-player-theme').length, 1);
  assert.equal(doc.head.lastElementChild.id, 'mb-player-theme');
  assert.match(doc.getElementById('mb-player-theme').textContent, /--mb-red:#047857/);

  lib.applyPlayerTheme({ colors: plain(shared.MATCHBOOK_COLORS) }, doc);
  assert.equal(doc.getElementById('mb-player-theme'), null, 'Matchbook needs no style');
  lib.applyPlayerTheme(null, doc);
  assert.equal(doc.getElementById('mb-player-theme'), null);
});

test('the app setting is read from its JSON string, leniently, and gives the icon set', () => {
  assert.deepEqual(plain(lib.parsePlayerThemeSetting(JSON.stringify({ sportsIconStyle: '3d' }))), { sportsIconStyle: '3d' });
  assert.deepEqual(plain(lib.parsePlayerThemeSetting({ sportsIconStyle: 'flat' })), { sportsIconStyle: 'flat' });
  assert.equal(lib.parsePlayerThemeSetting('not json'), null);
  assert.equal(lib.parsePlayerThemeSetting(null), null);
  assert.equal(lib.playerSportsIconStyle(null), 'default');
  assert.equal(lib.playerSportsIconStyle({ sportsIconStyle: '3d' }), '3d');
});

test('a dark-affecting change writes the html.dark block, and an invalid colour removes the style', () => {
  const doc = new JSDOM('<!doctype html><html><head></head><body></body></html>').window.document;
  const base = preset('royal-blue');
  lib.applyPlayerTheme({ colors: { ...base, dark: { ...base.dark, panel: '#101820' } } }, doc);
  const css = doc.getElementById('mb-player-theme').textContent;
  assert.match(css, /\nhtml\.dark:root\{[^}]*--mb-panel:#101820/);
  assert.match(css, /^html:root:not\(\.dark\)\{/);

  lib.applyPlayerTheme({ colors: { ...base, action: 'not-a-colour' } }, doc);
  assert.equal(doc.getElementById('mb-player-theme'), null, 'an invalid colour injects nothing');
});

test('a chrome or action change reaches the brand and charcoal tokens the CSS uses', () => {
  const css = shared.playerThemeCss({ ...plain(shared.MATCHBOOK_COLORS), action: '#1D4ED8', chrome: '#1E293B' });
  for (const token of ['--mb-brand-top', '--mb-brand-edge', '--mb-nav-active', '--mb-chrome-field', '--mb-chrome-edge', '--mb-chrome-hero-end']) {
    assert.ok(css.includes(`${token}:`), token);
  }
});
