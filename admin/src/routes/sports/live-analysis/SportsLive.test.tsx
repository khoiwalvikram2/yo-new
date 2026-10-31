import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DocumentNode } from 'graphql';
import LiveAnalysisPage from './LiveAnalysisPage';
import { OverviewTab } from './tabs/overview/OverviewTab';
import { PerformanceTab } from './tabs/performance/PerformanceTab';
import { AnalyticsTab } from './tabs/analytics/AnalyticsTab';
import { ComparisonTab } from './tabs/comparison/ComparisonTab';
import { ExposureTab } from './tabs/exposure/ExposureTab';
import { PlayersTab } from './tabs/players/PlayersTab';
import { MarketsTab } from './tabs/markets/MarketsTab';
import { RunningEventsTab } from './tabs/running-events/RunningEventsTab';
import { BetList } from './tabs/bet-list/BetList';
import { useAuthStore } from '@/shared/core/authStore';
import type { SportsLiveDashboard, SportsLiveHistory, SportsAggregateBet } from './sportsLiveModel';

// A Stat delta reads "Up 12.5%" across the arrow's hidden direction word and the visible figure, so the
// innermost element with that whole text is the delta chip.
const deltaText = (text: string) => (_: string, element: Element | null) =>
  !!element && element.textContent === text && ![...element.children].some((child) => child.textContent === text)

