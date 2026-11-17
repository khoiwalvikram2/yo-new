const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});

Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  localStorage: { configurable: true, value: dom.window.localStorage },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  HTMLInputElement: { configurable: true, value: dom.window.HTMLInputElement },
  Event: { configurable: true, value: dom.window.Event },
  CustomEvent: { configurable: true, value: dom.window.CustomEvent },
  requestAnimationFrame: { configurable: true, value: callback => setTimeout(callback, 0) },
  cancelAnimationFrame: { configurable: true, value: clearTimeout },
});

const React = require('react');
const { MemoryRouter } = require('react-router-dom');
const { act, cleanup, fireEvent, render, waitFor } = require('@testing-library/react');
const { loader, root } = require('./load-source.cjs');
const english = loader()('src/lib/i18n/locales/en.ts').en.translation;
const translate = (key, options = {}) => String(key.split('.').reduce((value, part) => value?.[part], english) ?? options.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) => options[name] ?? `{{${name}}}`);
dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function() { this.open = false; setTimeout(() => this.dispatchEvent(new Event('close')), 0); };

const browserGlobals = {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  localStorage: dom.window.localStorage,
  URL: dom.window.URL,
  URLSearchParams: dom.window.URLSearchParams,
  CustomEvent: dom.window.CustomEvent,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};

function spy(implementation = () => undefined) {
  const fn = (...args) => {
    fn.calls.push(args);
    return implementation(...args);
  };
  fn.calls = [];
  return fn;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test.afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  localStorage.clear();
  document.body.style.overflow = '';
  window.history.replaceState({}, '', '/');
});

function authModalHarness(mode, overrides = {}) {
  const calls = {
    closeAuthModal: spy(),
    openAuthModal: spy(),
    login: spy(async () => undefined),
    requestOtp: spy(async () => undefined),
    loginWithOtp: spy(async () => undefined),
    requestResetOtp: spy(async () => undefined),
    resetPassword: spy(async () => undefined),
    register: spy(async () => undefined),
    registerWithOtp: spy(async () => undefined),
  };
  const auth = {
    isAuthModalOpen: true,
    authModalMode: mode,
    ...calls,
    ...overrides.auth,
  };
  const notifications = {
    success: spy(),
    error: spy(),
  };
  const features = { registerEnabled: true, ...overrides.features };
  const graphql = spy(overrides.graphqlRequest || (async () => ({ checkPhoneAvailable: { available: true, message: null } })));
  const settingsHooks = { useFeatureFlags: () => features, useAppIdentity: () => overrides.identity || {}, useLogo: () => ({ siteTitle: 'Fixture Tenant', logoSrc: null }) };
  const load = loader({
    'react-i18next': { useTranslation: () => ({ t: translate }) },
    '../../lib/auth': { useAuth: () => auth },
    '../../hooks/useAppSettings': settingsHooks,
    '@/hooks/useAppSettings': settingsHooks,
    [path.join(root, 'src/hooks/useAppSettings.ts')]: settingsHooks,
    '@/lib/graphqlClient': { graphqlRequest: graphql },
    '@/lib/errors': {
      extractApiMessage: (error, fallback) => error?.message || fallback,
    },
    '@/lib/notify': { notify: notifications },
  }, { ...browserGlobals, ...overrides.clock });
  const Modal = load(`src/components/modals/${mode === 'register' ? 'RegisterModal' : 'LoginModal'}.tsx`).default;
  const element = () =>
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(Modal),
    );
  const view = render(element());
  return { ...view, auth, calls, notifications, features, graphql, rerenderModal: () => view.rerender(element()) };
}
function loginModalHarness(overrides = {}) { return authModalHarness('login', overrides); }

