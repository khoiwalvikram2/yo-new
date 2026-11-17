const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  Event: { configurable: true, value: dom.window.Event }, CustomEvent: { configurable: true, value: dom.window.CustomEvent },
  localStorage: { configurable: true, value: dom.window.localStorage },
});
// Native focus trapping is checked in the browser; JSDOM only models lifecycle.
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const React = require('react');
const { MemoryRouter, Link, useLocation } = require('react-router-dom');
const { cleanup, fireEvent, render, waitFor, within, act } = require('@testing-library/react');
const { loader, root } = require('./load-source.cjs');
const translations = loader()('src/lib/i18n/locales/en.ts').en.translation;
function translate(key, options = {}) { return key.split('.').reduce((value, part) => value?.[part], translations) ?? options.defaultValue ?? key; }
function spy(implementation = () => undefined) { const fn = (...args) => { fn.calls.push(args); return implementation(...args); }; fn.calls = []; return fn; }
const ok = data => ({ meta: { code: 200 }, data });
const globals = {
  window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  URLSearchParams: dom.window.URLSearchParams, CustomEvent: dom.window.CustomEvent,
  requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, setTimeout, clearTimeout,
};
function harness(options = {}) {
  const auth = {
    isAuthenticated: true, user: { id: 'player-1', username: 'ravi', balance: 1000, bonusBalance: 50, referralBonusBalance: 30, exposure: 100 },
    openAuthModal: spy(), logout: spy(), refreshUser: spy(), ...options.auth,
  };
  const features = { sportsEnabled: true, casinoEnabled: true, bonusesEnabled: true, referralsEnabled: true, registerEnabled: true, ...options.features };
  const settings = { hideDW: false, ...options.settings };
  const calls = {
    getCasinoGames: spy(options.getCasinoGames ?? (async () => ok([]))),
    getSportsList: spy(options.getSportsList ?? (async () => ok([]))),
    getCasinoUrl: spy(async () => ok({ redirectUrl: 'https://provider.example/game' })), addToRecent: spy(), open: spy(),
  };
  window.open = calls.open;
  const stub = Component => ({ __esModule: true, default: Component });
  const stubs = {
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    [path.join(root, 'src/lib/auth.tsx')]: { useAuth: () => auth },
    [path.join(root, 'src/hooks/useAppSettings.ts')]: { useFeatureFlags: () => features, useSportsIconStyle: () => 'default', useParsedSettings: () => settings },
    [path.join(root, 'src/lib/currency.ts')]: { formatAmount: value => `₹${Number(value).toFixed(2)}` },
    [path.join(root, 'src/components/Logo.tsx')]: stub(() => null),
    [path.join(root, 'src/components/ThemeSwitch.tsx')]: stub(() => null),
    [path.join(root, 'src/components/nova/NovaWorkspace.tsx')]: { NovaNavigationButton: () => null },
    [path.join(root, 'src/components/modals/ChangePasswordModal.tsx')]: stub(({ isOpen, onClose }) => isOpen ? React.createElement('div', { role: 'dialog', 'aria-label': 'Change password' }, React.createElement('button', { onClick: onClose }, 'Close password')) : null),
    '@/lib/api/user': calls,
    '@/lib/walletUtils': { getSelectedWallet: () => localStorage.getItem('stakex_selected_wallet') || 'balance' },
    '@/lib/sportsHelpers': { useSportsEvents: () => ({ addToRecent: calls.addToRecent }), generateEventId: value => value.toLowerCase().replaceAll(' ', '-') },
    [path.join(root, 'src/components/sports/utils.ts')]: { formatStart: () => ({ dayMon: '10 Oct', time: '15:00' }) },
  };
  for (const name of ['cricket', 'football', 'tennis']) stubs[path.join(root, `src/assets/images/${name}.png`)] = { __esModule: true, default: `${name}.png` };
  const Topbar = loader(stubs, globals)('src/components/Topbar.tsx').default;
  function Controls() { const location = useLocation(); return React.createElement(React.Fragment, null,
    React.createElement(Link, { to: '/sports?sport=tennis' }, 'External route'),
    React.createElement('span', { 'data-testid': 'route' }, location.pathname + location.search)); }
  const element = () => React.createElement(options.strict ? React.StrictMode : React.Fragment, null,
    React.createElement(MemoryRouter, null, React.createElement(Topbar), React.createElement(Controls)));
  const view = render(element());
  return { ...view, auth, features, settings, calls, rerenderPanel: () => view.rerender(element()) };
}
const searchName = 'Search teams & markets';
function openProfile(view) { const trigger = view.getByRole('button', { name: 'ravi' }); trigger.focus(); fireEvent.click(trigger); return trigger; }
function openSearch(view) { const trigger = view.getByRole('button', { name: searchName }); trigger.focus(); fireEvent.click(trigger); return trigger; }
test.afterEach(() => { cleanup(); document.body.innerHTML = ''; document.body.style.overflow = ''; localStorage.clear(); });

