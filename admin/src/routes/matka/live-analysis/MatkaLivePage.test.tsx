import assert from 'node:assert/strict'
import { cloneElement } from 'react'
import { beforeEach, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import { useMatkaLiveStore } from '@/state/matkaLiveStore'
import LiveAnalysisPage from './LiveAnalysisPage'
import { TestBetsPanel } from './tabs/testing/TestBetsPanel'
import { BetList } from './tabs/bet-list/BetList'
import { RiskAnalyticsDashboard } from './tabs/performance/RiskAnalyticsDashboard'
import { TopPlayersTable } from './tabs/players/TopPlayersTable'
import { matkaDashboardFixture, matkaFixtureResponse, type MatkaFixtureState } from '../../../../test/matkaLivePreviewData'
const scope = vi.hoisted(() => ({ tenant: 'tenant-a' }))
vi.mock('@/shared/core/useWhitelabels', () => ({ useCurrentWhitelabel: () => ({ whitelabel: { id: scope.tenant } }) }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ convertFromWhitelabelCurrency: (amount: number) => amount * 2, formatAmount: (amount: number) => `INR ${Number(amount).toFixed(2)}` }) }))
let calls: Array<{ name: string; variables: Record<string, unknown> }>
let stops: string[]
let exported: Blob | undefined
beforeEach(() => {
  scope.tenant = 'tenant-a'; calls = []; stops = []; exported = undefined
  useMatkaLiveStore.setState({ watchlist: [], savedViews: [] })
  useAuthStore.setState({ token: undefined, agent: undefined, roles: [], permissions: [{ domain: 'matka.live-analysis', actions: ['view'] }, { domain: 'settlements.center', actions: ['view'] }] })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { exported = blob; return 'blob:matka-preview' }) })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
function workspace(children = <LiveAnalysisPage />, state: MatkaFixtureState & { holdDashboard?: boolean; holdTenant?: string } = {}) {
  const localCalls = calls, localStops = stops
  const dashboards: Array<{ tenant: string; send: () => void }> = []
  const link = new ApolloLink(operation => new Observable(observer => {
    localCalls.push({ name: operation.operationName, variables: structuredClone(operation.variables) })
    const send = () => {
      try {
        if (operation.operationName === 'MatkaBets') {
          const query = operation.variables.query || {}
          if (query.status != null) assert.ok(['pending', 'active', 'won', 'lost', 'cancelled', 'void'].includes(query.status))
          if (query.statuses != null) assert.ok(query.statuses.every((value: string) => ['pending', 'active', 'won', 'lost', 'cancelled', 'void'].includes(value)))
        }
        observer.next(matkaFixtureResponse(operation, state))
        const definition = operation.query.definitions.find(node => node.kind === 'OperationDefinition')
        if (definition?.kind === 'OperationDefinition' && definition.operation !== 'subscription') observer.complete()
      } catch (error) { observer.error(error) }
    }
    queueMicrotask(() => {
      if (operation.operationName === 'MatkaLiveDashboard') {
        const tenant = operation.variables.scope.tenant
        dashboards.push({ tenant, send })
        if (state.holdDashboard || state.holdTenant === tenant) return
      }
      send()
    })
    return () => { localStops.push(operation.operationName) }
  }))
  const tree = () => <MockedProvider cache={new InMemoryCache()} link={link}><MemoryRouter>{cloneElement(children)}</MemoryRouter></MockedProvider>
  const view = render(tree())
  return { ...view, updateScope: () => view.rerender(tree()), release: (tenant: string) => dashboards.filter(value => value.tenant === tenant).forEach(value => value.send()) }
}

test('Players and Bet List load while the dashboard is delayed, with valid open-bet statuses', async () => {
  workspace(<LiveAnalysisPage />, { holdDashboard: true })
  await screen.findByText('Loading live Matka intelligence...')
  fireEvent.click(screen.getByRole('tab', { name: 'Players' }))
  await screen.findByRole('heading', { name: 'Player Overview' })
  const table = await screen.findByRole('table', { name: 'Top Matka players' })
  await within(table).findByText('Dev Patel')
  assert.ok(calls.filter(call => call.name === 'MatkaBets').every(call => {
    const query = call.variables.query as { statuses: string[] }
    assert.deepEqual(query.statuses, ['pending', 'active']); return true
  }))
  fireEvent.click(screen.getByRole('tab', { name: 'Bet List' }))
  await screen.findByRole('table', { name: 'Live Matka bets' })
  assert.equal(Boolean(screen.queryByText('Loading live Matka intelligence...')), false)
  assert.equal(calls.some(call => call.name === 'CreateTestMatkaBet'), false)
})

test('dashboard failure does not block lists and Retry reconnects statistics', async () => {
  const state = { fail: 'MatkaLiveDashboard' }
  workspace(<LiveAnalysisPage />, state); await screen.findByText('Live Matka data unavailable')
  fireEvent.click(screen.getByRole('tab', { name: 'Bet List' }))
  await screen.findByRole('table', { name: 'Live Matka bets' })
  screen.getByText('Live Matka data unavailable')
  state.fail = ''; fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
  await screen.findByRole('heading', { name: 'Top Matkas' })
})

