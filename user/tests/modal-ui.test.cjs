const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent, localStorage: dom.window.localStorage })) {
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
// This models lifecycle only. Real native focus containment is browser-tested.
dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function() { this.open = false; setTimeout(() => this.dispatchEvent(new Event('close')), 0); };
const React = require('react');
const { MemoryRouter } = require('react-router-dom');
const { render, cleanup, fireEvent, act, waitFor, within } = require('@testing-library/react');
const { loader, root } = require('./load-source.cjs');
const english = loader()('src/lib/i18n/locales/en.ts').en.translation;
const t = (key, options = {}) => key.split('.').reduce((value, part) => value?.[part], english) ?? options.defaultValue ?? key;
const spy = (implementation = () => undefined) => { const fn = (...args) => { fn.calls.push(args); return implementation(...args); }; fn.calls = []; return fn; };
const ok = data => ({ meta: { code: 200 }, data });
function clock() {
  let now = 0, id = 0;
  const pending = new Map();
  const schedule = (callback, delay = 0, repeat = false) => { const key = ++id; pending.set(key, { callback, time: now + delay, delay, repeat }); return key; };
  return { setTimeout: (callback, delay) => schedule(callback, delay), clearTimeout: key => pending.delete(key), setInterval: (callback, delay) => schedule(callback, delay, true), clearInterval: key => pending.delete(key), advance(ms) { const end = now + ms; let count = 0; while (true) { const next = [...pending].filter(([, item]) => item.time <= end).sort((a, b) => a[1].time - b[1].time)[0]; if (!next) break; if (++count > 10000) throw new Error('Fixture timer loop'); const [key, item] = next; now = item.time; pending.delete(key); if (item.repeat) pending.set(key, { ...item, time: now + item.delay }); item.callback(); } now = end; } };
}
function modalLoader(options = {}) {
  const calls = { close: spy(), submit: spy(), changePassword: spy(async () => undefined), refreshUser: spy(), updateUser: spy(), copy: spy(async () => undefined), downloads: [], canvas: spy(async element => ({ width: 800, height: 200, toDataURL: () => 'data:image/png;base64,Zml4dHVyZQ==', toBlob: callback => callback(new dom.window.Blob(['fixture'], { type: 'image/png' })) })), deposits: spy(async () => ok([])), withdrawals: spy(async () => ok([])), ...options.calls };
  Object.defineProperty(dom.window.navigator, 'clipboard', { configurable: true, value: { writeText: calls.copy } });
  dom.window.HTMLAnchorElement.prototype.click = function() { calls.downloads.push({ filename: this.download, href: this.href }); };
  dom.window.URL.createObjectURL = () => 'blob:fixture-only'; dom.window.URL.revokeObjectURL = () => undefined;
  const timers = options.clock || { setTimeout, clearTimeout, setInterval, clearInterval };
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Node: dom.window.Node, HTMLInputElement: dom.window.HTMLInputElement, localStorage: dom.window.localStorage, URL: dom.window.URL, URLSearchParams: dom.window.URLSearchParams, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), CustomEvent: dom.window.CustomEvent, ...timers, requestAnimationFrame: callback => timers.setTimeout(callback, 0), cancelAnimationFrame: timers.clearTimeout, alert: message => { throw new Error(`Unexpected fixture alert: ${message}`); } };
  const load = loader({
    'react-i18next': { useTranslation: () => ({ t }) },
    '@/lib/auth': { useAuth: () => ({ user: { username: 'fixture-player', phone: '+919876543210' }, changePassword: calls.changePassword, refreshUser: calls.refreshUser, updateUser: calls.updateUser }) },
    [path.join(root, 'src/lib/auth.tsx')]: { useAuth: () => ({ user: { username: 'fixture-player', phone: '+919876543210' }, changePassword: calls.changePassword, refreshUser: calls.refreshUser, updateUser: calls.updateUser }) },
    '@/hooks/useAppSettings': { useLogo: () => ({ siteTitle: 'Fixture Tenant' }) },
    '@/lib/api/user': { getAdminDepositRequests: calls.deposits, getWithdrawalRequests: calls.withdrawals },
    [path.join(root, 'src/components/animations/ConfettiBurst.tsx')]: { __esModule: true, default: () => null },
    html2canvas: { __esModule: true, default: calls.canvas },
    ...options.stubs,
  }, globals);
  return { load, calls, timers };
}
function renderModal(relative, props, options = {}) {
  const harness = modalLoader(options);
  const module = harness.load(relative);
  const Component = module[options.exportName || 'default'];
  const element = next => React.createElement(MemoryRouter, null, React.createElement(Component, next));
  const view = render(element(props));
  return { ...view, ...harness, rerenderModal: next => view.rerender(element(next)) };
}
test.afterEach(() => { cleanup(); document.body.innerHTML = ''; document.body.style.overflow = ''; localStorage.clear(); });

