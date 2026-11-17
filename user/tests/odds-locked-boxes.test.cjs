// Every back/lay box without a usable price is a locked box: a lock icon, no price text, nothing to click.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : dom.window[key] });
}
const React = require('react');
const { MemoryRouter } = require('react-router-dom');
const { render, cleanup, fireEvent } = require('@testing-library/react');
const { loader } = require('./load-source.cjs');

const root = path.resolve(__dirname, '..');
const stubs = {
  'react-i18next': { useTranslation: () => ({ t: (key, opts = {}) => opts.defaultValue ?? key }) },
  [path.join(root, 'src/components/nova/exchange-home/useEventOdds.ts')]: { useEventOdds: () => ({}) },
  [path.join(root, 'src/components/nova/exchange-home/LivePulse.tsx')]: { LivePulse: () => null },
  [path.join(root, 'src/lib/sportsHelpers.ts')]: { addEventToRecent: async () => {} },
};
const load = loader(stubs, { window, document, localStorage });
const { MatchCard, MatchRow } = load('src/components/nova/exchange-home/MatchCard.tsx');
const OddsButton = load('src/components/sport-event/OddsButton.tsx').default;
const StandardMarketLayout = load('src/components/sport-event/StandardMarketLayout.tsx').default;
const h = React.createElement;
test.afterEach(() => cleanup());

const pair = (back, lay) => ({ back: { price: back, size: 120 }, lay: { price: lay, size: 80 } });
const base = { to: '/e/1', league: 'L', home: 'A', away: 'B', start: new Date('2026-11-02T10:00:00Z'), badges: [] };
const view = props => render(h(MemoryRouter, null, h(props.row ? MatchRow : MatchCard, { ...base, ...props })));

test('a priced box keeps price and size; a missing side is locked on its own', () => {
  const { container } = view({ ways: 2, loaded: true, pairs: [pair(1.9, undefined), pair(2.1, 2.2)] });
  const cells = [...container.querySelectorAll('.nova-ex-price')];
  assert.equal(cells.length, 4);
  assert.match(cells[0].textContent, /1\.9/);
  assert.equal(cells[0].querySelector('svg'), null);
  assert.ok(cells[1].classList.contains('is-locked') && cells[1].classList.contains('is-lay'));
  assert.ok(cells[1].querySelector('svg'));
  assert.equal(cells[1].textContent, '');
  assert.equal(cells[1].getAttribute('aria-label'), 'Suspended');
  assert.equal(container.querySelectorAll('.nova-ex-price button, button.nova-ex-price').length, 0);
  assert.match(cells[3].textContent, /2\.2/);
});

test('the X column of a two-way market and a not-yet-loaded row show locks', () => {
  const x = view({ row: true, ways: 3, loaded: true, pairs: [pair(1.5, 1.6), undefined, pair(3, 3.1)] });
  const cells = [...x.container.querySelectorAll('.nova-ex-price')];
  assert.equal(cells.length, 6);
  assert.deepEqual(cells.map(c => c.classList.contains('is-locked')), [false, false, true, true, false, false]);
  cleanup();
  const pending = view({ row: true, ways: 3, loaded: false, pairs: [] });
  const all = [...pending.container.querySelectorAll('.nova-ex-price')];
  assert.equal(all.length, 6);
  assert.ok(all.every(c => c.classList.contains('is-locked') && c.querySelector('svg')));
  assert.equal(pending.container.textContent.includes('–'), false);
});

test('event page OddsButton: no price is a locked non-button, a price is a clickable button', () => {
  const clicks = [];
  const locked = render(h(OddsButton, { value: 0, volume: 0, isMain: true, type: 'back', isVisible: true, onClick: () => clicks.push('x') }));
  assert.equal(locked.container.querySelector('button'), null);
  const box = locked.container.querySelector('[data-locked="true"]');
  assert.ok(box.classList.contains('is-back') && box.querySelector('svg'));
  assert.equal(box.textContent, '');
  fireEvent.click(box);
  assert.equal(clicks.length, 0);
  cleanup();
  const priced = render(h(OddsButton, { value: 2.5, volume: 1500, isMain: true, type: 'lay', isVisible: true, onClick: () => clicks.push('y') }));
  const button = priced.container.querySelector('button');
  assert.match(button.textContent, /2\.50/);
  assert.match(button.textContent, /2K/);
  fireEvent.click(button);
  assert.deepEqual(clicks, ['y']);
});

test('StandardMarketLayout locks a zero price instead of printing 0.00', () => {
  const clicks = [];
  const market = { id: 'm', name: 'Bookmaker', type: 'bookmaker', marketType: 'bookmaker', odds: [{ selection: 'A', selectionId: 1, back: 1.8, lay: 0 }] };
  const { container } = render(h(StandardMarketLayout, { market, onOddsClick: () => clicks.push(1) }));
  assert.equal(container.textContent.includes('0.00'), false);
  assert.equal(container.querySelectorAll('button.nova-ev-odd').length, 1);
  const locked = container.querySelector('.nova-ev-odd.is-lay[data-locked="true"]');
  assert.ok(locked && locked.querySelector('svg'));
  fireEvent.click(locked);
  assert.equal(clicks.length, 0);
  fireEvent.click(container.querySelector('button.nova-ev-odd'));
  assert.equal(clicks.length, 1);
});
