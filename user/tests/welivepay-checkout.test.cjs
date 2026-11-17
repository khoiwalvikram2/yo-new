// WeLivePay on the Deposit page: Proceed on the gateway starts a checkout card on the page (no confirm step,
// no redirect), the card keeps checking the order status, and the open checkout survives a reload.
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, localStorage: dom.window.localStorage })) {
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function() { this.open = false; };
const React = require('react');
const { MemoryRouter } = require('react-router-dom');
const { render, cleanup, fireEvent, act, waitFor, within } = require('@testing-library/react');
const { loader } = require('./load-source.cjs');

const ok = data => ({ meta: { code: 200 }, data });
const plain = value => JSON.parse(JSON.stringify(value)); // objects made inside the loader's realm
const spy = (implementation = () => undefined) => { const fn = (...args) => { fn.calls.push(args); return implementation(...args); }; fn.calls = []; return fn; };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
// Timers for the page's own modules only (React and testing-library keep the real ones)
function clock() {
  let now = 0, id = 0;
  const pending = new Map();
  const schedule = (callback, delay = 0, repeat = false) => { const key = ++id; pending.set(key, { callback, time: now + delay, delay, repeat }); return key; };
  return {
    setTimeout: (callback, delay) => schedule(callback, delay), clearTimeout: key => pending.delete(key),
    setInterval: (callback, delay) => schedule(callback, delay, true), clearInterval: key => pending.delete(key),
    advance(ms) {
      const end = now + ms; let count = 0;
      while (true) {
        const next = [...pending].filter(([, item]) => item.time <= end).sort((a, b) => a[1].time - b[1].time)[0];
        if (!next) break;
        if (++count > 10000) throw new Error('Fixture timer loop');
        const [key, item] = next; now = item.time; pending.delete(key);
        if (item.repeat) pending.set(key, { ...item, time: now + item.delay });
        item.callback();
      }
      now = end;
    },
  };
}
const setHidden = hidden => { if (hidden) Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); else delete document.visibilityState; };
const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, Node: dom.window.Node,
  HTMLInputElement: dom.window.HTMLInputElement, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), CustomEvent: dom.window.CustomEvent };
test.afterEach(() => { cleanup(); setHidden(false); localStorage.clear(); document.body.innerHTML = ''; document.body.style.overflow = ''; });

const KEY = 'welivepay-checkout:localhost:7'; // site (jsdom host) and the fixture player
const STATUS_ERROR = 'Payment confirmation is temporarily unavailable. Check again shortly.';
const LATE_PAYMENT = 'Start a new checkout if you have not paid. Any confirmed late payment will still be credited.';
const helpers = loader({}, { localStorage: dom.window.localStorage })('src/lib/welivepayCheckout.ts');

