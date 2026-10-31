import assert from 'node:assert/strict'
import { beforeEach, describe, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApolloLink, Observable, InMemoryCache } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { CLOSED_CYCLE, commissionResponse } from '../../../../test/commissionPreviewData'
import { CommissionViewBetsModal, type CommissionViewBetsParams } from './CommissionViewBetsModal'
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number, currency: string) => `${currency} ${Number(value).toFixed(2)}` }) }))
let calls: { name: string; variables: Record<string, unknown> }[]
beforeEach(() => { calls = [] })
function page(params: CommissionViewBetsParams | null = { agentId: 'sub-1', username: 'Partner', cycleFrom: CLOSED_CYCLE.from, cycleTo: CLOSED_CYCLE.to }, open = true) {
  const close = vi.fn()
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
    queueMicrotask(() => { observer.next(commissionResponse(operation)); observer.complete() })
  }))
  const view = render(<MockedProvider link={link} cache={new InMemoryCache({ typePolicies: { Query: { fields: { agents: { merge: true } } } } })}><CommissionViewBetsModal open={open} onClose={close} params={params} /></MockedProvider>)
  return { close, ...view }
}
describe('shared commission bets dialog', () => {
  test('queries only on open and preserves manual/player scope', async () => {
    const first = page(null, false); assert.equal(calls.length, 0); first.unmount()
    page({ agentId: 'sub-1', username: 'Alice', playerId: 'player-1', cycleFrom: '2026-09-28', cycleTo: '2026-10-05' })
    await screen.findByText('Page GGR')
    assert.ok(calls.some((call) => call.name === 'CommissionHistory' && call.variables.playerId === 'player-1' && call.variables.limit === 50 && call.variables.offset === 0))
    assert.equal(calls.find((call) => call.name === 'CommissionCyclesForAgent')?.variables.agentId, 'sub-1')
  })
  test('groups bets per player, computes stake/GGR and expands date-ordered rows', async () => {
    page(); await screen.findByText('Page GGR')
    assert.ok(screen.getAllByText('INR 85.00').length); assert.ok(screen.getAllByText('INR 175.00').length)
    const summary = screen.getByText('Alice').closest('summary')!
    fireEvent.click(summary)
    assert.ok(screen.getByRole('table', { name: 'Bets for Alice' }))
    assert.ok(screen.getByText('01 Oct 15:30'))
  })
  test('full detail retains all domain metadata and re-queries on domain filter', async () => {
    page(); await screen.findByText('Page GGR')
    fireEvent.click(screen.getByRole('switch', { name: 'Full detail' }))
    assert.ok(screen.getByRole('table', { name: 'Full commission bet detail' }))
    assert.ok(screen.getByText('Cricket championship')); assert.ok(screen.getByText('Roulette')); assert.ok(screen.getByText('Morning Market'))
    assert.ok(screen.getByText('×9.0')); assert.ok(screen.getByText('INR 120.00'))
    fireEvent.click(screen.getByRole('button', { name: 'Sports' }))
    await waitFor(() => assert.ok(calls.some((call) => call.name === 'CommissionHistory' && call.variables.domain === 'sports')))
    await waitFor(() => assert.equal(screen.queryByText('Roulette'), null))
  })
  test('requested active cycle resolves and close callback remains supported', async () => {
    const view = page({ agentId: 'sub-1', username: 'Partner', activeCycleKey: CLOSED_CYCLE.from })
    await screen.findByText('Page GGR')
    assert.ok(calls.some((call) => call.name === 'CommissionHistory' && call.variables.periodFrom === CLOSED_CYCLE.from && call.variables.periodTo === CLOSED_CYCLE.to))
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    assert.equal(view.close.mock.calls.length, 1)
  })
})