function authClock() {
  let now = 0, id = 0; const pending = new Map();
  return { setTimeout(callback, delay = 0) { const key = ++id; pending.set(key, { callback, at: now + delay }); return key; }, clearTimeout(key) { pending.delete(key); }, advance(ms) { const end = now + ms; let count = 0; while (true) { const next = [...pending].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break; if (++count > 10000) throw new Error('Fixture timer loop'); now = next[1].at; pending.delete(next[0]); next[1].callback(); } now = end; } };
}
function fillRegistration(view, phone = '9876543210') {
  fireEvent.change(view.getByLabelText('Full Name'), { target: { value: ' fixture-player ' } });
  fireEvent.change(view.getByLabelText('Phone Number'), { target: { value: phone } });
  fireEvent.change(view.getByLabelText('Password'), { target: { value: ' fixture-pass1 ' } });
  fireEvent.change(view.getByLabelText('Confirm Password'), { target: { value: ' fixture-pass1 ' } });
}
function fillOtp(view, value = '1234') {
  const inputs = [...document.querySelectorAll('.otp-input')]; assert.equal(inputs.length, 4);
  inputs.forEach((input, index) => fireEvent.change(input, { target: { value: value[index] } }));
}

test('LoginModal stays closed unless login mode is explicitly open', () => {
  const { container } = loginModalHarness({
    auth: { isAuthModalOpen: false },
  });
  assert.equal(container.innerHTML, '');
});

test('LoginModal blocks invalid credentials without calling login or OTP adapters', () => {
  const view = loginModalHarness();
  const phone = view.getByLabelText('Phone Number');
  const password = view.getByLabelText('Password');
  const submit = view.getByRole('button', { name: 'Sign in' });

  assert.equal(submit.disabled, true);
  fireEvent.change(phone, { target: { value: '12345' } });
  fireEvent.change(password, { target: { value: '123' } });

  assert.match(view.getByText('Enter a valid 10-digit mobile number.').textContent, /10-digit/);
  assert.match(view.getByText('At least 6 characters.').textContent, /6 characters/);
  assert.equal(submit.disabled, true);
  fireEvent.submit(submit.closest('form'));
  assert.equal(view.calls.login.calls.length, 0);
  assert.equal(view.calls.requestOtp.calls.length, 0);
  assert.equal(view.calls.loginWithOtp.calls.length, 0);
});

test('LoginModal submits a normalized phone and trimmed password through the password adapter only', async () => {
  const pending = deferred();
  const login = spy(() => pending.promise);
  const view = loginModalHarness({ auth: { login } });

  fireEvent.change(view.getByLabelText('Phone Number'), {
    target: { value: '9876543210' },
  });
  fireEvent.change(view.getByLabelText('Password'), {
    target: { value: '  secret1  ' },
  });
  const submit = view.getByRole('button', { name: 'Sign in' });
  assert.equal(submit.disabled, false);
  fireEvent.click(submit);

  await waitFor(() => assert.equal(login.calls.length, 1));
  assert.deepEqual(login.calls[0], ['+919876543210', 'secret1']);
  assert.equal(view.calls.requestOtp.calls.length, 0);
  assert.equal(view.calls.loginWithOtp.calls.length, 0);
  assert.equal(submit.disabled, true);

  await act(async () => pending.resolve());
  await waitFor(() => assert.equal(view.notifications.success.calls.length, 1));
  assert.equal(view.notifications.success.calls[0][0], 'Signed in successfully');
});

test('LoginModal surfaces a rejected password login and does not fall back to OTP', async () => {
  const login = spy(async () => {
    throw new Error('Invalid credentials');
  });
  const view = loginModalHarness({ auth: { login } });

  fireEvent.change(view.getByLabelText('Phone Number'), {
    target: { value: '9876543210' },
  });
  fireEvent.change(view.getByLabelText('Password'), {
    target: { value: 'secret1' },
  });
  fireEvent.click(view.getByRole('button', { name: 'Sign in' }));

  await waitFor(() => assert.ok(view.getByText('Invalid credentials')));
  assert.equal(view.notifications.error.calls.length, 1);
  assert.equal(view.calls.requestOtp.calls.length, 0);
  assert.equal(view.calls.loginWithOtp.calls.length, 0);
});

function requireAuthHarness(initialAuth) {
  const state = {
    isAuthenticated: false,
    isHydrating: false,
    openAuthModal: spy(),
    ...initialAuth,
  };
  const load = loader({
    '@/lib/auth': { useAuth: () => state },
  }, browserGlobals);
  const RequireAuth = load('src/lib/RequireAuth.tsx').default;
  const element = () => React.createElement(
    RequireAuth,
    null,
    React.createElement('div', null, 'Private screen'),
  );
  return { state, element };
}

