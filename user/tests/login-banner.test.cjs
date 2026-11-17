// user/tests/login-banner.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./load-source.cjs');

const rules = loader()('src/lib/loginBanner.ts');
const BANNER = 'data:image/png;base64,' + 'A'.repeat(60000);
const visitor = { url: BANNER, ready: true, isAuthenticated: false, authModalOpen: false, seen: null };

test('the fingerprint is short, stable and tells two banners apart', () => {
  const print = rules.bannerFingerprint(BANNER);
  assert.ok(print.length < 20, print);
  assert.equal(rules.bannerFingerprint(BANNER), print);
  assert.notEqual(rules.bannerFingerprint(BANNER + 'B'), print);
});

test('pre-login: a ready visitor sees an unseen banner once; never while signed in, loading or in the login dialog', () => {
  assert.equal(rules.shouldShowPreLoginBanner(visitor), true);
  assert.equal(rules.shouldShowPreLoginBanner({ ...visitor, seen: rules.bannerFingerprint(BANNER) }), false);
  assert.equal(rules.shouldShowPreLoginBanner({ ...visitor, seen: rules.bannerFingerprint('old banner') }), true, 'a changed banner shows again');
  assert.equal(rules.shouldShowPreLoginBanner({ ...visitor, isAuthenticated: true }), false);
  assert.equal(rules.shouldShowPreLoginBanner({ ...visitor, ready: false }), false);
  assert.equal(rules.shouldShowPreLoginBanner({ ...visitor, authModalOpen: true }), false);
  assert.equal(rules.shouldShowPreLoginBanner({ ...visitor, url: null }), false);
});

test('post-login: once per sign-in made on this page, not for a restored session or during a forced password reset', () => {
  const signedIn = { url: BANNER, signedInAt: 1000, handledSignInAt: null, requirePasswordReset: false };
  assert.equal(rules.shouldShowPostLoginBanner(signedIn), true);
  assert.equal(rules.shouldShowPostLoginBanner({ ...signedIn, handledSignInAt: 1000 }), false);
  assert.equal(rules.shouldShowPostLoginBanner({ ...signedIn, handledSignInAt: 1000, signedInAt: 2000 }), true, 'a new sign-in');
  assert.equal(rules.shouldShowPostLoginBanner({ ...signedIn, signedInAt: null }), false);
  assert.equal(rules.shouldShowPostLoginBanner({ ...signedIn, requirePasswordReset: true }), false);
  assert.equal(rules.shouldShowPostLoginBanner({ ...signedIn, url: '' }), false);
});

