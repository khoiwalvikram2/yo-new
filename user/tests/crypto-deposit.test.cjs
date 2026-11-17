// Crypto (USDT) deposits on the player Deposit page: the preview maths, the API contract, the method card,
// the confirm step (TxID required, warning, white QR), the server-quoted receipt, history and details.
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
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
const clipboard = [];
const downloads = [];
Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { clipboard.push(text); } } });
dom.window.HTMLAnchorElement.prototype.click = function() { downloads.push(this.download); };
const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, Node: dom.window.Node,
  HTMLInputElement: dom.window.HTMLInputElement, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), CustomEvent: dom.window.CustomEvent,
  setTimeout, clearTimeout, setInterval, clearInterval };
test.afterEach(() => { cleanup(); document.body.innerHTML = ''; document.body.style.overflow = ''; clipboard.length = 0; downloads.length = 0; });

const lib = loader()('src/lib/cryptoDeposit.ts');
const TRON_WALLET = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
const HASH = 'a7f5c0d2e4b6a8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8';

// ------------------------------------------------------------------ maths (same cases as the server's tests)
test('usdtFor rounds the USDT to send UP to 2 decimals and never adds a cent to an exact division', () => {
  assert.equal(lib.usdtFor(1000, 92.5), 10.82); // 10.8108...
  assert.equal(lib.usdtFor(100, 91), 1.1); // 1.0989...
  assert.equal(lib.usdtFor(1, 95), 0.02); // never rounds a deposit down to nothing
  assert.equal(lib.usdtFor(1100, 10), 110);
  assert.equal(lib.usdtFor(9250, 92.5), 100);
  assert.equal(lib.usdtFor(300000, 88.9), 3374.58);
  for (const rate of [83.3, 88.9, 91.07, 92.5, 99.99]) {
    for (const usdt of [1, 7, 33, 110, 4999]) assert.equal(lib.usdtFor(Number((usdt * rate).toFixed(4)), rate), usdt, `${usdt} @ ${rate}`);
  }
  for (const rate of [null, undefined, 0, -1, NaN, Infinity]) assert.equal(lib.usdtFor(1000, rate), null, String(rate));
  for (const amount of [0, -5, NaN, Infinity]) assert.equal(lib.usdtFor(amount, 92.5), null, String(amount));
  assert.equal(lib.formatUsdt(10.8), '10.80 USDT');
  assert.equal(lib.formatUsdt(110), '110.00 USDT');
});

test('the bonus percent is valid above 0 up to 50, and the bonus rounds DOWN to the paisa', () => {
  assert.equal(lib.cryptoBonusPercent(5), 5);
  assert.equal(lib.cryptoBonusPercent('2.50'), 2.5);
  assert.equal(lib.cryptoBonusPercent(50), 50);
  for (const off of [null, undefined, '', 0, '0', -5, 50.01, 500, 'abc', NaN]) assert.equal(lib.cryptoBonusPercent(off), null, String(off));
  assert.equal(lib.cryptoBonusFor(9000, 5), 450); // 5% on 100 USDT at 90 credits what 105 USDT would
  assert.equal(lib.cryptoBonusFor(1234.56, 3.33), 41.11); // 41.1108..., rounded down
  assert.equal(lib.cryptoBonusFor(1000, 2.5), 25);
  for (const off of [null, undefined, 0, 60]) assert.equal(lib.cryptoBonusFor(9000, off), 0, String(off));
  assert.equal(lib.cryptoBonusFor(0, 5), 0);
  assert.equal(lib.formatBonusPercent(5), '5%');
  assert.equal(lib.formatBonusPercent(2.5), '2.5%');
  assert.equal(lib.formatBonusPercent(3.33), '3.33%');
});

