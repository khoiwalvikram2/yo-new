import { beforeEach, afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { format } from 'date-fns'
import { useAuthStore } from '@/shared/core/authStore'
import { useReportingStore } from '@/state/reportingStore'
import { getDateRangeISOForAgentDashboardPreset } from '@/shared/utils/agentDashboardDateRange'
import { istDayOf } from '@/ui/components/istDate'
import type { FetchResult, Operation } from '@apollo/client'
import { chipAccountFixture } from '@/modules/chips/chipTestKit'
import AgentHome from './AgentHome'
import { agentHomeAccount, agentHomeFixtureResponse, type AgentHomeFixtureState, type AgentScheme } from '../../../test/agentHomePreviewData'
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (n: number) => `INR ${n}`, convertFromWhitelabelCurrency: (n: number) => n * 2, getCurrencySymbol: () => '₹', getWhitelabelBaseCurrencyCode: () => 'INR' }) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (value: string) => value }) }))
let state: AgentHomeFixtureState
let calls: Array<{ name: string; variables: Record<string, unknown> }>
const clients: ApolloClient<unknown>[] = []
function Destination() { const value = useLocation(); return <output aria-label="Destination">{value.pathname}{value.search}</output> }
// A CREDIT agent's own chips (spec 2026-11-02 §7 myChipAccount); every other read comes from the dashboard preview data.
const MY_CHIPS = chipAccountFixture({ id: 'preview-agent', username: 'preview', creditReference: 100000, balance: 95000, available: 95000, exposure: 1200, downlineBalance: 9700, refPnl: 4700, downlineCount: 3 })
let myChips = MY_CHIPS
function respond(operation: Operation): FetchResult {
  if (operation.operationName === 'MyChipAccount') return { data: { agents: { __typename: 'AgentsQuery', myChipAccount: myChips } } }
  const result = agentHomeFixtureResponse(operation, state)
  // The money waiting on the pending requests: the preview data carries only their counts (12 deposits, 8 withdrawals).
  const stats = (result.data as { agents?: { agentDashboardStats?: Record<string, unknown> } } | undefined)?.agents?.agentDashboardStats
  if (operation.operationName === 'AgentDashboardStats' && stats) {
    return { data: { agents: { agentDashboardStats: { ...stats, pendingDepositsAmount: 5000, pendingWithdrawalsAmount: 1640850 } } } }
  }
  return result
}
function mount(scheme: AgentScheme = 'CREDIT', authenticated = true) {
  useAuthStore.setState({ agent: authenticated ? agentHomeAccount(scheme) : undefined })
  const client = new ApolloClient({ cache: new InMemoryCache({ typePolicies: { Query: { fields: { agents: { merge: true }, reporting: { merge: true } } } } }), link: new ApolloLink(operation => new Observable(observer => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    const timer = setTimeout(() => { try { observer.next(respond(operation)); observer.complete() } catch (error) { observer.error(error) } }, 1)
    return () => clearTimeout(timer)
  })) })
  clients.push(client)
  return render(<ApolloProvider client={client}><MemoryRouter initialEntries={['/agent']}><AgentHome /><Destination /></MemoryRouter></ApolloProvider>)
}
beforeEach(() => { state = {}; calls = []; myChips = MY_CHIPS; useAuthStore.setState({ agent: undefined, user: undefined, roles: [], permissions: [], agentPermissions: [] }); useReportingStore.setState({ filters: { agentId: 'preview-agent', whitelabelId: 'preview-tenant' } }) })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.stop()) })
test('two actual tabs, all overview metrics and exact agent/report query scopes remain unchanged', async () => {
  mount(); await screen.findByText('INR 77500')
  const chips = screen.getByRole('group', { name: 'My chip figures' }); await within(chips).findByText('INR 100000')
  assert.deepEqual(within(screen.getByRole('tablist', { name: 'Agent Dashboard' })).getAllByRole('tab').map(tab => tab.textContent), ['Overview', 'Financial'])
  assert.equal(Boolean(screen.queryByRole('tab', { name: 'Players' })), false)
  assert.ok(screen.getByText('INR 249000')); assert.ok(screen.getByText('1,240'))
  // Pending Deposits / Withdrawals show the money waiting, with the number of requests as the note (AGE-15):
  // they read '₹12' and '₹8' when the request counts went through the money formatter.
  assert.ok(screen.getByText('INR 10000')); assert.ok(screen.getByText('12 awaiting approval'))
  assert.ok(screen.getByText('INR 3281700')); assert.ok(screen.getByText('8 awaiting approval'))
  assert.equal(screen.queryByText('INR 24'), null); assert.equal(screen.queryByText('INR 16'), null)
  const today = getDateRangeISOForAgentDashboardPreset('today')
  assert.deepEqual(calls.find(call => call.name === 'AgentDashboardStats')?.variables, { agentId: 'preview-agent', dateFrom: istDayOf(today.dateFrom), dateTo: istDayOf(today.dateTo) })
  assert.deepEqual(calls.find(call => call.name === 'AgentKPIs')?.variables, { filter: { agentId: 'preview-agent', whitelabelId: 'preview-tenant', dateFrom: istDayOf(today.dateFrom), dateTo: istDayOf(today.dateTo) } })
  // A CREDIT agent's chips replace the credit-limit meter and its alerts: its figures and the way to its Chips page.
  for (const text of ['Credit Reference', 'Downline holds INR 9700', 'Ref P/L', '+INR 4700', 'Upline owes you']) assert.ok(within(chips).getByText(text), text)
  assert.equal(within(chips).getAllByText('INR 95000').length, 2, 'an agent’s available is its balance')
  assert.equal(screen.getByRole('link', { name: 'Open chips' }).getAttribute('href'), '/agent/credit')
  for (const gone of ['Credit Status', 'Credit Usage', 'Credit Limit Exceeded', 'Credit Usage High']) assert.equal(screen.queryByText(gone), null, gone)
  assert.equal(screen.queryByRole('button', { name: 'Request More Credit' }), null)
  assert.equal(calls.some(call => call.name === 'CreditAllocation'), false)
  assert.equal(calls.filter(call => call.name === 'MyChipAccount').length, 1)
})
test('a non-credit agent gets no chips section and no chips read', async () => {
  mount('SHARING'); await screen.findByText('INR 77500')
  assert.equal(screen.queryByRole('group', { name: 'My chip figures' }), null)
  assert.equal(screen.queryByRole('link', { name: 'Open chips' }), null)
  assert.equal(calls.some(call => call.name === 'MyChipAccount'), false)
})
test('staged agent preset and custom date changes apply only once and query exact IST calendar days', async () => {
  mount(); await screen.findByText('INR 77500')
  const initial = calls.filter(call => call.name === 'AgentDashboardStats').length
  fireEvent.change(screen.getByRole('combobox', { name: 'Period preset' }), { target: { value: 'lastWeek' } })
  assert.equal(calls.filter(call => call.name === 'AgentDashboardStats').length, initial)
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  const week = getDateRangeISOForAgentDashboardPreset('lastWeek')
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentDashboardStats' && call.variables.dateFrom === istDayOf(week.dateFrom))))
  fireEvent.change(screen.getByRole('combobox', { name: 'Period preset' }), { target: { value: 'custom' } })
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-21' } })
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-20' } })
  assert.equal((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled, true)
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-25' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  await waitFor(() => assert.ok(calls.some(call => call.name === 'AgentDashboardStats' && call.variables.dateFrom === '2026-09-21' && call.variables.dateTo === '2026-09-25')))
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
  assert.equal((screen.getByRole('combobox', { name: 'Period preset' }) as HTMLSelectElement).value, 'today')
})
test('all three chart views retain the selected agent and period without mounting dormant business widgets', async () => {
  mount(); await screen.findByRole('heading', { name: 'GGR Trends Over Time' })
  fireEvent.click(screen.getByRole('tab', { name: 'Domain Breakdown' })); await screen.findByRole('heading', { name: 'GGR by Domain' })
  assert.ok(screen.getByText('INR -600')); assert.ok(screen.getByText('₹1,000.00'))
  const slices = screen.getByRole('list', { name: 'Pie slice values' })
  assert.ok(within(slices).getByText('Sports: 75.0% (INR 2400)'))
  assert.ok(within(slices).getByText('Casino: 18.8% (INR -600)'))
  fireEvent.click(screen.getByRole('tab', { name: 'Player Activity' })); await screen.findByRole('heading', { name: 'Player Activity Over Time' })
  for (const name of ['GGRTrends', 'DomainBreakdown', 'PlayerActivity']) assert.equal(calls.find(call => call.name === name)?.variables.agentId, 'preview-agent')
  assert.equal(calls.some(call => ['TopPlayers', 'SubAgents', 'RecentPlayers'].includes(call.name)), false)
})
test('commission finance keeps all-time/current-cycle windows, signed provisional amounts and destination', async () => {
  mount('COMMISSION'); await screen.findByText('INR 77500')
  assert.equal(Boolean(screen.queryByRole('button', { name: 'Request More Credit' })), false)
  fireEvent.click(screen.getByRole('tab', { name: 'Financial' }))
  await screen.findByText('INR 14000'); await screen.findByText('INR -250')
  assert.ok(screen.getByText('INR 4000'))
  assert.ok(calls.some(call => call.name === 'CommissionSummary' && call.variables.periodFrom === '2000-01-01'))
  assert.ok(calls.some(call => call.name === 'CommissionSummary' && call.variables.periodFrom === format(new Date('2026-09-21T00:00:00.000Z'), 'yyyy-MM-dd') && call.variables.periodTo === format(new Date('2026-09-27T23:59:59.999Z'), 'yyyy-MM-dd')))
  assert.equal(calls.some(call => call.name === 'SettlementSummary'), false)
  fireEvent.click(screen.getByRole('button', { name: 'View Detailed Commission Report' }))
  assert.equal(screen.getByLabelText('Destination').textContent, '/commission/overview')
})
test('effective zero commission does not fall back to raw calculated totals', async () => {
  state.effectiveZero = true; mount('COMMISSION'); await screen.findByText('INR 77500')
  fireEvent.click(screen.getByRole('tab', { name: 'Financial' }))
  await screen.findByText('INR 4000')
  assert.ok(screen.getAllByText('INR 0').length >= 4)
  assert.equal(Boolean(screen.queryByText('INR 18000')), false)
})
test('SHARING finance preserves settlement signs, conversion, zero fallbacks and report destination', async () => {
  mount('SHARING'); await screen.findByText('INR 77500')
  fireEvent.click(screen.getByRole('tab', { name: 'Financial' }))
  await screen.findByText('-INR 2000'); assert.ok(screen.getByText('25.00%')); assert.ok(screen.getByText('INR 1500')); assert.ok(screen.getByText('INR 1000'))
  assert.equal(calls.some(call => call.name === 'CommissionSummary'), false)
  fireEvent.click(screen.getByRole('button', { name: 'View Detailed Settlement Report' }))
  assert.equal(screen.getByLabelText('Destination').textContent, '/settlement/overview')
})
test('CREDIT finance is its chips: no settlement summary, due or share, and the way to its Chips page', async () => {
  // A CREDIT agent settles nothing since 2026-11-02 (spec §6): what it owes or is owed is its Ref P/L.
  mount('CREDIT'); await screen.findByText('INR 77500')
  fireEvent.click(screen.getByRole('tab', { name: 'Financial' }))
  const chips = await screen.findByRole('group', { name: 'My chip figures' }); await within(chips).findByText('INR 100000')
  for (const text of ['Ref P/L', '+INR 4700', 'Upline owes you']) assert.ok(within(chips).getByText(text), text)
  assert.equal(screen.getByRole('link', { name: 'Open chips' }).getAttribute('href'), '/agent/credit')
  for (const gone of ['Settlement Due', 'Last Settlement', 'Share %']) assert.equal(screen.queryByText(gone), null, gone)
  assert.equal(screen.queryByRole('button', { name: 'View Detailed Settlement Report' }), null)
  assert.equal(calls.some(call => call.name === 'SettlementSummary'), false)
})
test('a CREDIT agent that owes its upline reads it on the Financial tab: Ref P/L below zero, "You owe upline"', async () => {
  myChips = chipAccountFixture({ ...MY_CHIPS, balance: 80000, available: 80000, downlineBalance: 5000, refPnl: -15000 })
  mount('CREDIT'); await screen.findByText('INR 77500')
  fireEvent.click(screen.getByRole('tab', { name: 'Financial' }))
  const chips = await screen.findByRole('group', { name: 'My chip figures' }); await within(chips).findByText('−INR 15000')
  assert.ok(within(chips).getByText('You owe upline'))
  assert.equal(within(chips).queryByText('Upline owes you'), null)
})
test('unauthenticated page is denied and an actual stats failure is not reported as success', async () => {
  const first = mount('CREDIT', false); assert.ok(screen.getByText('Not Authenticated')); assert.equal(calls.some(call => call.name === 'AgentDashboardStats'), false)
  first.unmount(); state.fail = 'AgentDashboardStats'; mount()
  await screen.findByText('Error Loading Data'); assert.ok(screen.getByText('Preview data unavailable'))
})