test('the seen marker survives blocked storage', () => {
  const store = new Map();
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  rules.rememberPreLoginBanner(BANNER, storage);
  assert.equal(rules.readSeenPreLoginBanner(storage), rules.bannerFingerprint(BANNER));
  assert.equal(store.get('mb_pre_login_banner_seen').length < 20, true, 'the image itself is never stored');
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(rules.readSeenPreLoginBanner(blocked), null);
  assert.doesNotThrow(() => rules.rememberPreLoginBanner(BANNER, blocked));
  assert.equal(rules.readSeenPreLoginBanner(null), null);
});

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement })) {
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function() { this.open = false; };
const React = require('react');
const { render, cleanup, fireEvent, act } = require('@testing-library/react');

const PRE = 'data:image/png;base64,UFJF';
const POST = 'data:image/png;base64,UE9TVA==';
let auth;
let settings;
const freshAuth = () => ({ isAuthenticated: false, isHydrating: false, isAuthModalOpen: false, signedInAt: null, user: null });
const load = loader({
  '@/lib/auth': { useAuth: () => auth },
  '@/lib/app-settings': { useAppSettings: () => settings },
  'react-i18next': { useTranslation: () => ({ t: (key, options) => options?.defaultValue ?? key }) },
}, { window: dom.window, document: dom.window.document, setTimeout, clearTimeout });
const Banner = load('src/components/modals/LoginBannerModal.tsx').default;
const shown = () => document.querySelector('img.mb-login-banner-image')?.getAttribute('src') ?? null;

test.beforeEach(() => {
  dom.window.sessionStorage.clear();
  auth = freshAuth();
  settings = { isLoading: false, parsedSettings: { preLoginBannerUrl: PRE, postLoginBannerUrl: POST } };
});
test.afterEach(() => { cleanup(); document.body.innerHTML = ''; });

test('a visitor sees the pre-login banner once per visit; closing it with Escape keeps it closed', () => {
  render(React.createElement(Banner));
  assert.equal(shown(), PRE);
  assert.equal(document.activeElement, document.querySelector('.mb-login-banner-close'), 'focus starts on Close');
  act(() => { fireEvent(document.querySelector('dialog'), new dom.window.Event('cancel', { cancelable: true })); });
  assert.equal(shown(), null);
  cleanup();
  render(React.createElement(Banner));
  assert.equal(shown(), null, 'not again in this visit');
});

test('the pre-login banner waits for settings, the saved session and a closed login dialog', () => {
  settings = { ...settings, isLoading: true };
  auth = { ...freshAuth(), isHydrating: true };
  const view = render(React.createElement(Banner));
  assert.equal(shown(), null);
  settings = { ...settings, isLoading: false };
  auth = { ...auth, isHydrating: false, isAuthModalOpen: true };
  view.rerender(React.createElement(Banner));
  assert.equal(shown(), null);
  auth = { ...auth, isAuthModalOpen: false };
  view.rerender(React.createElement(Banner));
  assert.equal(shown(), PRE);
});

test('a sign-in on this page shows the post-login banner once; a restored session and a forced reset do not', () => {
  auth = { ...freshAuth(), isAuthenticated: true, user: { requirePasswordReset: false } };
  const view = render(React.createElement(Banner));
  assert.equal(shown(), null, 'restored session');
  auth = { ...auth, signedInAt: 1000, user: { requirePasswordReset: true } };
  view.rerender(React.createElement(Banner));
  assert.equal(shown(), null, 'forced password reset pending');
  auth = { ...auth, user: { requirePasswordReset: false } };
  view.rerender(React.createElement(Banner));
  assert.equal(shown(), POST);
  act(() => { fireEvent.click(document.querySelector('.mb-login-banner-close')); });
  view.rerender(React.createElement(Banner));
  assert.equal(shown(), null, 'once per sign-in');
});

test('an image that fails to load closes the popup', () => {
  render(React.createElement(Banner));
  act(() => { fireEvent.error(document.querySelector('img.mb-login-banner-image')); });
  assert.equal(shown(), null);
});

test('the post-login popup closes when the player is no longer signed in', () => {
  settings = { isLoading: false, parsedSettings: { preLoginBannerUrl: null, postLoginBannerUrl: POST } };
  auth = { ...freshAuth(), isAuthenticated: true, signedInAt: 1000, user: { requirePasswordReset: false } };
  const view = render(React.createElement(Banner));
  assert.equal(shown(), POST);
  auth = { ...auth, isAuthenticated: false, signedInAt: null, user: null };
  view.rerender(React.createElement(Banner));
  assert.equal(shown(), null);
});

test('a sign-in made while no post-login banner is set does not pop one up when it is added later', () => {
  settings = { isLoading: false, parsedSettings: { preLoginBannerUrl: null, postLoginBannerUrl: null } };
  auth = { ...freshAuth(), isAuthenticated: true, signedInAt: 1000, user: { requirePasswordReset: false } };
  const view = render(React.createElement(Banner));
  assert.equal(shown(), null);
  settings = { isLoading: false, parsedSettings: { preLoginBannerUrl: null, postLoginBannerUrl: POST } };
  view.rerender(React.createElement(Banner));
  assert.equal(shown(), null, 'that sign-in already happened');
  auth = { ...auth, signedInAt: 2000 };
  view.rerender(React.createElement(Banner));
  assert.equal(shown(), POST, 'a new sign-in shows it');
});