test('network labels and the warning name the network the way players know it', () => {
  assert.equal(lib.cryptoNetworkLabel('TRC20'), 'TRC20 (Tron)');
  assert.equal(lib.cryptoNetworkLabel('bep20'), 'BEP20 (BNB Smart Chain)');
  assert.equal(lib.cryptoNetworkLabel('ERC20'), 'ERC20 (Ethereum)');
  assert.equal(lib.cryptoNetworkLabel('POLYGON'), 'Polygon');
  assert.equal(lib.cryptoNetworkLabel('SOLANA'), 'Solana');
  assert.equal(lib.cryptoNetworkLabel('TON'), 'TON');
  assert.equal(lib.cryptoNetworkLabel('ARB'), 'ARB', 'an unknown network is shown as sent');
  for (const none of [null, undefined, '', '  ']) assert.equal(lib.cryptoNetworkLabel(none), '');
  assert.equal(lib.cryptoNetworkWarning('TRC20'), 'Send only USDT on the TRC20 (Tron) network');
  assert.equal(lib.cryptoNetworkWarning(undefined), 'Send only USDT');
});

test('cryptoDepositInfo reads the server quote of CRYPTO requests only', () => {
  assert.deepEqual(plain(lib.cryptoDepositInfo({ method: 'CRYPTO', cryptoAmount: 100.01, cryptoRate: '92.49', cryptoNetwork: 'TRC20', cryptoBonusAmount: 462.5 })),
    { usdt: 100.01, rate: 92.49, network: 'TRC20', bonus: 462.5 });
  assert.deepEqual(plain(lib.cryptoDepositInfo({ method: 'crypto', cryptoAmount: null, cryptoRate: null, cryptoNetwork: '', cryptoBonusAmount: null })),
    { usdt: null, rate: null, network: null, bonus: 0 });
  for (const other of [null, undefined, 'CRYPTO', { method: 'UPI', cryptoAmount: 5 }, { method: 'BANK_TRANSFER' }, {}]) assert.equal(lib.cryptoDepositInfo(other), null);
});

// ------------------------------------------------------------------ API contract
test('the deposit API asks for crypto wallets and the server quote fields', async () => {
  const queries = [];
  const api = loader({ '@/lib/graphqlClient': { graphqlRequest: async (query, variables) => {
    queries.push({ query, variables });
    const key = /(adminAccounts|createAdminDeposit|adminDepositRequests)\b/.exec(query)[1];
    return { [key]: ok(key === 'adminAccounts' ? [{ id: 'w1', type: 'crypto', qrUrl: '/api/site-assets/t/payments/abc' }] : []) };
  } } }, globals)('src/lib/api/user.ts');
  const accounts = await api.getAdminAccounts();
  assert.match(queries[0].query, /adminAccounts\(includeCrypto: true\)/);
  for (const field of ['walletAddress', 'network', 'cryptoRate', 'cryptoBonusPercent', 'qrUrl', 'minAmount', 'maxAmount']) assert.match(queries[0].query, new RegExp(`\\b${field}\\b`), field);
  assert.match(accounts.data[0].qrUrl, /\/api\/site-assets\/t\/payments\/abc$/, 'a crypto QR resolves like a UPI QR');
  await api.createAdminDeposit({ accountId: 'w1', amount: 9250, txnRef: HASH, type: 'crypto' });
  assert.equal(queries[1].variables.type, 'crypto');
  assert.equal(queries[1].variables.txnRef, HASH);
  await api.getAdminDepositRequests({ start_date: 'a', end_date: 'b' });
  for (const { query } of queries.slice(1)) {
    for (const field of ['cryptoAmount', 'cryptoRate', 'cryptoNetwork', 'cryptoBonusAmount']) assert.match(query, new RegExp(`\\b${field}\\b`), field);
  }
});

// ------------------------------------------------------------------ components
const appStubs = {
  'react-i18next': { useTranslation: () => ({ t: (key, options = {}) => options.defaultValue ?? key }) },
  '@/lib/auth': { useAuth: () => ({ user: { id: 7, playerType: 'REGULAR', username: 'fixture-player' } }) },
  '@/hooks/useAppSettings': { usePaymentConfig: () => ({ depositMin: null, depositMax: null, depositFeePercent: 0 }), useParsedSettings: () => ({ hideDW: false }), useLogo: () => ({ siteTitle: 'Fixture' }) },
  '@/hooks/usePageSEO': { usePageSEO() {} },
  '@/lib/request': { requestWithToast: fn => fn() },
  '@/components/animations/ConfettiBurst': { __esModule: true, default: () => null },
  html2canvas: { __esModule: true, default: async () => ({ width: 400, height: 200, toDataURL: () => 'data:image/png;base64,Zml4dHVyZQ==' }) },
};
const cryptoMethod = { id: 'w1', type: 'crypto', name: 'USDT', displayName: 'USDT (TRC20)', walletAddress: TRON_WALLET, accountNumber: TRON_WALLET, network: 'TRC20',
  cryptoRate: 92.5, cryptoBonusPercent: 5, qrUrl: 'https://cdn.example/qr.png', minAmount: 500, maxAmount: 100000, isActive: true };
