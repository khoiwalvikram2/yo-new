import { beforeEach, afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
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
// Chips have no limit to run out of (spec 2026-11-02): the alerts are activity only, with no credit-limit read.
test('alerts carry activity only: no credit-limit alert or query, and dismissals stay local and preserve scopes', async () => {
  // The fixture answers no credit-limit read any more: one would fail the test, not just show up in calls.
  mount(<AgentAlerts agentId="target-agent" autoRefresh={false} />)
  await screen.findByText('New Player Registered')
  for (const gone of ['Credit Limit Exceeded', 'Credit Usage High']) assert.equal(screen.queryByText(gone), null, gone)
  const activity = screen.getByText('New Player Registered').closest('li')!
  fireEvent.click(within(activity).getByRole('button', { name: 'Dismiss' }))
  await waitFor(() => assert.equal(Boolean(screen.queryByText('New Player Registered')), false))
  assert.ok(screen.getByText('Large Bet Detected'))
  assert.deepEqual(calls.find(call => call.name === 'AgentActivity')?.variables, { agentId: 'target-agent', limit: 5 })
  assert.deepEqual(calls.map(call => call.name), ['AgentActivity'])
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
