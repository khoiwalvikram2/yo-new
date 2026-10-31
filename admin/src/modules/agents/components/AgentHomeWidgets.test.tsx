import { beforeEach, afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import CreditMeter from './CreditMeter'
import AgentAlerts from './AgentAlerts'
import PlayerQuickView from './PlayerQuickView'
import SubAgentPerformance from './SubAgentPerformance'
import ReportingQuickAccess from './ReportingQuickAccess'
import { agentHomeAccount, agentHomeFixtureResponse, type AgentHomeFixtureState } from '../../../../test/agentHomePreviewData'
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (n: number) => `INR ${n}`, convertFromWhitelabelCurrency: (n: number) => n * 2, getCurrencySymbol: () => '₹' }) }))
vi.mock('@/shared/core/useFormatDate', () => ({ useFormatDate: () => ({ formatDate: (value: string) => value }) }))
let state: AgentHomeFixtureState
let calls: Array<{ name: string; variables: Record<string, unknown> }>
const clients: ApolloClient<unknown>[] = []
function Destination() { const route = useLocation(); return <output aria-label="Destination">{route.pathname}{route.search}</output> }
function mount(content: ReactNode) {
  const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink(operation => new Observable(observer => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    const timer = setTimeout(() => { try { observer.next(agentHomeFixtureResponse(operation, state)); observer.complete() } catch (error) { observer.error(error) } }, 1)
    return () => clearTimeout(timer)
  })) }); clients.push(client)
  return render(<ApolloProvider client={client}><MemoryRouter>{content}<Destination /></MemoryRouter></ApolloProvider>)
}
beforeEach(() => { state = {}; calls = []; useAuthStore.setState({ agent: agentHomeAccount(), user: undefined, roles: [], permissions: [] }) })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.stop()) })
test('credit request invokes only a supplied handler while preserving raw figures and query agent', async () => {
  const request = vi.fn(); mount(<CreditMeter agentId="target-agent" onRequestCredit={request} />)
  await screen.findByText('₹100,000.00'); assert.ok(screen.getByText('INR 200000')); assert.ok(screen.getByText('85.0%'))
  fireEvent.click(screen.getByRole('button', { name: 'Request More Credit' })); assert.equal(request.mock.calls.length, 1)
  assert.deepEqual(calls.find(call => call.name === 'CreditAllocation')?.variables, { agentId: 'target-agent' })
})
test('non-credit scheme does not query or show credit controls', () => {
  useAuthStore.setState({ agent: agentHomeAccount('SHARING') }); mount(<CreditMeter agentId="preview-agent" />)
  assert.equal(calls.length, 0); assert.equal(Boolean(screen.queryByText('Credit Status')), false)
})
test('critical credit alert cannot be dismissed; activity dismissals stay local and preserve scopes', async () => {
  state.overLimit = true; mount(<AgentAlerts agentId="target-agent" autoRefresh={false} />)
  await screen.findByText('New Player Registered'); const critical = screen.getByText('Credit Limit Exceeded').closest('li')!
  assert.equal(Boolean(within(critical).queryByRole('button', { name: 'Dismiss' })), false)
  const activity = screen.getByText('New Player Registered').closest('li')!
  fireEvent.click(within(activity).getByRole('button', { name: 'Dismiss' }))
  await waitFor(() => assert.equal(Boolean(screen.queryByText('New Player Registered')), false))
  assert.ok(screen.getByText('Credit Limit Exceeded'))
  assert.deepEqual(calls.find(call => call.name === 'AgentActivity')?.variables, { agentId: 'target-agent', limit: 5 })
  assert.ok(calls.every(call => ['CreditAllocation', 'AgentActivity'].includes(call.name)))
})
test('top player table keeps six columns, top-five calculation, period and profile navigation', async () => {
  mount(<PlayerQuickView agentId="preview-agent" />); const table = await screen.findByRole('table', { name: 'Top players' }); await screen.findByText('Asha Sharma')
  assert.equal(within(table).getAllByRole('columnheader').length, 6); assert.equal(within(table).getAllByRole('row').length, 6)
  assert.ok(screen.getByText('INR -1000'))
  assert.equal(calls.find(call => call.name === 'TopPlayers')?.variables.limit, 5)
  fireEvent.click(within(within(table).getAllByRole('row')[1]).getByRole('button', { name: 'View' })); assert.equal(screen.getByLabelText('Destination').textContent, '/players/profile/player-0')
})
test('sub-agents keep depth-one query, single pagination pass, honest placeholder and hierarchy links', async () => {
  mount(<SubAgentPerformance agentId="preview-agent" periodFrom="2000-01-01" periodTo="2026-09-27" />)
  await screen.findByText('Partner 1'); const table = screen.getByRole('table', { name: 'Sub-agents' })
  assert.equal(within(table).getAllByRole('row').length, 11)
  assert.deepEqual(calls.find(call => call.name === 'SubAgents')?.variables, { parentAgentId: 'preview-agent' })
  assert.ok(screen.getByText('Placeholder only · INR · No sub-agent GGR source is connected here.'))
  fireEvent.click(screen.getByRole('button', { name: 'Next page' })); assert.equal(within(table).getAllByRole('row').length, 5)
  fireEvent.click(within(within(table).getAllByRole('row')[1]).getByRole('button', { name: 'Manage' })); assert.equal(screen.getByLabelText('Destination').textContent, '/agents/hierarchy?subAgentId=sub-agent-10')
})
test('empty level-four sub-agent widget cannot expose creation and reporting links do not pretend to download', async () => {
  state.empty = true; useAuthStore.setState({ agent: agentHomeAccount('CREDIT', 4) })
  const first = mount(<SubAgentPerformance agentId="preview-agent" periodFrom="2000-01-01" periodTo="2026-09-27" />)
  await screen.findByText('No sub-agents found'); assert.equal(Boolean(screen.queryByRole('button', { name: 'Create Sub-Agent' })), false)
  first.unmount(); mount(<ReportingQuickAccess agentId="preview-agent" />)
  const card = screen.getByText('Daily GGR Report').closest('section')!
  fireEvent.click(within(card).getByRole('button', { name: 'Open report' })); assert.equal(screen.getByLabelText('Destination').textContent, '/reporting/agents/performance?report=Daily GGR&agentId=preview-agent')
})