function surfaceHarness(options = {}) {
  const { load } = modalLoader();
  const Surface = load('src/components/modals/ModalSurface.tsx').default;
  const close = spy();
  let update;
  function Demo() {
    const [open, setOpen] = React.useState(false); update = setOpen;
    return React.createElement(React.Fragment, null,
      React.createElement('button', { onClick: () => setOpen(true) }, 'Fixture trigger'),
      React.createElement(Surface, { open, onClose: () => { close(); setOpen(false); }, title: 'Fixture modal', description: 'Fixture description', ...options.props }, React.createElement('input', { 'aria-label': 'Fixture input' })));
  }
  const view = render(React.createElement(options.strict ? React.StrictMode : React.Fragment, null, React.createElement(Demo)));
  return { ...view, close, setOpen: value => act(() => update(value)) };
}
test('shared native modal stays absent while closed and portals one named surface with connected description', () => {
  const view = surfaceHarness();
  assert.equal(view.queryByRole('dialog'), null);
  document.body.style.overflow = 'auto';
  const trigger = view.getByRole('button', { name: 'Fixture trigger' }); trigger.focus(); fireEvent.click(trigger);
  const dialog = view.getByRole('dialog', { name: 'Fixture modal' });
  assert.equal(dialog.tagName, 'DIALOG'); assert.equal(dialog.open, true); assert.equal(dialog.parentElement, document.body);
  assert.equal(document.getElementById(dialog.getAttribute('aria-describedby')).textContent, 'Fixture description');
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(dialog.querySelectorAll('.nova-modal-surface').length, 1);
  fireEvent.mouseDown(within(dialog).getByRole('textbox', { name: 'Fixture input' })); assert.equal(view.close.calls.length, 0);
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  assert.equal(view.close.calls.length, 1); assert.equal(view.queryByRole('dialog'), null);
  assert.equal(document.body.style.overflow, 'auto'); assert.equal(document.activeElement, trigger);
});
test('shared modal backdrop and close button dismiss exactly once, while forced modal refuses native cancel and backdrop', () => {
  const regular = surfaceHarness(); fireEvent.click(regular.getByRole('button', { name: 'Fixture trigger' }));
  fireEvent.mouseDown(regular.getByRole('dialog')); assert.equal(regular.close.calls.length, 1);
  fireEvent.click(regular.getByRole('button', { name: 'Fixture trigger' })); fireEvent.click(regular.getByRole('button', { name: 'Close' })); assert.equal(regular.close.calls.length, 2); regular.unmount();
  const forced = surfaceHarness({ props: { dismissible: false } }); fireEvent.click(forced.getByRole('button', { name: 'Fixture trigger' }));
  const dialog = forced.getByRole('dialog'); const cancel = new Event('cancel', { cancelable: true });
  fireEvent(dialog, cancel); fireEvent.mouseDown(dialog);
  assert.equal(cancel.defaultPrevented, true); assert.equal(forced.close.calls.length, 0); assert.equal(dialog.open, true); assert.equal(forced.queryByRole('button', { name: 'Close' }), null);
});
test('shared modal survives StrictMode queued stale-close and handles only an actual native close', async () => {
  const view = surfaceHarness({ strict: true }); fireEvent.click(view.getByRole('button', { name: 'Fixture trigger' }));
  const dialog = view.getByRole('dialog');
  fireEvent(dialog, new Event('close'));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  assert.equal(dialog.open, true); assert.equal(view.close.calls.length, 0);
  dialog.open = false; fireEvent(dialog, new Event('close')); assert.equal(view.close.calls.length, 1); assert.equal(view.queryByRole('dialog'), null);
});
test('shared modal scroll locks stay counted when two native surfaces overlap', () => {
  const { load } = modalLoader(); const Surface = load('src/components/modals/ModalSurface.tsx').default;
  document.body.style.overflow = 'scroll';
  const pair = (a, b) => React.createElement(React.Fragment, null, React.createElement(Surface, { open: a, onClose() {}, title: 'First' }, 'First content'), React.createElement(Surface, { open: b, onClose() {}, title: 'Second' }, 'Second content'));
  const view = render(pair(true, true)); assert.equal(document.body.style.overflow, 'hidden');
  view.rerender(pair(false, true)); assert.equal(document.body.style.overflow, 'hidden');
  view.rerender(pair(false, false)); assert.equal(document.body.style.overflow, 'scroll'); assert.equal(view.queryByRole('dialog'), null);
});
test('shared custom-header mode keeps the supplied title ID without duplicating headings or close controls', () => {
  const { load } = modalLoader(); const Surface = load('src/components/modals/ModalSurface.tsx').default;
  const view = render(React.createElement(Surface, { open: true, onClose() {}, title: 'Custom', titleId: 'fixture-custom-title', hideHeader: true, size: 'auth' }, React.createElement('h2', { id: 'fixture-custom-title' }, 'Custom')));
  const dialog = view.getByRole('dialog', { name: 'Custom' }); assert.equal(dialog.querySelectorAll('h2').length, 1); assert.equal(dialog.querySelector('.nova-modal-header'), null); assert.ok(dialog.querySelector('.nova-modal-auth'));
});