test('RequireAuth renders private content only for a signed-in user', () => {
  const harness = requireAuthHarness({ isAuthenticated: true });
  const view = render(harness.element());

  assert.equal(view.getByText('Private screen').textContent, 'Private screen');
  assert.equal(harness.state.openAuthModal.calls.length, 0);
});

test('RequireAuth waits for hydration, then opens login once while content stays hidden', async () => {
  const harness = requireAuthHarness({ isHydrating: true });
  const view = render(harness.element());

  assert.equal(view.queryByText('Private screen'), null);
  assert.equal(harness.state.openAuthModal.calls.length, 0);

  harness.state.isHydrating = false;
  view.rerender(harness.element());
  await waitFor(() => assert.equal(harness.state.openAuthModal.calls.length, 1));
  assert.deepEqual(harness.state.openAuthModal.calls[0], ['login']);

  view.rerender(harness.element());
  await act(async () => undefined);
  assert.equal(harness.state.openAuthModal.calls.length, 1);
});

function authProviderHarness(backendOverrides = {}, options = {}) {
  const atomValues = {
    user: [],
    token: [],
    modal: [],
  };
  const atoms = {
    userAtom: Symbol('user'),
    tokenAtom: Symbol('token'),
    isAuthModalOpenAtom: Symbol('modal'),
  };
  const atomSetters = new Map([
    [atoms.userAtom, value => atomValues.user.push(value)],
    [atoms.tokenAtom, value => atomValues.token.push(value)],
    [atoms.isAuthModalOpenAtom, value => atomValues.modal.push(value)],
  ]);
  const hooks = {
    httpUnauthorized: null,
    graphqlUnauthorized: null,
    httpTokenGetter: null,
    graphqlTokenGetter: null,
  };
  const backend = {
    getMe: spy(async () => null),
    getUserData: spy(async () => null),
    loginWithPassword: spy(async () => ({ token: null, user: null })),
    ...backendOverrides,
  };
  const notify = {
    success: spy(),
    warning: spy(),
    error: spy(),
  };
  const load = loader({
    '@/lib/http': {
      setUnauthorizedHandler: handler => { hooks.httpUnauthorized = handler; },
      setAuthTokenGetter: getter => { hooks.httpTokenGetter = getter; },
    },
    '@/lib/graphqlClient': {
      setGraphqlUnauthorizedHandler: handler => { hooks.graphqlUnauthorized = handler; },
      setGraphqlAuthTokenGetter: getter => { hooks.graphqlTokenGetter = getter; },
    },
    '@/lib/api/userBackend': backend,
    '@/lib/api/user': { getUserDetail: spy(async () => null) },
    jotai: { useSetAtom: atom => atomSetters.get(atom) },
    '@/state/authAtoms': atoms,
    '@/lib/request': { requestWithToast: async callback => callback() },
    '@/lib/notify': { notify },
    '@/lib/tokenService': {
      tokenService: {
        getToken: () => localStorage.getItem('token'),
        isTokenExpired: options.isTokenExpired || (() => false),
      },
    },
  }, browserGlobals);
  const authModule = load('src/lib/auth.tsx');
  let current;
  function Probe() {
    current = authModule.useAuth();
    return React.createElement(
      'output',
      { 'data-authenticated': String(current.isAuthenticated) },
      current.user?.username || 'anonymous',
    );
  }
  const view = render(
    React.createElement(
      authModule.AuthProvider,
      null,
      React.createElement(Probe),
    ),
  );
  return {
    ...view,
    backend,
    hooks,
    atomValues,
    notify,
    get auth() { return current; },
  };
}