test('profile is a named native modal; cancel restores focus and original scroll state', async () => {
  document.body.style.overflow = 'auto';
  const view = harness(); const trigger = openProfile(view);
  const dialog = view.getByRole('dialog', { name: 'Your account' });
  assert.equal(dialog.tagName, 'DIALOG'); assert.equal(dialog.open, true);
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.activeElement, within(dialog).getByRole('button', { name: 'Close' }));
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  await waitFor(() => assert.equal(Boolean(view.queryByRole('dialog')), false));
  assert.equal(document.body.style.overflow, 'auto'); assert.equal(document.activeElement, trigger);
});

test('StrictMode profile stays open after a queued cleanup close event reaches its reopened dialog', () => {
  const view = harness({ strict: true });
  openProfile(view);
  const dialog = view.getByRole('dialog', { name: 'Your account' });
  assert.equal(dialog.open, true);
  fireEvent(dialog, new Event('close'));
  assert.ok(view.queryByRole('dialog', { name: 'Your account' }));
  assert.equal(dialog.open, true);
  dialog.open = false;
  fireEvent(dialog, new Event('close'));
  assert.equal(view.queryByRole('dialog'), null);
});

test('search ignores a queued stale close after reopening but handles an actual native close', () => {
  const view = harness({ strict: true }); openSearch(view);
  const dialog = view.getByRole('dialog', { name: searchName });
  fireEvent(dialog, new Event('close'));
  assert.equal(dialog.open, true); assert.ok(view.queryByRole('dialog', { name: searchName }));
  dialog.open = false; fireEvent(dialog, new Event('close'));
  assert.equal(view.queryByRole('dialog'), null);
});

test('profile retains guarded funding, bonus, referral, statements, logout and password actions', () => {
  const view = harness(); openProfile(view);
  const dialog = view.getByRole('dialog', { name: 'Your account' });
  for (const target of ['/deposit', '/withdrawal', '/bonus', '/referral', '/statements', '/my-bets']) assert.ok(dialog.querySelector(`a[href="${target}"]`), target);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
  assert.ok(view.queryByRole('dialog', { name: 'Change password' }));
  fireEvent.click(view.getByRole('button', { name: 'Close password' }));
  openProfile(view); fireEvent.click(view.getByRole('button', { name: 'Logout' }));
  assert.equal(view.auth.logout.calls.length, 1); assert.equal(view.queryByRole('dialog'), null);
});

test('credit players and hideDW never acquire funding/bonus shortcuts through new profile markup', () => {
  const view = harness({ auth: { user: { id: 'credit', username: 'ravi', playerType: 'AGENT_CREDIT', creditAvailable: 700 } }, settings: { hideDW: true } });
  openProfile(view); const dialog = view.getByRole('dialog', { name: 'Your account' });
  for (const target of ['/deposit', '/withdrawal', '/bonus', '/referral']) assert.equal(Boolean(dialog.querySelector(`a[href="${target}"]`)), false);
  assert.ok(dialog.querySelector('a[href="/statements"]'));
});

