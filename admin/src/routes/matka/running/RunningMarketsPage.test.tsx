import { beforeEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@/shared/core/authStore'
import RunningMarketsPage, { type RunningMarket } from './RunningMarketsPage'
vi.mock('@/shared/core/uiStore', () => ({ useUIStore: (select: (state: unknown) => unknown) => select({ directorMode: 'whitelabel', selectedWhitelabelId: 'qa', tenant: 'qa' }) }))
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number, currency: string) => `${currency} ${value.toFixed(2)}` }) }))
let calls: Array<{ name: string; variables: Record<string, unknown> }>, phase: number, failure: string, empty: boolean, kind: string
const marketId = '11111111-1111-4111-8111-111111111111', date = '2026-10-23'
function rows(): RunningMarket[] {
  if (empty || phase >= 2) return []
  const base = { matkaId: marketId, marketName: 'Kalyan QA', code: 'qa', matkaType: kind, date, timezone: 'Asia/Kolkata', resultAt: '2026-10-23T12:00:00Z', betCount: 1, playerCount: 1, totalStake: 10, potentialPayout: 90, currency: 'INR', resultValue: null, openResultValue: phase ? '267' : null, canDeclare: true }
  if (kind !== 'worli') { const session = kind === 'starline' ? 'open' : 'close'; return [{ ...base, id: session, session, declareSession: session, resultStatus: 'RESULT_PENDING' }] }
  return [...(!phase ? [{ ...base, id: 'open', session: 'open' as const, declareSession: 'open' as const, resultStatus: 'RESULT_PENDING' }] : []), { ...base, id: 'close', session: 'close' as const, declareSession: phase ? 'close' as const : 'open' as const, resultStatus: phase ? 'RESULT_PENDING' : 'OPEN_RESULT_REQUIRED' }]
}
function page() {
  const link = new ApolloLink(operation => new Observable(observer => {
    calls.push({ name: operation.operationName, variables: operation.variables })
    queueMicrotask(() => {
      let data: Record<string, unknown>
      switch (operation.operationName) {
        case 'MatkaRunningMarkets': { const items = rows(); data = { matkaRunningMarkets: { items, total: items.length, openBetCount: items.length, pendingResultCount: items.length } }; break }
        case 'MatkaRunningBets': data = { matkaRunningBets: { total: 1, items: [{ id: 'bet-qa', userId: '1', playerName: 'QA Player', bidType: 'SINGLE', selection: '5', amount: 10, payoutMultiplier: 9, potentialPayout: 90, currency: 'INR', status: 'active', walletType: 'cash', createdAt: '2026-10-23T00:00:00Z' }] } }; break
        case 'MatkaResultExists': data = { matkaResultExists: !!phase }; break
        case 'CreateMatkaResult': {
          if (failure) { data = { createMatkaResult: { success: false, message: failure, result: null, impact: null } }; break }
          phase++
          data = { createMatkaResult: { success: true, message: 'Settled', result: { id: 'result-' + phase, ...operation.variables.input, declaredBy: 'qa', declaredByName: null, declaredAt: '2026-10-25T00:00:00Z', createdAt: '2026-10-25T00:00:00Z' }, impact: { betsSettled: 1, winners: 1, totalPayout: 90 } } }; break
        }
        case 'MatkaResults': data = { matkaResults: { items: [], total: 0 } }; break
        default: observer.error(new Error('Unexpected operation: ' + operation.operationName)); return
      }
      observer.next({ data }); observer.complete()
    })
  }))
  return render(<MockedProvider link={link}><MemoryRouter><RunningMarketsPage /></MemoryRouter></MockedProvider>)
}
beforeEach(() => {
  calls = []; phase = 0; failure = ''; empty = false; kind = 'worli'
  useAuthStore.setState({ agent: undefined, user: { id: 'admin', name: 'QA' }, roles: [], permissions: [{ domain: 'matka.results', actions: ['view','create'] }] })
})
test('all unresolved dates are loaded; exact player entries are available from View bets', async () => {
  page(); const table = await screen.findByRole('table', { name: 'Matka running markets' })
  assert.ok(within(table).getAllByText(/2026-10-23/).length)
  assert.deepEqual(calls.find(call => call.name === 'MatkaRunningMarkets')?.variables.filters, { page: 1, limit: 20 })
  fireEvent.click(within(table).getAllByRole('button', { name: 'View bets' })[0])
  const bets = await screen.findByRole('table', { name: 'Open Matka bets' }); await within(bets).findByText('QA Player')
  assert.deepEqual(calls.find(call => call.name === 'MatkaRunningBets')?.variables.filters, { matkaId: marketId, date, session: 'open', page: 1, limit: 20 })
})
test('Open prerequisite and then Close declare the exact original market/date, and settled rows leave the queue', async () => {
  page(); fireEvent.click(await screen.findByRole('button', { name: 'Declare Open first' }))
  const drawer = await screen.findByRole('dialog', { name: 'Declare Matka Result' })
  assert.equal((within(drawer).getByLabelText(/^Date/) as HTMLInputElement).value, date)
  assert.equal((within(drawer).getByRole('combobox', { name: /^Market/ }) as HTMLInputElement).disabled, true)
  assert.equal((within(drawer).getByRole('combobox', { name: /^Type/ }) as HTMLSelectElement).value, 'open')
  fireEvent.change(within(drawer).getByRole('textbox', { name: /^Result/ }), { target: { value: '267' } })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Declare Result' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Declare Close' }))
  const close = await screen.findByRole('dialog', { name: 'Declare Matka Result' })
  await waitFor(() => assert.equal((within(close).getByRole('textbox', { name: /^Result/ }) as HTMLInputElement).disabled, false))
  fireEvent.change(within(close).getByRole('textbox', { name: /^Result/ }), { target: { value: '279' } }); fireEvent.click(within(close).getByRole('button', { name: 'Declare Result' }))
  await screen.findByText('No open Matka bets')
  assert.deepEqual(calls.filter(call => call.name === 'CreateMatkaResult').map(call => call.variables.input), [{ matkaId: marketId, date, type: 'open', result: '267' }, { matkaId: marketId, date, type: 'close', result: '279' }])
  assert.equal(calls.some(call => call.name === 'Matkas'), false)
})
for (const type of ['starline','jackpot','sattaMatka']) test(`${type} preserves its result session and digit count without requiring a Worli Open result`, async () => {
  kind = type; page(); fireEvent.click(await screen.findByRole('button', { name: type === 'starline' ? 'Declare Open' : 'Declare Close' }))
  const drawer = await screen.findByRole('dialog', { name: 'Declare Matka Result' }), value = type === 'starline' ? '267' : '05'
  fireEvent.change(within(drawer).getByRole('textbox', { name: /^Result/ }), { target: { value } }); fireEvent.click(within(drawer).getByRole('button', { name: 'Declare Result' }))
  await waitFor(() => assert.ok(calls.some(call => call.name === 'CreateMatkaResult')))
  assert.deepEqual(calls.find(call => call.name === 'CreateMatkaResult')?.variables.input, { matkaId: marketId, date, type: type === 'starline' ? 'open' : 'close', result: value })
})
test('a refused result retains the preset and request key so it can be safely retried', async () => {
  kind = 'starline'; failure = 'Result request refused'; page(); fireEvent.click(await screen.findByRole('button', { name: 'Declare Open' }))
  const drawer = await screen.findByRole('dialog', { name: 'Declare Matka Result' })
  fireEvent.change(within(drawer).getByRole('textbox', { name: /^Result/ }), { target: { value: '267' } }); fireEvent.click(within(drawer).getByRole('button', { name: 'Declare Result' }))
  await within(drawer).findByText(failure); failure = ''; fireEvent.click(within(drawer).getByRole('button', { name: 'Declare Result' }))
  await waitFor(() => assert.equal(calls.filter(call => call.name === 'CreateMatkaResult').length, 2))
  const sends = calls.filter(call => call.name === 'CreateMatkaResult'); assert.equal(sends[0].variables.idempotencyKey, sends[1].variables.idempotencyKey)
})
test('viewers can inspect bets but cannot declare results; denied users issue no queries', async () => {
  useAuthStore.setState({ permissions: [{ domain: 'matka.results', actions: ['view'] }] }); const view = page()
  await screen.findByRole('table', { name: 'Matka running markets' }); assert.equal(screen.queryByRole('button', { name: /Declare/ }), null)
  view.unmount(); calls = []; useAuthStore.setState({ permissions: [] }); page(); screen.getByText('Access denied'); assert.equal(calls.length, 0)
})