// ------------------------------------------------------------------ helpers
test('checkout helpers: the storage key, saved checkouts, QR sources, safe links and statuses', () => {
  assert.equal(helpers.welivepayCheckoutKey('site.example', 7), 'welivepay-checkout:site.example:7');
  for (const none of [null, undefined, '', ' ']) assert.equal(helpers.welivepayCheckoutKey('site.example', none), null, String(none));

  const checkout = { orderId: 'WLP-1', paymentLink: 'https://pay.example/1', hostedUrl: null, qrImage: '', amount: 500 };
  helpers.saveCheckout(KEY, checkout);
  assert.deepEqual(plain(helpers.readSavedCheckout(KEY)), checkout);
  helpers.clearSavedCheckout(KEY);
  assert.equal(helpers.readSavedCheckout(KEY), null);
  for (const bad of ['not json', '{"orderId":"","paymentLink":"","qrImage":"","amount":5}', '{"orderId":"A","paymentLink":"x","qrImage":"","amount":"5"}',
    '{"orderId":"A","paymentLink":"x","amount":5}', '{"orderId":"A","paymentLink":"x","qrImage":"","amount":0}', '[]', 'null']) {
    localStorage.setItem(KEY, bad);
    assert.equal(helpers.readSavedCheckout(KEY), null, bad);
  }
  assert.equal(helpers.readSavedCheckout(null), null);

  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };
  const offline = loader({}, { localStorage: blocked })('src/lib/welivepayCheckout.ts');
  assert.equal(offline.readSavedCheckout(KEY), null);
  assert.doesNotThrow(() => offline.saveCheckout(KEY, checkout));
  assert.doesNotThrow(() => offline.clearSavedCheckout(KEY));

  assert.equal(helpers.checkoutQrSrc(''), '');
  assert.equal(helpers.checkoutQrSrc(null), '');
  assert.equal(helpers.checkoutQrSrc('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(helpers.checkoutQrSrc('https://cdn.example/qr.png'), 'https://cdn.example/qr.png');
  assert.equal(helpers.checkoutQrSrc('iVBORw0K\nGgo='), 'data:image/png;base64,iVBORw0KGgo=', 'bare base64 becomes a PNG');
  assert.equal(helpers.checkoutQrSrc('data:text/html,<b>x</b>').startsWith('data:image/png;base64,'), true, 'only image data URIs pass as they are');

  assert.equal(helpers.checkoutLink({ hostedUrl: 'https://pay.example/hosted', paymentLink: 'upi://pay?pa=a@b' }), 'https://pay.example/hosted');
  assert.equal(helpers.checkoutLink({ hostedUrl: null, paymentLink: 'upi://pay?pa=a@b' }), 'upi://pay?pa=a@b');
  assert.equal(helpers.checkoutLink({ hostedUrl: '', paymentLink: 'http://pay.example/1' }), 'http://pay.example/1');
  assert.equal(helpers.checkoutLink({ hostedUrl: 'javascript:alert(1)', paymentLink: 'https://pay.example/1' }), 'https://pay.example/1');
  for (const unsafe of ['javascript:alert(1)', 'intent://pay', 'data:text/html,x', '', '/relative']) assert.equal(helpers.checkoutLink({ hostedUrl: null, paymentLink: unsafe }), null, unsafe);

  for (const status of ['pending', 'success', 'expired', 'invalid']) assert.equal(helpers.normalizeCheckoutStatus(status), status);
  assert.equal(helpers.normalizeCheckoutStatus('SUCCESS'), 'success');
  for (const other of ['', null, undefined, 'processing']) assert.equal(helpers.normalizeCheckoutStatus(other), 'pending');
});

test('the API starts a WeLivePay order and reads its status', async () => {
  const queries = [];
  const api = loader({ '@/lib/graphqlClient': { graphqlRequest: async (query, variables) => {
    queries.push({ query, variables });
    if (/createWelivepayDeposit\(/.test(query)) return { createWelivepayDeposit: ok({ orderId: 'WLP-1', paymentLink: 'https://pay.example/1', hostedUrl: null, qrImage: '' }) };
    if (variables.orderId === 'someone-else') throw new Error('Payment order not found');
    return { welivepayDepositStatus: { orderId: variables.orderId, status: 'pending', amount: 500 } };
  } } }, globals)('src/lib/api/user.ts');
  const created = await api.createWelivepayDeposit(500);
  assert.match(queries[0].query, /createWelivepayDeposit\(amount: \$amount\)/);
  assert.match(queries[0].query, /data \{ orderId paymentLink hostedUrl qrImage \}/);
  assert.deepEqual(plain(queries[0].variables), { amount: 500 });
  assert.equal(created.meta.code, 200);
  assert.equal(created.data.orderId, 'WLP-1');
  assert.deepEqual(plain(await api.getWelivepayDepositStatus('WLP-1')), { orderId: 'WLP-1', status: 'pending', amount: 500 });
  assert.match(queries[1].query, /welivepayDepositStatus\(orderId: \$orderId\) \{ orderId status amount \}/);
  await assert.rejects(api.getWelivepayDepositStatus('someone-else'), /Payment order not found/);
});

// ------------------------------------------------------------------ the page
const appStubs = {
  'react-i18next': { useTranslation: () => ({ t: (key, options = {}) => options.defaultValue ?? key }) },
  '@/hooks/useAppSettings': { usePaymentConfig: () => ({ depositMin: null, depositMax: null, depositFeePercent: 0 }), useParsedSettings: () => ({ hideDW: false }), useLogo: () => ({ siteTitle: 'Fixture' }) },
  '@/hooks/usePageSEO': { usePageSEO() {} },
  '@/lib/request': { requestWithToast: fn => fn() },
  '@/components/animations/ConfettiBurst': { __esModule: true, default: () => null },
  html2canvas: { __esModule: true, default: async () => ({ toDataURL: () => 'data:image/png;base64,Zml4dHVyZQ==' }) },
};
const gatewayAccount = { id: 'gateway-WELIVEPAY', type: 'gateway', displayName: 'UPI (Instant)', minAmount: 10, maxAmount: 100000, weight: 0 };
const bankAccount = { id: 'b1', type: 'bank', accountNumber: '1234567890', ifscCode: 'HDFC0001234', bankName: 'Fixture Bank', accountHolderName: 'Fixture Owner', displayName: 'Fixture Bank', minAmount: 100, maxAmount: 100000, weight: 1 };
const upiAccount = { id: 'u1', type: 'upi', accountNumber: 'fixture@upi', upiId: 'fixture@upi', displayName: 'Fixture UPI', minAmount: 100, maxAmount: 100000, weight: 1 };
const cryptoAccount = { id: 'w1', type: 'crypto', accountNumber: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', walletAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', network: 'TRC20',
  displayName: 'USDT (TRC20)', cryptoRate: 92.5, cryptoBonusPercent: null, minAmount: 500, maxAmount: 100000, weight: 2 };
const order = { orderId: 'WLP-ORDER-1', paymentLink: 'https://pay.example/link/1', hostedUrl: 'https://pay.example/checkout/1', qrImage: 'iVBORw0KGgo=' };

function depositPage(options = {}) {
  const calls = { creates: [], statuses: [], adminDeposits: [], history: 0, legacy: 0 };
  const queue = [...(options.statuses ?? ['pending'])]; // the last one repeats
  const api = {
    getAdminAccounts: async () => ok(options.accounts ?? [gatewayAccount, bankAccount, upiAccount, cryptoAccount]),
    getAdminDepositRequests: async () => { calls.history += 1; return ok([]); },
    createAdminDeposit: async payload => {
      calls.adminDeposits.push(payload);
      return ok([{ id: 'dep-1', amount: payload.amount, status: 'PENDING', createdAt: '2026-10-31T10:00:00Z', utr: payload.txnRef, method: payload.type === 'upi' ? 'UPI' : 'BANK_TRANSFER' }]);
    },
    createDeposit: async () => { calls.legacy += 1; return ok({ redirectUrl: 'https://pay.example/legacy' }); },
    createWelivepayDeposit: async amount => { calls.creates.push(amount); return options.create ? options.create(amount) : ok(order); },
    getWelivepayDepositStatus: async orderId => {
      calls.statuses.push(orderId);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return { orderId, status: next, amount: 9250 };
    },
    uploadDepositProof: async () => ({ success: true, data: { key: 'proof-key', url: '' } }),
  };
  const auth = { user: { id: 7, playerType: 'REGULAR', username: 'fixture-player' }, refreshUser: spy(async () => undefined) };
  const timers = clock();
  const stubs = { ...appStubs, '@/lib/auth': { useAuth: () => auth }, '@/lib/api/user': api };
  const load = loader(stubs, { ...globals, ...timers, ...(options.localStorage ? { localStorage: options.localStorage } : {}) });
  // The loader resolves files, not folders: hand the page its '@/components/deposit' barrel
  stubs['@/components/deposit'] = load('src/components/deposit/index.ts');
  const Page = load('src/pages/Deposit.tsx').default;
  const view = render(React.createElement(MemoryRouter, null, React.createElement(Page)));
  return { view, calls, auth, timers };
}
const card = (view, name) => view.getByText(name, { selector: 'h4' }).closest('.dep-method');
const checkoutCard = view => view.container.querySelector('section.dep-checkout');
async function toMethods(view, amount = '9250') {
  fireEvent.change(view.getByPlaceholderText('Enter amount'), { target: { value: amount } });
  // Enabled once the accounts have loaded and the amount fits them
  await waitFor(() => assert.equal(view.getByRole('button', { name: 'Continue' }).disabled, false));
  fireEvent.click(view.getByRole('button', { name: 'Continue' }));
  await waitFor(() => assert.ok(view.getByRole('button', { name: 'Proceed' })));
}
async function startCheckout(view) {
  await toMethods(view);
  fireEvent.click(card(view, 'UPI (Instant)'));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Proceed' })); });
  return waitFor(() => { const section = checkoutCard(view); assert.ok(section); return section; });
}

test('Proceed on the gateway shows a checkout card on the page: no confirm step, no redirect', async () => {
  const pendingCreate = deferred();
  const { view, calls } = depositPage({ create: () => pendingCreate.promise });
  await toMethods(view);
  fireEvent.click(card(view, 'UPI (Instant)'));
  fireEvent.click(view.getByRole('button', { name: 'Proceed' }));
  await waitFor(() => assert.equal(view.getByRole('button', { name: /Starting checkout/ }).disabled, true));
  await act(async () => pendingCreate.resolve(ok(order)));
  const section = await waitFor(() => { const found = checkoutCard(view); assert.ok(found); return found; });

  assert.deepEqual(calls.creates, [9250]);
  assert.equal(calls.legacy, 0, 'the old redirect mutation is not used');
  assert.equal(dom.window.location.href, 'http://localhost/', 'the page did not navigate');
  assert.equal(view.queryByRole('button', { name: 'Confirm Deposit' }), null, 'no confirm step');
  const heading = within(section).getByRole('heading', { name: 'Complete your payment' });
  assert.equal(document.activeElement, heading, 'a new checkout takes the focus');
  for (const value of ['₹9,250.00', 'Reference: WLP-ORDER-1', 'Your balance updates after the payment gateway confirms your payment.']) assert.ok(section.textContent.includes(value), value);
  const link = within(section).getByRole('link', { name: /Open secure checkout/ });
  assert.equal(link.getAttribute('href'), 'https://pay.example/checkout/1', 'the hosted checkout comes first');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.getAttribute('rel'), /noopener/);
  assert.equal(section.querySelector('img.dep-checkout-qr').getAttribute('src'), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(within(section).queryByRole('button', { name: 'Close' }), null, 'no Close while the payment is open');
  await waitFor(() => assert.deepEqual(calls.statuses, ['WLP-ORDER-1']), 'checked at once');
  assert.deepEqual(plain(JSON.parse(localStorage.getItem(KEY))), { ...order, amount: 9250 });

  // One gateway checkout at a time (the method list reloads after the order: wait for it)
  await waitFor(() => assert.equal(view.getByRole('button', { name: 'Proceed' }).disabled, true));
  assert.ok(view.container.textContent.includes('Complete or close your open online payment to start a new one.'));
});

test('the card checks every 12 s while visible, on focus and on request, then confirms and refreshes once', async () => {
  const { view, calls, auth, timers } = depositPage({ statuses: ['pending', 'pending', 'pending', 'success'] });
  const section = await startCheckout(view);
  await waitFor(() => assert.equal(calls.statuses.length, 1));
  await act(async () => timers.advance(11_999));
  assert.equal(calls.statuses.length, 1);
  await act(async () => timers.advance(1));
  await waitFor(() => assert.equal(calls.statuses.length, 2), 'every 12 s');

  setHidden(true);
  await act(async () => timers.advance(36_000));
  assert.equal(calls.statuses.length, 2, 'a hidden page does not poll');
  await act(async () => { fireEvent.click(within(section).getByRole('button', { name: 'Check payment status' })); });
  await waitFor(() => assert.equal(calls.statuses.length, 3), 'the button checks even when hidden');
  assert.ok(section.textContent.includes('Complete your payment'));

  setHidden(false);
  const historyBefore = calls.history;
  await act(async () => { dom.window.dispatchEvent(new dom.window.Event('focus')); });
  await waitFor(() => assert.equal(calls.statuses.length, 4), 'window focus checks');
  await waitFor(() => assert.ok(within(section).getByRole('heading', { name: 'Payment confirmed' })));
  assert.ok(section.textContent.includes('Your deposit has been credited to your wallet.'));
  await waitFor(() => assert.equal(auth.refreshUser.calls.length, 1, 'the balance is refreshed'));
  await waitFor(() => assert.equal(calls.history, historyBefore + 1, 'the history is reloaded'));
  assert.equal(section.querySelector('a, img'), null, 'nothing left to pay');
  assert.equal(within(section).queryByRole('button', { name: 'Check payment status' }), null);

  await act(async () => timers.advance(120_000));
  await act(async () => { dom.window.dispatchEvent(new dom.window.Event('focus')); });
  assert.equal(calls.statuses.length, 4, 'a confirmed payment is not checked again');
  assert.equal(auth.refreshUser.calls.length, 1, 'refreshed once');

  fireEvent.click(within(section).getByRole('button', { name: 'Close' }));
  assert.equal(checkoutCard(view), null);
  assert.equal(localStorage.getItem(KEY), null, 'Close forgets the checkout');
});

test('an expired checkout says so, offers Close, and a new checkout can start after it', async () => {
  const { view, calls } = depositPage({ statuses: ['expired'] });
  const section = await startCheckout(view);
  await waitFor(() => assert.ok(within(section).getByRole('heading', { name: 'Payment checkout expired' })));
  assert.ok(section.textContent.includes(LATE_PAYMENT));
  assert.equal(section.querySelector('a, img'), null);
  assert.ok(within(section).getByRole('button', { name: 'Check payment status' }), 'a late payment can still be checked');
  fireEvent.click(within(section).getByRole('button', { name: 'Close' }));
  assert.equal(checkoutCard(view), null);
  assert.equal(localStorage.getItem(KEY), null);
  assert.ok(!view.container.textContent.includes('Complete or close your open online payment'));
  await waitFor(() => assert.equal(view.getByRole('button', { name: 'Proceed' }).disabled, false));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Proceed' })); });
  await waitFor(() => assert.deepEqual(calls.creates, [9250, 9250]));
});

test('a status error keeps the card and says so; the next good check clears it', async () => {
  const { view, calls, timers } = depositPage({ statuses: [new Error('Network Error'), 'pending'] });
  const section = await startCheckout(view);
  await waitFor(() => assert.ok(section.textContent.includes(STATUS_ERROR)));
  assert.ok(within(section).getByRole('heading', { name: 'Complete your payment' }), 'the card stays');
  assert.ok(within(section).getByRole('link', { name: /Open secure checkout/ }));
  assert.ok(within(section).getByRole('button', { name: 'Close' }), 'a card whose status cannot be read can be closed');
  assert.ok(localStorage.getItem(KEY), 'still saved');
  await act(async () => timers.advance(12_000));
  await waitFor(() => assert.equal(calls.statuses.length, 2));
  await waitFor(() => assert.ok(!section.textContent.includes(STATUS_ERROR)));
  assert.equal(within(section).queryByRole('button', { name: 'Close' }), null);
});

test('a refused checkout shows the server message and leaves no card', async () => {
  const message = 'Please add a mobile number to your profile before depositing';
  const { view, calls } = depositPage({ create: async () => ({ meta: { code: 400, message }, data: null }) });
  await toMethods(view);
  fireEvent.click(card(view, 'UPI (Instant)'));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Proceed' })); });
  await waitFor(() => assert.ok([...view.container.querySelectorAll('.dep-alert')].some(alert => alert.textContent === message)));
  assert.equal(checkoutCard(view), null);
  assert.equal(localStorage.getItem(KEY), null);
  assert.deepEqual(calls.statuses, []);
  assert.equal(view.getByRole('button', { name: 'Proceed' }).disabled, false, 'the player can try again');
});

test('the open checkout comes back after a reload, for the same player only', async () => {
  localStorage.setItem(KEY, JSON.stringify({ orderId: 'WLP-SAVED', paymentLink: 'upi://pay?pa=merchant@bank', hostedUrl: null, qrImage: '', amount: 500 }));
  localStorage.setItem('welivepay-checkout:localhost:8', JSON.stringify({ orderId: 'WLP-OTHER', paymentLink: 'https://pay.example/x', hostedUrl: null, qrImage: '', amount: 900 }));
  const { view, calls } = depositPage({ statuses: ['pending'] });
  const section = await waitFor(() => { const found = checkoutCard(view); assert.ok(found); return found; });
  assert.ok(section.textContent.includes('Reference: WLP-SAVED'));
  assert.ok(section.textContent.includes('₹500.00'));
  assert.ok(!view.container.textContent.includes('WLP-OTHER'), "another player's checkout is not shown");
  assert.equal(within(section).getByRole('link', { name: /Open secure checkout/ }).getAttribute('href'), 'upi://pay?pa=merchant@bank');
  assert.equal(section.querySelector('img'), null, 'no QR without one');
  assert.notEqual(document.activeElement, within(section).getByRole('heading'), 'a restored card does not steal the focus');
  await waitFor(() => assert.deepEqual(calls.statuses, ['WLP-SAVED']));
  // The open checkout blocks a second gateway checkout from the start
  await toMethods(view);
  fireEvent.click(card(view, 'UPI (Instant)'));
  assert.equal(view.getByRole('button', { name: 'Proceed' }).disabled, true);
});

test('blocked storage: the checkout still starts and shows, nothing throws', async () => {
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };
  const { view, calls } = depositPage({ localStorage: blocked, statuses: ['expired'] });
  const section = await startCheckout(view);
  assert.ok(section.textContent.includes('Reference: WLP-ORDER-1'));
  await waitFor(() => assert.ok(within(section).getByRole('button', { name: 'Close' })));
  fireEvent.click(within(section).getByRole('button', { name: 'Close' }));
  assert.equal(checkoutCard(view), null);
  assert.deepEqual(calls.creates, [9250]);
});

test('bank, UPI and crypto still go through the confirm step, even with a checkout open', async () => {
  const { view, calls } = depositPage();
  await startCheckout(view);
  for (const [name, label] of [['Fixture Bank', 'UTR / Reference'], ['USDT (TRC20)', 'Transaction hash (TxID)'], ['Fixture UPI', 'UTR / Reference']]) {
    // The method list reloads after the order: wait for it
    fireEvent.click(await waitFor(() => card(view, name)));
    assert.ok(!view.container.textContent.includes('Complete or close your open online payment'), `${name} is not blocked`);
    fireEvent.click(view.getByRole('button', { name: 'Proceed' }));
    await waitFor(() => assert.ok(view.getByLabelText(label)), name);
    if (name !== 'Fixture UPI') {
      fireEvent.click(view.getByRole('button', { name: /Change method/ }));
      await waitFor(() => assert.ok(view.getByRole('button', { name: 'Proceed' })));
    }
  }
  fireEvent.change(view.getByLabelText('UTR / Reference'), { target: { value: 'UTR123456789' } });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Confirm Deposit' })); });
  assert.deepEqual(plain(calls.adminDeposits), [{ accountId: 'u1', amount: 9250, txnRef: 'UTR123456789', type: 'upi' }]);
  assert.deepEqual(calls.creates, [9250], 'no second gateway checkout');
  assert.equal(calls.legacy, 0);
});
