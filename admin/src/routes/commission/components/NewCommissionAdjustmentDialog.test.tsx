import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { CLOSED_CYCLE, CURRENT_CYCLE, commissionResponse, type CommissionFixtureOptions } from '../../../../test/commissionPreviewData'
import { NewCommissionAdjustmentDialog, type NewCommissionAdjustmentDialogProps } from './NewCommissionAdjustmentDialog'

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/shared/services/notification', () => ({ notify: feedback }))

// Oldest first, as commissionCyclesForAgent returns them: a paid week, a week with no commission, the closed unpaid week, the open week.
const PAID = { from: '2026-09-13T18:30:00.000Z', to: '2026-09-20T18:30:00.000Z', status: 'SETTLED', paidAmount: 80, payableAmount: 0, zeroCommission: false, fromDate: '2026-09-14', toDate: '2026-09-21' }
const ZERO = { from: '2026-09-20T18:30:00.000Z', to: '2026-09-27T18:30:00.000Z', status: 'SETTLED', paidAmount: 0, payableAmount: 0, zeroCommission: true, fromDate: '2026-09-21', toDate: '2026-09-28' }
const OPEN = { ...CURRENT_CYCLE, paidAmount: 0 }

let calls: { name: string; variables: Record<string, unknown> }[]
let options: CommissionFixtureOptions
function mount(props: Partial<NewCommissionAdjustmentDialogProps> = {}) {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    queueMicrotask(() => { observer.next(commissionResponse(operation, options)); observer.complete() })
  }))
  const handlers = { onClose: vi.fn(), onSaved: vi.fn() }
  const view = render(<MockedProvider link={link} cache={new InMemoryCache()}>
    <NewCommissionAdjustmentDialog open agentId="sub-1" username="Partner" {...handlers} {...props} />
  </MockedProvider>)
  return { view, ...handlers }
}
const variables = (name: string) => calls.filter((call) => call.name === name).at(-1)?.variables
const createButton = () => screen.getByRole('button', { name: 'Create adjustment' }) as HTMLButtonElement
beforeEach(() => { calls = []; options = { cycles: [PAID, ZERO, CLOSED_CYCLE, OPEN] }; feedback.success.mockClear(); feedback.error.mockClear() })
afterEach(cleanup)

describe('NewCommissionAdjustmentDialog', () => {
  test('offers every closed week newest first with its state, never the open week', async () => {
    mount()
    const dialog = await screen.findByRole('dialog', { name: 'New adjustment — Partner' })
    const picker = await within(dialog).findByRole('combobox', { name: 'Week it corrects' }) as HTMLSelectElement
    assert.deepEqual([...picker.options].map((option) => option.textContent), [
      '28 Sep – 04 Oct 2026 · unpaid', '21 Sep – 27 Sep 2026 · no commission', '14 Sep – 20 Sep 2026 · paid',
    ])
    assert.deepEqual(variables('CommissionCyclesForAgent'), { agentId: 'sub-1' })
  })

  test('creates a deduction for the chosen week with the reason and the note in refMeta, then closes', async () => {
    const { onClose, onSaved } = mount()
    const dialog = await screen.findByRole('dialog', { name: 'New adjustment — Partner' })
    const picker = await within(dialog).findByRole('combobox', { name: 'Week it corrects' })
    assert.equal(createButton().disabled, true)
    fireEvent.change(picker, { target: { value: PAID.from } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deduct (-)' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Amount' }), { target: { value: '25.5' } })
    assert.equal(createButton().disabled, true, 'no reason chosen yet')
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Reason' }), { target: { value: 'Void' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note (optional)' }), { target: { value: ' Duplicate bet voided ' } })
    await waitFor(() => assert.equal(createButton().disabled, false))
    fireEvent.click(createButton())
    await waitFor(() => assert.deepEqual(variables('CreateCommissionAdjustment'), {
      input: { agentId: 'sub-1', amount: -25.5, sourceCycleFrom: '2026-09-14', sourceCycleTo: '2026-09-21', reason: 'Void', refMeta: '{"note":"Duplicate bet voided"}' },
    }))
    await waitFor(() => assert.equal(onClose.mock.calls.length, 1))
    assert.equal(onSaved.mock.calls.length, 1)
    assert.ok(feedback.success.mock.calls.some(([text]) => text === 'Adjustment created; apply to a cycle to affect payable'))
  })

  test('a refused adjustment keeps the dialog and the draft', async () => {
    options.adjustmentRefused = true
    const { onClose, onSaved } = mount()
    const dialog = await screen.findByRole('dialog', { name: 'New adjustment — Partner' })
    await within(dialog).findByRole('combobox', { name: 'Week it corrects' })
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Amount' }), { target: { value: '10' } })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Reason' }), { target: { value: 'Correction' } })
    await waitFor(() => assert.equal(createButton().disabled, false))
    fireEvent.click(createButton())
    await waitFor(() => assert.ok(feedback.error.mock.calls.some(([text]) => text === 'Adjustment refused')))
    assert.equal(onClose.mock.calls.length, 0)
    assert.equal(onSaved.mock.calls.length, 0)
    assert.equal((within(dialog).getByRole('combobox', { name: 'Reason' }) as HTMLSelectElement).value, 'Correction')
    assert.deepEqual(variables('CreateCommissionAdjustment'), {
      input: { agentId: 'sub-1', amount: 10, sourceCycleFrom: '2026-09-28', sourceCycleTo: '2026-10-05', reason: 'Correction' },
    })
  })

  test('with no closed week there is a notice and nothing to send; a closed dialog reads nothing', async () => {
    options.cycles = [OPEN]
    const { view } = mount()
    const dialog = await screen.findByRole('dialog', { name: 'New adjustment — Partner' })
    await within(dialog).findByText('No closed week yet')
    assert.equal(createButton().disabled, true)
    view.unmount()
    calls = []
    mount({ open: false })
    assert.equal(screen.queryByRole('dialog'), null)
    assert.deepEqual(calls, [])
  })
})