const bankMethod = { id: 'b1', type: 'bank', name: 'Fixture Bank', displayName: 'Fixture Bank', bankName: 'Fixture Bank', accountNumber: '1234567890', ifscCode: 'HDFC0001234', minAmount: 100, maxAmount: 100000, isActive: true };

test('a crypto method card shows coin + network, bonus, rate, address, the USDT to send and a white QR', async () => {
  const { PaymentMethodCard } = loader(appStubs, globals)('src/components/deposit/PaymentMethodCard.tsx');
  const view = render(React.createElement(PaymentMethodCard, { method: cryptoMethod, showDetails: true, amount: 9250 }));
  const text = view.container.textContent;
  for (const value of ['USDT (TRC20)', 'USDT · TRC20', '+5% bonus', '1 USDT = ₹92.50', TRON_WALLET, 'Amount to Send', '100.00 USDT', 'Send only USDT on the TRC20 (Tron) network']) assert.ok(text.includes(value), value);
  assert.ok(text.includes('You get ₹9,712.50 on approval: ₹9,250.00 + ₹462.50 bonus (5%)'), 'bonus summary');
  assert.ok(view.container.querySelector('.dep-qr.is-scan img[alt="Wallet QR Code"]'), 'the wallet QR sits on the always-white surface');
  assert.ok(view.container.querySelector('.dep-copy-value.is-wrap'), 'the address is shown in full');
  fireEvent.click(view.getByTitle('Copy Amount to Send'));
  await waitFor(() => assert.deepEqual(clipboard, ['100.00']), 'the amount is copied without its unit');
  fireEvent.click(view.getByTitle('Copy Wallet Address'));
  await waitFor(() => assert.equal(clipboard[1], TRON_WALLET));
  view.rerender(React.createElement(PaymentMethodCard, { method: { ...cryptoMethod, cryptoBonusPercent: undefined }, showDetails: true, amount: 9250 }));
  assert.ok(!view.container.textContent.includes('bonus'), 'no bonus badge or summary without a bonus');
});

test('the Crypto filter appears only when a crypto wallet is offered and lists only crypto wallets', () => {
  const { PaymentMethodSelector } = loader(appStubs, globals)('src/components/deposit/PaymentMethodSelector.tsx');
  const props = { onSelect() {}, onProceed() {}, amount: 9250 };
  const filters = view => view.container.querySelectorAll('.dep-filter');
  const bankOnly = render(React.createElement(PaymentMethodSelector, { ...props, methods: [bankMethod] }));
  assert.deepEqual([...filters(bankOnly)].map(button => button.textContent), ['All Methods(1)', 'Payment Gateway(0)', 'UPI(0)', 'Bank Transfer(1)']);
  bankOnly.unmount();
  const view = render(React.createElement(PaymentMethodSelector, { ...props, methods: [bankMethod, cryptoMethod] }));
  const crypto = [...filters(view)].find(button => button.textContent === 'Crypto(1)');
  assert.ok(crypto, 'Crypto filter');
  assert.equal(view.container.querySelectorAll('.dep-method').length, 2);
  fireEvent.click(crypto);
  const cards = view.container.querySelectorAll('.dep-method');
  assert.equal(cards.length, 1);
  assert.ok(cards[0].textContent.includes('USDT (TRC20)'));
  assert.ok(cards[0].textContent.includes('100.00 USDT'), 'the card is given the amount');
});

// ------------------------------------------------------------------ the page
const cryptoAccount = { id: 'w1', type: 'crypto', accountNumber: TRON_WALLET, walletAddress: TRON_WALLET, network: 'TRC20', displayName: 'USDT (TRC20)',
  qrUrl: 'https://cdn.example/qr.png', cryptoRate: 92.5, cryptoBonusPercent: 5, minAmount: 500, maxAmount: 100000, weight: 2 };