test('native bank form preserves validation, numeric normalization and exact existing submit payload', () => {
  const view = renderModal('src/components/withdrawal/BankModal.tsx', { isOpen: true, onClose() {}, onSubmit() {} });
  const props = { isOpen: true, onClose: view.calls.close, onSubmit: view.calls.submit }; view.rerenderModal(props);
  const save = view.getByRole('button', { name: 'Save' }); assert.equal(save.disabled, true); fireEvent.click(save); assert.equal(view.calls.submit.calls.length, 0);
  fireEvent.change(view.getByLabelText('Account Holder Name'), { target: { value: '  Fixture Person  ' } });
  fireEvent.change(view.getByLabelText('Account Number'), { target: { value: '12-34567890x' } });
  fireEvent.change(view.getByLabelText('IFSC'), { target: { value: 'hdfc0001234' } });
  fireEvent.change(view.getByLabelText('Bank Name (optional)'), { target: { value: ' Fixture Bank ' } });
  assert.equal(save.disabled, false); fireEvent.click(save);
  assert.equal(JSON.stringify(view.calls.submit.calls[0]), '[{"holderName":"Fixture Person","accountNumber":"1234567890","ifsc":"HDFC0001234","bankName":"Fixture Bank","isPrimary":false}]');
  view.rerenderModal({ ...props, isOpen: false }); assert.equal(view.queryByRole('dialog'), null);
  view.rerenderModal(props); assert.equal(view.getByLabelText('Account Number').value, ''); assert.equal(view.getByRole('button', { name: 'Save' }).disabled, true);
});
test('native UPI form retains format checks and exact trimmed non-primary payload', () => {
  const view = renderModal('src/components/withdrawal/UpiModal.tsx', { isOpen: true, onClose() {}, onSubmit() {} });
  view.rerenderModal({ isOpen: true, onClose: view.calls.close, onSubmit: view.calls.submit });
  const save = view.getByRole('button', { name: 'Save' });
  fireEvent.change(view.getByLabelText('UPI ID'), { target: { value: 'invalid' } }); fireEvent.change(view.getByLabelText('Account Holder Name'), { target: { value: 'Fixture Person' } });
  assert.equal(save.disabled, true); assert.equal(view.calls.submit.calls.length, 0);
  fireEvent.change(view.getByLabelText('UPI ID'), { target: { value: ' fixture.person@bank ' } }); fireEvent.click(save);
  assert.equal(JSON.stringify(view.calls.submit.calls[0]), '[{"upiId":"fixture.person@bank","holderName":"Fixture Person","isPrimary":false}]');
});

test('statement modal keeps wallet transaction ID, amount, status, description and bonus references', () => {
  const row = { id: 'wallet-fixture-17', dateISO: '2026-10-10T10:00:00Z', type: 'Deposit', amount: 1234.5, status: 'Success', description: 'Fixture adjustment reference', bonusCampaignName: 'Fixture campaign', bonusCampaignType: 'deposit_bonus' };
  const view = renderModal('src/components/statements/DetailsModal.tsx', { details: { type: 'wallet', row }, onClose() {} });
  const dialog = view.getByRole('dialog');
  for (const value of ['wallet-fixture-17', 'Deposit', '1,234.50', 'Success', 'Fixture adjustment reference', 'Fixture campaign', 'deposit bonus']) assert.ok(dialog.textContent.includes(value), value);
});
test('statement sports and casino modals preserve stake, odds, liability, P/L, result and wallet meaning', () => {
  const sports = renderModal('src/components/statements/DetailsModal.tsx', { details: { type: 'sports', row: { dateISO: '2026-10-10T10:00:00Z', title: 'Cricket > Fixture League > One v Two', market: 'Match odds', selection: 'One', side: 'lay', stake: 125, odds: 2.45, liability: 181.25, payout: -181.25, eventResult: 'Two won', result: 'Lose' } }, onClose() {} });
  for (const value of ['Cricket', 'Fixture League', 'One v Two', 'Match odds', 'LAY', '125.00', '2.45', '181.25', 'Two won', 'Lose']) assert.ok(sports.getByRole('dialog').textContent.includes(value), value);
  assert.ok(sports.getByRole('dialog').textContent.includes(new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(-181.25))); sports.unmount();
  const casino = renderModal('src/components/statements/DetailsModal.tsx', { details: { type: 'casino', row: { dateISO: '2026-10-10T10:00:00Z', title: 'Fixture game', market: 'Fixture round', stake: 50, payout: 90, walletType: 'referral_bonus', result: 'Win' } }, onClose() {} });
  for (const value of ['Fixture game', 'Fixture round', '50.00', '90.00', 'Referral Bonus', 'Win']) assert.ok(casino.getByRole('dialog').textContent.includes(value), value);
});
test('bonus switch retains cancellation warning and both bonus values, and blocks all dismissal/actions while busy', () => {
  const props = { isOpen: true, onClose() {}, onConfirm() {}, currentBonus: { id: 'old-bonus', name: 'Current fixture', amount: 500, wagered: 25, rollingX: 1000 }, newBonus: { id: 'new-bonus', name: 'Next fixture', amount: 750 } };
  const view = renderModal('src/components/bonus/SwitchBonusModal.tsx', props, { exportName: 'SwitchBonusModal' });
  view.rerenderModal({ ...props, onClose: view.calls.close, onConfirm: view.calls.submit });
  const dialog = view.getByRole('dialog');
  for (const value of ['Current fixture', 'Next fixture', '500.00', '750.00', '25 / 1,000', 'cancel your current active bonus']) assert.ok(dialog.textContent.includes(value), value);
  fireEvent.click(view.getByRole('button', { name: 'Switch Bonus' })); assert.equal(view.calls.submit.calls.length, 1);
  view.rerenderModal({ ...props, onClose: view.calls.close, onConfirm: view.calls.submit, isLoading: true });
  assert.equal(view.getByRole('button', { name: 'Cancel' }).disabled, true); assert.equal(view.getByRole('button', { name: /Switching/ }).disabled, true);
  fireEvent(view.getByRole('dialog'), new Event('cancel', { cancelable: true })); fireEvent.mouseDown(view.getByRole('dialog')); assert.equal(view.calls.close.calls.length, 0);
});

