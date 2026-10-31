import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DocumentNode } from 'graphql';
import { EventBetsSidebar } from './EventBetsSidebar';
import type { SidebarBet } from '../live-analysis/sportsLiveModel';

const mock = vi.hoisted(() => ({ bets: [] as SidebarBet[], agent: false, whitelabel: true, success: true, reject: false, roles: [] as string[], queries: [] as Array<{ name: string; options: Record<string, unknown> }>, refetch: vi.fn(), fetchMore: vi.fn(), voidBet: vi.fn(), cancelBet: vi.fn(), toast: vi.fn(), roots: [] as Array<{ id: string; username: string; schemeType: string; rate: number }> }));
function operation(doc: DocumentNode) { const def = doc.definitions.find(item => item.kind === 'OperationDefinition'); return def?.kind === 'OperationDefinition' ? def.name?.value || '' : ''; }
const markets = [{ id: 'm1', name: 'First innings', type: 'fancy' }, { id: 'm2', name: 'Match Odds', type: 'exchange' }];
const sidebarClient = { query: async ({ query }: { query: DocumentNode }) => ({ data: operation(query) === 'RunnersByMarket' ? { runnersByMarket: [{ id: 'r1', name: 'India', selectionCode: 'IND' }] } : { agents: { agentDescendantIds: ['root1', 'child1'] } } }) };
vi.mock('@apollo/client', async importOriginal => ({ ...(await importOriginal<typeof import('@apollo/client')>()),
  useQuery: (doc: DocumentNode, options: Record<string, unknown>) => {
    const name = operation(doc); mock.queries.push({ name, options });
    const data = name === 'EventBets' ? { sportsBets: mock.bets } : name === 'MarketsByEvent' ? { marketsByEvent: markets } : name === 'MarketsByIds' ? { marketsByIds: markets } : name === 'AgentRootAgents' ? { agents: { agentRootAgents: mock.roots } } : name === 'AgentTreeForView' ? { agents: { agentTree: mock.roots } } : { bettingPatterns: [] };
    return { data, loading: false, refetch: mock.refetch, fetchMore: mock.fetchMore, networkStatus: 7 };
  },
  useApolloClient: () => sidebarClient,
  useMutation: (doc: DocumentNode) => [operation(doc) === 'VoidBet' ? mock.voidBet : mock.cancelBet],
}));
vi.mock('@/shared/core/useWhitelabels', () => ({ useCurrentWhitelabel: () => ({ whitelabel: mock.whitelabel ? { id: 'wl1' } : null }) }));
vi.mock('@/shared/core/authStore', () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector({ isAgent: () => mock.agent, agent: mock.agent ? { id: 'root1' } : undefined, roles: mock.roles }) }));
vi.mock('@/shared/core/uiStore', () => ({ useUIStore: (selector: (state: unknown) => unknown) => selector({ directorMode: 'whitelabel' }) }));
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `₹${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value * 2 }) }));
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: () => 'Oct 10', formatTime: () => '12:00:00' }) }));
vi.mock('@/ui/components/toast', () => ({ toast: mock.toast }));
const bet = (id = 'b1', overrides: Partial<SidebarBet> = {}): SidebarBet => ({ id, userId: 'u1', userName: 'Preview Player', eventId: 'e1', sportName: 'Cricket', leagueName: 'International', eventName: 'India vs England', marketId: 'm1', selectionId: 'IND', stake: 100, liability: 75, price: 50, oddsSize: 0, side: 'back', status: 'matched', createdAt: '2026-10-10T12:00:00Z', ipAddress: '127.0.0.1', userAgent: 'Preview browser', deviceInfo: 'Desktop', country: 'India', agentInfo: { agentId: 'child1', agentName: 'Child Partner', schemeType: 'SHARING', rate: 10 }, ...overrides });
beforeEach(() => {
  mock.bets = [bet()]; mock.agent = false; mock.whitelabel = true; mock.success = true; mock.reject = false; mock.roles = []; mock.roots = []; mock.queries = [];
  vi.clearAllMocks(); mock.refetch.mockResolvedValue({ data: { sportsBets: mock.bets } });
  mock.voidBet.mockImplementation(async () => { if (mock.reject) throw new Error('Network failed'); return { data: { voidBet: { success: mock.success, message: mock.success ? 'Voided' : 'Already settled' } } }; });
  mock.cancelBet.mockResolvedValue({ data: { cancelBet: { success: true } } });
});
afterEach(cleanup);
function mount(extra: Partial<React.ComponentProps<typeof EventBetsSidebar>> = {}) { return render(<MemoryRouter><EventBetsSidebar isCollapsed={false} setIsCollapsed={vi.fn()} eventId="e1" mobileMode showSportsHierarchy {...extra} /></MemoryRouter>); }
/** The default bet is fancy, so its row names the market where an exchange bet names the runner. */
const ROW_ACTIONS = 'Actions for Preview Player, First innings';
async function chooseAction(item: string, row = ROW_ACTIONS) { fireEvent.click(await screen.findByRole('button', { name: row })); fireEvent.click(await screen.findByRole('menuitem', { name: item })); }
/** Bet IDs of the rendered table rows, in DOM order (the IDs are behind Copy bet ID, not on screen). */
const betIds = (root: ParentNode = document) => Array.from(root.querySelectorAll('tr[data-bet-id]'), row => row.getAttribute('data-bet-id'));

test('preserves open-bet query scope, runner batching, zero fancy odds size and connection metadata', async () => {
  mount();
  assert.ok(await screen.findByText('First innings'));
  assert.ok(screen.getByText('@50/0'));
  assert.ok(screen.getByText('Cricket • International • India vs England'));
  const query = mock.queries.find(item => item.name === 'EventBets')!;
  assert.deepEqual(query.options.variables, { query: { eventId: 'e1', statuses: ['matched', 'unmatched'], search: undefined, limit: 100, offset: 0 } });
  assert.equal(query.options.fetchPolicy, 'network-only'); assert.equal(query.options.pollInterval, undefined);
  assert.equal(screen.getByRole('button', { name: ROW_ACTIONS }).getAttribute('aria-haspopup'), 'menu');
  await chooseAction('IP details');
  const dialog = await screen.findByRole('dialog', { name: 'Connection Details' });
  assert.ok(within(dialog).getByText('127.0.0.1')); assert.ok(within(dialog).getByText('Preview browser')); assert.ok(within(dialog).getByText('Desktop')); assert.ok(within(dialog).getByText('India', { selector: 'dd' }));
});
test('bets render as one captioned table with the kit columns, side tag and open status', async () => {
  mount();
  const table = await screen.findByRole('table', { name: 'All bets' });
  assert.deepEqual(within(table).getAllByRole('columnheader').map(th => th.textContent), ['Bet', 'Odds', 'Stake', 'Liability', 'P&L', 'Player', 'Status', 'Placed', 'Event', 'Actions']);
  const row = within(table).getAllByRole('row')[1];
  assert.ok(within(row).getByText('BACK')); assert.ok(within(row).getByText('fancy')); assert.ok(within(row).getByText('OPEN'));
  assert.ok(within(row).getByText('₹200.00')); assert.ok(within(row).getByText('₹150.00')); assert.ok(within(row).getByText('Oct 10 12:00:00'));
});
test('cancelled dialog never mutates and empty reason blocks the exact void mutation', async () => {
  mount(); await chooseAction('Void bet');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  assert.ok(await screen.findByText('Please input a reason')); assert.equal(mock.voidBet.mock.calls.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  assert.equal(screen.queryByRole('dialog'), null); assert.equal(mock.voidBet.mock.calls.length, 0);
});
test('void and invalid retain exact raw reason and betId payloads, refetch and success closure', async () => {
  const view = mount(); await chooseAction('Void bet');
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: '  operator note  ' } }); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.deepEqual(mock.voidBet.mock.calls[0][0], { variables: { betId: 'b1', reason: '  operator note  ' } }); assert.equal(mock.refetch.mock.calls.filter(call => call.length === 0).length, 1);
  view.unmount(); mount(); await chooseAction('Mark invalid');
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Cancel duplicate' } }); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.deepEqual(mock.cancelBet.mock.calls[0][0], { variables: { betId: 'b1', reason: 'Cancel duplicate' } });
});
test('business refusal and thrown errors keep the dialog and entered reason for retry', async () => {
  mock.success = false; mount(); await chooseAction('Void bet');
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Review stake' } }); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
  await waitFor(() => assert.equal(mock.toast.mock.calls.at(-1)?.[0].message, 'Already settled'));
  assert.ok(screen.getByRole('dialog')); assert.equal((screen.getByRole('textbox', { name: 'Reason' }) as HTMLTextAreaElement).value, 'Review stake');
  mock.reject = true; await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })); });
  await waitFor(() => assert.equal(mock.toast.mock.calls.at(-1)?.[0].message, 'Network failed')); assert.ok(screen.getByRole('dialog')); assert.equal(mock.refetch.mock.calls.filter(call => call.length === 0).length, 0);
});
test('agent and missing-whitelabel views retain data but expose neither mutation action', async () => {
  mock.agent = true; const view = mount(); await screen.findByRole('button', { name: 'Preview Player' });
  fireEvent.click(screen.getByRole('button', { name: ROW_ACTIONS })); assert.ok(await screen.findByRole('menuitem', { name: 'Copy bet ID' }));
  assert.equal(screen.queryByRole('menuitem', { name: 'Void bet' }), null); assert.equal(screen.queryByRole('menuitem', { name: 'Mark invalid' }), null);
  view.unmount(); mock.agent = false; mock.whitelabel = false; mount(); await screen.findByRole('button', { name: 'Preview Player' });
  fireEvent.click(screen.getByRole('button', { name: ROW_ACTIONS })); assert.ok(await screen.findByRole('menuitem', { name: 'Copy bet ID' }));
  assert.equal(screen.queryByRole('menuitem', { name: 'Void bet' }), null); assert.equal(screen.queryByRole('menuitem', { name: 'Mark invalid' }), null);
});
test('parent live batches deduplicate IDs and exclude other-event and settled bets; shared patterns skip local polling', async () => {
  const batch = [bet(), bet('b2', { userName: 'New Player' }), bet('b3', { eventId: 'e2' }), bet('b4', { status: 'won' })];
  const patterns = new Map([['u1', [{ userId: 'u1', patternType: 'RAPID_BETTING' as const, severity: 'HIGH' as const }]]]);
  mount({ placedBetBatch: batch, patternsByUserId: patterns });
  await waitFor(() => assert.ok(betIds().includes('b2'))); assert.deepEqual([...betIds()].sort(), ['b1', 'b2']);
  assert.ok(screen.getAllByLabelText('RAPID BETTING (HIGH)').length);
  assert.equal(mock.queries.find(item => item.name === 'BettingPatterns')?.options.skip, true);
});
test('user grouping preserves converted liability totals and filtering limits visible bets', async () => {
  mock.bets = [bet(), bet('b2', { userId: 'u2', userName: 'Other Player', status: 'unmatched', liability: 25 })]; mount(); await waitFor(() => assert.ok(betIds().includes('b2')));
  assert.equal(screen.queryByRole('combobox', { name: 'Status' }), null, 'the filters wait behind the Filters disclosure');
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'unmatched' } });
  assert.ok(screen.getByRole('button', { name: /^Filters,\s*1\s*on$/ })); // jsdom drops the spaces a browser keeps
  assert.deepEqual(betIds(), ['b2']);
  fireEvent.click(screen.getByRole('button', { name: 'User' }));
  assert.ok(screen.getByText('Total Wagered: ₹50.00'));
  const group = screen.getByText('Other Player', { selector: 'summary strong' }).closest('details')!; fireEvent.click(within(group).getByText('Other Player', { selector: 'strong' }));
  assert.deepEqual(betIds(group), ['b2']); assert.ok(within(group).getByRole('table', { name: 'Bets by Other Player' }));
});
test('agent grouping rolls descendant bets into loaded root-agent scheme/rate and retains currency totals', async () => {
  mock.roles = ['Whitelabel Admin']; mock.roots = [{ id: 'root1', username: 'Root Partner', schemeType: 'CREDIT', rate: 15 }]; mount(); await waitFor(() => assert.ok(betIds().includes('b1')));
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Agent' })); });
  assert.ok(await screen.findByText('Root Partner')); assert.ok(screen.getByText('Credit (15%)')); assert.ok(screen.getByText('Total Wagered: ₹150.00'));
  assert.equal(mock.queries.find(item => item.name === 'AgentRootAgents')?.options.skip, false);
});
test('manual scroll fetch-more preserves current-cache offset and exact query bounds', async () => {
  mock.bets = Array.from({ length: 100 }, (_, index) => bet(`b${index + 1}`)); mock.fetchMore.mockResolvedValue({ data: { sportsBets: [] } }); const view = mount(); await waitFor(() => assert.ok(betIds().includes('b100')));
  fireEvent.click(screen.getByRole('switch', { name: 'Show new bets as they arrive' }));
  const list = view.container.querySelector('div[class*="list_"]')!;
  assert.ok(list.querySelector('table'), 'the infinite-scroll box is the table wrapper');
  Object.defineProperties(list, { scrollTop: { configurable: true, value: 850 }, scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 100 } });
  await act(async () => { fireEvent.scroll(list); });
  assert.deepEqual(mock.fetchMore.mock.calls[0][0].variables, { query: { eventId: 'e1', statuses: ['matched', 'unmatched'], search: undefined, limit: 100, offset: 100 } });
});
test('exchange runner lookup retains selection-code matching and decimal odds display', async () => {
  mock.bets = [bet('b1', { marketId: 'm2', price: 2.2, oddsSize: undefined })]; mount();
  const row = (await screen.findByText('India', { selector: 'b' })).closest('tr')!;
  assert.ok(within(row).getByText('Match Odds')); assert.ok(within(row).getByText('@2.20'));
  assert.ok(screen.getByRole('button', { name: 'Actions for Preview Player, India' }));
});
test('All / Back / Lay narrows the list to one side of the book and the head count follows', async () => {
  mock.bets = [bet(), bet('b2', { side: 'lay' }), bet('b3', { side: 'lay' })]; mount(); await waitFor(() => assert.ok(betIds().includes('b3')));
  const group = screen.getByRole('group', { name: 'Bet side' });
  fireEvent.click(within(group).getByRole('button', { name: 'Lay' }));
  assert.deepEqual([...betIds()].sort(), ['b2', 'b3']);
  fireEvent.click(within(group).getByRole('button', { name: 'Back' }));
  assert.deepEqual(betIds(), ['b1']);
});
test('the head shows Expand / Collapse only when the page wires the wide view, beside Collapse Bets', async () => {
  const onToggleWide = vi.fn(); const view = mount({ mobileMode: false, onToggleWide });
  const expand = await screen.findByRole('button', { name: 'Expand' }); assert.equal(expand.getAttribute('aria-pressed'), 'false');
  fireEvent.click(expand); assert.equal(onToggleWide.mock.calls.length, 1); assert.ok(screen.getByRole('button', { name: 'Collapse Bets' }));
  view.unmount(); const wide = mount({ mobileMode: false, onToggleWide, isWide: true });
  assert.equal(screen.getByRole('button', { name: 'Collapse' }).getAttribute('aria-pressed'), 'true');
  wide.unmount(); mount({ mobileMode: false });
  assert.equal(screen.queryByRole('button', { name: 'Expand' }), null); assert.ok(screen.getByRole('button', { name: 'Collapse Bets' }));
});
test('row menu copies the bet ID with a toast and opens the player profile', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    render(<MemoryRouter><Routes><Route path="/" element={<EventBetsSidebar isCollapsed={false} setIsCollapsed={vi.fn()} eventId="e1" mobileMode />} /><Route path="/players/profile/u1" element={<p>Profile of u1</p>} /></Routes></MemoryRouter>);
    await chooseAction('Copy bet ID');
    await waitFor(() => assert.deepEqual(writeText.mock.calls, [['b1']]));
    await waitFor(() => assert.equal(mock.toast.mock.calls.at(-1)?.[0].message, 'Bet ID copied'));
    await chooseAction('Open player');
    assert.ok(await screen.findByText('Profile of u1'));
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});
