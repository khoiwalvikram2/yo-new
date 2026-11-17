// The payment screenshot of a manual deposit: no upload any more (owner 2026-11-04: no S3, files are stored as base64).
// The chosen image is scaled down in the browser (longest side 1600 px, JPEG quality 0.8, well under 1 MB) and its
// data URI goes to createAdminDeposit in `proofKey`. The server checks it again (user-backend depositProof.ts).
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
const { render, cleanup, fireEvent, act, waitFor } = require('@testing-library/react');
const { loader } = require('./load-source.cjs');

const ok = data => ({ meta: { code: 200 }, data });
const plain = value => JSON.parse(JSON.stringify(value)); // objects made inside the loader's realm
const jpeg = bytes => 'data:image/jpeg;base64,' + Buffer.alloc(bytes, 7).toString('base64');

// A browser's canvas, as far as the page uses it: jsdom draws nothing, so each JPEG it would write is recorded and
// answered with a data URI of the size the test chooses (by quality).
const canvas = { encodes: [], fills: [], sizes: { 0.8: 300 * 1024 } };
dom.window.HTMLCanvasElement.prototype.getContext = function() {
  return { fillStyle: '', fillRect: (...args) => canvas.fills.push(args), drawImage() {} };
};
dom.window.HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
  canvas.encodes.push([this.width, this.height, type, quality]);
  return jpeg(canvas.sizes[quality] ?? 100 * 1024);
};
const bitmaps = { closed: 0, size: { width: 4000, height: 3000 }, fail: false };
const createImageBitmap = async () => {
  if (bitmaps.fail) throw new Error('not an image the browser can decode');
  return { ...bitmaps.size, close() { bitmaps.closed += 1; } };
};
const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, Node: dom.window.Node,
  HTMLInputElement: dom.window.HTMLInputElement, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), CustomEvent: dom.window.CustomEvent,
  URL: dom.window.URL, Image: dom.window.Image, createImageBitmap, setTimeout, clearTimeout, setInterval, clearInterval };
test.beforeEach(() => {
  canvas.encodes.length = 0; canvas.fills.length = 0; canvas.sizes = { 0.8: 300 * 1024 };
  bitmaps.closed = 0; bitmaps.size = { width: 4000, height: 3000 }; bitmaps.fail = false;
});
test.afterEach(() => { cleanup(); document.body.innerHTML = ''; document.body.style.overflow = ''; });

const lib = loader({}, globals)('src/lib/depositProof.ts');
const file = (type = 'image/png', name = 'receipt.png') => new dom.window.File(['fixture image bytes'], name, { type });

// ------------------------------------------------------------------ the compression
test('a large screenshot is scaled to 1600 px on its longest side, never up, and sent as JPEG 0.8', async () => {
  assert.deepEqual(plain(lib.fitWithin(4000, 3000)), { width: 1600, height: 1200 });
  assert.deepEqual(plain(lib.fitWithin(1080, 2400)), { width: 720, height: 1600 });
  assert.deepEqual(plain(lib.fitWithin(800, 600)), { width: 800, height: 600 }, 'a small image keeps its size');
  const uri = await lib.compressDepositProof(file());
  assert.match(uri, /^data:image\/jpeg;base64,/);
  assert.equal(lib.dataUriBytes(uri), 300 * 1024);
  assert.deepEqual(canvas.encodes, [[1600, 1200, 'image/jpeg', 0.8]]);
  assert.deepEqual(canvas.fills, [[0, 0, 1600, 1200]], 'drawn on white paper: a JPEG has no transparency');
  assert.equal(bitmaps.closed, 1, 'the decoded image is freed');
});