const bankAccount = { id: 'b1', type: 'bank', accountNumber: '1234567890', ifscCode: 'HDFC0001234', bankName: 'Fixture Bank', accountHolderName: 'Fixture Owner',
  displayName: 'Fixture Bank', minAmount: 100, maxAmount: 100000, weight: 1 };
// The server's own quote differs from the page preview (100.00) on purpose: the receipt must show the server's.
const created = { id: 'dep-77', amount: 9250, status: 'PENDING', createdAt: '2026-10-31T10:00:00Z', utr: HASH, method: 'CRYPTO',
  cryptoAmount: 100.01, cryptoRate: 92.49, cryptoNetwork: 'TRC20', cryptoBonusAmount: 462.5 };

function depositPage(options = {}) {
  const calls = { deposits: [] };
  const api = {
    getAdminAccounts: async () => ok(options.accounts ?? [cryptoAccount, bankAccount]),
    getAdminDepositRequests: async () => ok([]),
    createAdminDeposit: async payload => {
      calls.deposits.push(payload);
      if (options.depositError) throw new Error(options.depositError);
      return ok([payload.type === 'crypto' ? created : { id: 'dep-78', amount: payload.amount, status: 'PENDING', createdAt: '2026-10-31T10:00:00Z', utr: payload.txnRef,
        method: 'BANK_TRANSFER', cryptoAmount: null, cryptoRate: null, cryptoNetwork: null, cryptoBonusAmount: null }]);
    },
    createDeposit: async () => ok({ redirectUrl: '' }),
    uploadDepositProof: async () => ({ success: true, data: { key: 'proof-key', url: '' } }),
  };
  const stubs = { ...appStubs, '@/lib/api/user': api };
  const load = loader(stubs, globals);
  // The loader resolves files, not folders: hand the page its '@/components/deposit' barrel
  stubs['@/components/deposit'] = load('src/components/deposit/index.ts');
  const Page = load('src/pages/Deposit.tsx').default;
  const view = render(React.createElement(MemoryRouter, null, React.createElement(Page)));
  return { view, calls };
}
const card = (view, name) => view.getByText(name, { selector: 'h4' }).closest('.dep-method');
async function toMethods(view, amount = '9250') {
  fireEvent.change(view.getByPlaceholderText('Enter amount'), { target: { value: amount } });
  // Enabled once the accounts have loaded and the amount fits them
  await waitFor(() => assert.equal(view.getByRole('button', { name: 'Continue' }).disabled, false));
  fireEvent.click(view.getByRole('button', { name: 'Continue' }));
  await waitFor(() => assert.ok(view.getByRole('button', { name: 'Proceed' })));
}
async function toConfirm(view, name) {
  await toMethods(view);
  fireEvent.click(card(view, name));
  fireEvent.click(view.getByRole('button', { name: 'Proceed' }));
  await waitFor(() => assert.ok(view.getByRole('button', { name: 'Confirm Deposit' })));
}