test('a delayed tenant change clears previous statistics before its new snapshot arrives', async () => {
  const state = { holdTenant: 'tenant-b' }
  const view = workspace(<LiveAnalysisPage />, state)
  await screen.findByRole('heading', { name: 'Top Matkas' })
  scope.tenant = 'tenant-b'; await act(async () => view.updateScope())
  await screen.findByText('Loading live Matka intelligence...')
  assert.equal(Boolean(screen.queryByRole('heading', { name: 'Top Matkas' })), false)
  const stats = screen.getByRole('region', { name: 'matka live statistics' })
  assert.ok(stats.querySelector('[aria-busy="true"]'))
  assert.equal(Boolean(within(stats).queryByText('INR 20000.00')), false)
  await act(async () => view.release('tenant-a'))
  assert.equal(Boolean(screen.queryByRole('heading', { name: 'Top Matkas' })), false)
  await act(async () => view.release('tenant-b'))
  await screen.findByRole('heading', { name: 'Top Matkas' })
})
test('main page retains all eight views and original subscription/query scopes without implicit writes', async () => {
  workspace(); await screen.findByRole('heading', { name: 'Top Matkas' })
  assert.equal(screen.getAllByRole('tab').length, 8)
  assert.deepEqual(calls.find(call => call.name === 'MatkaLiveDashboard')?.variables, { scope: { tenant: 'tenant-a', whitelabelId: 'tenant-a', agentId: undefined } })
  for (const [label, heading] of [['Analytics', 'Player Journey Mapping'], ['Performance', 'Risk Analytics'], ['Heatmap', 'Player Activity Heatmap'], ['Bet List', 'Live Bet List'], ['Compare', 'Comparison View'], ['Players', 'Player Overview']]) {
    fireEvent.click(screen.getByRole('tab', { name: label })); await screen.findByRole('heading', { name: heading })
  }
  fireEvent.click(screen.getByRole('tab', { name: 'Testing' })); await screen.findByRole('form', { name: 'Test Matka bets' })
  assert.equal(calls.some(call => call.name === 'CreateTestMatkaBet'), false)
})
test('pause keeps the snapshot, ends only dashboard/activity streams and Refresh resumes or restarts exact scopes', async () => {
  workspace(); await screen.findByRole('heading', { name: 'Top Matkas' })
  fireEvent.click(screen.getByRole('switch', { name: 'Auto-refresh' }))
  await screen.findByText('Dashboard and activity streams paused'); screen.getByRole('heading', { name: 'Top Matkas' })
  await waitFor(() => { assert.ok(stops.includes('MatkaLiveDashboard')); assert.ok(stops.includes('MatkaPlayerEvents')) })
  assert.equal(stops.includes('MatkaExposureBook'), false)
  const before = calls.filter(call => call.name === 'MatkaLiveDashboard').length
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh now' })) })
  await waitFor(() => assert.equal(calls.filter(call => call.name === 'MatkaLiveDashboard').length, before + 1))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh now' })) })
  await waitFor(() => assert.equal(calls.filter(call => call.name === 'MatkaLiveDashboard').length, before + 2))
  assert.deepEqual(calls.filter(call => call.name === 'MatkaLiveDashboard').at(-1)?.variables, { scope: { tenant: 'tenant-a', whitelabelId: 'tenant-a', agentId: undefined } })
})
test('changing scope while paused clears old snapshot/history and resumes the newly selected tenant', async () => {
  const view = workspace(); await screen.findByRole('heading', { name: 'Top Matkas' })
  fireEvent.click(screen.getByRole('switch', { name: 'Auto-refresh' })); await screen.findByText('Dashboard and activity streams paused')
  scope.tenant = 'tenant-b'; await act(async () => { view.updateScope() })
  await screen.findByText('Resume streams to load this scope.')
  assert.equal(Boolean(screen.queryByRole('heading', { name: 'Top Matkas' })), false)
  fireEvent.click(screen.getByRole('button', { name: 'Resume streams' })); await screen.findByRole('heading', { name: 'Top Matkas' })
  assert.equal((calls.filter(call => call.name === 'MatkaLiveDashboard').at(-1)?.variables.scope as { tenant: string }).tenant, 'tenant-b')
})
test('view permission still gates data reads and subscription failure offers real retry', async () => {
  useAuthStore.setState({ permissions: [] }); const denied = workspace(); await screen.findByText('Access denied'); assert.equal(calls.length, 0); denied.unmount()
  useAuthStore.setState({ permissions: [{ domain: 'matka.live-analysis', actions: ['view'] }] }); const state = { fail: 'MatkaLiveDashboard' }
  workspace(<LiveAnalysisPage />, state); await screen.findByText('Live Matka data unavailable')
  state.fail = ''; fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByRole('heading', { name: 'Top Matkas' })
})
test('Bet List paginates exactly once, keeps limit/status contract, saves views and exports all filtered loaded rows', async () => {
  workspace(<BetList />); const table = await screen.findByRole('table', { name: 'Live Matka bets' }); await waitFor(() => assert.equal(within(table).getAllByRole('row').length, 21))
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(call => call.name === 'MatkaLiveBetsPage')?.variables)), { filters: { status: ['pending'] }, offset: 0, limit: 20 })
  fireEvent.click(screen.getByRole('button', { name: 'Next page' })); await waitFor(() => assert.equal(within(table).getAllByRole('row').length, 11))
  fireEvent.change(screen.getByRole('textbox', { name: 'Search Matka bets' }), { target: { value: 'Asha' } }); await waitFor(() => assert.equal(within(table).getAllByRole('row').length, 9))
  const before = calls.length; fireEvent.click(screen.getByRole('button', { name: 'Save View' })); assert.equal(useMatkaLiveStore.getState().savedViews[0].filters.searchQuery, 'Asha')
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' })); await waitFor(() => assert.ok(exported)); assert.ok(calls.length > before); assert.equal(calls.at(-1)?.variables.limit,500)
  fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'active' } })
  await waitFor(() => assert.ok(calls.some(call => JSON.stringify((call.variables.filters as { status?: string[] })?.status) === '["active"]')))
})
test('Top Players retains every original column and ranking changes without changing the query', async () => {
  workspace(<TopPlayersTable />); const table = await screen.findByRole('table', { name: 'Top Matka players' }); await within(table).findByText('Dev Patel')
  assert.equal(within(table).getAllByRole('columnheader').length, 9)
  within(within(table).getAllByRole('row')[1]).getByText('Dev Patel')
  const before = calls.length; fireEvent.click(within(screen.getByRole('group', { name: 'Player ranking' })).getByRole('button', { name: 'Exposure' }))
  within(within(table).getAllByRole('row')[1]).getByText('Asha Sharma'); assert.equal(calls.length, before)
})
test('Risk Analytics retains liquidity and overall-score memo calculations and identifies estimates', () => {
  render(<RiskAnalyticsDashboard kpis={matkaDashboardFixture.kpis} breakdown={matkaDashboardFixture.breakdown} />)
  screen.getByText('Estimated risk indicators'); screen.getByText('37'); screen.getByText('INR 40000.00'); screen.getByText('80.0%')
})
test('Risk Analytics without wagers says so instead of spinning forever', () => {
  render(<RiskAnalyticsDashboard kpis={matkaDashboardFixture.kpis} breakdown={{ byMatka: [] }} />)
  screen.getByText('No risk data yet'); assert.equal(screen.queryByRole('status'), null)
})
async function fillTestBet(count = '2') {
  const matka = await screen.findByRole('combobox', { name: /^Matka\s*\*?$/ })
  fireEvent.click(matka); fireEvent.keyDown(matka, { key: 'ArrowDown' }); fireEvent.click(await screen.findByRole('option', { name: 'Kalyan (KAL)' }))
  fireEvent.change(screen.getByLabelText(/^Bet Numbers/), { target: { value: '123' } })
  fireEvent.change(screen.getByLabelText(/^Count/), { target: { value: count } })
  fireEvent.change(screen.getByLabelText('Potential Win'), { target: { value: '0' } })
}
test('test creation validates, preserves exact payload including zero and submits a batch only once', async () => {
  workspace(<TestBetsPanel />); fireEvent.click(screen.getByRole('button', { name: 'Place test bet(s)' })); await screen.findByText('Please enter Bet Numbers'); assert.equal(calls.filter(call => call.name === 'CreateTestMatkaBet').length, 0)
  await fillTestBet(); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Place test bet(s)' })); fireEvent.click(screen.getByRole('button', { name: 'Place test bet(s)' })) })
  await waitFor(() => assert.equal((screen.getByLabelText(/^Bet Numbers/) as HTMLInputElement).value, ''))
  const writes = calls.filter(call => call.name === 'CreateTestMatkaBet'); assert.equal(writes.length, 2)
  assert.deepEqual(writes[0].variables, { input: { userId: 1, matkaId: 'matka-0', matkaType: 'worli', marketName: 'OPEN', marketSession: undefined, bidType: 'single', betNumbers: '123', betAmount: 100, payoutMultiplier: 9, potentialWin: 0, status: undefined } })
})
test('test creation rejects server errors without clearing drafts or claiming a completed batch', async () => {
  workspace(<TestBetsPanel />, { refused: true }); await fillTestBet('1'); fireEvent.click(screen.getByRole('button', { name: 'Place test bet(s)' })); await screen.findByText('Test bet refused')
  assert.equal((screen.getByLabelText(/^Bet Numbers/) as HTMLInputElement).value, '123')
})
test('partial test creation explains the committed count before allowing an operator to retry', async () => {
  workspace(<TestBetsPanel />, { failAfter: 1 }); await fillTestBet(); fireEvent.click(screen.getByRole('button', { name: 'Place test bet(s)' })); await screen.findByText(/1 test bet\(s\) were created before the remaining request failed/)
  assert.equal((screen.getByLabelText(/^Bet Numbers/) as HTMLInputElement).value, '123'); assert.equal(calls.filter(call => call.name === 'CreateTestMatkaBet').length, 2)
})
