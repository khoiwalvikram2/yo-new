import { afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettlementModal } from './SettlementModal'
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ getCurrencySymbol: () => '₹' }) }))
const errors = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/shared/services/notification', () => ({ notify: errors }))
afterEach(() => { cleanup(); errors.error.mockClear() })
const formatCurrency = (amount: number) => `INR ${amount}`
// Settlement engine sign: a positive SHARING pending is TO_AGENT (players lost, you pay the agent its share).
test('Sharing partial settlement reviews notes/amount and only submits after explicit confirmation', async () => {
  const submit = vi.fn(async () => undefined)
  render(<SettlementModal visible agent={{ pendingAmount: 4000, agent: { username: 'Partner', schemeType: 'SHARING' } }} onCancel={() => {}} onSubmit={submit} formatCurrency={formatCurrency} />)
  assert.ok(screen.getByText('Pay TO Agent (You pay agent)')); assert.ok(screen.getByText('You owe agent'))
  fireEvent.click(screen.getByRole('button', { name: 'Review Details' })); await screen.findByText('Please enter notes for audit trail'); assert.equal(submit.mock.calls.length, 0)
  fireEvent.change(screen.getByRole('textbox', { name: 'Settlement Amount' }), { target: { value: '1000' } }); fireEvent.change(screen.getByRole('textbox', { name: /Notes/ }), { target: { value: '  Weekly settlement  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Review Details' })); assert.ok(screen.getByRole('dialog', { name: 'Confirm Settlement' })); assert.ok(screen.getByText('INR 4000 (You owe agent)')); assert.ok(screen.getByText('INR 3000 (You still owe agent)')); assert.equal(submit.mock.calls.length, 0)
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Settlement' })); await waitFor(() => assert.deepEqual(submit.mock.calls[0], [{ amount: 1000, direction: 'TO_AGENT', notes: '  Weekly settlement  ' }]))
})
test('negative Sharing balance derives collect-from-agent direction and Full Amount restores absolute balance', async () => {
  const submit = vi.fn(async () => undefined)
  render(<SettlementModal visible agent={{ pendingAmount: -4000, schemeType: 'SHARING', username: 'Partner' }} onCancel={() => {}} onSubmit={submit} formatCurrency={formatCurrency} />)
  assert.ok(screen.getByText('Collect FROM Agent (Agent pays you)')); assert.ok(screen.getByText('Agent owes you'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Settlement Amount' }), { target: { value: '500' } }); fireEvent.click(screen.getByRole('button', { name: 'Full Amount' }))
  fireEvent.change(screen.getByRole('textbox', { name: /Notes/ }), { target: { value: 'Complete payout' } }); fireEvent.click(screen.getByRole('button', { name: 'Review Details' })); assert.ok(screen.getByText('INR 0 (Settled)')); fireEvent.click(screen.getByRole('button', { name: 'Confirm Settlement' }))
  await waitFor(() => assert.deepEqual(submit.mock.calls[0], [{ amount: 4000, direction: 'FROM_AGENT', notes: 'Complete payout' }]))
})
test('the backend settlementDirection wins over the sign of the pending amount', async () => {
  const submit = vi.fn(async () => undefined)
  render(<SettlementModal visible agent={{ pendingAmount: 4000, settlementDirection: 'FROM_AGENT', schemeType: 'SHARING', username: 'Partner' }} onCancel={() => {}} onSubmit={submit} formatCurrency={formatCurrency} />)
  assert.ok(screen.getByText('Collect FROM Agent (Agent pays you)'))
  fireEvent.change(screen.getByRole('textbox', { name: /Notes/ }), { target: { value: 'Collect share' } }); fireEvent.click(screen.getByRole('button', { name: 'Review Details' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm Settlement' }))
  await waitFor(() => assert.deepEqual(submit.mock.calls[0], [{ amount: 4000, direction: 'FROM_AGENT', notes: 'Collect share' }]))
})
test('the direction is never picked by hand and the amount stays editable: the fixed-amount CREDIT settle is gone', async () => {
  // Since 2026-11-02 a CREDIT agent settles by moving chips (D / W of its Ref P/L); only SHARING settles here.
  const submit = vi.fn(async () => undefined)
  render(<SettlementModal visible agent={{ pendingAmount: 4000, agent: { username: 'Partner' } }} onCancel={() => {}} onSubmit={submit} formatCurrency={formatCurrency} />)
  assert.equal(screen.queryByRole('radio'), null); assert.equal((screen.getByRole('textbox', { name: 'Settlement Amount' }) as HTMLInputElement).disabled, false)
  assert.equal(screen.queryByText(/Amount is fixed/), null); assert.ok(screen.getByText('Pay TO Agent (You pay agent)'))
  fireEvent.change(screen.getByRole('textbox', { name: /Notes/ }), { target: { value: 'Pay share' } }); fireEvent.click(screen.getByRole('button', { name: 'Review Details' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm Settlement' }))
  await waitFor(() => assert.deepEqual(submit.mock.calls[0], [{ amount: 4000, direction: 'TO_AGENT', notes: 'Pay share' }]))
})
test('domain breakdown preserves signed amounts/percentages/cuts and refresh callback', async () => {
  const refresh = vi.fn(async () => undefined)
  render(<SettlementModal visible agent={{ pendingAmount: 4000, schemeType: 'SHARING', settlementBreakdownByDomain: [{ domain: 'sports', amount: -2000, percentage: 50, cutAmount: 600, cutPercentage: 30, agentShare: 1400 }, { domain: 'casino', amount: 500, percentage: 50, cutAmount: 150, cutPercentage: 30, agentShare: -350 }] }} onCancel={() => {}} onSubmit={async () => {}} onRefresh={refresh} formatCurrency={formatCurrency} />)
  // amount = the players' P/L (players lost 2000), agentShare positive = the agent earns, cutAmount = the platform's part.
  assert.ok(screen.getByText('-INR 2000')); assert.equal(screen.getAllByText("Players' P/L · 50% of total").length, 2); assert.ok(screen.getByText('Platform cut INR 600 (30%)'))
  assert.ok(screen.getByText('Agent share +INR 1400')); assert.ok(screen.getByText('+INR 500')); assert.ok(screen.getByText('Agent share -INR 350'))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh amount' })); await waitFor(() => assert.equal(refresh.mock.calls.length, 1))
})
test('failed confirmation keeps review state and Go Back restores amount and notes', async () => {
  render(<SettlementModal visible agent={{ pendingAmount: 4000, schemeType: 'SHARING' }} onCancel={() => {}} onSubmit={async () => { throw new Error('Settlement refused') }} formatCurrency={formatCurrency} />)
  fireEvent.change(screen.getByRole('textbox', { name: /Notes/ }), { target: { value: 'Keep draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Review Details' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm Settlement' }))
  await waitFor(() => assert.ok(errors.error.mock.calls.some(([text]) => text === 'Settlement refused'))); assert.ok(screen.getByRole('dialog', { name: 'Confirm Settlement' }))
  fireEvent.click(screen.getByRole('button', { name: 'Go Back' })); assert.equal((screen.getByRole('textbox', { name: /Notes/ }) as HTMLTextAreaElement).value, 'Keep draft')
})
test('missing balance renders nothing and Cancel calls existing caller without committing', () => {
  const close = vi.fn()
  const view = render(<SettlementModal visible agent={{}} onCancel={close} onSubmit={async () => {}} formatCurrency={formatCurrency} />); assert.equal(screen.queryByRole('dialog'), null)
  view.rerender(<SettlementModal visible agent={{ pendingAmount: 4000, schemeType: 'SHARING' }} onCancel={close} onSubmit={async () => {}} formatCurrency={formatCurrency} />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); assert.equal(close.mock.calls.length, 1)
})
