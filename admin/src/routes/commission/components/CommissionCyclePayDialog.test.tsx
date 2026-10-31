import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { CLOSED_CYCLE, CURRENT_CYCLE, commissionResponse, type CommissionFixtureOptions } from '../../../../test/commissionPreviewData'
import { CommissionCyclePayDialog, type CommissionCyclePayDialogProps } from './CommissionCyclePayDialog'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `INR ${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value * 2 }) }))
vi.mock('@/shared/services/notification', () => ({ notify: feedback }))

// An older closed week with a part payment and an adjustment, and a week that closed with no commission (SETTLED).
const OLDER = { from: '2026-09-20T18:30:00.000Z', to: '2026-09-27T18:30:00.000Z', status: 'CLOSED_UNSETTLED', paidAmount: 50, payableAmount: 75, adjustmentAmount: -10, zeroCommission: false, fromDate: '2026-09-21', toDate: '2026-09-28' }
const ZERO = { from: '2026-09-13T18:30:00.000Z', to: '2026-09-20T18:30:00.000Z', status: 'SETTLED', paidAmount: 0, payableAmount: 0, zeroCommission: true, fromDate: '2026-09-14', toDate: '2026-09-21' }
const OPEN = { ...CURRENT_CYCLE, paidAmount: 0 }

let calls: { name: string; variables: Record<string, unknown> }[]
let options: CommissionFixtureOptions
function mount(props: Partial<CommissionCyclePayDialogProps> = {}) {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    queueMicrotask(() => { observer.next(commissionResponse(operation, options)); observer.complete() })
  }))
  const handlers = { onClose: vi.fn(), onPaid: vi.fn(), onViewBets: vi.fn() }
  const view = render(<MemoryRouter><MockedProvider link={link} cache={new InMemoryCache({ typePolicies: { Query: { fields: { agents: { merge: true } } } } })}>
    <CommissionCyclePayDialog open agentId="sub-1" username="Partner" {...handlers} {...props} />
  </MockedProvider></MemoryRouter>)
  return { view, ...handlers }
}
const variables = (name: string) => calls.filter((call) => call.name === name).at(-1)?.variables
const payButton = () => screen.getByRole('button', { name: 'Pay this cycle' }) as HTMLButtonElement
beforeEach(() => { calls = []; options = {}; feedback.success.mockClear(); feedback.error.mockClear() })
afterEach(cleanup)

describe('CommissionCyclePayDialog', () => {
  test('offers only closed unpaid weeks and reads readiness, the payee gross and the bet count for the chosen week\'s IST dates', async () => {
    options.cycles = [OLDER, CLOSED_CYCLE, OPEN, ZERO]; mount()
    const dialog = await screen.findByRole('dialog', { name: 'Pay commission — Partner' })
    const picker = await within(dialog).findByRole('combobox', { name: 'Unpaid cycle' }) as HTMLSelectElement
    // The open week and the zero-commission (settled) week are never payable.
    assert.deepEqual([...picker.options].map((option) => option.textContent), ['21 Sep – 27 Sep 2026 · payable INR 150.00', '28 Sep – 04 Oct 2026 · payable INR 500.50'])
    assert.ok(within(dialog).getByText(/Weeks with no commission count as settled \(1\)\./))
    assert.deepEqual(variables('CommissionCyclesForAgent'), { agentId: 'sub-1' })
    await waitFor(() => assert.deepEqual(variables('CommissionCycleReadiness'), { agentId: 'sub-1', cycleFrom: '2026-09-21', cycleTo: '2026-09-28' }))
    assert.deepEqual(variables('CommissionSummary'), { agentId: 'sub-1', periodFrom: '2026-09-21', periodTo: '2026-09-28' })
    assert.deepEqual(variables('CommissionHistory'), { agentId: 'sub-1', periodFrom: '2026-09-21', periodTo: '2026-09-28', limit: 1, offset: 0 })
    // The payee's GROSS per domain (what its payer owes it), before and after tally, with the rate; all converted once.
    const domains = within(dialog).getByRole('region', { name: 'Commission by domain' })
    await within(domains).findByText('Commission INR 60.00 (10.00%)'); assert.ok(within(domains).getByText('Commission INR 30.00 (5.00%)')); assert.ok(within(domains).getByText('Commission INR -10.00 (20.00%)'))
    assert.ok(within(domains).getByText('GGR INR 2000.00')); assert.equal(within(domains).getAllByText('After tally INR 60.00').length, 1)
    assert.ok(await within(dialog).findByText('3 settled bets in this cycle · Tally ON: Sports, Casino'))
    assert.ok(within(dialog).getByText('INR 80.00')); assert.ok(within(dialog).getByText('INR -20.00')); assert.ok(within(dialog).getByText('INR 100.00'))
    assert.ok(await within(dialog).findByText('INR 500.50'))
    // Choosing the other week moves readiness and the payout to its dates.
    fireEvent.change(picker, { target: { value: CLOSED_CYCLE.from } })
    await waitFor(() => assert.deepEqual(variables('CommissionCycleReadiness'), { agentId: 'sub-1', cycleFrom: '2026-09-28', cycleTo: '2026-10-05' }))
  })
  test('pays exactly the readiness amount for the chosen week, then closes and reports the payout', async () => {
    const { onClose, onPaid } = mount()
    await waitFor(() => assert.equal(payButton().disabled, false))
    fireEvent.click(payButton())
    await waitFor(() => assert.deepEqual(variables('PayCommission'), { input: { agentId: 'sub-1', amount: 250.25, periodFrom: '2026-09-28', periodTo: '2026-10-05', notes: 'Commission payout (full cycle IST)' } }))
    await waitFor(() => assert.equal(onClose.mock.calls.length, 1)); assert.equal(onPaid.mock.calls.length, 1)
    assert.ok(feedback.success.mock.calls.some(([text]) => text === 'Commission paid successfully'))
  })
  test('open bets block the payout with a readable reason; a ledger gap only informs', async () => {
    options.ready = false; const { view } = mount()
    const dialog = await screen.findByRole('dialog', { name: 'Pay commission — Partner' })
    await within(dialog).findByText('Cannot pay this cycle yet'); assert.ok(within(dialog).getByText('2 bets placed in this week are still open. Pay after they settle, so they are included.'))
    assert.equal(payButton().disabled, true); fireEvent.click(payButton()); assert.equal(calls.some((call) => call.name === 'PayCommission'), false)
    view.unmount(); calls = []; options = {}; mount()
    await screen.findByText('Ledger gap'); await waitFor(() => assert.equal(payButton().disabled, false)); assert.equal(screen.queryByText('Cannot pay this cycle yet'), null)
  })
  test('nothing to pay when every closed week is paid or had no commission, and no readiness is read', async () => {
    options.cycles = [ZERO, OPEN]; mount()
    const dialog = await screen.findByRole('dialog', { name: 'Pay commission — Partner' })
    await within(dialog).findByText('Nothing to pay'); assert.ok(within(dialog).getByText(/1 week counted as settled/))
    assert.equal(payButton().disabled, true)
    assert.deepEqual(calls.map((call) => call.name), ['CommissionCyclesForAgent'])
  })
  test('a refused payout keeps the dialog, the target and the notes; Cancel closes without paying', async () => {
    options.paySuccess = false; const { onClose, onPaid } = mount()
    await waitFor(() => assert.equal(payButton().disabled, false))
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'Keep this draft' } }); fireEvent.click(payButton())
    await waitFor(() => assert.ok(feedback.error.mock.calls.some(([text]) => text === 'Payment refused')))
    assert.equal(onClose.mock.calls.length, 0); assert.equal(onPaid.mock.calls.length, 0)
    assert.equal((screen.getByRole('textbox', { name: 'Notes' }) as HTMLTextAreaElement).value, 'Keep this draft')
    assert.deepEqual((variables('PayCommission') as { input: { notes: string } }).input.notes, 'Keep this draft')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); assert.equal(onClose.mock.calls.length, 1)
  })
  test("a pending adjustment blocks the payout and links to the agent's Adjustments card", async () => {
    options.unresolvedAdjustments = 2; const { onClose } = mount()
    const dialog = await screen.findByRole('dialog', { name: 'Pay commission — Partner' })
    await within(dialog).findByText('Cannot pay this cycle yet')
    assert.ok(within(dialog).getByText('2 adjustments raised against this week are still pending.'))
    const link = within(dialog).getByRole('link', { name: 'Review adjustments' })
    assert.equal(link.getAttribute('href'), '/agents/sub-1?tab=commission#commission-adjustments')
    assert.equal(payButton().disabled, true)
    fireEvent.click(link); assert.equal(onClose.mock.calls.length, 1)
  })
  test('other blocking reasons get no adjustments link', async () => {
    options.ready = false; mount()
    const dialog = await screen.findByRole('dialog', { name: 'Pay commission — Partner' })
    await within(dialog).findByText('Cannot pay this cycle yet')
    assert.equal(within(dialog).queryByRole('link', { name: 'Review adjustments' }), null)
  })
  test('a closed dialog reads nothing; View Bets hands over the chosen week', async () => {
    const closed = mount({ open: false }); assert.equal(screen.queryByRole('dialog'), null); assert.deepEqual(calls, [])
    closed.view.unmount()
    const { onViewBets } = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'View Bets' }))
    assert.deepEqual(onViewBets.mock.calls[0], [{ from: CLOSED_CYCLE.from, to: CLOSED_CYCLE.to, periodFrom: '2026-09-28', periodTo: '2026-10-05' }])
  })
})

describe('CommissionCyclePayDialog: loss carry-forward', () => {
  test('last week\'s loss comes off the gross as one line before the fixed payable', async () => {
    options.carry = { carriedLoss: 30, carryApplied: 20, lossThisCycle: 5 }; mount()
    const dialog = await screen.findByRole('dialog', { name: 'Pay commission — Partner' })
    const lines = await within(dialog).findByLabelText('Loss carry-forward')
    // "Commission after tally" is before the carry: 40 + 20 = 60, converted x2.
    assert.ok(within(dialog).getByText('INR 120.00'))
    assert.ok(within(lines).getByText('Loss carried from last week')); assert.ok(within(lines).getByText('\u2212INR 60.00'))
    assert.ok(within(lines).getByText('Not recovered (forgiven)')); assert.ok(within(lines).getByText('INR 20.00'))
    assert.ok(within(lines).getByText("This week's loss (carries to next week)")); assert.ok(within(lines).getByText('\u2212INR 10.00'))
  })
  test('open bets of the week before block the payout: that week\'s loss carries into this one', async () => {
    options.ready = false; options.openBets = 0; options.previousCycleOpenBets = 3; mount()
    const dialog = await screen.findByRole('dialog', { name: 'Pay commission — Partner' })
    await within(dialog).findByText('Cannot pay this cycle yet')
    assert.ok(within(dialog).getByText("3 bets placed in the week before are still open. That week's loss carries into this one, so pay after they settle."))
    assert.equal(payButton().disabled, true)
  })
  test('without carry figures nothing extra is shown', async () => {
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Pay commission — Partner' })
    await within(dialog).findByText('INR 500.50')
    assert.equal(within(dialog).queryByLabelText('Loss carry-forward'), null)
  })
})
