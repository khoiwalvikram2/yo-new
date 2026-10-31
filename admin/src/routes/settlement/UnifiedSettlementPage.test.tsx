import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { DocumentNode } from 'graphql';
import UnifiedSettlementPage from './UnifiedSettlementPage';
import { useAuthStore } from '@/shared/core/authStore';
import type { PendingSettlement } from './settlementModel';

const mock = vi.hoisted(() => ({ calls: [] as Array<{ name: string; options: Record<string, unknown> }>, pendingLoading: false, pendingCold: false, pendingError: undefined as Error | undefined, refresh: vi.fn(async () => ({})) }));
const pending: PendingSettlement[] = [{ agentId: 'sharing1', schemeType: 'SHARING', agent: { username: 'Sharing Partner', schemeType: 'SHARING' }, pendingAmount: 50, settlementType: 'P_L' }, { agentId: 'credit1', schemeType: 'CREDIT', agent: { username: 'Credit Partner', schemeType: 'CREDIT' }, pendingAmount: -20, settlementType: 'CREDIT' }, { agentId: 'commission1', schemeType: 'COMMISSION', pendingAmount: 10, settlementType: 'COMMISSION' }];
function operation(doc: DocumentNode) { const def = doc.definitions.find(item => item.kind === 'OperationDefinition'); return def?.kind === 'OperationDefinition' ? def.name?.value || '' : ''; }
vi.mock('@apollo/client', async importOriginal => ({ ...(await importOriginal<typeof import('@apollo/client')>()), useApolloClient: () => ({ refetchQueries: mock.refresh }), useQuery: (doc: DocumentNode, options: Record<string, unknown>) => {
  const name = operation(doc); mock.calls.push({ name, options }); const data = { agents: { settlementSummary: { settlementDue: 100 }, agentSettlements: [], downlineSettlementHistory: [] }, enhancedPendingSettlements: pending, subAgentsPendingSettlements: pending, allSettlementHistory: [], settlementDashboard: { pendingSharingSettlements: 50 } }; return { data: name === 'EnhancedPendingSettlements' && mock.pendingCold ? undefined : data, loading: name === 'EnhancedPendingSettlements' && mock.pendingLoading, error: name === 'EnhancedPendingSettlements' ? mock.pendingError : undefined, refetch: async () => ({ data }) };
} }));
vi.mock('./components/SettlementDashboardTab', () => ({ SettlementDashboardTab: ({ isAgent }: { isAgent: boolean }) => <h2>{isAgent ? 'Agent dashboard content' : 'Admin dashboard content'}</h2> }));
vi.mock('./components/LastSettlementCard', () => ({ LastSettlementCard: () => <h2>Last settlement content</h2> }));
vi.mock('./components/PendingSettlementsSection', () => ({ PendingSettlementsSection: ({ pendingSettlements, isAgent }: { pendingSettlements: PendingSettlement[]; isAgent: boolean }) => <h2>{isAgent ? 'Sub-agent pending content' : pendingSettlements.map(row => row.agentId).join(',')}</h2> }));
vi.mock('./components/PendingCommissionSection', () => ({ PendingCommissionSection: () => <h2>Commission pending content</h2> }));
vi.mock('./components/SettlementHistorySection', () => ({ SettlementHistorySection: () => <h2>History content</h2> }));
vi.mock('./components/DomainBreakdownSection', () => ({ DomainBreakdownSection: () => <h2>Breakdown content</h2> }));
vi.mock('./components/PlayerContributionsSection', () => ({ PlayerContributionsSection: ({ settlement }: { settlement?: PendingSettlement }) => <h2>{settlement?.agentId || 'No selected contributions'}</h2> }));
vi.mock('./components/SubAgentContributionsSection', () => ({ SubAgentContributionsSection: () => <h2>Agent contribution content</h2> }));
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T08:00:00Z')); mock.calls = []; mock.pendingLoading = false; mock.pendingCold = false; mock.pendingError = undefined; mock.refresh.mockClear(); useAuthStore.setState({ user: { id: 'admin1', name: 'Admin' }, agent: undefined, roles: [], permissions: [{ domain: 'settlements.center', actions: ['view'] }] }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function PathProbe() { return <span>{useLocation().pathname + useLocation().search}</span>; }
function mount(tab = 'dashboard') { return render(<MemoryRouter initialEntries={[`/settlement?tab=${tab}`]}><Routes><Route path="/settlement" element={<><UnifiedSettlementPage /><PathProbe /></>} /><Route path="/commission/overview" element={<h1>Commission destination</h1>} /></Routes></MemoryRouter>); }
function setAgent(scheme: string) { useAuthStore.setState({ user: undefined, agent: { id: 'root1', tenantId: 'wl1', username: 'Root Partner', phone: null, schemeType: scheme, allowedDomains: ['sports'], status: 'ACTIVE', parentAgentId: null, levelIndex: 1, tallyEnabled: false, tallyDomains: [], createdAt: '2026-01-01' }, roles: [], permissions: [] }); }
test('admin gets all five labelled tabs and only dashboard query enabled on initial view', async () => {
  mount('invalid'); assert.ok(await screen.findByText('Admin dashboard content')); assert.equal(screen.getAllByRole('tab').length, 5); assert.ok(screen.getByRole('tabpanel', { name: 'Dashboard' }));
  assert.equal(mock.calls.find(call => call.name === 'SettlementDashboard')?.options.skip, false); assert.equal(mock.calls.find(call => call.name === 'EnhancedPendingSettlements')?.options.skip, true);
});
test('sharing/credit/commission pending schemes keep exact client filter and deferred pending query', async () => {
  mount('pending'); assert.ok(await screen.findByText('sharing1')); fireEvent.click(screen.getByRole('button', { name: 'Credit' })); assert.ok(await screen.findByText('credit1')); fireEvent.click(screen.getByRole('button', { name: 'Commission' })); assert.ok(await screen.findByText('Commission pending content'));
  assert.equal(mock.calls.find(call => call.name === 'EnhancedPendingSettlements')?.options.skip, false); assert.equal(mock.calls.find(call => call.name === 'SettlementDashboard')?.options.skip, true);
});
test('whitelabel admins keep restricted tab set and hidden-tab URL redirect', async () => {
  useAuthStore.setState({ roles: ['Whitelabel Admin'] }); mount('breakdown'); assert.ok(await screen.findByText('Admin dashboard content')); assert.equal(screen.getAllByRole('tab').length, 3); assert.ok(screen.getByText('/settlement?tab=dashboard')); assert.equal(screen.queryByRole('tab', { name: 'Breakdown' }), null);
});
test('agent summary and upline/downline history retain original periods, IDs and query guards', async () => {
  setAgent('SHARING'); mount('history'); assert.ok(await screen.findByText('History content'));
  assert.deepEqual(mock.calls.find(call => call.name === 'SettlementSummary')?.options.variables, { agentId: 'root1', periodFrom: '2026-09-10', periodTo: '2026-10-10' });
  assert.deepEqual(mock.calls.find(call => call.name === 'AgentSettlements')?.options.variables, { agentId: 'root1', periodFrom: '2025-10-10', periodTo: '2026-10-10' });
  assert.equal(mock.calls.find(call => call.name === 'DownlineSettlementHistory')?.options.skip, false); assert.equal(mock.calls.find(call => call.name === 'AllSettlementHistory')?.options.skip, true);
});
test('credit agent Request Settlement updates canonical URL and enables only the existing pending query', async () => {
  setAgent('CREDIT'); mount(); assert.ok(await screen.findByText('Agent dashboard content')); fireEvent.click(screen.getByRole('button', { name: 'Request Settlement' })); assert.ok(await screen.findByText('Sub-agent pending content')); assert.ok(screen.getByText('/settlement?tab=pending')); assert.equal(mock.calls.filter(call => call.name === 'SubAgentsPendingSettlements').at(-1)?.options.skip, false);
});
test('commission agents retain their original redirect without rendering settlement actions', async () => {
  setAgent('COMMISSION'); mount('pending'); assert.ok(await screen.findByRole('heading', { name: 'Commission destination' })); assert.equal(screen.queryByRole('button', { name: 'Request Settlement' }), null);
});
test('admin contribution selection passes the real selected pending row and can be cleared', async () => {
  mount('contributions'); assert.ok(await screen.findByText('No selected contributions')); fireEvent.change(screen.getByRole('combobox', { name: 'View contributions for:' }), { target: { value: 'credit1' } }); assert.ok(await screen.findByText('credit1')); fireEvent.change(screen.getByRole('combobox', { name: 'View contributions for:' }), { target: { value: '' } }); assert.ok(await screen.findByText('No selected contributions'));
});
test('admin history retains original 100-row/date shape and tab navigation replace behavior', async () => {
  mount('history'); assert.ok(await screen.findByText('History content')); assert.deepEqual(mock.calls.find(call => call.name === 'AllSettlementHistory')?.options.variables, { limit: 100, fromDate: '2025-10-10', toDate: '2026-10-10' }); fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' })); await waitFor(() => assert.ok(screen.getByText('/settlement?tab=dashboard')));
});