// D/W chips: a credit player's chips are the wallet cash. The header shows the cash figures; the account sheet adds the
// credit reference and Ref P/L = balance - credit reference, and explains why there is no Deposit or Withdraw.
test('a credit player gets the cash wallet figures in the header and credit reference, Ref P/L and agent note in the account sheet', () => {
  const view = harness({ auth: { user: { id: 'credit', username: 'ravi', playerType: 'AGENT_CREDIT', balance: 800, exposure: 150, creditLimit: 1000, creditAvailable: 700 } } });
  const trigger = view.getByRole('button', { name: 'Choose wallet' });
  assert.equal(trigger.textContent, 'Main Wallet₹650.00Exposure₹150.00Available₹650.00');
  openProfile(view); const dialog = view.getByRole('dialog', { name: 'Your account' });
  const figures = [...dialog.querySelectorAll('dl.nova-panel-chips > div')].map(row => `${row.querySelector('dt').textContent}=${row.querySelector('dd').textContent}`);
  assert.deepEqual(figures, ['Credit reference=₹1000.00', 'Ref P/L=−₹200.00']);
  assert.equal(dialog.querySelector('dl.nova-panel-chips dd.is-down')?.textContent, '−₹200.00', 'the player owes the upline: red text');
  assert.ok(within(dialog).getByText('Chips are managed by your agent'));
  for (const target of ['/deposit', '/withdrawal', '/bonus', '/referral']) assert.equal(Boolean(dialog.querySelector(`a[href="${target}"]`)), false, target);
  assert.doesNotMatch(document.body.textContent, /Available credit|₹700\.00/, 'the retired available-credit figure never shows');
});

test('wallet is named and connected to its trigger, Escape returns focus, and inert Info was replaced by close', () => {
  const view = harness(); const trigger = view.getByRole('button', { name: 'Choose wallet' });
  fireEvent.click(trigger);
  const panel = view.getByRole('dialog', { name: 'Choose wallet' });
  assert.equal(trigger.getAttribute('aria-controls'), panel.id);
  assert.equal(panel.className, 'nova-wallet-popover');
  assert.equal(panel.hasAttribute('style'), false);
  assert.equal(view.queryByRole('button', { name: 'Info' }), null);
  assert.ok(within(panel).getByRole('button', { name: 'Close' }));
  assert.equal(document.activeElement.getAttribute('aria-pressed'), 'true');
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(view.queryByRole('dialog'), null); assert.equal(document.activeElement, trigger);
});

test('wallet selection keeps all values and original storage contract', () => {
  const view = harness(); const trigger = view.getByRole('button', { name: 'Choose wallet' });
  assert.match(trigger.textContent, /₹900\.00/);
  fireEvent.click(trigger);
  const panel = view.getByRole('dialog', { name: 'Choose wallet' });
  fireEvent.click(within(panel).getByRole('button', { name: /Bonus Wallet/ }));
  assert.equal(localStorage.getItem('stakex_selected_wallet'), 'bonus');
  assert.match(trigger.textContent, /₹50\.00/); assert.equal(document.activeElement, trigger);
  fireEvent.click(trigger); fireEvent.click(view.getByRole('button', { name: /Referral Bonus/ }));
  assert.equal(localStorage.getItem('stakex_selected_wallet'), 'referralBonus');
  assert.match(trigger.textContent, /₹30\.00/);
});

test('search is named, focuses its labelled input, and native cancel restores focus/scroll', async () => {
  const view = harness(); const trigger = openSearch(view);
  const dialog = view.getByRole('dialog', { name: searchName });
  assert.equal(dialog.tagName, 'DIALOG'); assert.equal(dialog.open, true);
  assert.equal(document.activeElement, within(dialog).getByRole('textbox', { name: searchName }));
  assert.equal(document.body.style.overflow, 'hidden');
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  await waitFor(() => assert.equal(Boolean(view.queryByRole('dialog')), false));
  assert.equal(document.body.style.overflow, ''); assert.equal(document.activeElement, trigger);
});