test('AuthProvider remains hydrating and anonymous until getMe validates the saved token', async () => {
  const refresh = deferred();
  localStorage.setItem('stakex_user', JSON.stringify({
    id: 'saved-1',
    name: 'Saved Player',
    balance: '42.5',
    walletType: '2',
  }));
  localStorage.setItem('token', 'saved-token');
  const getMe = spy(() => refresh.promise);
  const view = authProviderHarness({ getMe });

  assert.equal(view.auth.isHydrating, true);
  assert.equal(view.auth.isAuthenticated, false);
  assert.equal(view.auth.user, null);
  assert.equal(getMe.calls.length, 1);

  await act(async () => {
    refresh.resolve({
      id: 'saved-1',
      name: 'Saved Player',
      balance: '42.5',
      walletType: '2',
    });
    await refresh.promise;
  });

  await waitFor(() => assert.equal(view.auth.isHydrating, false));
  assert.equal(view.auth.isAuthenticated, true);
  assert.equal(view.auth.user.username, 'Saved Player');
  assert.equal(view.auth.user.balance, 42.5);
  assert.equal(view.auth.user.walletType, '2');
  assert.equal(view.auth.user.playerType, 'REGULAR');
  assert.equal(view.hooks.httpTokenGetter(), 'saved-token');
  assert.equal(view.hooks.graphqlTokenGetter(), 'saved-token');
  assert.equal(view.atomValues.token.at(-1), 'saved-token');
});

test('AuthProvider clears a cached user when no token exists without calling getMe', async () => {
  localStorage.setItem('stakex_user', JSON.stringify({ id: 'cached-1', username: 'Cached Player' }));
  const getMe = spy(async () => ({ id: 'cached-1', username: 'Cached Player' }));
  const view = authProviderHarness({ getMe });

  await waitFor(() => assert.equal(view.auth.isHydrating, false));
  assert.equal(view.auth.isAuthenticated, false);
  assert.equal(view.auth.user, null);
  assert.equal(getMe.calls.length, 0);
  assert.equal(localStorage.getItem('stakex_user'), null);
  assert.equal(localStorage.getItem('token'), null);
  assert.equal(view.atomValues.user.at(-1), null);
  assert.equal(view.atomValues.token.at(-1), null);
});

test('AuthProvider clears an expired token and cached user before contacting getMe', async () => {
  localStorage.setItem('stakex_user', JSON.stringify({ id: 'cached-2', username: 'Expired Player' }));
  localStorage.setItem('token', 'expired-token');
  const getMe = spy(async () => ({ id: 'cached-2', username: 'Expired Player' }));
  const view = authProviderHarness(
    { getMe },
    { isTokenExpired: token => token === 'expired-token' },
  );

  await waitFor(() => assert.equal(view.auth.isHydrating, false));
  assert.equal(view.auth.isAuthenticated, false);
  assert.equal(getMe.calls.length, 0);
  assert.equal(localStorage.getItem('stakex_user'), null);
  assert.equal(localStorage.getItem('token'), null);
});

test('AuthProvider treats a malformed token as invalid and fails closed', async () => {
  localStorage.setItem('stakex_user', JSON.stringify({ id: 'cached-3', username: 'Malformed Player' }));
  localStorage.setItem('token', 'not-a-jwt');
  const getMe = spy(async () => ({ id: 'cached-3', username: 'Malformed Player' }));
  const view = authProviderHarness(
    { getMe },
    { isTokenExpired: token => token === 'not-a-jwt' },
  );

  await waitFor(() => assert.equal(view.auth.isHydrating, false));
  assert.equal(view.auth.isAuthenticated, false);
  assert.equal(getMe.calls.length, 0);
  assert.equal(localStorage.getItem('stakex_user'), null);
  assert.equal(localStorage.getItem('token'), null);
});

test('AuthProvider clears cached auth when initial getMe rejects', async () => {
  localStorage.setItem('stakex_user', JSON.stringify({ id: 'cached-4', username: 'Rejected Player' }));
  localStorage.setItem('token', 'unverified-token');
  const view = authProviderHarness({
    getMe: spy(async () => { throw new Error('Session validation unavailable'); }),
  });

  await waitFor(() => assert.equal(view.auth.isHydrating, false));
  assert.equal(view.auth.isAuthenticated, false);
  assert.equal(view.auth.user, null);
  assert.equal(localStorage.getItem('stakex_user'), null);
  assert.equal(localStorage.getItem('token'), null);
});