test('change-password form blocks invalid values and keeps exact trimmed adapter arguments and error state', async () => {
  const changePassword = spy(async () => { throw new Error('Fixture password rejection'); });
  const view = renderModal('src/components/modals/ChangePasswordModal.tsx', { isOpen: true, onClose() {} }, { calls: { changePassword } });
  const submit = view.getByRole('button', { name: 'Update password' }); assert.equal(submit.disabled, true);
  fireEvent.change(view.getByLabelText('Current password'), { target: { value: ' fixture-old1 ' } });
  fireEvent.change(view.getByLabelText('New password'), { target: { value: ' fixture-new2 ' } });
  fireEvent.change(view.getByLabelText('Confirm new password'), { target: { value: 'wrong' } }); assert.equal(submit.disabled, true);
  fireEvent.change(view.getByLabelText('Confirm new password'), { target: { value: ' fixture-new2 ' } }); fireEvent.click(submit);
  await waitFor(() => assert.equal(changePassword.calls.length, 1)); assert.deepEqual(changePassword.calls[0], ['fixture-old1', 'fixture-new2']);
  await waitFor(() => assert.equal(view.getByRole('alert').textContent.includes('Fixture password rejection'), true)); assert.equal(submit.disabled, false);
});
test('forced change-password cannot close by cancel/backdrop and clears only the original security flag after success', async () => {
  const timers = clock(); const view = renderModal('src/components/modals/ChangePasswordModal.tsx', { isOpen: true, forced: true, onClose() {} }, { clock: timers });
  view.rerenderModal({ isOpen: true, forced: true, onClose: view.calls.close });
  const dialog = view.getByRole('dialog'); assert.equal(view.queryByRole('button', { name: 'Close' }), null);
  fireEvent(dialog, new Event('cancel', { cancelable: true })); fireEvent.mouseDown(dialog); assert.equal(view.calls.close.calls.length, 0);
  for (const [label, value] of [['Current password', 'fixture-old1'], ['New password', 'fixture-new2'], ['Confirm new password', 'fixture-new2']]) fireEvent.change(view.getByLabelText(label), { target: { value } });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Update password' })); });
  await act(async () => timers.advance(600));
  assert.equal(view.calls.changePassword.calls.length, 1); assert.equal(JSON.stringify(view.calls.updateUser.calls[0]), '[{"requirePasswordReset":false}]'); assert.equal(view.calls.refreshUser.calls.length, 1); assert.equal(view.calls.close.calls.length, 0);
});

test('change-password pending submit retains a stable accessible name and busy/disabled state', () => {
  const changePassword = spy(() => new Promise(() => {}));
  const view = renderModal('src/components/modals/ChangePasswordModal.tsx', { isOpen: true, onClose() {} }, { calls: { changePassword } });
  for (const [label, value] of [['Current password', 'fixture-old1'], ['New password', 'fixture-new2'], ['Confirm new password', 'fixture-new2']]) fireEvent.change(view.getByLabelText(label), { target: { value } });
  fireEvent.click(view.getByRole('button', { name: 'Update password' }));
  const button = view.getByRole('button', { name: 'Update password' }); assert.equal(button.disabled, true); assert.equal(button.getAttribute('aria-busy'), 'true'); assert.equal(button.querySelector('svg').getAttribute('aria-hidden'), 'true');
  fireEvent.click(button); assert.equal(changePassword.calls.length, 1);
});
test('shared password fields preserve native label, controlled visibility and connected error/help descriptions', () => {
  const view = renderModal('src/components/forms/TextField.tsx', { id: 'fixture-password', label: 'Fixture password', type: 'password', error: 'Fixture invalid password', 'aria-describedby': 'fixture-help' });
  const field = view.getByLabelText('Fixture password'); assert.equal(field.type, 'password'); assert.equal(field.getAttribute('aria-invalid'), 'true'); assert.equal(field.getAttribute('aria-describedby'), 'fixture-help fixture-password-error'); assert.equal(document.getElementById('fixture-password-error').getAttribute('role'), 'alert');
  const show = view.getByRole('button', { name: 'Show password' }); assert.equal(show.getAttribute('aria-controls'), field.id); assert.equal(show.getAttribute('aria-pressed'), 'false'); fireEvent.click(show);
  assert.equal(field.type, 'text'); const hide = view.getByRole('button', { name: 'Hide password' }); assert.equal(hide.getAttribute('aria-pressed'), 'true'); fireEvent.click(hide); assert.equal(field.type, 'password');
});

test('financial and security wrappers remain absent while closed or when their detail identity is missing', () => {
  for (const [relative, props, exportName] of [
    ['src/components/withdrawal/BankModal.tsx', { isOpen: false, onClose() {}, onSubmit() {} }],
    ['src/components/withdrawal/UpiModal.tsx', { isOpen: false, onClose() {}, onSubmit() {} }],
    ['src/components/modals/ChangePasswordModal.tsx', { isOpen: false, onClose() {} }],
    ['src/components/bonus/SwitchBonusModal.tsx', { isOpen: false, onClose() {}, onConfirm() {}, currentBonus: null, newBonus: null }, 'SwitchBonusModal'],
    ['src/components/statements/DetailsModal.tsx', { details: null, onClose() {} }],
    ['src/components/deposit/DepositDetailsModal.tsx', { isOpen: true, deposit: null, onClose() {} }, 'DepositDetailsModal'],
    ['src/components/withdrawal/WithdrawalDetailsModal.tsx', { isOpen: false, withdrawal: { id: 'fixture' }, onClose() {} }, 'WithdrawalDetailsModal'],
  ]) {
    const view = renderModal(relative, props, { exportName }); assert.equal(view.queryByRole('dialog'), null, relative); assert.equal(document.body.style.overflow, ''); assert.equal(view.calls.deposits.calls.length + view.calls.withdrawals.calls.length, 0); view.unmount();
  }
});

