import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LastSettlementCard } from './LastSettlementCard';
import { SettlementDashboardTab } from './SettlementDashboardTab';
import { DomainBreakdownSection } from './DomainBreakdownSection';
import { PlayerContributionsSection } from './PlayerContributionsSection';
import { SubAgentContributionsSection } from './SubAgentContributionsSection';
const exports = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>>, handleExport: vi.fn() }));
vi.mock('@/shared/hooks/useTableExport', () => ({ useTableExport: (options: Record<string, unknown>) => { exports.calls.push(options); return { exporting: false, handleExport: exports.handleExport }; } }));
vi.mock('recharts', async () => {
  const { createContext, useContext } = await import('react');
  const ChartData = createContext<Array<Record<string, unknown>>>([]);
  const Chart = ({ data = [], children }: { data?: Array<Record<string, unknown>>; children?: React.ReactNode }) => <ChartData.Provider value={data}><div>{children}</div></ChartData.Provider>;
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Tooltip = ({ content }: { content?: (props: { active: boolean; payload: Array<{ name: string; value: number }> }) => React.ReactNode }) => { const rows = useContext(ChartData); const payload = Object.entries(rows[0] || {}).filter(([, value]) => typeof value === 'number').map(([name, value]) => ({ name, value: Number(value) })); return payload.length && content ? <div>{content({ active: true, payload })}</div> : null; };
  const Empty = () => null;
  return { PieChart: Chart, BarChart: Chart, LineChart: Chart, ResponsiveContainer: Container, Pie: Container, Tooltip, Cell: Empty, Bar: Empty, XAxis: Empty, YAxis: Empty, Line: Empty, Legend: Empty, CartesianGrid: Empty };
});
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (amount: number) => `₹${amount.toFixed(2)}`, convertFromWhitelabelCurrency: (amount: number) => amount * 2 }) }));
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDateTime: (date: string) => date }) }));
afterEach(cleanup);
test('last settlement retains the Never state, posted amount and both contribution counts/values', () => {
  const view = render(<LastSettlementCard />); assert.ok(screen.getByText('Never')); view.rerender(<LastSettlementCard settlement={{ lastSettlementDate: '2026-10-01', lastSettlementAmount: 50, directPlayersCount: 3, subAgentsCount: 2, directPlayersContribution: 20, subAgentsContribution: 30 }} />); assert.ok(screen.getByText('POSTED')); assert.ok(screen.getByText('₹100.00')); assert.ok(screen.getByText('3 players')); assert.ok(screen.getByText('2 sub-agents')); assert.ok(screen.getByText('Contribution: ₹40.00')); assert.ok(screen.getByText('Contribution: ₹60.00'));
});
test('admin dashboard retains its five financial figures including last30 days and commission MTD, with no CREDIT pending', () => {
  // CREDIT left the settlement centre (spec 2026-11-02 §6): its chips move by Deposit / Withdraw on the Chips pages.
  render(<MemoryRouter><SettlementDashboardTab isAgent={false} dashboard={{ pendingSharingSettlements: 10, pendingCommissionPayouts: 30, totalSettledThisMonth: 40, totalSettledLast30Days: 50, totalCommissionPaidThisMonth: 60 }} /></MemoryRouter>);
  for (const value of [20, 60, 80, 100, 120]) assert.ok(screen.getByText(`₹${value.toFixed(2)}`)); for (const name of ['Pending Sharing', 'Pending Commission', 'Total Settled (This Month)', 'Total Settled (Last 30 Days)', 'Commission Paid (MTD)']) assert.ok(screen.getByText(name));
  assert.equal(screen.queryByText('Pending Credit'), null);
});
test('admin dashboard shows the net sharing pending as a size with its direction, and to pay / to collect separately', () => {
  // NET = to pay − to collect, here negative: the agents owe more than they are owed. Neither part drops out of the chart.
  render(<MemoryRouter><SettlementDashboardTab isAgent={false} dashboard={{ pendingSharingSettlements: -20, pendingSharingToAgents: 30, pendingSharingFromAgents: 50, pendingCommissionPayouts: 0 }} /></MemoryRouter>);
  assert.ok(screen.getByText('₹40.00')); assert.ok(screen.getByText('Net to collect · To pay ₹60.00 · To collect ₹100.00'));
  assert.ok(screen.getByText('Sharing to pay 38%')); assert.ok(screen.getByText('Sharing to collect 63%'));
});
test('agent dashboard shows pending as a size with who pays, signed P&L, share rounding and no-summary state', () => {
  // settlementDue −25 = FROM_AGENT: the agent pays its upline.
  const view = render(<MemoryRouter><SettlementDashboardTab isAgent agentSchemeType="SHARING" settlement={{ settlementDue: -25, netPL: -50, sharePercentage: 33.33 }} /></MemoryRouter>); assert.ok(screen.getByText('₹50.00')); assert.ok(screen.getByText('You pay · since last settlement')); assert.ok(screen.getByText('₹-100.00')); assert.ok(screen.getByText('33.3%'));
  view.rerender(<MemoryRouter><SettlementDashboardTab isAgent agentSchemeType="SHARING" settlement={{ settlementDue: 25, netPL: -50, sharePercentage: 33.33 }} /></MemoryRouter>); assert.ok(screen.getByText('You receive · since last settlement'));
  view.rerender(<MemoryRouter><SettlementDashboardTab isAgent agentSchemeType="SHARING" /></MemoryRouter>); assert.ok(screen.getByText('No settlement summary available'));
});
test('dashboard error/loading/empty and Commission CTA remain real accessible states', () => {
  const view = render(<MemoryRouter><SettlementDashboardTab isAgent={false} loading /></MemoryRouter>); assert.equal(screen.getByText('Pending Sharing').closest('[aria-busy="true"]') !== null, true); assert.equal(screen.getAllByText('Loading').length, 5); assert.equal(screen.queryByText('No settlement data available'), null); view.rerender(<MemoryRouter><SettlementDashboardTab isAgent={false} error={new Error('Read failed')} /></MemoryRouter>); assert.ok(screen.getByText('Read failed')); view.rerender(<MemoryRouter><SettlementDashboardTab isAgent={false} /></MemoryRouter>); assert.ok(screen.getByText('No settlement data available')); view.rerender(<MemoryRouter><SettlementDashboardTab isAgent agentSchemeType="COMMISSION" /></MemoryRouter>); assert.ok(screen.getByRole('button', { name: 'Go to Commission' }));
});
test('already-converted trend chart values format once at non-unit exchange rates, including negatives and zero', () => {
  render(<MemoryRouter><SettlementDashboardTab isAgent={false} dashboard={{ pendingSharingSettlements: 100, monthlyTrend: [{ month: 'October', totalSettled: -50, commissionPaid: 0 }] }} /></MemoryRouter>);
  assert.ok(screen.getByText('settled: ₹-100.00')); assert.ok(screen.getByText('commission: ₹0.00')); assert.equal(screen.queryByText('settled: ₹-200.00'), null); assert.ok(screen.getByText('₹200.00'));
  // The pending chart and the trend sit side by side; the credit balance by domain went with CREDIT settlement.
  assert.ok(screen.getByText('Pending by type')); assert.ok(screen.getByText('Settled & Commission over time')); assert.equal(screen.queryByText('Credit balance by domain'), null);
});
test('agent domain table retains signed totals, all cut/share columns and absolute contribution denominator', () => {
  // Players lost 100 on sports (the agent earns 80, the platform keeps 20) and won 50 on casino (the agent pays 40).
  render(<MemoryRouter><DomainBreakdownSection isAgent settlement={{ settlementBreakdownByDomain: [{ domain: 'sports', amount: -100, percentage: 60, cutAmount: 20, cutPercentage: 20 }, { domain: 'casino', amount: 50, percentage: 40, cutAmount: 10, cutPercentage: 20 }] }} /></MemoryRouter>);
  const table = screen.getByRole('table', { name: 'Domain Breakdown' }); for (const name of ["Players' P/L", 'Share Rate', 'Agent Share', 'Cut Rate', 'Platform Cut', 'Contribution %']) assert.ok(within(table).getByRole('columnheader', { name })); assert.ok(within(table).getByText('₹-100.00')); assert.ok(within(table).getByText('66.7%')); assert.ok(within(table).getByText('33.3%')); assert.ok(within(table).getByText('100%'));
  assert.ok(within(table).getByText('₹160.00').className.includes('positive')); assert.ok(within(table).getByText('₹-80.00').className.includes('negative')); assert.ok(within(table).getByText('₹80.00')); assert.ok(within(table).getByText('₹60.00'));
});
test('aggregate domain table keeps signed players\' P/L, the agents\' share, the platform cut, agent count and keyboard help', async () => {
  render(<MemoryRouter><DomainBreakdownSection isAgent={false} pendingSettlements={[{ agentId: 'a1', pendingAmount: 80, settlementType: 'P_L', settlementBreakdownByDomain: [{ domain: 'sports', amount: -100, percentage: 100, cutAmount: 20, cutPercentage: 20, agentShare: 80 }] }]} /></MemoryRouter>);
  const table = screen.getByRole('table', { name: 'Domain Breakdown (Aggregate)' }); assert.ok(within(table).getByText('₹-200.00')); assert.ok(within(table).getByText('₹160.00')); assert.ok(within(table).getByText('₹40.00')); assert.ok(within(table).getByText('1'));
  fireEvent.focus(screen.getByRole('button', { name: 'About Platform Cut' })); assert.ok(await screen.findByRole('tooltip'));
});
test('zero-domain agent summary retains the original empty branch without a misleading Total/100% footer', () => {
  render(<MemoryRouter><DomainBreakdownSection isAgent settlement={{ sportsPL: 0, sportsShare: 0, casinoPL: 0, casinoShare: 0, matkaPL: 0, matkaShare: 0, settlementBreakdownByDomain: [] }} /></MemoryRouter>);
  assert.ok(screen.getByText('No domain data available')); assert.equal(screen.queryByRole('table'), null); assert.equal(screen.queryByText('Total'), null); assert.equal(screen.queryByText('100%'), null);
});
test('direct player search excludes descendants and exports every filtered row with original metadata', () => {
  // The player lost 40 (P/L −40); the agent's share is +20 (positive = the agent earns); the platform keeps the other 20.
  const direct = { playerId: 'p1', playerName: 'Direct Player', pl: -40, share: 20, isDirectPlayer: true, contributionPercentage: 25, domainBreakdown: [{ domain: 'sports', pl: -40, share: 20, cutAmount: 20 }] }; const descendant = { ...direct, playerId: 'p2', playerName: 'Nested Player', isDirectPlayer: false };
  render(<MemoryRouter><PlayerContributionsSection isAgent settlement={{ topPlayers: [direct, descendant] }} /></MemoryRouter>); assert.equal(screen.queryByText('Nested Player'), null); const table = screen.getByRole('table', { name: 'Player Contributions' }); assert.equal(within(table).getAllByText('₹-80.00').length, 2); fireEvent.change(screen.getByRole('searchbox', { name: 'Search players' }), { target: { value: 'p1' } });
  for (const name of ['Player P/L', 'Agent Share']) assert.ok(within(table).getByRole('columnheader', { name })); assert.ok(within(table).getAllByText('₹40.00').every(cell => cell.className.includes('positive')));
  const options = exports.calls.at(-1)!; assert.deepEqual(options.data, [direct]); assert.equal(options.filename, 'Player-Contributions'); fireEvent.click(screen.getByRole('button', { name: 'Export' })); assert.ok(exports.handleExport.mock.calls.length); fireEvent.change(screen.getByRole('searchbox', { name: 'Search players' }), { target: { value: 'missing' } }); assert.ok(screen.getByText('No direct player contributions'));
});
test('sub-agent contributions preserve every loaded row without pagination and expose full domain/player expansion', () => {
  const sub = { subAgentId: 'a1', subAgentName: 'Child Partner', totalPL: -50, totalShare: 25, playerCount: 1, contributionPercentage: 50, domainBreakdown: [{ domain: 'sports', pl: -50, share: 25, cutAmount: 25 }], players: [{ playerId: 'p1', playerName: 'Nested Player', pl: -50, share: 25, contributionPercentage: 100 }] };
  render(<MemoryRouter><SubAgentContributionsSection isAgent settlement={{ subAgents: Array.from({ length: 12 }, (_, index) => ({ ...sub, subAgentId: `a${index + 1}`, subAgentName: `Child ${index + 1}` })) }} /></MemoryRouter>); assert.ok(screen.getByText('Child 12')); const table = screen.getByRole('table', { name: 'Agent Contributions' }); fireEvent.click(within(table).getAllByRole('button', { name: /Expand/ })[0]); assert.ok(screen.getByText('Domain Breakdown:')); assert.ok(screen.getByText('Nested Player')); assert.ok(screen.getByText('Contribution: 100.00%'));
  for (const name of ["Players' P/L", 'Agent Share']) assert.ok(within(table).getByRole('columnheader', { name })); assert.ok(screen.getByText(/Platform cut:/)); assert.equal(screen.getAllByText('Agent share:', { exact: false }).length, 2);
});
test('admin direct-agent contributions preserve nested agents, selected domain share and original export scope', () => {
  const pending = { agentId: 'a1', agent: { username: 'Root Partner' }, schemeType: 'SHARING', pendingAmount: -50, settlementType: 'P_L', directPlayersCount: 0, subAgentsCount: 1, directPlayersContribution: 0, subAgentsContribution: -50, settlementBreakdownByDomain: [{ domain: 'sports', amount: 50, percentage: 100, cutAmount: 25, cutPercentage: 50, agentShare: -25 }], subAgents: [{ subAgentId: 'child1', subAgentName: 'Nested Partner', totalPL: 50, totalShare: -25, playerCount: 1 }] };
  render(<MemoryRouter><SubAgentContributionsSection isAgent={false} pendingSettlements={[pending]} /></MemoryRouter>);
  // Pending −50 = FROM_AGENT: shown as its size with who pays.
  const table = screen.getByRole('table', { name: 'Pending Agent Contributions' }); assert.ok(within(table).getByText('₹100.00')); assert.ok(within(table).getByText('Collect from agent'));
  fireEvent.click(table.querySelector('button[aria-expanded]')!); assert.ok(screen.getByText('Nested sub-agents')); assert.ok(screen.getByText('Nested Partner')); assert.equal(exports.calls.at(-1)?.filename, 'Agent-Contributions-Pending'); assert.deepEqual(exports.calls.at(-1)?.data, [pending]);
});

