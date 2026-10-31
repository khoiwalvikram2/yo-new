import { beforeEach, afterEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import { AgentCreditAdjustmentModal } from './AgentCreditAdjustmentModal'
import { agentsSearchResponse } from '../../../../../test/agentsSearchPreviewData'
const feedback = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('@/ui/components/toast', () => ({ toast: feedback.toast }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number) => `INR ${value}` }) }))
let calls: Array<{ name: string; variables: Record<string, unknown> }>, refused: boolean
const success = vi.fn(), close = vi.fn()
const agent = { id: 'root1', schemeType: 'CREDIT', creditLimit: 10000, creditUsed: 3000, creditAvailable: 7000 }
function mount(initialTab: 'limit' | 'adjust' = 'limit', scheme = 'CREDIT') {
  const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink(operation => new Observable(observer => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    queueMicrotask(() => { observer.next(agentsSearchResponse(operation, { refused })); observer.complete() })
  })) })
  return render(<ApolloProvider client={client}><AgentCreditAdjustmentModal open agent={{ ...agent, schemeType: scheme }} onClose={close} onSuccess={success} initialTab={initialTab} /></ApolloProvider>)
}
beforeEach(() => { calls = []; refused = false; success.mockClear(); close.mockClear(); feedback.toast.mockClear() })
afterEach(cleanup)
test('limit adjustment preserves minimum used bound, exact input and intentionally omits optional reason', async () => {
  mount(); const field = screen.getByRole('textbox', { name: 'New Credit Limit' })
  fireEvent.change(field, { target: { value: '2000' } }); assert.ok((screen.getByRole('button', { name: 'Update Limit' }) as HTMLButtonElement).disabled)
  fireEvent.change(field, { target: { value: '12000' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Optional reason' } })
  fireEvent.click(screen.getByRole('button', { name: 'Update Limit' }))
  await waitFor(() => assert.equal(success.mock.calls.length, 1))
  assert.deepEqual(calls[0], { name: 'AdjustSubAgentCredit', variables: { agentId: 'root1', creditLimit: 12000 } }); assert.equal(close.mock.calls.length, 1)
})
test('increasing credit used cannot exceed available and submits trimmed optional notes and INCREASE', async () => {
  mount('adjust'); const field = screen.getByRole('textbox', { name: 'Amount' })
  fireEvent.change(field, { target: { value: '8000' } }); assert.ok((screen.getByRole('button', { name: 'Add Credit' }) as HTMLButtonElement).disabled)
  fireEvent.change(field, { target: { value: '500' } }); fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: '  Transfer  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add Credit' })); await waitFor(() => assert.equal(success.mock.calls.length, 1))
  assert.deepEqual(calls[0], { name: 'AdjustAgentCredit', variables: { input: { agentId: 'root1', adjustmentType: 'INCREASE', amount: 500, notes: 'Transfer' } } })
})
test('decreasing credit cannot exceed used credit and preserves DECREASE payload', async () => {
  mount('adjust'); fireEvent.change(screen.getByRole('combobox', { name: 'Adjustment Type' }), { target: { value: 'DECREASE' } })
  const field = screen.getByRole('textbox', { name: 'Amount' })
  fireEvent.change(field, { target: { value: '4000' } }); assert.ok((screen.getByRole('button', { name: 'Remove Credit' }) as HTMLButtonElement).disabled)
  fireEvent.change(field, { target: { value: '1000' } }); fireEvent.click(screen.getByRole('button', { name: 'Remove Credit' }))
  await waitFor(() => assert.equal(success.mock.calls.length, 1))
  assert.deepEqual(calls[0].variables, { input: { agentId: 'root1', adjustmentType: 'DECREASE', amount: 1000, notes: '' } })
})
test('tab switches reset amount/reason and previews keep current currency and correct post-adjustment arithmetic', () => {
  mount(); assert.ok(screen.getByText(/Limit: INR 10000/))
  fireEvent.click(screen.getByRole('tab', { name: 'Add/Remove Credit' })); assert.equal((screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement).value, '')
  fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '500' } })
  assert.ok(screen.getByText('INR 3500')); assert.ok(screen.getByText('INR 6500'))
  fireEvent.click(screen.getByRole('tab', { name: 'Adjust Limit' })); assert.equal((screen.getByRole('textbox', { name: 'New Credit Limit' }) as HTMLInputElement).value, '10,000')
})
test('server refusals retain form and never trigger success or close', async () => {
  refused = true; mount()
  fireEvent.click(screen.getByRole('button', { name: 'Update Limit' }))
  await waitFor(() => assert.ok(feedback.toast.mock.calls.some(([value]) => value.message === 'Credit update refused')))
  assert.equal(success.mock.calls.length, 0); assert.equal(close.mock.calls.length, 0); assert.ok(screen.getByRole('dialog'))
})
test('non-credit agent cannot mutate credit even if a compatible caller opens this dialog', async () => {
  mount('limit', 'SHARING'); fireEvent.click(screen.getByRole('button', { name: 'Update Limit' }))
  await waitFor(() => assert.ok(feedback.toast.mock.calls.some(([value]) => value.message === 'Credit adjustments are only available for CREDIT agents')))
  assert.equal(calls.length, 0)
})