test('AuthProvider clears cached auth when getMe returns no user for a revoked session', async () => {
  localStorage.setItem('stakex_user', JSON.stringify({ id: 'cached-5', username: 'Revoked Player' }));
  localStorage.setItem('token', 'revoked-token');
  const getMe = spy(async () => null);
  const view = authProviderHarness({ getMe });

  await waitFor(() => assert.equal(view.auth.isHydrating, false));
  assert.equal(view.auth.isAuthenticated, false);
  assert.equal(view.auth.user, null);
  assert.equal(getMe.calls.length, 1);
  assert.equal(localStorage.getItem('stakex_user'), null);
  assert.equal(localStorage.getItem('token'), null);
});

test('AuthProvider stores a login token, normalizes the user, and updates auth adapters', async () => {
  const loginWithPassword = spy(async () => ({
    token: 'test-token',
    user: {
      id: 'login-1',
      username: 'Login Player',
      phone: '+919876543210',
      balance: '12',
      walletType: '2',
      requirePasswordReset: true,
    },
  }));
  const view = authProviderHarness({ loginWithPassword });
  await waitFor(() => assert.equal(view.auth.isHydrating, false));

  await act(async () => {
    await view.auth.login('+919876543210', 'secret1');
  });

  assert.deepEqual(loginWithPassword.calls[0], ['+919876543210', 'secret1']);
  assert.equal(localStorage.getItem('token'), 'test-token');
  assert.equal(view.hooks.httpTokenGetter(), 'test-token');
  assert.equal(view.hooks.graphqlTokenGetter(), 'test-token');
  assert.equal(view.auth.isAuthenticated, true);
  assert.equal(view.auth.user.username, 'Login Player');
  assert.equal(view.auth.user.balance, 12);
  assert.equal(localStorage.getItem('stakex_selected_wallet'), 'bonus');
  assert.equal(view.atomValues.token.at(-1), 'test-token');
  assert.equal(view.atomValues.modal.at(-1), false);
  assert.equal(view.backend.getMe.calls.length, 0);
});

test('AuthProvider unauthorized handlers clear both saved user and token', async () => {
  localStorage.setItem('stakex_user', JSON.stringify({ id: 'saved-2', username: 'Saved' }));
  localStorage.setItem('token', 'stale-token');
  const view = authProviderHarness({
    getMe: spy(async () => ({ id: 'saved-2', username: 'Saved' })),
  });
  await waitFor(() => assert.equal(view.auth.isAuthenticated, true));
  await waitFor(() => assert.equal(view.backend.getUserData.calls.length, 1));

  act(() => view.hooks.httpUnauthorized());

  await waitFor(() => assert.equal(view.auth.isAuthenticated, false));
  assert.equal(localStorage.getItem('stakex_user'), null);
  assert.equal(localStorage.getItem('token'), null);
  assert.equal(typeof view.hooks.graphqlUnauthorized, 'function');
});

