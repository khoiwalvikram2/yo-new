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
import AgentHome from './AgentHome'
import { agentHomeAccount, agentHomeFixtureResponse, type AgentHomeFixtureState, type AgentScheme } from '../../../test/agentHomePreviewData'
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (n: number) => `INR ${n}`, convertFromWhitelabelCurrency: (n: number) => n * 2, getCurrencySymbol: () => '₹', getWhitelabelBaseCurrencyCode: () => 'INR' }) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (value: string) => value }) }))
let state: AgentHomeFixtureState
let calls: Array<{ name: string; variables: Record<string, unknown> }>
const clients: ApolloClient<unknown>[] = []
function Destination() { const value = useLocation(); return <output aria-label="Destination">{value.pathname}{value.search}</output> }
function mount(scheme: AgentScheme = 'CREDIT', authenticated = true) {
  useAuthStore.setState({ agent: authenticated ? agentHomeAccount(scheme) : undefined })
  const client = new ApolloClient({ cache: new InMemoryCache({ typePolicies: { Query: { fields: { agents: { merge: true }, reporting: { merge: true } } } } }), link: new ApolloLink(operation => new Observable(observer => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    const timer = setTimeout(() => { try { observer.next(agentHomeFixtureResponse(operation, state)); observer.complete() } catch (error) { observer.error(error) } }, 1)
    return () => clearTimeout(timer)
  })) })
  clients.push(client)
  return render(<ApolloProvider client={client}><MemoryRouter initialEntries={['/agent']}><AgentHome /><Destination /></MemoryRouter></ApolloProvider>)
}
beforeEach(() => { state = {}; calls = []; useAuthStore.setState({ agent: undefined, user: undefined, roles: [], permissions: [], agentPermissions: [] }); useReportingStore.setState({ filters: { agentId: 'preview-agent', whitelabelId: 'preview-tenant' } }) })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.stop()) })
test('two actual tabs, all overview metrics and exact agent/report query scopes remain unchanged', async () => {
  mount(); await screen.findByText('INR 77500'); await screen.findByText('₹100,000.00')
  assert.deepEqual(within(screen.getByRole('tablist', { name: 'Agent Dashboard' })).getAllByRole('tab').map(tab => tab.textContent), ['Overview', 'Financial'])
  assert.equal(Boolean(screen.queryByRole('tab', { name: 'Players' })), false)
  assert.ok(screen.getByText('INR 249000')); assert.ok(screen.getByText('INR 24')); assert.ok(screen.getByText('1,240'))
  const today = getDateRangeISOForAgentDashboardPreset('today')
  assert.deepEqual(calls.find(call => call.name === 'AgentDashboardStats')?.variables, { agentId: 'preview-agent', dateFrom: istDayOf(today.dateFrom), dateTo: istDayOf(today.dateTo) })
  assert.deepEqual(calls.find(call => call.name === 'AgentKPIs')?.variables, { filter: { agentId: 'preview-agent', whitelabelId: 'preview-tenant', dateFrom: istDayOf(today.dateFrom), dateTo: istDayOf(today.dateTo) } })
  // No credit-request workflow exists, so the dashboard offers no request button, only the credit page.
  assert.equal(screen.queryByRole('button', { name: 'Request More Credit' }), null)
  assert.equal(screen.getByRole('link', { name: 'Credit details' }).getAttribute('href'), '/agent/credit')
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
for (const scheme of ['SHARING', 'CREDIT'] as const) test(`${scheme} finance preserves settlement signs, conversion, zero fallbacks and report destination`, async () => {
  mount(scheme); await screen.findByText('INR 77500')
  fireEvent.click(screen.getByRole('tab', { name: 'Financial' }))
  await screen.findByText('-INR 2000'); assert.ok(screen.getByText('25.00%')); assert.ok(screen.getByText('INR 1500')); assert.ok(screen.getByText('INR 1000'))
  assert.equal(calls.some(call => call.name === 'CommissionSummary'), false)
  fireEvent.click(screen.getByRole('button', { name: 'View Detailed Settlement Report' }))
  assert.equal(screen.getByLabelText('Destination').textContent, '/settlement/overview')
})
test('unauthenticated page is denied and an actual stats failure is not reported as success', async () => {
  const first = mount('CREDIT', false); assert.ok(screen.getByText('Not Authenticated')); assert.equal(calls.some(call => call.name === 'AgentDashboardStats'), false)
  first.unmount(); state.fail = 'AgentDashboardStats'; mount()
  await screen.findByText('Error Loading Data'); assert.ok(screen.getByText('Preview data unavailable'))
})