test('deposit detail keeps identity, amount, status and all payment references with explicit payment-method precedence', () => {
  const deposit = { id: 'deposit-fixture-17', amount: 1234.5, status: 'approved', createdAt: '2026-10-10T10:00:00Z', type: 'bank', method: 'Explicit Bank Method', paymentMethod: 'Secondary method', transactionId: 'provider-transaction', referenceId: 'reference-fixture', paymentId: 'payment-fixture', upiTransactionId: 'upi-reference-fixture' };
  const view = renderModal('src/components/deposit/DepositDetailsModal.tsx', { deposit, isOpen: true, onClose() {} }, { exportName: 'DepositDetailsModal' });
  const dialog = view.getByRole('dialog', { name: 'Deposit Details' });
  for (const value of ['deposit-fixture-17', '1,234.50', 'Success', 'Explicit Bank Method', 'provider-transaction', 'reference-fixture', 'payment-fixture', 'upi-reference-fixture']) assert.ok(dialog.textContent.includes(value), value);
  assert.equal(dialog.textContent.includes('Secondary method'), false);
  view.rerenderModal({ deposit: { ...deposit, method: '', paymentMethod: 'Secondary method' }, isOpen: true, onClose() {} }); assert.ok(dialog.textContent.includes('Secondary method'));
  view.rerenderModal({ deposit: { ...deposit, method: '', paymentMethod: '', status: 'rejected' }, isOpen: true, onClose() {} }); assert.ok(dialog.textContent.includes('Bank Transfer')); assert.ok(dialog.textContent.includes('Failed'));
});

test('withdrawal detail keeps account data, exact transaction identity, amount and original status normalization', () => {
  const withdrawal = { _id: 'withdrawal-fixture-18', amount: 678.9, status: 'processing', createdAt: '2026-10-10T10:00:00Z', type: 'bank', accountHolderName: 'Fixture Person', accountNumber: '123456789012', upiId: 'fixture@bank', ifscCode: 'HDFC0001234', bankName: 'Fixture Bank' };
  const view = renderModal('src/components/withdrawal/WithdrawalDetailsModal.tsx', { withdrawal, isOpen: true, onClose() {} }, { exportName: 'WithdrawalDetailsModal' });
  const dialog = view.getByRole('dialog', { name: 'Withdrawal Details' });
  for (const value of ['withdrawal-fixture-18', '678.90', 'Pending', 'Bank Transfer', 'Fixture Person', '123456789012', 'fixture@bank', 'HDFC0001234', 'Fixture Bank']) assert.ok(dialog.textContent.includes(value), value);
  view.rerenderModal({ withdrawal: { ...withdrawal, status: 'approved' }, isOpen: true, onClose() {} }); assert.ok(dialog.textContent.includes('Success'));
  view.rerenderModal({ withdrawal: { ...withdrawal, status: 'rejected' }, isOpen: true, onClose() {} }); assert.ok(dialog.textContent.includes('Failed'));
});

test('detail downloads still capture the original outside-dialog receipt ref with unchanged identifiers and filename', async () => {
  for (const [kind, field, relative, exportName] of [['deposit', 'deposit', 'src/components/deposit/DepositDetailsModal.tsx', 'DepositDetailsModal'], ['withdrawal', 'withdrawal', 'src/components/withdrawal/WithdrawalDetailsModal.tsx', 'WithdrawalDetailsModal']]) {
    const timers = clock(); const record = { id: `${kind}-download-fixture`, amount: 345.67, status: 'approved', createdAt: '2026-10-10T10:00:00Z', method: 'Explicit fixture method', type: 'bank', referenceId: 'fixture-reference', accountNumber: '123456789012' };
    const view = renderModal(relative, { [field]: record, isOpen: true, onClose() {} }, { exportName, clock: timers });
    const dialog = view.getByRole('dialog'); fireEvent.click(within(dialog).getByRole('button', { name: 'Download Slip' }));
    await act(async () => timers.advance(300)); await waitFor(() => assert.equal(view.calls.canvas.calls.length, 1));
    const element = view.calls.canvas.calls[0][0]; assert.equal(dialog.contains(element), false, 'the original receipt export ref remains outside the redesigned portal');
    assert.ok(element.textContent.includes(`${kind.toUpperCase()} RECEIPT`)); assert.ok(element.textContent.includes(record.id)); assert.ok(element.textContent.includes('345.67')); assert.ok(element.textContent.includes('Success'));
    assert.equal(view.calls.downloads.length, 1); assert.equal(view.calls.downloads[0].filename, `${kind}-slip-${record.id}-20261010.png`);
    assert.equal(view.calls.deposits.calls.length + view.calls.withdrawals.calls.length, 0, 'downloading a receipt does not write or poll financial data'); view.unmount();
  }
});