test('Pending opens its controls immediately while the selected scheme is still loading', async () => {
  mount(); await screen.findByText('Admin dashboard content');
  mock.pendingLoading = true; mock.pendingCold = true;
  fireEvent.click(screen.getByRole('tab', { name: 'Pending' }));
  assert.ok(screen.getByRole('button', { name: 'Sharing' }));
  assert.ok(screen.getByRole('button', { name: 'Commission' }));
  assert.deepEqual(mock.calls.filter(call => call.name === 'EnhancedPendingSettlements').at(-1)?.options.variables, { schemeType: 'SHARING' });
  fireEvent.click(screen.getByRole('button', { name: 'Credit' }));
  assert.deepEqual(mock.calls.filter(call => call.name === 'EnhancedPendingSettlements').at(-1)?.options.variables, { schemeType: 'CREDIT' });
  fireEvent.click(screen.getByRole('button', { name: 'Commission' }));
  assert.equal(mock.calls.filter(call => call.name === 'EnhancedPendingSettlements').at(-1)?.options.skip, true);
  assert.ok(await screen.findByText('Commission pending content'));
});

test('cached pending rows stay visible during a background refresh', async () => {
  mount('pending'); await screen.findByText('sharing1');
  mock.pendingLoading = true;
  fireEvent.click(screen.getByRole('button', { name: 'Credit' }));
  assert.ok(await screen.findByText('credit1'));
  assert.equal(screen.queryByText('Loading settlement data...'), null);
});

