const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loader } = require('./load-source.cjs');

const shared = loader()('../shared/src/theme/sportsIcons.ts');
const ex = loader({ 'react-i18next': { useTranslation: () => ({ t: key => key }) } })('src/components/nova/exchange-home/exchangeShared.ts');
const EXCHANGE_DIR = path.resolve(__dirname, '../src/components/nova/exchange-home');
const PLAYER_SPORTS = ['cricket', 'football', 'tennis', 'basketball', 'horseracing', 'greyhoundracing', 'ice-hockey', 'hockey', 'baseball',
  'volleyball', 'boxing', 'mma', 'rugby', 'darts', 'snooker', 'cycling', 'golf', 'esports'];

test('every colourful slug has a flat and a 3d file', () => {
  for (const style of ['flat', '3d']) {
    for (const slug of shared.SPORTS_ICON_SLUGS) {
      assert.ok(fs.existsSync(path.resolve(__dirname, `../src/assets/images/${style}/${slug}.png`)), `${style}/${slug}`);
    }
  }
});

test('the player sport keys find their colourful file; Live, Politics and the default set do not', () => {
  for (const style of ['flat', '3d']) {
    for (const sport of PLAYER_SPORTS) {
      const key = ex.styledSportIconKey(sport, style);
      assert.ok(key && fs.existsSync(path.resolve(EXCHANGE_DIR, key)), `${style} ${sport} -> ${key}`);
    }
    assert.equal(ex.styledSportIconKey('live', style), null);
    assert.equal(ex.styledSportIconKey('politics', style), null);
  }
  assert.equal(ex.styledSportIconKey('cricket', 'default'), null);
});

test('without a colourful file the icon falls back to the default set and gets no colourful class', () => {
  // The test loader resolves import.meta.glob to {}, so here every lookup falls back.
  assert.equal(ex.sportIcon('cricket', 'flat'), ex.sportIcon('cricket'));
  assert.equal(ex.sportIconClass('cricket', 'default', 'sport-img'), 'sport-img');
  assert.equal(ex.sportIconClass('live', 'flat'), undefined);
  assert.equal(ex.COLORFUL_SPORT_ICON_CLASS, 'mb-sport-icon-colorful');
});