test('transaction receipts retain statuses, amount, reference/account, original polling and real matching identity', async () => {
  for (const kind of ['deposit', 'withdrawal']) {
    const timers = clock(); const requests = spy(async () => ok([{ id: 'different-id', amount: 250, status: 'rejected', createdAt: '2026-10-10T10:00:00Z' }, { id: `${kind}-receipt-fixture`, amount: 250, status: 'approved', createdAt: '2026-10-10T10:00:00Z' }]));
    const exportName = kind === 'deposit' ? 'TransactionReceipt' : 'WithdrawalReceipt';
    const relative = `src/components/${kind === 'deposit' ? 'deposit/TransactionReceipt' : 'withdrawal/WithdrawalReceipt'}.tsx`;
    const view = renderModal(relative, { transaction: { id: `${kind}-receipt-fixture`, amount: 250, status: 'pending', method: 'Fixture method', reference: 'fixture-reference', account: 'fixture@bank', timestamp: '2026-10-10T10:00:00Z', expectedSettlement: 'Fixture settlement' }, onClose() {}, onStatusChange() {} }, { exportName, clock: timers, calls: kind === 'deposit' ? { deposits: requests } : { withdrawals: requests } });
    const changed = spy(); view.rerenderModal({ transaction: { id: `${kind}-receipt-fixture`, amount: 250, status: 'pending', method: 'Fixture method', reference: 'fixture-reference', account: 'fixture@bank', timestamp: '2026-10-10T10:00:00Z', expectedSettlement: 'Fixture settlement' }, onClose: view.calls.close, onStatusChange: changed });
    const dialog = view.getByRole('dialog'); for (const value of [`${kind}-receipt-fixture`, '250.00', 'Fixture method']) assert.ok(dialog.textContent.includes(value), value);
    assert.ok(dialog.textContent.includes(kind === 'deposit' ? 'fixture-reference' : 'fixture@bank'));
    await act(async () => timers.advance(1999)); assert.equal(requests.calls.length, 0);
    await act(async () => timers.advance(1)); assert.equal(requests.calls.length, 1); assert.deepEqual(changed.calls[0], ['success']);
    assert.equal(typeof requests.calls[0][0].start_date, 'string'); assert.equal(typeof requests.calls[0][0].end_date, 'string');
    assert.equal(view.calls.close.calls.length, 0); await act(async () => timers.advance(1500)); assert.equal(view.calls.close.calls.length, 1); view.unmount();
  }
});

test('Fancy Book keeps hook order through closed/open toggles and preserves every position P/L calculation', () => {
  const bets = [{ selection: 'Fixture market', odds: 10, stake: 100, type: 'back', odds_size: 100 }, { selection: 'Fixture market', odds: 12, stake: 50, type: 'lay', odds_size: 200 }];
  const props = { bets, isOpen: false, onClose() {}, marketName: 'Fixture fancy market' };
  const view = renderModal('src/components/sport-event/FancyBookDisplay.tsx', props); assert.equal(view.queryByRole('dialog'), null);
  view.rerenderModal({ ...props, isOpen: true }); const dialog = view.getByRole('dialog', { name: 'Fancy Book Analysis' }); assert.ok(dialog.textContent.includes('Fixture fancy market'));
  const rows = [...dialog.querySelectorAll('div.group')]; assert.equal(rows.length, 13);
  const amount = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Math.abs(value));
  rows.forEach((row, index) => { const position = index + 5; const pnl = position < 10 ? -50 : position < 12 ? 150 : 0; assert.equal(row.querySelector('div.font-bold').textContent, String(position)); assert.equal(row.querySelector('span.tabular-nums').textContent, `${pnl >= 0 ? '+' : '-'}${amount(pnl)}`); });
  view.rerenderModal(props); assert.equal(view.queryByRole('dialog'), null); view.rerenderModal({ ...props, isOpen: true, bets: [] }); assert.ok(view.getByText('No bets found for this market'));
});

test('auth backend adapters retain exact GraphQL mutation fields and variables without contacting a server', async () => {
  const requests = [];
  const backend = loader({ '@/lib/graphqlClient': { graphqlRequest: async (query, variables) => { requests.push({ query, variables }); return { requestOtp: {}, registerUser: {}, loginWithOtp: {}, login: {}, changePassword: {}, requestResetOtp: {}, resetPassword: {} }; } } })('src/lib/api/userBackend.ts');
  const cases = [
    ['requestOtp', 'requestOtp', ['+919876543210'], { phone: '+919876543210' }],
    ['registerUser', 'registerUser', [{ username: 'fixture', phone: '+919876543210', password: 'fixture-pass1', confirmPassword: 'fixture-pass1', affiliateCode: 'FIXTURE', otp: '1234' }], { input: { username: 'fixture', phone: '+919876543210', password: 'fixture-pass1', confirmPassword: 'fixture-pass1', affiliateCode: 'FIXTURE', otp: '1234' } }],
    ['loginWithOtp', 'loginWithOtp', ['+919876543210', '1234'], { phone: '+919876543210', otp: '1234' }],
    ['loginWithPassword', 'login', ['+919876543210', 'fixture-pass1'], { input: { phoneOrUsername: '+919876543210', password: 'fixture-pass1' } }],
    ['changePassword', 'changePassword', ['fixture-old1', 'fixture-new2'], { currentPassword: 'fixture-old1', newPassword: 'fixture-new2' }],
    ['requestResetOtp', 'requestResetOtp', ['+919876543210'], { phone: '+919876543210' }],
    ['resetPassword', 'resetPassword', ['+919876543210', '1234', 'fixture-new2'], { phone: '+919876543210', otp: '1234', newPassword: 'fixture-new2' }],
  ];
  for (const [fn, field, args, variables] of cases) { await backend[fn](...args); const request = requests.at(-1); assert.match(request.query, /mutation\s+\w+/); assert.match(request.query, new RegExp(`\\b${field}\\(`)); assert.equal(JSON.stringify(request.variables), JSON.stringify(variables)); }
  assert.equal(requests.length, cases.length);
});