test('a failed pending request is explicit and the Commission selector remains usable', async () => {
  mock.pendingError = new Error('Pending unavailable'); mount('pending');
  assert.ok(await screen.findByText('Failed to load pending settlements'));
  fireEvent.click(screen.getByRole('button', { name: 'Commission' }));
  assert.ok(await screen.findByText('Commission pending content'));
});

test('Refresh refetches active settlement queries without reloading the application', async () => {
  mount(); await screen.findByText('Admin dashboard content');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => assert.equal(mock.refresh.mock.calls.length, 1));
});

test('Dashboard period stages without a request, applies real query dates, persists across tabs and resets', async () => {
  mount(); await screen.findByText('Admin dashboard content');
  const variables = () => mock.calls.filter(call => call.name === 'SettlementDashboard').at(-1)?.options.variables;
  assert.deepEqual(variables(), { fromDate: '2026-10-01', toDate: '2026-10-10' });
  fireEvent.click(screen.getByRole('button', { name: 'Activity period: This month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
  assert.deepEqual(variables(), { fromDate: '2026-10-01', toDate: '2026-10-10' });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  assert.deepEqual(variables(), { fromDate: '2026-10-09', toDate: '2026-10-09' });
  fireEvent.click(screen.getByRole('tab', { name: 'Pending' }));
  assert.equal(screen.queryByRole('button', { name: /Activity period:/ }), null);
  assert.deepEqual(mock.calls.filter(call => call.name === 'EnhancedPendingSettlements').at(-1)?.options.variables, { schemeType: 'SHARING' });
  fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
  await screen.findByRole('button', { name: 'Activity period: Yesterday' });
  assert.deepEqual(variables(), { fromDate: '2026-10-09', toDate: '2026-10-09' });
  fireEvent.click(screen.getByRole('button', { name: 'Activity period: Yesterday' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  assert.deepEqual(variables(), { fromDate: '2026-10-01', toDate: '2026-10-10' });
});

test('Dashboard custom range blocks reversed dates and sends inclusive calendar days on Apply', async () => {
  mount(); await screen.findByText('Admin dashboard content');
  const variables = () => mock.calls.filter(call => call.name === 'SettlementDashboard').at(-1)?.options.variables;
  fireEvent.click(screen.getByRole('button', { name: 'Activity period: This month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-05' } });
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-04' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  assert.deepEqual(variables(), { fromDate: '2026-10-01', toDate: '2026-10-10' });
  assert.ok(screen.getByText('The end date is before the start'));
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-30' } });
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-10-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  assert.deepEqual(variables(), { fromDate: '2026-09-30', toDate: '2026-10-01' });
  assert.ok(screen.getByText('Settlement activity · 30 Sep 2026 – 01 Oct 2026'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => assert.equal(mock.refresh.mock.calls.length, 1));
  assert.deepEqual(variables(), { fromDate: '2026-09-30', toDate: '2026-10-01' });
});
