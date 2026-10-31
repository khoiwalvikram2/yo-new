import assert from 'node:assert/strict'
import dayjs from 'dayjs'
import { beforeEach, describe, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, Observable, InMemoryCache } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { PageEyebrowProvider } from '@/shell/PageEyebrowContext'
import { CLOSED_CYCLE, commissionResponse, type CommissionFixtureOptions } from '../../../test/commissionPreviewData'
import CommissionDashboard from './CommissionDashboard'

const state = vi.hoisted(() => ({ agent: { id: 'agent-1', schemeType: 'COMMISSION' } as { id: string; schemeType: string } | undefined, success: vi.fn(), error: vi.fn() }))
vi.mock('@/shared/core/authStore', () => ({ useAuthStore: (selector: (value: { agent: typeof state.agent }) => unknown) => selector({ agent: state.agent }) }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `INR ${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value * 2 }) }))
vi.mock('@/shared/utils/date', () => ({ nowIST: () => dayjs.tz('2026-10-09T12:00:00', 'Asia/Kolkata') }))
vi.mock('@/shared/services/notification', () => ({ notify: { success: state.success, error: state.error } }))
let calls: { name: string; variables: Record<string, unknown> }[]
let options: CommissionFixtureOptions
function Location() { const location = useLocation(); return <output aria-label="Location">{location.pathname}{location.search}</output> }
function page() {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    queueMicrotask(() => { observer.next(commissionResponse(operation, options)); observer.complete() })
  }))
  return render(<MockedProvider link={link} cache={new InMemoryCache({ typePolicies: { Query: { fields: { agents: { merge: true } } } } })}><MemoryRouter initialEntries={['/commission/overview']}><PageEyebrowProvider value="Commission"><CommissionDashboard /><Location /></PageEyebrowProvider></MemoryRouter></MockedProvider>)
}
beforeEach(() => { state.agent = { id: 'agent-1', schemeType: 'COMMISSION' }; vi.clearAllMocks(); calls = []; options = {} })
async function payDialog() {
  await screen.findAllByText('Partner with a descriptive account name')
  fireEvent.click(within(screen.getByRole('tablist', { name: 'Sub-agent cycle' })).getByRole('tab', { name: /Last Week/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Pay' }))
  const dialog = await screen.findByRole('dialog', { name: /Pay commission/ })
  await within(dialog).findByText('Payable amount (fixed)')
  await waitFor(() => assert.ok(calls.some((call) => call.name === 'CommissionCycleReadiness')))
  return dialog
}
describe('commission overview', () => {
  test('retains cycle query scopes, gross/net/downline calculations and conversion', async () => {
    page(); await screen.findAllByText('Partner with a descriptive account name')
    assert.ok(screen.getByRole('heading', { name: 'Receivable' }))
    // Receivable = the backend gross after tally (40), not GGR x rate (100); Payable = the sub-agents' effective (15);
    // My Share = the backend net (25 = 40 − 15). Every figure is converted once (x2).
    const receivable = await screen.findByRole('region', { name: 'Receivable' })
    await within(receivable).findByText('INR 80.00'); assert.equal(within(receivable).queryByText('INR 200.00'), null)
    assert.ok(within(receivable).getByText('INR 60.00')); assert.ok(within(receivable).getByText('INR 30.00')); assert.ok(within(receivable).getByText('INR -10.00'))
    assert.ok(within(screen.getByRole('region', { name: 'My Share' })).getByText('INR 50.00'))
    assert.ok(within(screen.getByRole('region', { name: 'Payable' })).getByText('INR 30.00'))
    assert.deepEqual(calls.find((call) => call.name === 'CommissionSummary')?.variables, { agentId: 'agent-1', periodFrom: '2026-10-05', periodTo: '2026-10-12' })
    assert.ok(calls.some((call) => call.name === 'SubAgentCommissionSummaries' && call.variables.lastPaidBefore === '2026-09-28'))
    assert.equal(calls.some((call) => call.name === 'CommissionCycleReadiness'), false)
  })
  test('custom calendar range keeps IST start and exclusive next-day end', async () => {
    page(); await screen.findAllByText('Partner with a descriptive account name')
    fireEvent.change(screen.getByLabelText('Commission period'), { target: { value: 'custom' } })
    fireEvent.click(screen.getByRole('button', { name: /Custom commission range/ }))
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-09-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'CommissionSummary' && call.variables.periodFrom === '2026-09-01' && call.variables.periodTo === '2026-09-04')))
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    assert.equal((screen.getByLabelText('Commission period') as HTMLSelectElement).value, 'currentWeek')
  })
  test('pays the immutable readiness amount with exact cycle and notes', async () => {
    page(); const dialog = await payDialog()
    // Only the closed, unpaid week is offered (never the open one); the payout carries its IST calendar dates.
    const picker = within(dialog).getByLabelText('Unpaid cycle') as HTMLSelectElement
    assert.deepEqual([...picker.options].map((option) => option.textContent), ['28 Sep – 04 Oct 2026 · payable INR 500.50'])
    assert.ok(calls.some((call) => call.name === 'CommissionCycleReadiness' && call.variables.agentId === 'sub-1' && call.variables.cycleFrom === CLOSED_CYCLE.fromDate && call.variables.cycleTo === CLOSED_CYCLE.toDate))
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'Reviewed payout' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay this cycle' }))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'PayCommission')))
    assert.deepEqual(calls.find((call) => call.name === 'PayCommission')?.variables, { input: { agentId: 'sub-1', amount: 250.25, periodFrom: '2026-09-28', periodTo: '2026-10-05', notes: 'Reviewed payout' } })
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: /Pay commission/ }), null))
    assert.equal(state.success.mock.calls.length, 1)
  })
  test('failed payout retains the dialog and notes; not-ready cycles are inert', async () => {
    options.paySuccess = false; page(); const dialog = await payDialog()
    fireEvent.change(within(dialog).getByLabelText('Notes'), { target: { value: 'Keep this draft' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay this cycle' }))
    await waitFor(() => assert.ok(state.error.mock.calls.length))
    assert.equal((within(dialog).getByLabelText('Notes') as HTMLTextAreaElement).value, 'Keep this draft')
  })
  test('not-ready payout cannot send a mutation', async () => {
    options.ready = false; page(); const dialog = await payDialog()
    // Bets placed in the week that are still open block the payout until they settle.
    await within(dialog).findByText('2 bets placed in this week are still open. Pay after they settle, so they are included.')
    assert.equal((within(dialog).getByRole('button', { name: 'Pay this cycle' }) as HTMLButtonElement).disabled, true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay this cycle' }))
    assert.equal(calls.some((call) => call.name === 'PayCommission'), false)
  })
  test('history navigation and non-commission query skips remain', async () => {
    const view = page(); await screen.findAllByText('Partner with a descriptive account name')
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    assert.equal(screen.getByLabelText('Location').textContent, '/commission/history?tab=subAgent&subAgentId=sub-1')
    view.unmount(); calls = []; state.agent = undefined; page()
    assert.ok(screen.getByText('Commission agent account required')); assert.deepEqual(calls, [])
  })
})

describe('commission overview: loss carry-forward', () => {
  test('the Receivable card shows the loss carried from last week and this week\'s loss that carries on', async () => {
    options.carry = { carriedLoss: 30, carryApplied: 30, lossThisCycle: 5 }
    page(); await screen.findAllByText('Partner with a descriptive account name')
    const receivable = await screen.findByRole('region', { name: 'Receivable' })
    const lines = await within(receivable).findByLabelText('Loss carry-forward')
    assert.ok(within(lines).getByText('Loss carried from last week')); assert.ok(within(lines).getByText('\u2212INR 60.00'))
    assert.ok(within(lines).getByText("This week's loss (carries to next week)")); assert.ok(within(lines).getByText('\u2212INR 10.00'))
    assert.equal(within(lines).queryByText('Not recovered (forgiven)'), null)
  })
  test('no carry figures, no carry lines', async () => {
    page(); await screen.findAllByText('Partner with a descriptive account name')
    const receivable = await screen.findByRole('region', { name: 'Receivable' })
    await within(receivable).findByText('INR 80.00')
    assert.equal(within(receivable).queryByLabelText('Loss carry-forward'), null)
  })
})