test('a screenshot still too heavy at 0.8 is tried at lower qualities, within the server limit', async () => {
  canvas.sizes = { 0.8: 1200 * 1024, 0.65: 950 * 1024, 0.5: 700 * 1024 };
  assert.equal(lib.dataUriBytes(await lib.compressDepositProof(file())), 700 * 1024);
  assert.deepEqual(canvas.encodes.map(entry => entry[3]), [0.8, 0.65, 0.5]);
  // Above the target at every quality, but within the server's 2 MB: the smallest is sent.
  canvas.encodes.length = 0;
  canvas.sizes = { 0.8: 1900 * 1024, 0.65: 1700 * 1024, 0.5: 1500 * 1024 };
  assert.equal(lib.dataUriBytes(await lib.compressDepositProof(file())), 1500 * 1024);
  // Over the server's limit even at the lowest quality: refused here, before anything is sent.
  canvas.sizes = { 0.8: 3000 * 1024, 0.65: 2600 * 1024, 0.5: 2200 * 1024 };
  await assert.rejects(lib.compressDepositProof(file()), { message: lib.PROOF_TOO_LARGE });
  assert.equal(bitmaps.closed, 3, 'freed every time');
});

test('a file that is not an image, or that cannot be decoded, is refused with a message for the player', async () => {
  await assert.rejects(lib.compressDepositProof(file('application/pdf', 'receipt.pdf')), { message: lib.PROOF_NOT_IMAGE });
  bitmaps.fail = true;
  // The <img> fallback cannot decode either (jsdom loads no images): still a readable refusal.
  const tools = { decode: async () => { throw new Error('decode'); }, encode: () => jpeg(10) };
  await assert.rejects(lib.compressDepositProof(file(), tools), { message: lib.PROOF_UNREADABLE });
  const blank = { decode: async () => ({ image: {}, width: 0, height: 0, release() {} }), encode: () => jpeg(10) };
  await assert.rejects(lib.compressDepositProof(file(), blank), { message: lib.PROOF_UNREADABLE });
  const noCanvas = { decode: async () => ({ image: {}, width: 10, height: 10, release() {} }), encode: () => 'data:,' };
  await assert.rejects(lib.compressDepositProof(file(), noCanvas), { message: lib.PROOF_UNREADABLE });
  assert.equal(canvas.encodes.length, 0);
});

// ------------------------------------------------------------------ the page
const appStubs = {
  'react-i18next': { useTranslation: () => ({ t: (key, options = {}) => options.defaultValue ?? key }) },
  '@/lib/auth': { useAuth: () => ({ user: { id: 7, playerType: 'REGULAR', username: 'fixture-player' }, refreshUser: async () => undefined }) },
  '@/hooks/useAppSettings': { usePaymentConfig: () => ({ depositMin: null, depositMax: null, depositFeePercent: 0 }), useParsedSettings: () => ({ hideDW: false }), useLogo: () => ({ siteTitle: 'Fixture' }) },
  '@/hooks/usePageSEO': { usePageSEO() {} },
  '@/lib/request': { requestWithToast: fn => fn() },
  '@/components/animations/ConfettiBurst': { __esModule: true, default: () => null },
  html2canvas: { __esModule: true, default: async () => ({ width: 400, height: 200, toDataURL: () => 'data:image/png;base64,Zml4dHVyZQ==' }) },
};
const bankAccount = { id: 'b1', type: 'bank', accountNumber: '1234567890', ifscCode: 'HDFC0001234', bankName: 'Fixture Bank', accountHolderName: 'Fixture Owner',
  displayName: 'Fixture Bank', minAmount: 100, maxAmount: 100000, weight: 1 };

function depositPage(options = {}) {
  const calls = { deposits: [] };
  const api = {
    getAdminAccounts: async () => ok([bankAccount]),
    getAdminDepositRequests: async () => ok([]),
    createAdminDeposit: async payload => {
      calls.deposits.push(payload);
      if (options.refusal) return { meta: { code: 400, message: options.refusal }, data: [] };
      return ok([{ id: 'dep-90', amount: payload.amount, status: 'PENDING', createdAt: '2026-11-04T10:00:00Z', utr: payload.txnRef ?? null, method: 'BANK_TRANSFER',
        cryptoAmount: null, cryptoRate: null, cryptoNetwork: null, cryptoBonusAmount: null }]);
    },
    createDeposit: async () => ok({ redirectUrl: '' }),
  };
  const stubs = { ...appStubs, '@/lib/api/user': api };
  const load = loader(stubs, globals);
  // The loader resolves files, not folders: hand the page its '@/components/deposit' barrel
  stubs['@/components/deposit'] = load('src/components/deposit/index.ts');
  const Page = load('src/pages/Deposit.tsx').default;
  const view = render(React.createElement(MemoryRouter, null, React.createElement(Page)));
  return { view, calls };
}
async function toBankConfirm(view) {
  fireEvent.change(view.getByPlaceholderText('Enter amount'), { target: { value: '5000' } });
  await waitFor(() => assert.equal(view.getByRole('button', { name: 'Continue' }).disabled, false));
  fireEvent.click(view.getByRole('button', { name: 'Continue' }));
  await waitFor(() => assert.ok(view.getByRole('button', { name: 'Proceed' })));
  fireEvent.click(view.getByText('Fixture Bank', { selector: 'h4' }).closest('.dep-method'));
  fireEvent.click(view.getByRole('button', { name: 'Proceed' }));
  await waitFor(() => assert.ok(view.getByRole('button', { name: 'Confirm Deposit' })));
}
const fileInput = view => view.container.querySelector('input[type="file"]');

