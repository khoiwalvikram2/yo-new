import assert from 'node:assert/strict'
import { ApolloLink, Observable, type Operation } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { beforeEach, describe, test } from 'vitest'
import { CurrencyProvider } from '@/shared/core/CurrencyContext'
import { useAuthStore } from '@/shared/core/authStore'
import { casinoFixtureResponse, casinoDashboardFixture } from '../../../../test/casinoLivePreviewData'
import type { CasinoDashboard } from './casinoLiveModel'
import LiveAnalysisPage from './LiveAnalysisPage'

dayjs.extend(utc); dayjs.extend(timezone)
let calls: Array<{ name: string; variables: Record<string, unknown> }>
let activeSubscriptions: Set<string>
let dashboardObservers: Map<number, (snapshot: CasinoDashboard) => void>
beforeEach(() => {
  calls = []; activeSubscriptions = new Set(); dashboardObservers = new Map(); localStorage.clear()
  useAuthStore.setState({ user: undefined, agent: undefined, token: undefined, roles: [], permissions: [{ domain: 'casino.live-analysis', actions: ['view'] }] })
})
function mount(options: { holdDashboard?: boolean; holdWindow?: number; dashboardError?: boolean } = {}) {
  const link = new ApolloLink(operation => new Observable(observer => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    if (operation.operationName === 'CasinoLiveDashboard' || operation.operationName === 'CasinoPlayerEvents') activeSubscriptions.add(operation.operationName)
    if (operation.operationName === 'CasinoLiveDashboard') {
      const window = Number(operation.variables.scope?.windowMins)
      dashboardObservers.set(window, snapshot => observer.next({ data: { casinoLiveDashboard: snapshot } }))
      if (options.dashboardError) { queueMicrotask(() => observer.error(new Error('Dashboard stream unavailable'))); return }
      if (options.holdDashboard || options.holdWindow === window) return () => { activeSubscriptions.delete(operation.operationName) }
    }
    queueMicrotask(() => { observer.next(casinoFixtureResponse(operation as Operation)); if (operation.operationName !== 'CasinoLiveDashboard' && operation.operationName !== 'CasinoPlayerEvents') observer.complete() })
    return () => { activeSubscriptions.delete(operation.operationName) }
  }))
  return render(<MockedProvider link={link} addTypename={false}><CurrencyProvider><MemoryRouter><LiveAnalysisPage /></MemoryRouter></CurrencyProvider></MockedProvider>)
}
describe('complete casino live workspace', () => {
  test('retains RBAC denial without querying live data', () => {
    useAuthStore.setState({ permissions: [] })
    mount()
    assert.ok(screen.getByText('Access denied'))
    assert.equal(calls.length, 0)
  })
  test('uses persisted valid window and exact tenant/whitelabel subscription scope', async () => {
    localStorage.setItem('liveCasinoAnalysis_windowMins', '60')
    mount()
    await screen.findByRole('heading', { name: 'Live Casino Intelligence' })
    await waitFor(() => assert.ok(calls.some(call => call.name === 'CasinoLiveDashboard')))
    assert.deepEqual(calls.find(call => call.name === 'CasinoLiveDashboard')?.variables, { scope: { tenant: 'default', whitelabelId: 'default', windowMins: 60 } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Time window' }), { target: { value: '30' } })
    await waitFor(() => assert.ok(calls.some(call => call.name === 'CasinoLiveDashboard' && (call.variables.scope as { windowMins: number }).windowMins === 30)))
    assert.equal(localStorage.getItem('liveCasinoAnalysis_windowMins'), '30')
  })
  test('shows each original view rather than header-only migration', async () => {
    mount()
    await screen.findByRole('region', { name: 'Exposure & Payouts' })
    for (const [tab, heading] of [['Analytics', 'Player Journey Mapping'], ['Performance', 'Risk Analytics'], ['Heatmap', 'Games Activity Heatmap'], ['Bet List', 'Bet List'], ['Compare', 'Comparison Controls'], ['Players', 'Player Overview'], ['Testing', 'Test Bets Panel']]) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      assert.ok(await screen.findByRole('region', { name: heading }))
      assert.equal(screen.getByRole('tab', { name: tab }).getAttribute('aria-selected'), 'true')
    }
  })
  test('pauses only the documented subscription streams and Refresh resumes without new APIs', async () => {
    mount()
    await screen.findByRole('region', { name: 'Exposure & Payouts' })
    await waitFor(() => assert.equal(activeSubscriptions.size, 2))
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-refresh' }))
    await waitFor(() => assert.equal(activeSubscriptions.size, 0))
    assert.ok(screen.getByText(/Individual tab queries keep their own polling/))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }))
    await waitFor(() => assert.equal(activeSubscriptions.size, 2))
    assert.equal(screen.getByRole('switch', { name: 'Auto-refresh' }).getAttribute('aria-checked'), 'true')
    assert.equal(calls.filter(call => call.name === 'CasinoLiveDashboard').length, 2)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }))
    await waitFor(() => assert.equal(calls.filter(call => call.name === 'CasinoLiveDashboard').length, 3))
  })
  test('preserves complete server pagination, filters, exact server status and clear/reset', async () => {
    mount(); fireEvent.click(await screen.findByRole('tab', { name: 'Bet List' }))
    await screen.findByText('Showing 20 of 24 bets')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Showing 4 of 24 bets')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search casino bets' }), { target: { value: 'Asha' } })
    await screen.findByText('Showing 8 of 8 bets')
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'won' } })
    await waitFor(() => assert.ok(calls.some(call => call.name === 'CasinoLiveBetsPage' && JSON.stringify((call.variables.filters as { status?: string[] }).status) === '["won"]')))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await screen.findByText('Showing 20 of 24 bets')
  })
  test('retains player rankings and original ten table fields after selected sort', async () => {
    mount(); fireEvent.click(await screen.findByRole('tab', { name: 'Players' }))
    const top = await screen.findByRole('region', { name: 'Top Players' })
    const table = await within(top).findByRole('table', { name: 'Top players' })
    await waitFor(() => assert.equal(within(table).getAllByRole('row').length, 4))
    assert.equal(within(table).getAllByRole('columnheader').length, 10)
    fireEvent.click(within(top).getByRole('button', { name: 'GGR' }))
    assert.equal(within(top).getByRole('button', { name: 'GGR' }).getAttribute('aria-pressed'), 'true')
    assert.ok(within(table).getAllByRole('row')[1].textContent?.includes('Mina'))
  })
  test('Players, Bet List and Testing open before the dashboard snapshot arrives', async () => {
    mount({ holdDashboard: true })
    await screen.findByText('Loading live intelligence data...')
    for (const [tab, heading] of [['Players', 'Player Overview'], ['Bet List', 'Bet List'], ['Testing', 'Test Bets Panel']]) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      assert.ok(await screen.findByRole('region', { name: heading }))
      assert.equal(screen.queryByText('Loading live intelligence data...'), null)
    }
    assert.equal(calls.some(call => ['CreateTestCasinoBet', 'SettleTestCasinoBet'].includes(call.name)), false)
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    assert.ok(screen.getByText('Loading live intelligence data...'))
  })
  test('dashboard errors leave independently queried lists available with a retry action', async () => {
    mount({ dashboardError: true })
    await screen.findByText('Dashboard stream unavailable')
    fireEvent.click(screen.getByRole('tab', { name: 'Bet List' }))
    assert.ok(await screen.findByRole('table', { name: 'Live casino bets' }))
    assert.ok(screen.getByRole('button', { name: 'Retry' }))
  })
  test('changing the time window clears old statistics while a delayed new-scope snapshot loads', async () => {
    mount({ holdWindow: 30 })
    await screen.findByRole('region', { name: 'Exposure & Payouts' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Time window' }), { target: { value: '30' } })
    await waitFor(() => assert.ok(dashboardObservers.has(30)))
    const pendingStatistics = screen.getByRole('region', { name: 'casino live statistics' })
    assert.ok(pendingStatistics.querySelector('[aria-busy="true"]'))
    assert.ok(!within(pendingStatistics).queryByText(/10,000/))
    assert.ok(screen.getByText('Loading live intelligence data...'))
    await act(async () => { dashboardObservers.get(10)?.(casinoDashboardFixture) })
    assert.ok(pendingStatistics.querySelector('[aria-busy="true"]'))
    await act(async () => { dashboardObservers.get(30)?.({ ...casinoDashboardFixture, kpis: { ...casinoDashboardFixture.kpis, wagered: 22222 } }) })
    const statistics = screen.getByRole('region', { name: 'casino live statistics' })
    assert.ok(within(statistics).getByText(/22,222/))
  })
})
