import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { ADJUSTMENT_PENDING, CLOSED_CYCLE, CURRENT_CYCLE, commissionResponse, type CommissionFixtureOptions } from '../../../../test/commissionPreviewData'
import { ApplyCommissionAdjustmentDialog, type ApplyCommissionAdjustmentDialogProps } from './ApplyCommissionAdjustmentDialog'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `INR ${value.toFixed(2)}`, convertFromWhitelabelCurrency: (value: number) => value }) }))
vi.mock('@/shared/services/notification', () => ({ notify: feedback }))

const PAID = { from: '2026-09-13T18:30:00.000Z', to: '2026-09-20T18:30:00.000Z', status: 'SETTLED', paidAmount: 80, payableAmount: 0, zeroCommission: false, fromDate: '2026-09-14', toDate: '2026-09-21' }
const OLDER = { from: '2026-09-20T18:30:00.000Z', to: '2026-09-27T18:30:00.000Z', status: 'CLOSED_UNSETTLED', paidAmount: 0, payableAmount: 75, zeroCommission: false, fromDate: '2026-09-21', toDate: '2026-09-28' }
const OPEN = { ...CURRENT_CYCLE, paidAmount: 0 }

let calls: { name: string; variables: Record<string, unknown> }[]
let options: CommissionFixtureOptions
function mount(props: Partial<ApplyCommissionAdjustmentDialogProps> = {}) {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    queueMicrotask(() => { observer.next(commissionResponse(operation, options)); observer.complete() })
  }))
  const handlers = { onClose: vi.fn(), onSaved: vi.fn() }
  const view = render(<MockedProvider link={link} cache={new InMemoryCache()}>
    <ApplyCommissionAdjustmentDialog open agentId="sub-1" adjustment={ADJUSTMENT_PENDING} {...handlers} {...props} />
  </MockedProvider>)
  return { view, ...handlers }
}
const variables = (name: string) => calls.filter((call) => call.name === name).at(-1)?.variables
const applyButton = () => screen.getByRole('button', { name: 'Apply adjustment' }) as HTMLButtonElement
beforeEach(() => { calls = []; options = {}; feedback.success.mockClear(); feedback.error.mockClear() })
afterEach(cleanup)

describe('ApplyCommissionAdjustmentDialog', () => {
  test('offers the unpaid closed weeks and the open week, oldest first, and shows what is applied', async () => {
    options.cycles = [PAID, OLDER, CLOSED_CYCLE, OPEN]
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Apply adjustment' })
    const picker = await within(dialog).findByRole('combobox', { name: 'Apply to week' }) as HTMLSelectElement
    assert.deepEqual([...picker.options].map((option) => option.textContent), [
      '21 Sep – 27 Sep 2026 · payable INR 75.00', '28 Sep – 04 Oct 2026 · payable INR 250.25', '05 Oct – 11 Oct 2026 · current week',
    ])
    assert.ok(within(dialog).getByText('-INR 25.50 · Deduct'))
    assert.ok(within(dialog).getByText('28 Sep – 04 Oct 2026'))
    assert.ok(within(dialog).getByText('Void'))
    assert.deepEqual(variables('CommissionCyclesForAgent'), { agentId: 'sub-1' })
  })

  test("applies to the chosen week with its IST dates, then closes and reloads", async () => {
    options.cycles = [OLDER, CLOSED_CYCLE, OPEN]
    const { onClose, onSaved } = mount()
    const dialog = await screen.findByRole('dialog', { name: 'Apply adjustment' })
    fireEvent.change(await within(dialog).findByRole('combobox', { name: 'Apply to week' }), { target: { value: CLOSED_CYCLE.from } })
    fireEvent.click(applyButton())
    await waitFor(() => assert.deepEqual(variables('ApplyCommissionAdjustment'), {
      input: { adjustmentId: 'adj-pending', targetCycleFrom: '2026-09-28', targetCycleTo: '2026-10-05' },
    }))
    await waitFor(() => assert.equal(onClose.mock.calls.length, 1))
    assert.equal(onSaved.mock.calls.length, 1)
    assert.ok(feedback.success.mock.calls.some(([text]) => text === 'Adjustment applied to cycle'))
  })

  test("warns when a deduction is larger than the week's payable, and only then", async () => {
    const { view } = mount({ adjustment: { ...ADJUSTMENT_PENDING, amount: -300 } })
    const dialog = await screen.findByRole('dialog', { name: 'Apply adjustment' })
    assert.ok(await within(dialog).findByText('Deduction larger than the payable'))
    view.unmount()
    mount()
    const again = await screen.findByRole('dialog', { name: 'Apply adjustment' })
    await within(again).findByRole('combobox', { name: 'Apply to week' })
    assert.equal(within(again).queryByText('Deduction larger than the payable'), null)
  })

  test('a refused apply keeps the dialog open', async () => {
    options.adjustmentRefused = true
    const { onClose, onSaved } = mount()
    const dialog = await screen.findByRole('dialog', { name: 'Apply adjustment' })
    await within(dialog).findByRole('combobox', { name: 'Apply to week' })
    fireEvent.click(applyButton())
    await waitFor(() => assert.ok(feedback.error.mock.calls.some(([text]) => text === 'Cannot adjust an already-paid cycle')))
    assert.equal(onClose.mock.calls.length, 0)
    assert.equal(onSaved.mock.calls.length, 0)
  })

  test('with no unpaid week there is a notice and nothing to send', async () => {
    options.cycles = [PAID]
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'Apply adjustment' })
    await within(dialog).findByText('No unpaid week')
    assert.equal(applyButton().disabled, true)
  })
})