test('the page compresses the chosen screenshot and sends its data URI with the deposit request', async () => {
  const { view, calls } = depositPage();
  await toBankConfirm(view);
  const input = fileInput(view);
  assert.equal(input.accept, 'image/*', 'images only: a PDF cannot be drawn into a JPEG');
  const submit = view.getByRole('button', { name: 'Confirm Deposit' });
  assert.equal(submit.disabled, true, 'no reference and no screenshot yet');
  await act(async () => { fireEvent.change(input, { target: { files: [file()] } }); });
  await waitFor(() => assert.ok(view.container.querySelector('.dep-file-name')?.textContent === 'receipt.png'));
  assert.equal(view.getByRole('button', { name: 'Confirm Deposit' }).disabled, false, 'the screenshot alone is enough');
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Confirm Deposit' })); });
  assert.equal(calls.deposits.length, 1);
  const { proofKey, ...rest } = plain(calls.deposits[0]);
  assert.deepEqual(rest, { accountId: 'b1', amount: 5000, type: 'bank' }, 'no reference: the screenshot is the proof');
  assert.match(proofKey, /^data:image\/jpeg;base64,/);
  assert.equal(lib.dataUriBytes(proofKey), 300 * 1024, 'well under 1 MB');
  assert.deepEqual(canvas.encodes, [[1600, 1200, 'image/jpeg', 0.8]]);
  await waitFor(() => assert.ok(view.getByRole('dialog', { name: 'Deposit Receipt' })));
});

test('an unreadable or non-image file shows why and sends nothing', async () => {
  const { view, calls } = depositPage();
  await toBankConfirm(view);
  await act(async () => { fireEvent.change(fileInput(view), { target: { files: [file('application/pdf', 'statement.pdf')] } }); });
  await waitFor(() => assert.equal(view.container.querySelector('.dep-upload-error')?.textContent, lib.PROOF_NOT_IMAGE));
  assert.equal(view.container.querySelector('.dep-file'), null);
  assert.equal(view.getByRole('button', { name: 'Confirm Deposit' }).disabled, true);
  bitmaps.fail = true;
  await act(async () => { fireEvent.change(fileInput(view), { target: { files: [file('image/heic', 'photo.heic')] } }); });
  await waitFor(() => assert.equal(view.container.querySelector('.dep-upload-error')?.textContent, lib.PROOF_UNREADABLE));
  assert.equal(calls.deposits.length, 0);
});

test('a refusal the server answers in meta is shown as an error, not as a submitted deposit', async () => {
  const message = 'The payment screenshot is too large (2.4 MB). The limit is 2 MB.';
  const { view, calls } = depositPage({ refusal: message });
  await toBankConfirm(view);
  await act(async () => { fireEvent.change(fileInput(view), { target: { files: [file()] } }); });
  await waitFor(() => assert.ok(view.container.querySelector('.dep-file')));
  await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Confirm Deposit' })); });
  assert.equal(calls.deposits.length, 1);
  await waitFor(() => assert.ok([...view.container.querySelectorAll('.dep-alert')].some(alert => alert.textContent === message)));
  assert.equal(view.queryByRole('dialog', { name: 'Deposit Receipt' }), null);
});