test('crypto confirm step: address, USDT to send, bonus, network warning, white QR; TxID required, screenshot optional', async () => {
  const { view, calls } = depositPage();
  await toConfirm(view, 'USDT (TRC20)');
  const text = view.container.textContent;
  for (const value of ['You send', '100.00 USDT', 'USDT · TRC20', '+5% bonus', '1 USDT = ₹92.50', TRON_WALLET, 'Amount to Send', 'After network confirmation',
    'You get ₹9,712.50 on approval', 'Screenshot (optional)']) assert.ok(text.includes(value), value);
  assert.equal(view.getByRole('note').textContent, 'Send only USDT on the TRC20 (Tron) network. Funds sent on another network cannot be recovered.');
  assert.ok(view.container.querySelector('.dep-pay-qr img.is-scan[alt="Wallet QR Code"]'), 'white QR');
  const txid = view.getByLabelText('Transaction hash (TxID)');
  assert.equal(txid.placeholder, 'Paste the transaction hash');
  assert.equal(txid.required, true);
  const submit = view.getByRole('button', { name: 'Confirm Deposit' });
  assert.equal(submit.disabled, true, 'no hash, no submit');
  assert.ok(text.includes('Enter the transaction hash after sending'));
  fireEvent.change(txid, { target: { value: '   ' } });
  assert.equal(submit.disabled, true, 'blank is not a hash');
  fireEvent.change(txid, { target: { value: ` ${HASH} ` } });
  assert.equal(submit.disabled, false);
  await act(async () => { fireEvent.click(submit); });
  assert.equal(calls.deposits.length, 1);
  assert.deepEqual(plain(calls.deposits[0]), { accountId: 'w1', amount: 9250, txnRef: ` ${HASH} `, type: 'crypto' });
  const receipt = await waitFor(() => view.getByRole('dialog', { name: 'Deposit Receipt' }));
  const receiptText = receipt.textContent;
  for (const value of ['dep-77', 'USDT (TRC20)', '100.01 USDT · TRC20 (Tron)', '+₹462.50 on approval', 'Transaction Hash', HASH, 'After network confirmation']) assert.ok(receiptText.includes(value), value);
  assert.ok(!receiptText.includes('100.00 USDT'), 'the receipt shows the server quote, not the preview');
  fireEvent.click(within(receipt).getByRole('button', { name: 'Download receipt' }));
  await waitFor(() => assert.deepEqual(downloads, ['deposit-receipt-dep-77.png']));
});

test('server errors for a crypto deposit are shown as they come', async () => {
  const message = 'This transaction hash has already been submitted. Check your deposit history or contact support.';
  const { view } = depositPage({ depositError: message });
  await toConfirm(view, 'USDT (TRC20)');
  fireEvent.change(view.getByLabelText('Transaction hash (TxID)'), { target: { value: HASH } });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Confirm Deposit' })); });
  await waitFor(() => assert.ok([...view.container.querySelectorAll('.dep-alert')].some(alert => alert.textContent === message)));
  assert.equal(view.queryByRole('dialog', { name: 'Deposit Receipt' }), null);
});

test('bank stays as it was, and a hash typed for crypto does not follow the player to a bank account', async () => {
  const { view, calls } = depositPage();
  await toConfirm(view, 'USDT (TRC20)');
  fireEvent.change(view.getByLabelText('Transaction hash (TxID)'), { target: { value: HASH } });
  fireEvent.click(view.getByRole('button', { name: /Change method/ }));
  fireEvent.click(card(view, 'Fixture Bank'));
  fireEvent.click(view.getByRole('button', { name: 'Proceed' }));
  const utr = await waitFor(() => view.getByLabelText('UTR / Reference'));
  assert.equal(utr.value, '', 'the crypto hash was cleared');
  assert.equal(utr.required, false);
  assert.equal(utr.placeholder, 'Transaction reference');
  assert.ok(view.container.textContent.includes('Screenshot (or UTR)'));
  assert.ok(view.container.textContent.includes('Provide UTR or screenshot'));
  assert.ok(!view.container.textContent.includes('You send'));
  assert.equal(view.queryByRole('note'), null, 'no network warning for a bank');
  assert.equal(view.container.querySelector('.dep-pay-qr img.is-scan'), null);
  const submit = view.getByRole('button', { name: 'Confirm Deposit' });
  assert.equal(submit.disabled, true);
  fireEvent.change(utr, { target: { value: 'UTR123456789' } });
  assert.equal(submit.disabled, false);
  await act(async () => { fireEvent.click(submit); });
  assert.deepEqual(plain(calls.deposits[0]), { accountId: 'b1', amount: 9250, txnRef: 'UTR123456789', type: 'bank' });
  const receipt = await waitFor(() => view.getByRole('dialog', { name: 'Deposit Receipt' }));
  for (const value of ['dep-78', 'Fixture Bank', 'Reference', 'UTR123456789', '1-5 minutes']) assert.ok(receipt.textContent.includes(value), value);
  assert.ok(!receipt.textContent.includes('USDT') && !receipt.textContent.includes('Transaction Hash'), 'no crypto rows on a bank receipt');
});