test('CREDIT has left the dashboard: no pending credit, no credit chart, and pending commission stays all-week', () => {
  render(<MemoryRouter><SettlementDashboardTab isAgent={false} dashboard={{ pendingCommissionPayouts: 636215.5 }} /></MemoryRouter>);
  for (const gone of ['Pending Credit', 'Credit balance by domain', 'No pending credit balance', 'Credit']) assert.equal(screen.queryByText(gone), null, gone);
  assert.ok(screen.getByText('Commission 100%'));
  assert.ok(screen.getByText('All unpaid weeks'));
  assert.equal(screen.getAllByText('Paid and collected').length, 2);
});

test('filtered activity uses the selected-period totals and leaves current pending balances live', () => {
  render(<MemoryRouter><SettlementDashboardTab isAgent={false} activityPeriodLabel="01 Sep 2026 – 30 Sep 2026" dashboard={{
    pendingSharingSettlements: 11, pendingCommissionPayouts: 33,
    totalPaidToAgentsInPeriod: 44, totalCollectedFromAgentsInPeriod: 55, totalCommissionPaidInPeriod: 66,
    totalSettledThisMonth: 9999, totalSettledLast30Days: 8888, totalCommissionPaidThisMonth: 7777,
  }} /></MemoryRouter>);
  for (const value of [22, 66, 88, 110, 132]) assert.ok(screen.getByText(`₹${value.toFixed(2)}`));
  for (const label of ['Paid to Agents', 'Collected from Agents', 'Commission Paid']) assert.ok(screen.getByText(label));
  assert.equal(screen.getAllByText('01 Sep 2026 – 30 Sep 2026').length, 3);
  assert.equal(screen.queryByText('₹19998.00'), null);
  assert.ok(screen.getByText('All unpaid weeks'));
});