test('auth modal modes and disabled registration never render a mismatched native surface', () => {
  for (const [mode, overrides] of [['login', { auth: { authModalMode: 'register' } }], ['register', { auth: { isAuthModalOpen: false } }], ['register', { auth: { authModalMode: 'login' } }], ['register', { features: { registerEnabled: false } }]]) {
    const view = authModalHarness(mode, overrides);
    assert.equal(view.queryByRole('dialog'), null); assert.equal(view.graphql.calls.length, 0); assert.equal(view.calls.register.calls.length, 0); view.unmount();
  }
});
test('registration invalid fields cannot call password registration or OTP adapters', () => {
  const view = authModalHarness('register');
  const submit = view.getByRole('button', { name: 'Create account' }); assert.equal(submit.disabled, true);
  for (const [label, value] of [['Full Name', 'a'], ['Phone Number', '12345'], ['Password', 'short'], ['Confirm Password', 'different']]) fireEvent.change(view.getByLabelText(label), { target: { value } });
  fireEvent.submit(submit.closest('form')); assert.equal(submit.disabled, true); assert.equal(view.calls.register.calls.length, 0); assert.equal(view.calls.requestOtp.calls.length, 0); assert.equal(view.calls.registerWithOtp.calls.length, 0);
});
test('registration preserves normalized password stage and separate four-digit OTP confirmation', async () => {
  const view = authModalHarness('register'); fillRegistration(view);
  await act(async () => fireEvent.click(view.getByRole('button', { name: 'Create account' })));
  assert.deepEqual(view.calls.register.calls[0], ['fixture-player', '+919876543210', 'fixture-pass1', 'fixture-pass1']);
  assert.equal(view.calls.requestOtp.calls.length, 0); assert.equal(view.getByRole('button', { name: /Resend in 120s/ }).disabled, true);
  fillOtp(view); await act(async () => fireEvent.click(view.getByRole('button', { name: 'Verify and sign in' })));
  assert.deepEqual(view.calls.registerWithOtp.calls[0], ['fixture-player', '+919876543210', '1234']); assert.equal(view.calls.register.calls.length, 1); assert.equal(view.calls.closeAuthModal.calls.length, 1);
});
test('registration availability uses the original500ms normalized query and blocks a taken phone', async () => {
  const timers = authClock(); const view = authModalHarness('register', { clock: timers, graphqlRequest: async () => ({ checkPhoneAvailable: { available: false, message: 'Fixture phone already used' } }) });
  fillRegistration(view); await act(async () => timers.advance(499)); assert.equal(view.graphql.calls.length, 0);
  await act(async () => timers.advance(1)); assert.equal(view.graphql.calls.length, 1);
  assert.match(view.graphql.calls[0][0], /query CheckPhoneAvailable/); assert.equal(JSON.stringify(view.graphql.calls[0][1]), '{"phone":"+919876543210"}');
  assert.ok(view.getByText('Fixture phone already used')); assert.equal(view.getByRole('button', { name: 'Create account' }).disabled, true);
});
test('registration ignores stale availability after a changed phone or closed modal', async () => {
  const timers = authClock(), first = deferred(), second = deferred(); let requests = 0;
  const view = authModalHarness('register', { clock: timers, graphqlRequest: () => ++requests === 1 ? first.promise : second.promise });
  fillRegistration(view); await act(async () => timers.advance(500));
  fireEvent.change(view.getByLabelText('Phone Number'), { target: { value: '9123456780' } }); await act(async () => timers.advance(500));
  await act(async () => second.resolve({ checkPhoneAvailable: { available: true, message: null } }));
  await act(async () => first.resolve({ checkPhoneAvailable: { available: false, message: 'Stale taken phone' } }));
  assert.equal(view.queryByText('Stale taken phone'), null); assert.equal(view.getByRole('button', { name: 'Create account' }).disabled, false);
  const closing = deferred(); view.unmount();
  const closed = authModalHarness('register', { clock: timers, graphqlRequest: () => closing.promise }); fillRegistration(closed); await act(async () => timers.advance(500));
  closed.auth.isAuthModalOpen = false; closed.rerenderModal(); await act(async () => closing.resolve({ checkPhoneAvailable: { available: false, message: 'Closed response' } }));
  assert.equal(closed.queryByRole('dialog'), null); closed.auth.isAuthModalOpen = true; closed.rerenderModal(); assert.equal(closed.queryByText('Closed response'), null);
});
test('registration referral display prioritizes URL and ignores expired stored referral metadata', () => {
  localStorage.setItem('referral_code', JSON.stringify({ code: 'STORED', expiresAt: Date.now() + 10000 })); window.history.replaceState({}, '', '/?ref=url-code');
  const url = authModalHarness('register'); assert.ok(url.getByText('URL-CODE')); assert.equal(url.queryByText('STORED'), null); url.unmount();
  window.history.replaceState({}, '', '/'); const stored = authModalHarness('register'); assert.ok(stored.getByText('STORED')); stored.unmount();
  localStorage.setItem('referral_code', JSON.stringify({ code: 'EXPIRED', expiresAt: Date.now() - 1 })); const expired = authModalHarness('register'); assert.equal(expired.queryByText('EXPIRED'), null);
});
test('registration WhatsApp shortcut remains absent unless the tenant actually supplies a valid contact', () => {
  for (const identity of [{}, { whatsappSupportPhone: '123' }]) { const view = authModalHarness('register', { identity }); assert.equal(document.querySelector('a[href^="https://wa.me/"]'), null); view.unmount(); }
  const view = authModalHarness('register', { identity: { whatsappSupportPhone: '+91 (12345) 67890' } }); const link = document.querySelector('a[href^="https://wa.me/"]');
  assert.ok(link); assert.ok(link.getAttribute('href').startsWith('https://wa.me/911234567890?text=')); assert.equal(link.target, '_blank'); assert.match(link.rel, /noopener/); assert.match(link.rel, /noreferrer/);
});
test('login OTP retains its separate request/verification adapters and120-second resend guard', async () => {
  const timers = authClock(); const view = loginModalHarness({ clock: timers }); fireEvent.change(view.getByLabelText('Phone Number'), { target: { value: '9876543210' } });
  await act(async () => fireEvent.click(view.getByRole('button', { name: 'Send OTP' })));
  assert.deepEqual(view.calls.requestOtp.calls[0], ['+919876543210']); assert.equal(view.getByRole('button', { name: /Resend in 120s/ }).disabled, true);
  for (let index = 0; index < 120; index++) await act(async () => timers.advance(1000));
  await act(async () => fireEvent.click(view.getByRole('button', { name: 'Resend code' })));
  assert.equal(view.calls.requestOtp.calls.length, 2); assert.equal(view.calls.requestResetOtp.calls.length, 0);
  fillOtp(view); await act(async () => fireEvent.click(view.getByRole('button', { name: 'Verify and sign in' })));
  assert.deepEqual(view.calls.loginWithOtp.calls[0], ['+919876543210', '1234']); assert.equal(view.calls.login.calls.length, 0);
});
test('editing a middle OTP digit preserves later slots, blocks incomplete verification and submits the exact refilled code', async () => {
  for (const mode of ['login', 'register']) {
    const view = authModalHarness(mode);
    if (mode === 'register') { fillRegistration(view); await act(async () => fireEvent.click(view.getByRole('button', { name: 'Create account' }))); }
    else { fireEvent.change(view.getByLabelText('Phone Number'), { target: { value: '9876543210' } }); await act(async () => fireEvent.click(view.getByRole('button', { name: 'Send OTP' }))); }
    fillOtp(view); const inputs = [...document.querySelectorAll('.otp-input')];
    inputs.forEach((input, index) => assert.equal(input.getAttribute('aria-label'), `Code digit ${index + 1} of 4`));
    fireEvent.change(inputs[1], { target: { value: '' } }); assert.deepEqual(inputs.map(input => input.value), ['1', '', '3', '4']);
    const verify = view.getByRole('button', { name: 'Verify and sign in' }); assert.equal(verify.disabled, true); fireEvent.submit(verify.closest('form'));
    assert.equal(view.calls.loginWithOtp.calls.length + view.calls.registerWithOtp.calls.length, 0);
    fireEvent.change(inputs[1], { target: { value: '9' } }); assert.deepEqual(inputs.map(input => input.value), ['1', '9', '3', '4']); await act(async () => fireEvent.click(verify));
    const call = mode === 'login' ? view.calls.loginWithOtp.calls[0] : view.calls.registerWithOtp.calls[0]; assert.equal(call.at(-1), '1934'); view.unmount();
  }
});
test('forgot-password initial send and resend use reset OTP exclusively and preserve reset payload', async () => {
  const timers = authClock(); const view = loginModalHarness({ clock: timers });
  fireEvent.change(view.getByLabelText('Phone Number'), { target: { value: '9876543210' } }); fireEvent.click(view.getByRole('button', { name: 'Forgot Password?' }));
  await act(async () => fireEvent.submit(view.getByRole('dialog').querySelector('form')));
  assert.deepEqual(view.calls.requestResetOtp.calls[0], ['+919876543210']); assert.equal(view.calls.requestOtp.calls.length, 0);
  for (let index = 0; index < 120; index++) await act(async () => timers.advance(1000));
  await act(async () => fireEvent.click(view.getByRole('button', { name: 'Resend code' }))); assert.equal(view.calls.requestResetOtp.calls.length, 2); assert.equal(view.calls.requestOtp.calls.length, 0);
  fillOtp(view); fireEvent.change(view.getByLabelText('New Password'), { target: { value: ' fixture-new2 ' } }); fireEvent.change(view.getByLabelText('Confirm Password'), { target: { value: 'different' } }); assert.equal(view.getByRole('button', { name: 'Reset Password' }).disabled, true);
  fireEvent.change(view.getByLabelText('Confirm Password'), { target: { value: ' fixture-new2 ' } }); await act(async () => fireEvent.click(view.getByRole('button', { name: 'Reset Password' })));
  assert.deepEqual(view.calls.resetPassword.calls[0], ['+919876543210', '1234', 'fixture-new2']); assert.equal(view.calls.login.calls.length, 0); assert.equal(view.calls.loginWithOtp.calls.length, 0); assert.ok(view.getByRole('button', { name: 'Sign in' }));
});
test('registration and OTP failures remain actionable errors without successful close or fallback authentication', async () => {
  const register = spy(async () => { throw new Error('Fixture registration error'); }); const registration = authModalHarness('register', { auth: { register } }); fillRegistration(registration);
  await act(async () => fireEvent.click(registration.getByRole('button', { name: 'Create account' }))); assert.ok(registration.getByText('Fixture registration error')); assert.equal(registration.calls.closeAuthModal.calls.length, 0); assert.equal(registration.calls.registerWithOtp.calls.length, 0); registration.unmount();
  const loginWithOtp = spy(async () => { throw new Error('Fixture invalid code'); }); const login = loginModalHarness({ auth: { loginWithOtp } }); fireEvent.change(login.getByLabelText('Phone Number'), { target: { value: '9876543210' } }); await act(async () => fireEvent.click(login.getByRole('button', { name: 'Send OTP' }))); fillOtp(login);
  await act(async () => fireEvent.click(login.getByRole('button', { name: 'Verify and sign in' }))); assert.ok(login.getByText('Fixture invalid code')); assert.equal(login.calls.login.calls.length, 0); assert.equal(login.calls.closeAuthModal.calls.length, 0);
});
test('AuthProvider retains referral metadata across the two registration endpoints without replacing identity or credentials', async () => {
  window.history.replaceState({}, '', '/?affiliateCode=url-fixture'); localStorage.setItem('referral_code', JSON.stringify({ code: 'STORED', expiresAt: Date.now() + 10000 }));
  const registerUser = spy(async () => ({ success: true })); const loginWithPassword = spy(async () => ({ token: 'fixture-only-token', user: { id: 'fixture-user', username: 'fixture-player', requirePasswordReset: true } }));
  const view = authProviderHarness({ registerUser, loginWithPassword }); await waitFor(() => assert.equal(view.auth.isHydrating, false));
  await act(async () => view.auth.register('fixture-player', '+919876543210', 'fixture-pass1', 'fixture-pass1'));
  assert.equal(JSON.stringify(registerUser.calls[0]), '[{"username":"fixture-player","phone":"+919876543210","password":"fixture-pass1","confirmPassword":"fixture-pass1","affiliateCode":"url-fixture"}]');
  assert.notEqual(localStorage.getItem('referral_code'), null); assert.equal(window.location.search, '?affiliateCode=url-fixture');
  await act(async () => view.auth.registerWithOtp('ignored-new-name', '+919876543210', '1234'));
  assert.equal(localStorage.getItem('referral_code'), null); assert.equal(window.location.search, '');
  assert.equal(JSON.stringify(registerUser.calls[1]), '[{"username":"fixture-player","phone":"+919876543210","password":"fixture-pass1","confirmPassword":"fixture-pass1","affiliateCode":"url-fixture","otp":"1234"}]');
  assert.deepEqual(loginWithPassword.calls[0], ['+919876543210', 'fixture-pass1']);
});

test('signedInAt is set by a sign-in made on this page, not by a restored session', async () => {
  localStorage.setItem('token', 'saved-token');
  const view = authProviderHarness({
    getMe: spy(async () => ({ id: 'p1', name: 'Restored' })),
    loginWithPassword: spy(async () => ({ token: 'fresh-token', user: { id: 'p1', name: 'Fresh' } })),
  });
  await waitFor(() => assert.equal(view.auth.isHydrating, false));
  assert.equal(view.auth.isAuthenticated, true);
  assert.equal(view.auth.signedInAt, null, 'a restored session is not a sign-in');
  const before = Date.now();
  await act(async () => { await view.auth.login('player', 'secret'); });
  assert.equal(typeof view.auth.signedInAt, 'number');
  assert.ok(view.auth.signedInAt >= before);
});