const mock = vi.hoisted(() => ({ dashboard: null as SportsLiveDashboard | null, loading: false, bets: [] as SportsAggregateBet[], events: [] as Array<Record<string, unknown>>, calls: [] as Array<{ name: string; options: Record<string, unknown> }>, refetch: vi.fn(), wl: 'wl1', restartDashboard: vi.fn(), restartEvents: vi.fn(), restartRisk: vi.fn() }));
function operation(doc: DocumentNode) { const def = doc.definitions.find(item => item.kind === 'OperationDefinition'); return def?.kind === 'OperationDefinition' ? def.name?.value || '' : ''; }
const client = { query: async () => ({ data: { runnersByMarket: [] } }) };
const empty = { sportsBets: [], bettingPatterns: [], marketsByIds: [], marketsByEvent: [] };
vi.mock('@apollo/client', async importOriginal => ({ ...(await importOriginal<typeof import('@apollo/client')>()),
  useSubscription: (doc: DocumentNode, options: Record<string, unknown>) => { const name = operation(doc); mock.calls.push({ name, options }); return { data: name === 'SportsLiveDashboard' ? { sportsLiveDashboard: mock.dashboard } : undefined, loading: mock.loading, variables: options.variables, restart: name === 'SportsLiveDashboard' ? mock.restartDashboard : name === 'SportsPlayerEvents' ? mock.restartEvents : mock.restartRisk }; },
  useQuery: (doc: DocumentNode, options: Record<string, unknown>) => { const name = operation(doc); mock.calls.push({ name, options }); return { data: name === 'SportsBets' ? { sportsBets: mock.bets } : name === 'RunningEvents' ? { runningEvents: mock.events } : empty, loading: false, refetch: mock.refetch, networkStatus: 7 }; },
  useApolloClient: () => client, useMutation: () => [vi.fn()],
}));
vi.mock('@/shared/core/useWhitelabels', () => ({ useCurrentWhitelabel: () => ({ whitelabel: { id: mock.wl } }) }));
vi.mock('@/shared/core/uiStore', () => ({ useUIStore: (selector: (state: unknown) => unknown) => selector({ directorMode: 'core' }) }));
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `₹${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value * 2, getCurrencySymbol: () => '₹' }) }));
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: () => 'Oct 10', formatTime: () => '12:00', formatDateTime: (value: string) => value }) }));
const dashboard = (): SportsLiveDashboard => ({ kpis: { at: '2026-10-10T12:00:00Z', totalStake: 100, totalLiability: 80, netExposure: -30, grossExposure: 50, activeMarkets: 2, activePlayers: 3, betsPerMin: 8, avgOdds: 1.8, backBets: 4, layBets: 2 }, breakdown: { bySport: [{ sportId: '1', sportName: 'Cricket', bets: 5, totalStake: 100, totalLiability: 80, netExposure: -30 }], byLeague: [{ leagueId: 'l1', leagueName: 'International', bets: 5, totalStake: 100, totalLiability: 80, netExposure: -30 }], byEvent: [{ eventId: 'e1', eventName: 'India vs England', bets: 5, totalStake: 100, totalLiability: 80, netExposure: -30 }], byMarketType: [{ marketType: 'exchange', bets: 5, totalStake: 100, totalLiability: 80, netExposure: -30 }], byBetSide: [{ side: 'back', bets: 4, totalStake: 70, totalLiability: 50, netExposure: -20 }, { side: 'lay', bets: 2, totalStake: 30, totalLiability: 30, netExposure: -10 }] } });
const history = (): SportsLiveHistory[] => [{ ...dashboard().kpis, timestamp: 1000 }, { ...dashboard().kpis, totalStake: 200, timestamp: 2000 }];
const bet = (id: string, overrides: Partial<SportsAggregateBet> = {}): SportsAggregateBet => ({ id, userId: 1, marketId: 'm1', eventId: 'e1', stake: 100, liability: 50, side: 'back', price: 2, status: 'matched', currency: 'INR', createdAt: '2026-10-10T12:00:00Z', ...overrides });
beforeEach(() => { mock.dashboard = dashboard(); mock.loading = false; mock.wl = 'wl1'; mock.calls = []; mock.bets = [bet('b1'), bet('b2', { liability: 0, side: 'lay', status: 'unmatched', price: 4 }), bet('b3', { status: 'won' })]; mock.events = [{ id: 'e1', name: 'India vs England', competition: 'International', sport: 'Cricket', startTime: '2026-10-10T12:00:00Z', status: 'in_play', marketCount: 30, matchedVolume: 500, totalLiquidity: 1000, betsCount: 50, inPlay: true, updatedAt: '2026-10-10T12:00:00Z', lastBetAt: null }]; vi.clearAllMocks(); mock.refetch.mockResolvedValue({ data: empty }); useAuthStore.setState({ user: { id: 'admin', name: 'Admin' }, agent: undefined, roles: [], permissions: [{ domain: 'sports.live-analysis', actions: ['view'] }] }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function mount(node: React.ReactNode) { return render(<MemoryRouter>{node}</MemoryRouter>); }

test('whole page preserves the RBAC view requirement and all three tenant-scoped subscriptions', async () => {
  mount(<LiveAnalysisPage />); assert.ok(await screen.findByRole('table', { name: 'Running Events' }));
  for (const name of ['SportsLiveDashboard', 'SportsPlayerEvents', 'SportsRiskAlerts']) assert.deepEqual(mock.calls.find(call => call.name === name)?.options.variables, { scope: { tenant: 'wl1', whitelabelId: 'wl1' } });
  assert.equal(mock.calls.find(call => call.name === 'SportsPlayerEvents')?.options.skip, false);
  cleanup(); mock.calls = []; useAuthStore.setState({ permissions: [] }); mount(<LiveAnalysisPage />); assert.ok(screen.getByText('Access denied')); assert.equal(mock.calls.length, 0);
});
test('dashboard-backed tabs retain connection states while independent lists render without a snapshot', async () => {
  mock.dashboard = { ...dashboard(), kpis: { ...dashboard().kpis, totalStake: Number.NaN } }; mount(<LiveAnalysisPage />); assert.ok(screen.getByRole('table', { name: 'Running Events' })); fireEvent.click(screen.getByRole('tab', { name: 'Overview' })); assert.ok(screen.getByText('No dashboard data available. Please check your connection.')); assert.equal(screen.queryByText(/₹NaN/), null);
  cleanup(); mock.dashboard = null; mock.loading = true; mount(<LiveAnalysisPage />); assert.ok(screen.getByRole('table', { name: 'Running Events' })); fireEvent.click(screen.getByRole('tab', { name: 'Overview' })); assert.ok(screen.getByText('Loading live intelligence data...'));
});

test('all four independent lists can load and switch before the dashboard subscription arrives', () => {
  mock.dashboard = null; mock.loading = true;
  mount(<LiveAnalysisPage />);
  for (const [tab, table] of [['Running Events', 'Running Events'], ['Players', 'All Active Players'], ['Markets', 'All Running Markets'], ['Bet List', 'Bet List']]) {
    fireEvent.click(screen.getByRole('tab', { name: tab }));
    assert.ok(screen.getByRole('table', { name: table }));
    assert.equal(screen.queryByText('Loading live intelligence data...'), null);
  }
  fireEvent.click(screen.getByRole('tab', { name: 'Analytics' }));
  assert.ok(screen.getByText('Loading live intelligence data...'));
  const requests = mock.calls.filter(call => call.name === 'SportsBets' && (call.options.variables as { query?: { limit?: number } })?.query?.limit === 10000);
  assert.ok(requests.length > 0);
  assert.ok(requests.every(call => JSON.stringify((call.options.variables as { query: { statuses: string[] } }).query.statuses) === JSON.stringify(['matched', 'unmatched'])));
});
test('duplicate and sub-second subscription snapshots preserve the last good financial snapshot', async () => {
  let now = 10000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  const view = mount(<LiveAnalysisPage />); fireEvent.click(await screen.findByRole('tab', { name: 'Overview' }));
  const stakeMetric = () => screen.getAllByText('Total Stake').find(node => node.closest('div')?.nextElementSibling?.textContent === '₹200.00');
  assert.ok(stakeMetric()); mock.dashboard = { ...dashboard(), kpis: { ...dashboard().kpis, totalStake: 300, at: '2026-10-10T12:00:01Z' } };
  now = 10500; view.rerender(<MemoryRouter><LiveAnalysisPage /></MemoryRouter>); assert.ok(stakeMetric());
  now = 11001; mock.dashboard = { ...mock.dashboard, kpis: { ...mock.dashboard.kpis, at: '2026-10-10T12:00:02Z' } }; view.rerender(<MemoryRouter><LiveAnalysisPage /></MemoryRouter>);
  await waitFor(() => assert.ok(screen.getAllByText('₹600.00').length));
});
test('performance retains signed exposure ratios, exact 25/50 percent risk thresholds and currency conversion', () => {
  const view = mount(<PerformanceTab dashboard={dashboard()} headerHeight={140} didAnimate />);
  assert.ok(screen.getByText('Moderate Risk Exposure')); assert.ok(screen.getByText('-30.00%')); assert.ok(screen.getByText('80.00%')); assert.ok(screen.getByText('₹-60.00'));
  view.rerender(<MemoryRouter><PerformanceTab dashboard={{ ...dashboard(), kpis: { ...dashboard().kpis, netExposure: 50 } }} headerHeight={140} didAnimate /></MemoryRouter>); assert.ok(screen.getByText('Moderate Risk Exposure'));
  view.rerender(<MemoryRouter><PerformanceTab dashboard={{ ...dashboard(), kpis: { ...dashboard().kpis, netExposure: 51 } }} headerHeight={140} didAnimate /></MemoryRouter>); assert.ok(screen.getByText('High Risk Exposure Detected'));
});
test('analytics table mode preserves every financial column and view toggles on all sections', () => {
  mount(<AnalyticsTab dashboard={dashboard()} dataHistory={history()} didAnimate />); fireEvent.click(screen.getAllByRole('button', { name: 'Table view' })[0]);
  assert.ok(screen.getByText('Timeline table view is not available.'));
  const sport = screen.getByRole('table', { name: 'Sports Analytics' }); for (const name of ['Sport', 'Bets', 'Total Stake', 'Total Liability', 'Net Exposure']) assert.ok(within(sport).getByRole('columnheader', { name: new RegExp(name) }));
  assert.ok(within(sport).getByText('₹-60.00')); assert.ok(screen.getByRole('table', { name: 'League Analytics' })); assert.ok(screen.getByRole('table', { name: 'Market Type Analytics' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Chart view' })[0]); assert.equal(screen.queryByRole('table', { name: 'Sports Analytics' }), null);
});
test('comparison preserves per-bet arithmetic and exposure tab uses the loaded breakdown only', () => {
  const view = mount(<ComparisonTab dashboard={dashboard()} dataHistory={history()} didAnimate />); const table = screen.getByRole('table', { name: 'Sport Comparison' }); assert.ok(within(table).getByText('₹40.00')); assert.ok(within(table).getByText('₹160.00')); assert.ok(within(table).getByText('₹-60.00'));
  const calls = mock.calls.length; view.rerender(<MemoryRouter><ExposureTab dashboard={dashboard()} dataHistory={history()} didAnimate /></MemoryRouter>); assert.ok(screen.getByRole('heading', { name: 'Net Exposure by Sport' })); assert.ok(screen.getByRole('heading', { name: 'Net Exposure by League' })); assert.equal(mock.calls.length, calls);
});
test('players and markets include only open bets and retain liability-based wager, zero values and average odds', () => {
  const view = mount(<PlayersTab dashboard={dashboard()} didAnimate />); const players = screen.getByRole('table', { name: 'All Active Players' }); assert.equal(within(players).getAllByText('₹100.00').length, 2); assert.ok(within(players).getByText('3.00')); assert.ok(within(players).getByText('2'));
  const query = mock.calls.find(call => call.name === 'SportsBets')!; assert.deepEqual(query.options.variables, { query: { statuses: ['matched', 'unmatched'], limit: 10000 } }); assert.equal(query.options.pollInterval, 5000); assert.equal(query.options.fetchPolicy, 'network-only');
  view.rerender(<MemoryRouter><MarketsTab dashboard={dashboard()} didAnimate /></MemoryRouter>); const markets = screen.getByRole('table', { name: 'All Running Markets' }); assert.ok(within(markets).getByText('India vs England')); assert.equal(within(markets).getAllByText('₹100.00').length, 2); assert.ok(within(markets).getByText('3.00'));
});
test('bet list preserves open server filtering, statuses, side query shape and ID search', async () => {
  mount(<BetList />); const table = screen.getByRole('table', { name: 'Bet List' }); assert.equal(within(table).queryByText('WON'), null);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search by User ID or Bet ID' }), { target: { value: 'b2' } }); assert.ok(within(table).getByText('LAY')); assert.equal(within(table).queryByText('BACK'), null);
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter by Side' }), { target: { value: 'lay' } }); assert.deepEqual(mock.calls.filter(call => call.name === 'SportsBets').at(-1)?.options.variables, { query: { statuses: ['matched', 'unmatched'], side: 'lay', limit: 1000 } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh bets' })); }); assert.ok(mock.refetch.mock.calls.length);
});
test('running event filtering, empty state, sport query and refresh preserve five-second network-only polling', async () => {
  mount(<RunningEventsTab didAnimate />); assert.ok(screen.getByRole('button', { name: 'View Event India vs England' })); assert.equal(mock.calls.find(call => call.name === 'RunningEvents')?.options.pollInterval, 5000);
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter by Sport' }), { target: { value: 'Cricket' } }); assert.deepEqual(mock.calls.filter(call => call.name === 'RunningEvents').at(-1)?.options.variables, { sport: 'Cricket' });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search running events' }), { target: { value: 'missing' } }); assert.ok(screen.getByText('No events found. Try adjusting your filters or search query.'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); }); assert.ok(mock.refetch.mock.calls.length);
});
test('overview preserves alert entity, original threshold values and all loaded breakdown cards', () => {
  mount(<OverviewTab dashboard={dashboard()} dataHistory={history()} didAnimate riskAlerts={{ at: '2026-10-10T12:00:00Z', items: [{ id: 'risk1', entityId: 'e1', entityName: 'India vs England', entityType: 'event', severity: 'critical', metric: 'exposure', value: 80, threshold: 50, description: 'Exposure threshold exceeded', channel: 'sports', at: '2026-10-10T12:00:00Z' }] }} />);
  assert.ok(screen.getByText('Exposure threshold exceeded')); assert.ok(screen.getByText('₹80.00')); assert.ok(screen.getByText('₹50.00')); assert.ok(screen.getByRole('heading', { name: 'Top Sports' })); assert.ok(screen.getByRole('heading', { name: 'Top Leagues' })); assert.ok(screen.getByRole('heading', { name: 'Bet Sides' }));
});
test('all nine actual page tabs retain labelled panels and the Exposure tab uses its existing view scope', async () => {
  mount(<LiveAnalysisPage />); await screen.findByRole('table', { name: 'Running Events' });
  const tabs = within(screen.getByRole('tablist', { name: 'sports analysis views' })).getAllByRole('tab'); assert.equal(tabs.length, 9);
  for (const name of ['Running Events', 'Overview', 'Analytics', 'Performance', 'Exposure', 'Bet List', 'Compare', 'Players', 'Markets']) {
    fireEvent.click(screen.getByRole('tab', { name })); const panel = screen.getByRole('tabpanel', { name }); assert.equal(panel.getAttribute('aria-labelledby'), screen.getByRole('tab', { name }).id);
    assert.equal(screen.getByRole('tab', { name }).getAttribute('aria-selected'), 'true');
  }
});
test('auto-refresh pauses all three streams without discarding the last snapshot or child query polling', async () => {
  let now = 10000; vi.spyOn(Date, 'now').mockImplementation(() => now); const view = mount(<LiveAnalysisPage />); fireEvent.click(await screen.findByRole('tab', { name: 'Overview' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Auto-refresh' })); assert.ok(screen.getByText('Sports live streams paused'));
  for (const name of ['SportsLiveDashboard', 'SportsPlayerEvents', 'SportsRiskAlerts']) assert.equal(mock.calls.filter(call => call.name === name).at(-1)?.options.skip, true);
  now = 12000; mock.dashboard = { ...dashboard(), kpis: { ...dashboard().kpis, totalStake: 300, at: '2026-10-10T12:00:03Z' } }; view.rerender(<MemoryRouter><LiveAnalysisPage /></MemoryRouter>);
  assert.ok(screen.getAllByText('₹200.00').length); assert.equal(screen.queryByText('₹600.00'), null);
  fireEvent.click(screen.getByRole('tab', { name: 'Players' })); assert.equal(mock.calls.filter(call => call.name === 'SportsBets').at(-1)?.options.pollInterval, 5000);
  fireEvent.click(screen.getByRole('button', { name: 'Resume streams' }));
  for (const name of ['SportsLiveDashboard', 'SportsPlayerEvents', 'SportsRiskAlerts']) assert.equal(mock.calls.filter(call => call.name === name).at(-1)?.options.skip, false);
  assert.ok(screen.getAllByText('₹600.00').length);
});
test('Refresh now restarts all three active streams but resumes skipped streams before trying to restart', async () => {
  mount(<LiveAnalysisPage />); await screen.findByRole('table', { name: 'Running Events' }); fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
  assert.equal(mock.restartDashboard.mock.calls.length, 1); assert.equal(mock.restartEvents.mock.calls.length, 1); assert.equal(mock.restartRisk.mock.calls.length, 1);
  fireEvent.click(screen.getByRole('switch', { name: 'Auto-refresh' })); fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
  assert.equal(mock.restartDashboard.mock.calls.length, 1); assert.equal(screen.getByRole('switch', { name: 'Auto-refresh' }).getAttribute('aria-checked'), 'true');
});
test('paused whitelabel changes clear old financial data and history before resuming the new scope', async () => {
  let now = 10000; vi.spyOn(Date, 'now').mockImplementation(() => now); const view = mount(<LiveAnalysisPage />); await screen.findByRole('table', { name: 'Running Events' });
  now = 12000; mock.dashboard = { ...dashboard(), kpis: { ...dashboard().kpis, totalStake: 200, at: '2026-10-10T12:00:02Z' } }; view.rerender(<MemoryRouter><LiveAnalysisPage /></MemoryRouter>); assert.ok(screen.getByText(deltaText('Up 100.0%'))); // the trend sits on the tile, no Expand stats step
  fireEvent.click(screen.getByRole('switch', { name: 'Auto-refresh' })); mock.wl = 'wl2'; mock.dashboard = null; view.rerender(<MemoryRouter><LiveAnalysisPage /></MemoryRouter>);
  assert.ok(screen.getByText('Live Sports dashboard paused')); assert.equal(screen.queryByText('₹200.00'), null); assert.equal(screen.queryByRole('region', { name: 'sports live statistics' }), null);
  for (const name of ['SportsLiveDashboard', 'SportsPlayerEvents', 'SportsRiskAlerts']) assert.deepEqual(mock.calls.filter(call => call.name === name).at(-1)?.options.variables, { scope: { tenant: 'wl2', whitelabelId: 'wl2' } });
  mock.dashboard = { ...dashboard(), kpis: { ...dashboard().kpis, totalStake: 400 } }; fireEvent.click(screen.getByRole('button', { name: 'Resume streams' })); assert.ok(screen.getAllByText('₹800.00').length); assert.equal(screen.queryByText(/Up [0-9]/), null);
});
test('running event View action retains the exact selected event navigation route', () => {
  mount(<Routes><Route path="/" element={<RunningEventsTab didAnimate />} /><Route path="/sports/event/e1" element={<h1>Selected event detail</h1>} /></Routes>); fireEvent.click(screen.getByRole('button', { name: 'View Event India vs England' })); assert.ok(screen.getByRole('heading', { name: 'Selected event detail' }));
});