test('search preserves debounce, original query limits, real event navigation and recent action', async () => {
  const view = harness({ getSportsList: async () => ok([{ name: 'cricket', leagues: [{ name: 'League', events: [{ id: 'event-1', name: 'India v Australia', date: '2026-10-10T10:00:00Z' }] }] }]) });
  openSearch(view);
  fireEvent.change(view.getByRole('textbox', { name: searchName }), { target: { value: 'India' } });
  assert.equal(view.calls.getCasinoGames.calls.length, 0);
  const result = await view.findByRole('button', { name: 'View Event' });
  assert.equal(view.calls.getCasinoGames.calls.length, 2);
  assert.equal(JSON.stringify(view.calls.getCasinoGames.calls[0]), '[{"search":"India","page":1,"limit":6,"liveOnly":true}]');
  assert.equal(JSON.stringify(view.calls.getCasinoGames.calls[1]), '[{"search":"India","page":1,"limit":6,"slots":true}]');
  fireEvent.click(result);
  assert.equal(view.calls.addToRecent.calls.length, 1);
  assert.equal(view.getByTestId('route').textContent, '/sports/event/india-v-australia?id=event-1');
  assert.equal(view.queryByRole('dialog'), null);
});

test('signed-out game action closes native search before requesting existing login', async () => {
  const view = harness({ auth: { isAuthenticated: false, user: null }, getCasinoGames: async () => ok([{ gameId: 'game-1', title: 'Roulette', provider: 'Evolution' }]) });
  openSearch(view); fireEvent.change(view.getByRole('textbox', { name: searchName }), { target: { value: 'Roulette' } });
  fireEvent.click(await view.findByRole('button', { name: 'Play Now' }));
  assert.equal(view.queryByRole('dialog'), null);
  assert.equal(view.auth.openAuthModal.calls[0][0], 'login'); assert.equal(view.calls.getCasinoUrl.calls.length, 0);
});

test('search launches through original selected-wallet adapter without changing provider arguments', async () => {
  localStorage.setItem('stakex_selected_wallet', 'bonus');
  const view = harness({ getCasinoGames: async () => ok([{ gameId: 'game-1', title: 'Roulette', provider: 'Evolution' }]) });
  openSearch(view); fireEvent.change(view.getByRole('textbox', { name: searchName }), { target: { value: 'Roulette' } });
  fireEvent.click(await view.findByRole('button', { name: 'Play Now' }));
  await waitFor(() => assert.equal(view.calls.open.calls.length, 1));
  assert.equal(JSON.stringify(view.calls.getCasinoUrl.calls[0]), '["game-1","bonus"]');
  assert.equal(JSON.stringify(view.calls.open.calls[0]), '["https://provider.example/game","_self"]');
});

test('search query failures are caught and shown instead of false no-matches', async () => {
  const view = harness({ getCasinoGames: async () => { throw new Error('Offline') }, getSportsList: async () => { throw new Error('Offline') } });
  openSearch(view); fireEvent.change(view.getByRole('textbox', { name: searchName }), { target: { value: 'India' } });
  const alert = await view.findByRole('alert');
  assert.match(alert.textContent, /Search results could not be loaded/);
  assert.equal(view.queryByText('No matches found'), null);
});

test('route changes close search/profile/wallet without leaking body scroll locks', async () => {
  const view = harness(); openSearch(view);
  fireEvent.click(view.getByRole('link', { name: 'External route' }));
  await waitFor(() => assert.equal(Boolean(view.queryByRole('dialog')), false));
  assert.equal(document.body.style.overflow, '');
  openProfile(view); fireEvent.click(view.getByRole('link', { name: 'Statements' }));
  assert.equal(view.queryByRole('dialog'), null); assert.equal(document.body.style.overflow, '');
  fireEvent.click(view.getByRole('button', { name: 'Choose wallet' }));
  fireEvent.click(view.getByRole('link', { name: 'External route' }));
  assert.equal(view.queryByRole('dialog'), null);
});

test('forced password-reset state closes top-layer panels and blocks their triggers/keyboard shortcut', async () => {
  const view = harness(); openProfile(view);
  view.auth.user = { ...view.auth.user, requirePasswordReset: true }; view.rerenderPanel();
  await waitFor(() => assert.equal(Boolean(view.queryByRole('dialog')), false));
  assert.equal(view.getByRole('button', { name: 'ravi' }).disabled, true);
  assert.equal(view.getByRole('button', { name: searchName }).disabled, true);
  assert.equal(view.getByRole('button', { name: 'Choose wallet' }).disabled, true);
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  assert.equal(view.queryByRole('dialog'), null);
  assert.equal(view.auth.user.requirePasswordReset, true);
});