test('a crypto wallet without a rate or an address is never offered', async () => {
  const { view } = depositPage({ accounts: [{ ...cryptoAccount, cryptoRate: null }, { ...cryptoAccount, id: 'w2', walletAddress: '', accountNumber: '' }, bankAccount] });
  await toMethods(view);
  assert.ok(card(view, 'Fixture Bank'));
  assert.equal(view.queryByText('USDT (TRC20)'), null);
  assert.ok(![...view.container.querySelectorAll('.dep-filter')].some(button => button.textContent.startsWith('Crypto')));
});

// ------------------------------------------------------------------ history, details, receipt
const cryptoRow = { id: 'dep-9', amount: 9250, status: 'PENDING', createdAt: new Date().toISOString(), utr: HASH, method: 'CRYPTO',
  cryptoAmount: 100, cryptoRate: 92.5, cryptoNetwork: 'BEP20', cryptoBonusAmount: 462.5 };
const bankRow = { id: 'dep-8', amount: 1000, status: 'APPROVED', createdAt: new Date().toISOString(), utr: 'UTR1', method: 'BANK_TRANSFER',
  cryptoAmount: null, cryptoRate: null, cryptoNetwork: null, cryptoBonusAmount: null };

test('history shows the USDT, network and bonus under a crypto amount only', () => {
  const { DepositHistory } = loader(appStubs, globals)('src/components/deposit/DepositHistory.tsx');
  const view = render(React.createElement(DepositHistory, { deposits: [cryptoRow, bankRow] }));
  const amounts = [...view.container.querySelectorAll('td.dep-cell-amount')].map(cell => cell.textContent);
  assert.ok(amounts.includes('₹9,250.00100.00 USDT · BEP20+₹462.50 bonus'), amounts.join(' | '));
  assert.ok(amounts.includes('₹1,000.00'), 'a bank row is unchanged');
});

test('deposit details of a crypto request show network, USDT, rate, bonus and a copyable hash', async () => {
  const { DepositDetailsModal } = loader(appStubs, globals)('src/components/deposit/DepositDetailsModal.tsx');
  const view = render(React.createElement(DepositDetailsModal, { deposit: cryptoRow, isOpen: true, onClose() {} }));
  const dialog = view.getByRole('dialog', { name: 'Deposit Details' });
  for (const value of ['USDT (BEP20)', 'Crypto Transfer', 'BEP20 (BNB Smart Chain)', '100.00 USDT', '1 USDT = ₹92.50', '+₹462.50', HASH]) assert.ok(dialog.textContent.includes(value), value);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copy transaction hash' }));
  await waitFor(() => assert.deepEqual(clipboard, [HASH]));
  view.rerender(React.createElement(DepositDetailsModal, { deposit: bankRow, isOpen: true, onClose() {} }));
  assert.ok(!view.getByRole('dialog').textContent.includes('Crypto Transfer'), 'no crypto section for a bank deposit');
  assert.ok(view.getByRole('dialog').textContent.includes('BANK_TRANSFER'), 'the bank method label is as before');
});

test('the receipt download keeps a pasted reference as text', async () => {
  let captured = null;
  const { TransactionReceipt } = loader({ ...appStubs, '@/lib/api/user': { getAdminDepositRequests: async () => ok([]) },
    html2canvas: { __esModule: true, default: async element => { captured = element.cloneNode(true); return { toDataURL: () => 'data:image/png;base64,Zml4dHVyZQ==' }; } } }, globals)('src/components/deposit/TransactionReceipt.tsx');
  const reference = '<img src=x onerror=alert(1)>';
  const view = render(React.createElement(TransactionReceipt, { transaction: { id: 'dep-5', amount: 250, status: 'pending', method: 'UPI', reference, timestamp: '2026-10-31T10:00:00Z' }, onClose() {} }));
  const dialog = view.getByRole('dialog', { name: 'Deposit Receipt' });
  assert.ok(dialog.textContent.includes('Reference'));
  assert.ok(!dialog.textContent.includes('USDT'), 'no crypto rows without a crypto quote');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Download receipt' }));
  await waitFor(() => assert.ok(captured));
  assert.equal(captured.querySelector('img'), null);
  assert.ok(captured.textContent.includes(reference));
});
