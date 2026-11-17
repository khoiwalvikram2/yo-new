import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DocumentNode } from 'graphql';
import { PendingCommissionSection } from './PendingCommissionSection';
import { PendingSettlementsSection } from './PendingSettlementsSection';
import { SettlementHistorySection } from './SettlementHistorySection';
import type { CommissionSummary, CommissionReadiness, SettlementDetails, SettlementHistoryRow } from '../settlementModel';
const mock = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; options: Record<string, unknown> }>,
  exports: [] as Array<Record<string, unknown>>,
  mutationOptions: {} as Record<string, { onCompleted?: (data: unknown) => void; onError?: (error: Error) => void }>,
  mutate: vi.fn(async (options: unknown) => ({ options })), export: vi.fn(), success: vi.fn(), error: vi.fn(),
  summaries: [] as CommissionSummary[], readiness: undefined as CommissionReadiness | undefined,
  summary: undefined as CommissionSummary | undefined, details: undefined as SettlementDetails | undefined,
  cycles: [] as Array<Record<string, unknown>>,
  cycleMissing: false, loading: false, queryError: undefined as Error | undefined,
}));
function operation(doc: DocumentNode) { const definition = doc.definitions.find(item => item.kind === 'OperationDefinition'); return definition?.kind === 'OperationDefinition' ? definition.name?.value || '' : ''; }
vi.mock('@apollo/client', async importOriginal => ({ ...(await importOriginal<typeof import('@apollo/client')>()),
  useQuery: (doc: DocumentNode, options: Record<string, unknown>) => {
    const name = operation(doc); mock.calls.push({ name, options });
    const results: Record<string, unknown> = {
      // The open and the last closed IST weeks come from the backend (no browser week maths).
      CurrentCommissionCycle: mock.cycleMissing ? undefined : { currentCommissionCycle: { from: '2026-10-04T18:30:00.000Z', to: '2026-10-11T18:30:00.000Z', status: 'OPEN', fromDate: '2026-10-05', toDate: '2026-10-12', previousFromDate: '2026-09-28', previousToDate: '2026-10-05' } },
      CommissionCyclesForAgent: { commissionCyclesForAgent: mock.cycles },
      WhitelabelCommissionSummaries: { whitelabelCommissionSummaries: mock.summaries },
      CommissionCycleReadiness: { commissionCycleReadiness: mock.readiness },
      CommissionSummary: { agents: { commissionSummary: mock.summary } },
      CommissionHistory: { agents: { commissionHistory: { total: 17 } } },
      SettlementDetails: { settlementDetails: mock.details },
    };
    return { data: options.skip || (name === 'WhitelabelCommissionSummaries' && mock.loading) ? undefined : results[name], loading: name === 'WhitelabelCommissionSummaries' && mock.loading, error: name === 'WhitelabelCommissionSummaries' ? mock.queryError : undefined };
  },
  useMutation: (doc: DocumentNode, options: Record<string, unknown>) => { mock.mutationOptions[operation(doc)] = options; return [mock.mutate, { loading: false }]; },
}));
vi.mock('@/shared/hooks/useTableExport', () => ({ useTableExport: (options: Record<string, unknown>) => { mock.exports.push(options); return { exporting: false, handleExport: mock.export }; } }));
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (amount: number) => `₹${amount.toFixed(2)}`, convertFromWhitelabelCurrency: (amount: number) => amount * 2, getCurrencySymbol: () => '₹' }) }));
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (date: string) => date, formatDateTime: (date: string) => date }) }));
vi.mock('@/shared/services/notification', () => ({ notify: { success: mock.success, error: mock.error } }));
vi.mock('@/routes/commission/components/CommissionViewBetsModal', () => ({ CommissionViewBetsModal: ({ open, params, onClose }: { open: boolean; params: unknown; onClose: () => void }) => open ? <aside aria-label="Existing Bets dialog"><pre>{JSON.stringify(params)}</pre><button onClick={onClose}>Close Bets</button></aside> : null }));
const summary: CommissionSummary = { agentId: 'c1', username: 'Commission Partner', pendingCommission: 999, totalPaid: 200, lastPaidAt: '2026-10-01', sportsGGR: 100, casinoGGR: -50, matkaGGR: 0, sportsCommission: 10, casinoCommission: -5, matkaCommission: 0, sportsCommissionRate: .1, casinoCommissionRate: .15, matkaCommissionRate: .2, currency: 'INR', effectiveCalculatedTotal: 42, effectiveSportsCommission: 50, effectiveCasinoCommission: -8, effectiveMatkaCommission: 0, tallyApplied: { enabled: true, domains: ['sports', 'casino'] } };
// The pay dialog shows the payee's GROSS (what its payer owes it), before and after tally, whatever the caller.
const payeeSummary = { ...summary, grossSportsCommission: 12, grossCasinoCommission: -6, grossMatkaCommission: 0, grossEffectiveSportsCommission: 30, grossEffectiveCasinoCommission: 12, grossEffectiveMatkaCommission: 0, grossEffectiveCalculatedTotal: 42 } as CommissionSummary;
// commissionCyclesForAgent: the closed, unpaid week is payable; the open week is not.
const CLOSED = { from: '2026-09-27T18:30:00.000Z', to: '2026-10-04T18:30:00.000Z', status: 'CLOSED_UNSETTLED', paidAmount: 0, payableAmount: 42, calculatedTotal: 42, adjustmentAmount: 0, zeroCommission: false, fromDate: '2026-09-28', toDate: '2026-10-05' };
const OPEN = { from: '2026-10-04T18:30:00.000Z', to: '2026-10-11T18:30:00.000Z', status: 'OPEN', paidAmount: 0, payableAmount: 0, zeroCommission: false, fromDate: '2026-10-05', toDate: '2026-10-12' };
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T08:00:00Z')); mock.calls = []; mock.exports = []; mock.mutationOptions = {}; mock.mutate.mockClear(); mock.export.mockClear(); mock.error.mockClear(); mock.success.mockClear(); mock.summaries = [summary]; mock.summary = payeeSummary; mock.cycles = [CLOSED, OPEN]; mock.readiness = { ready: true, payableAmount: 42, reasons: ['READY', 'LEDGER_GAP'] }; mock.details = undefined; mock.cycleMissing = false; mock.loading = false; mock.queryError = undefined; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const mountCommission = () => render(<MemoryRouter><PendingCommissionSection /></MemoryRouter>);
const lastCall = (name: string) => mock.calls.filter(call => call.name === name).at(-1)!;
const click = async (button: HTMLElement) => { await act(async () => { fireEvent.click(button); }); };
test('commission periods retain full IST cycles, exclusive-end label, old date vars and lazy payment query guards', async () => {
  mountCommission(); assert.ok(screen.getByRole('button', { name: 'Current Week (05 Oct – 11 Oct)' }));
  assert.deepEqual(lastCall('WhitelabelCommissionSummaries').options.variables, { periodFrom: '2026-10-05', periodTo: '2026-10-12' });
  assert.equal(lastCall('WhitelabelCommissionSummaries').options.fetchPolicy, 'cache-and-network'); assert.equal(lastCall('CommissionCycleReadiness').options.skip, true);
  await click(screen.getByRole('button', { name: 'Last Week (28 Sep – 04 Oct)' })); assert.deepEqual(lastCall('WhitelabelCommissionSummaries').options.variables, { periodFrom: '2026-09-28', periodTo: '2026-10-05' });
  await click(screen.getByRole('button', { name: 'All time' })); assert.deepEqual(lastCall('WhitelabelCommissionSummaries').options.variables, { periodFrom: '2000-01-01', periodTo: '2026-10-11' });
});
// Pay opens CommissionCyclePayDialog: a picker of the agent's CLOSED_UNSETTLED weeks (never the open week or all time).
const payDialog = () => screen.getByRole('dialog', { name: 'Pay commission — Commission Partner' });
test('payment reads exact selected-agent cycle/readiness/history shapes and shows all domains, tally and count', async () => {
  mountCommission(); await click(screen.getByRole('button', { name: 'Pay Commission' })); const dialog = payDialog();
  assert.deepEqual(lastCall('CommissionCyclesForAgent').options.variables, { agentId: 'c1' }); assert.equal(lastCall('CommissionCyclesForAgent').options.fetchPolicy, 'network-only');
  // Only the closed week is offered, with its payable; its IST dates drive readiness, history and the payout.
  const picker = within(dialog).getByRole('combobox', { name: 'Unpaid cycle' }) as HTMLSelectElement; assert.equal(picker.options.length, 1); assert.equal(picker.options[0].textContent, '28 Sep – 04 Oct 2026 · payable ₹84.00');
  assert.deepEqual(lastCall('CommissionCycleReadiness').options.variables, { agentId: 'c1', cycleFrom: '2026-09-28', cycleTo: '2026-10-05' }); assert.equal(lastCall('CommissionCycleReadiness').options.skip, false);
  assert.deepEqual(lastCall('CommissionHistory').options.variables, { agentId: 'c1', periodFrom: '2026-09-28', periodTo: '2026-10-05', limit: 1, offset: 0 });
  assert.deepEqual(lastCall('CommissionSummary').options.variables, { agentId: 'c1', periodFrom: '2026-09-28', periodTo: '2026-10-05' }); assert.equal(lastCall('CommissionSummary').options.fetchPolicy, 'network-only');
  const domains = within(dialog).getByRole('region', { name: 'Commission by domain' }); for (const domain of ['Sports', 'Casino', 'Matka']) assert.ok(within(domains).getByText(domain));
  assert.ok(within(dialog).getByText('17 settled bets in this cycle · Tally ON: Sports, Casino')); assert.ok(within(dialog).getByText('Ledger gap'));
  assert.ok(within(dialog).getByText('Commission ₹24.00 (10.00%)')); assert.ok(within(dialog).getByText('After tally ₹60.00')); assert.ok(within(dialog).getByText('GGR ₹-100.00')); assert.ok(within(dialog).getByText('Payable amount (fixed)'));
});
test('fixed payout submits readiness amount rather than row pending and preserves raw optional notes plus original refetch', async () => {
  mountCommission(); await click(screen.getByRole('button', { name: 'Pay Commission' })); fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: '  Approved audit  ' } }); await click(screen.getByRole('button', { name: 'Pay this cycle' }));
  assert.deepEqual(mock.mutate.mock.calls[0], [{ variables: { input: { agentId: 'c1', amount: 42, periodFrom: '2026-09-28', periodTo: '2026-10-05', notes: '  Approved audit  ' } } }]);
  const options = mock.mutationOptions.PayCommission as Record<string, unknown>; assert.equal(options.awaitRefetchQueries, true); const refs = options.refetchQueries as Array<{ variables: unknown }>; assert.deepEqual(refs[0].variables, { periodFrom: '2026-10-05', periodTo: '2026-10-12' });
});
test('empty commission notes retain original fallback; success closes/reset and refusal/error keep the target visible', async () => {
  mountCommission(); await click(screen.getByRole('button', { name: 'Pay Commission' })); await click(screen.getByRole('button', { name: 'Pay this cycle' }));
  assert.equal((mock.mutate.mock.calls[0] as unknown as [{ variables: { input: { notes: string } } }])[0].variables.input.notes, 'Commission payout (full cycle IST)');
  await act(async () => { mock.mutationOptions.PayCommission.onCompleted?.({ payCommission: { success: false, message: 'Not permitted' } }); }); assert.ok(payDialog()); assert.ok(mock.error.mock.calls.some(call => call[0] === 'Not permitted'));
  await act(async () => { mock.mutationOptions.PayCommission.onError?.(new Error('Transport failed')); }); assert.ok(mock.error.mock.calls.some(call => call[0] === 'Transport failed'));
  await act(async () => { mock.mutationOptions.PayCommission.onCompleted?.({ payCommission: { success: true, message: 'Paid' } }); }); assert.equal(screen.queryByRole('dialog'), null); assert.equal(lastCall('CommissionCycleReadiness').options.skip, true); assert.ok(mock.success.mock.calls.some(call => call[0] === 'Paid'));
});
test('not-ready/zero/negative payout guards and readiness notices preserve existing rules', async () => {
  const payButton = () => screen.getByRole('button', { name: 'Pay this cycle' }) as HTMLButtonElement;
  mock.readiness = { ready: false, payableAmount: 0, reasons: ['ZERO_PAYABLE_NET'] }; const view = mountCommission(); await click(screen.getByRole('button', { name: 'Pay Commission' })); assert.ok(screen.getByText('No payout due')); assert.equal(payButton().disabled, true);
  // Open bets placed in the week and unresolved adjustments block the payout; a ledger gap only informs.
  mock.readiness = { ready: false, payableAmount: 7, reasons: ['MISSING_BETS', 'UNRESOLVED_ADJUSTMENT', 'LEDGER_GAP'], openBets: 3, unresolvedAdjustments: 1 }; view.rerender(<MemoryRouter><PendingCommissionSection /></MemoryRouter>);
  assert.ok(screen.getByText('Cannot pay this cycle yet')); assert.ok(screen.getByText('3 bets placed in this week are still open. Pay after they settle, so they are included.')); assert.ok(screen.getByText('1 adjustment raised against this week is still pending.')); assert.ok(screen.getByText('Ledger gap')); assert.equal(payButton().disabled, true);
  mock.readiness = { ready: true, payableAmount: -2, reasons: [] }; view.rerender(<MemoryRouter><PendingCommissionSection /></MemoryRouter>); assert.equal(payButton().disabled, true); assert.equal(mock.mutate.mock.calls.length, 0);
});
test('no closed unpaid week: nothing to pay, zero-commission weeks count as settled, and no readiness is read', async () => {
  mock.cycles = [{ ...CLOSED, status: 'SETTLED', payableAmount: 0, zeroCommission: true }, OPEN]; mountCommission(); await click(screen.getByRole('button', { name: 'Pay Commission' }));
  assert.ok(within(payDialog()).getByText('Nothing to pay')); assert.ok(within(payDialog()).getByText(/1 week counted as settled/)); assert.equal(lastCall('CommissionCycleReadiness').options.skip, true); assert.equal((screen.getByRole('button', { name: 'Pay this cycle' }) as HTMLButtonElement).disabled, true);
});
test('cancel resets notes/query guards; existing View Bets receives unchanged selected target cycle props', async () => {
  mountCommission(); await click(screen.getByRole('button', { name: 'Pay Commission' })); fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'Draft notes' } }); await click(screen.getByRole('button', { name: 'View Bets' }));
  const bets = screen.getByRole('complementary', { name: 'Existing Bets dialog' }); assert.ok(bets.textContent?.includes(JSON.stringify({ agentId: 'c1', username: 'Commission Partner', cycleFrom: '2026-09-28', cycleTo: '2026-10-05', activeCycleKey: CLOSED.from })));
  await click(screen.getByRole('button', { name: 'Close Bets' })); await click(screen.getByRole('button', { name: 'Cancel' })); assert.equal(lastCall('CommissionHistory').options.skip, true); await click(screen.getByRole('button', { name: 'Pay Commission' })); assert.equal((screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement).value, '');
});
test('commission strict .01 threshold, all-row export and pagination preserve original contracts', () => {
  mock.summaries = Array.from({ length: 12 }, (_, index) => ({ ...summary, agentId: `c${index + 1}`, username: `Partner ${index + 1}`, pendingCommission: index ? 20 : .01 })); mountCommission();
  const buttons = within(screen.getByRole('table', { name: 'Commission Agents' })).getAllByRole('button', { name: 'Pay Commission' }); assert.equal(buttons.length, 10); assert.equal((buttons[0] as HTMLButtonElement).disabled, true); assert.equal((buttons[1] as HTMLButtonElement).disabled, false);
  const options = mock.exports.at(-1)!; assert.equal((options.data as unknown[]).length, 12); assert.equal(options.filename, 'Pending-Commission-Agents'); assert.equal(options.sheetName, 'Commission Agents'); fireEvent.click(screen.getByRole('button', { name: 'Export' })); assert.equal(mock.export.mock.calls.length, 1);
});
test('expanded commission row reads same agent/cycle cache policy and retains effective/domain figures', async () => {
  // The (closed) pay dialog stays mounted with its own skipped CommissionSummary read; the row's read is the live one.
  mountCommission(); await click(screen.getByRole('button', { name: 'Expand c1' })); const call = mock.calls.filter(item => item.name === 'CommissionSummary' && !item.options.skip).at(-1)!; assert.deepEqual(call.options.variables, { agentId: 'c1', periodFrom: '2026-10-05', periodTo: '2026-10-12' }); assert.equal(call.options.fetchPolicy, 'cache-and-network'); assert.ok(screen.getByText('Effective total:')); assert.ok(screen.getByText('Tally: sports, casino')); assert.ok(screen.getByText('15.00%'));
});
test('commission loading/error/empty states stay explicit', () => {
  mock.loading = true; const view = mountCommission(); assert.ok(screen.getByText('Loading commission summaries…')); mock.loading = false; mock.queryError = new Error('Unavailable'); view.rerender(<MemoryRouter><PendingCommissionSection /></MemoryRouter>); assert.ok(screen.getByText('Unavailable')); mock.queryError = undefined; mock.summaries = []; view.rerender(<MemoryRouter><PendingCommissionSection /></MemoryRouter>); assert.ok(screen.getByText('No commission agents with pending amount for this period'));
});
const history: SettlementHistoryRow[] = [
  { id: 'h1', agentId: 'a1', agent: { username: 'Sharing Partner', schemeType: 'SHARING' }, periodFrom: '2026-10-01', periodTo: '2026-10-03', totalAmount: 11, status: 'POSTED', createdAt: '2026-10-04', notes: 'First audit' },
  { id: 'h2', agentId: 'a2', agent: { username: 'Commission Partner', schemeType: 'COMMISSION' }, periodFrom: '2026-10-02', periodTo: '2026-10-04', totalAmount: -22, status: 'COMMISSION', createdAt: '2026-10-05', notes: 'Second audit' },
];
test('history date/search/type filters retain boundary inclusivity, signed rows and clear all', () => {
  render(<MemoryRouter><SettlementHistorySection isAgent={false} settlements={history} /></MemoryRouter>); const table = screen.getByRole('table', { name: 'Settlement History' }); assert.ok(within(table).getByText('₹-44.00'));
  fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-10-02' } }); fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-10-02' } }); assert.equal(within(table).queryByText('Sharing Partner'), null); assert.ok(within(table).getByText('Commission Partner'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Settlement Type' }), { target: { value: 'P_L' } }); assert.ok(screen.getByText('No settlement history')); fireEvent.click(screen.getByRole('button', { name: 'Clear all' })); assert.ok(within(table).getByText('Sharing Partner'));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search by agent or ID' }), { target: { value: 'a2' } }); assert.ok(within(table).getByText('Commission Partner')); assert.equal(within(table).queryByText('Sharing Partner'), null);
});
function expandedBy(key: string) { const controls = screen.getByRole('button', { name: `Collapse ${key}` }).getAttribute('aria-controls')!; return document.getElementById(controls)!; }
test('two expanded history rows keep their own financial detail cache and reject late wrong-ID responses', async () => {
  const view = render(<MemoryRouter><SettlementHistorySection isAgent={false} settlements={history} /></MemoryRouter>); mock.details = { ...history[0], directPlayersContribution: 101, directPlayersCount: 1 }; await click(screen.getByRole('button', { name: 'Expand h1' })); assert.ok(within(expandedBy('h1')).getByText('Contribution: ₹202.00'));
  mock.details = undefined; await click(screen.getByRole('button', { name: 'Expand h2' })); assert.equal(within(expandedBy('h2')).queryByText('Contribution: ₹202.00'), null);
  mock.details = { ...history[1], directPlayersContribution: 202, directPlayersCount: 2 }; view.rerender(<MemoryRouter><SettlementHistorySection isAgent={false} settlements={history} /></MemoryRouter>); assert.ok(within(expandedBy('h2')).getByText('Contribution: ₹404.00')); assert.ok(within(expandedBy('h1')).getByText('Contribution: ₹202.00'));
  mock.details = { ...history[0], directPlayersContribution: 999 }; view.rerender(<MemoryRouter><SettlementHistorySection isAgent={false} settlements={history} /></MemoryRouter>); assert.equal(within(expandedBy('h2')).queryByText('Contribution: ₹1998.00'), null); assert.ok(within(expandedBy('h2')).getByText('Contribution: ₹404.00')); assert.ok(within(expandedBy('h1')).getByText('Contribution: ₹202.00'));
  assert.deepEqual(lastCall('SettlementDetails').options.variables, { settlementId: 'h2' }); assert.equal(lastCall('SettlementDetails').options.fetchPolicy, 'network-only');
});
test('agent upline expansion remains notes-only and downline enables the same single-ID details query', async () => {
  render(<MemoryRouter><SettlementHistorySection isAgent agentSchemeType="SHARING" settlements={[history[0]]} downlineSettlements={[history[1]]} /></MemoryRouter>); await click(screen.getByRole('button', { name: 'Expand h1' })); assert.ok(screen.getByText('First audit')); assert.equal(lastCall('SettlementDetails').options.skip, true);
  await click(screen.getByRole('button', { name: 'Downline' })); await click(screen.getByRole('button', { name: 'Expand h2' })); assert.equal(lastCall('SettlementDetails').options.skip, false); assert.deepEqual(lastCall('SettlementDetails').options.variables, { settlementId: 'h2' });
});
test('pending sharing review preserves partial input, derived direction, trimmed audit notes and refused mutation state', async () => {
  // Positive SHARING pending = TO_AGENT (players lost, the agent is paid its share). The settle carries the row's periodTo.
  const pending = { agentId: 'a1', agent: { username: 'Sharing Partner', schemeType: 'SHARING' }, schemeType: 'SHARING', pendingAmount: 100, settlementType: 'P_L', settledThisPeriod: -40, periodFrom: '2026-10-03T00:00:00.000Z', periodTo: '2026-10-10T07:59:00.000Z' }; render(<MemoryRouter><PendingSettlementsSection isAgent={false} pendingSettlements={[pending]} /></MemoryRouter>);
  const table = screen.getByRole('table', { name: 'Pending Settlements' }); assert.ok(within(table).getByText('₹200.00')); assert.ok(within(table).getByText('Pay to agent')); assert.ok(within(table).getByText('₹80.00'));
  await click(screen.getByRole('button', { name: 'Settle' }));
  fireEvent.change(screen.getByLabelText('Settlement Amount'), { target: { value: '30' } }); fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: '  Partial audit  ' } }); await click(screen.getByRole('button', { name: 'Review Details' })); await click(screen.getByRole('button', { name: 'Confirm Settlement' }));
  assert.deepEqual(mock.mutate.mock.calls[0], [{ variables: { input: { agentId: 'a1', settlementType: 'P_L', amount: 30, direction: 'TO_AGENT', notes: 'Partial audit', periodTo: '2026-10-10T07:59:00.000Z' } } }]);
  await act(async () => { mock.mutationOptions.SettleAgent.onCompleted?.({ settleAgent: { success: false, message: 'Refused' } }); }); assert.ok(screen.getByRole('dialog', { name: 'Confirm Settlement' })); assert.ok(mock.error.mock.calls.some(call => call[0] === 'Refused'));
});
test('pending modal refreshes the selected row\'s actual balance, exports all rows and cancels without write', async () => {
  // A SHARING agent that owes (FROM_AGENT; the backend's settlementDirection says who pays). CREDIT rows no longer
  // reach the settlement centre: since 2026-11-02 a CREDIT agent settles by moving chips (spec §6).
  const pending = { agentId: 'a2', agent: { username: 'Sharing Debtor', schemeType: 'SHARING' }, schemeType: 'SHARING', pendingAmount: -75, settlementDirection: 'FROM_AGENT', settlementType: 'P_L', settledThisPeriod: 0, totalSettledToAgent: 0, periodTo: '2026-10-10T07:59:00.000Z' };
  const refresh = vi.fn(async () => ({})); const view = render(<MemoryRouter><PendingSettlementsSection isAgent={false} pendingSettlements={[pending]} refetchPendingSettlements={refresh} /></MemoryRouter>); assert.ok(screen.getByText('₹0.00')); assert.ok(screen.getByText('₹150.00')); assert.ok(screen.getByText('Collect from agent')); await click(screen.getByRole('button', { name: 'Settle' })); assert.equal((screen.getByLabelText('Settlement Amount') as HTMLInputElement).disabled, false); assert.equal((screen.getByLabelText('Settlement Amount') as HTMLInputElement).value, '75'); await click(screen.getByRole('button', { name: 'Refresh amount' })); assert.equal(refresh.mock.calls.length, 1);
  view.rerender(<MemoryRouter><PendingSettlementsSection isAgent={false} pendingSettlements={[{ ...pending, pendingAmount: -120 }]} refetchPendingSettlements={refresh} /></MemoryRouter>); assert.equal((screen.getByLabelText('Settlement Amount') as HTMLInputElement).value, '120');
  await click(screen.getByRole('button', { name: 'Cancel' })); assert.equal(screen.queryByRole('dialog'), null); assert.equal(mock.mutate.mock.calls.length, 0); assert.equal(mock.exports.filter(options => options.filename === 'Pending-Settlements').at(-1)?.data instanceof Array, true);
});
test("agent's own card shows its side of the settlement in words, and settling a sub-agent posts that row's window", async () => {
  const sub = { agentId: 's1', agent: { username: 'Sub Partner', schemeType: 'SHARING' }, schemeType: 'SHARING', pendingAmount: -60, settlementType: 'P_L', periodTo: '2026-10-10T07:00:00.000Z' };
  const view = render(<MemoryRouter><PendingSettlementsSection isAgent agentSchemeType="SHARING" settlement={{ settlementDue: 25, sharePercentage: 40 }} subAgentsPending={[sub]} /></MemoryRouter>);
  // settlementDue +25 = TO_AGENT: the agent receives from its upline. The sub-agent's −60 = FROM_AGENT: the agent collects.
  assert.ok(screen.getByText('You receive')); assert.ok(screen.getByText('₹50.00'));
  const table = screen.getByRole('table', { name: 'Sub-Agents Pending' }); assert.ok(within(table).getByText('₹120.00')); assert.ok(within(table).getByText('Collect from agent'));
  await click(within(table).getByRole('button', { name: 'Settle' })); assert.ok(screen.getByText('Collect FROM Agent (Agent pays you)'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'Collect from sub' } }); await click(screen.getByRole('button', { name: 'Review Details' })); await click(screen.getByRole('button', { name: 'Confirm Settlement' }));
  assert.deepEqual(mock.mutate.mock.calls[0], [{ variables: { input: { agentId: 's1', settlementType: 'P_L', amount: 60, direction: 'FROM_AGENT', notes: 'Collect from sub', periodTo: '2026-10-10T07:00:00.000Z' } } }]);
  view.rerender(<MemoryRouter><PendingSettlementsSection isAgent agentSchemeType="SHARING" settlement={{ settlementDue: -25, sharePercentage: 40 }} /></MemoryRouter>); assert.ok(screen.getByText('You pay'));
});

test('waits for the real current cycle instead of sending an accidental all-time report', () => {
  mock.cycleMissing = true;
  try {
    mountCommission();
    const request = mock.calls.find(call => call.name === 'WhitelabelCommissionSummaries');
    assert.equal(request?.options.skip, true);
    assert.deepEqual(request?.options.variables, { periodFrom: null, periodTo: null });
  } finally { mock.cycleMissing = false; }
});