function slipHarness(variant = 'desktop', user = { balance: 10000, exposure: 0, playerType: 'REGULAR' }, betOverrides = {}) {
  const placeSportsBet = spy(() => new Promise(() => {})); const placeFancyBet = spy(() => { throw new Error('Unexpected fancy write'); });
  const bet = { team: 'Team A', market: 'Match Odds', type: 'back', odds: 2, stake: 1000, teamIndex: 0, marketType: 'exchange', marketId: 'market-id', selectionId: 1, marketCode: 'market-code', ...betOverrides };
  const event = { id: 'event-id', eventId: 'event-id', sportId: 'sport-id', leagueId: 'league-id', homeTeam: { name: 'A' }, awayTeam: { name: 'B' }, league: 'L', venue: 'V', startTime: '2026-10-10', status: 'live', markets: [] };
  const stubs = {
    [path.join(root, 'src/components/sports/BetSlipProvider.tsx')]: { useBetSlip: () => ({ closeQuickBet: spy(), updateQuickBet: spy(), openQuickBet: spy() }) },
    '@/lib/auth': { useAuth: () => ({ isAuthenticated: true, user, openAuthModal: spy(), refreshUser: spy() }) },
    '@/lib/api/user': { placeSportsBet, placeFancyBet }, '@/lib/notify': { notify: { error: spy(), success: spy() } },
    '@/hooks/useAppSettings': { useRiskConfig: () => ({ cashoutEnabled: true, overallExposureCap: null }) },
    '@/hooks/useStakeLimits': { useStakeLimits: () => ({ canPlaceStake: () => ({ allowed: true }) }) },
    '@/hooks/useSportsSettings': { useSportsSettings: () => ({ settings: { exchange: { maxStake: 50000 } } }) },
    '@/lib/hooks/useOddsSocket': { useOddsSocket: () => undefined },
    [path.join(root, 'src/components/sport-event/fancySocketOdds.ts')]: { getFancyLiveSnapshot: () => null },
  };
  return { ...renderModal('src/components/sport-event/EnterpriseBetSlip.tsx', { bet, event, variant }, { stubs }), placeSportsBet, placeFancyBet };
}
test('bet slip Enter is owned by its inputs, never background/search/other dialogs, and preserves the exact mocked payload', () => {
  const view = slipHarness(); const stake = view.getByRole('textbox', { name: 'Stake' });
  const background = document.createElement('input'); background.setAttribute('aria-label', 'Search background'); document.body.append(background);
  fireEvent.keyDown(document.body, { key: 'Enter' }); fireEvent.keyDown(background, { key: 'Enter' }); assert.equal(view.placeSportsBet.calls.length, 0);
  const other = document.createElement('dialog'); other.open = true; const field = document.createElement('input'); other.append(field); document.body.append(other);
  fireEvent.keyDown(field, { key: 'Enter' }); fireEvent.keyDown(stake, { key: 'Enter' }); assert.equal(view.placeSportsBet.calls.length, 0);
  other.remove(); fireEvent.keyDown(stake, { key: 'Enter', isComposing: true }); assert.equal(view.placeSportsBet.calls.length, 0);
  fireEvent.keyDown(stake, { key: 'Enter' }); assert.equal(view.placeSportsBet.calls.length, 1); assert.equal(view.placeFancyBet.calls.length, 0);
  assert.equal(JSON.stringify(view.placeSportsBet.calls[0][0]), JSON.stringify({ eventId: 'event-id', sportId: 'sport-id', leagueId: 'league-id', marketId: 'market-id', marketCode: 'market-code', marketType: 'exchange', selectionId: 1, selection: 'Team A', selectionType: 'back', odds: 2, stake: 1000 }));
  fireEvent.keyDown(stake, { key: 'Enter' }); assert.equal(view.placeSportsBet.calls.length, 1, 'in-flight duplicate blocked');
});
// Credit players play on D/W chips held in the wallet cash: MAX stakes balance - exposure for them as for cash players,
// never the retired available-credit figure (99,999 here), and the market's max stake still caps it.
test('bet slip MAX stakes the free balance (balance - exposure) for cash and credit players alike', () => {
  for (const [user, expected] of [
    [{ balance: 2500, exposure: -500, playerType: 'AGENT_CREDIT', creditAvailable: 99999 }, '2000'],
    [{ balance: 2500, exposure: 500, playerType: 'WHITELABEL_CREDIT', creditAvailable: 99999 }, '2000'],
    [{ balance: 2500, exposure: 500, playerType: 'REGULAR' }, '2000'],
    [{ balance: 90000, exposure: 0, playerType: 'AGENT_CREDIT', creditAvailable: 0 }, '50000'],
  ]) {
    // MAX sits in the phone sheet's stake box. The fixture bet carries no stake: the slip copies a bet's own stake back
    // into the field, and the stubbed provider never takes MAX's stake as the real one does.
    const view = slipHarness('mobile', user, { stake: undefined });
    try {
      fireEvent.click(view.getByRole('button', { name: 'MAX' }));
      assert.equal(view.getByRole('textbox', { name: 'Stake' }).value, expected, `${user.playerType} balance ${user.balance}`);
      assert.equal(view.placeSportsBet.calls.length, 0);
    } finally { view.unmount(); }
  }
});
// The desktop side slip follows the same rule. Its fixture bet carries no stake: the slip copies a bet's own stake
// back into the field, which would undo MAX.
test('desktop side slip MAX stakes the free balance (balance - exposure) for cash and credit players alike', () => {
  const bet = { team: 'Team A', market: 'Match Odds', type: 'back', odds: 2, teamIndex: 0, marketType: 'exchange', marketId: 'market-id', selectionId: 1, marketCode: 'market-code' };
  const event = { id: 'event-id', eventId: 'event-id', sportId: 'sport-id', leagueId: 'league-id', homeTeam: { name: 'A' }, awayTeam: { name: 'B' }, league: 'L', venue: 'V', startTime: '2026-10-10', status: 'live', markets: [] };
  for (const [user, expected] of [
    [{ balance: 2500, exposure: -500, playerType: 'AGENT_CREDIT', creditAvailable: 99999 }, '2000'],
    [{ balance: 2500, exposure: 500, playerType: 'WHITELABEL_CREDIT', creditAvailable: 99999 }, '2000'],
    [{ balance: 2500, exposure: 500, playerType: 'REGULAR' }, '2000'],
    [{ balance: 90000, exposure: 0, playerType: 'AGENT_CREDIT', creditAvailable: 0 }, '50000'],
  ]) {
    // Stable hook results, as the real providers give: the slip's effects depend on them.
    const slip = { quickBet: bet, closeQuickBet: spy(), updateQuickBet: spy() };
    const auth = { isAuthenticated: true, user, openAuthModal: spy(), refreshUser: spy() };
    const sports = { settings: { exchange: { maxStake: 50000 } } };
    const api = { placeSportsBet: spy(), placeFancyBet: spy() };
    const stubs = {
      [path.join(root, 'src/components/sports/BetSlipProvider.tsx')]: { useBetSlip: () => slip },
      '@/lib/auth': { useAuth: () => auth },
      '@/lib/api/user': api, '@/lib/notify': { notify: { error: spy(), success: spy() } },
      '@/hooks/useAppSettings': { useRiskConfig: () => ({ cashoutEnabled: true, overallExposureCap: null }) },
      '@/hooks/useStakeLimits': { useStakeLimits: () => ({ canPlaceStake: () => ({ allowed: true }) }) },
      '@/hooks/useSportsSettings': { useSportsSettings: () => sports },
      '@/lib/hooks/useOddsSocket': { useOddsSocket: () => undefined },
      [path.join(root, 'src/components/sport-event/fancySocketOdds.ts')]: { getFancyLiveSnapshot: () => null },
    };
    const view = renderModal('src/components/sport-event/DesktopBetSlipSidebar.tsx', { event }, { stubs });
    try {
      fireEvent.click(view.getByRole('button', { name: 'Max' }));
      // The field groups digits by locale ("2,000"), so compare the digits.
      assert.equal(view.getByRole('textbox', { name: 'Stake' }).value.replace(/[^0-9]/g, ''), expected, `${user.playerType} balance ${user.balance}`);
      assert.equal(api.placeSportsBet.calls.length, 0);
    } finally { view.unmount(); }
  }
});
test('native mobile bet slip owns its title and preserves the shared lock before any actual drag', () => {
  document.body.style.overflow = 'auto'; const view = slipHarness('mobile');
  const dialog = view.getByRole('dialog', { name: /^Bet slip:\s*Team A$/ }); assert.equal(dialog.tagName, 'DIALOG'); assert.equal(dialog.open, true);
  assert.equal(document.body.style.overflow, 'hidden'); assert.ok(dialog.querySelector('[data-enterprise-betslip="mobile"]'));
  view.unmount(); assert.equal(document.body.style.overflow, 'auto'); assert.equal(view.placeSportsBet.calls.length, 0);
});
test('native provider filter stages name-based selections, search and aria-pressed until an explicit Apply', () => {
  const selected = spy(); const closed = spy();
  const props = { isOpen: true, onClose: closed, providers: [{ name: 'Alpha', slug: 'alpha-id' }, { name: 'Beta', slug: 'beta-id' }], loading: false, selectedProviders: ['Alpha'], onSelectProviders: selected, isMobile: true };
  const view = renderModal('src/components/casino/ProviderFilterDrawer.tsx', props); const dialog = view.getByRole('dialog', { name: 'Filter Providers' });
  const alpha = within(dialog).getByRole('button', { name: 'Alpha', exact: true }); const beta = within(dialog).getByRole('button', { name: 'Beta', exact: true });
  assert.equal(alpha.getAttribute('aria-pressed'), 'true'); assert.equal(beta.getAttribute('aria-pressed'), 'false'); fireEvent.click(beta);
  assert.equal(beta.getAttribute('aria-pressed'), 'true'); assert.equal(selected.calls.length, 0);
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search providers' }), { target: { value: 'beta' } });
  assert.equal(within(dialog).queryByRole('button', { name: 'Alpha', exact: true }), null); assert.ok(within(dialog).getByRole('button', { name: 'Beta', exact: true }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Apply (2)' })); assert.equal(JSON.stringify(selected.calls), JSON.stringify([[['Alpha', 'Beta']]])); assert.equal(closed.calls.length, 1);
  view.rerenderModal({ ...props, isOpen: false }); view.unmount();
  const cancelView = renderModal('src/components/casino/ProviderFilterDrawer.tsx', props); fireEvent.click(cancelView.getByRole('button', { name: 'Cancel' })); assert.equal(selected.calls.length, 1); assert.equal(closed.calls.length, 2);
});
