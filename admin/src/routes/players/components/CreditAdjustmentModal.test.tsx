import { afterEach, beforeEach, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable } from '@apollo/client'
import type { Player } from '@/shared/types/player'
import { CreditAdjustmentModal } from './CreditAdjustmentModal'

/* The Settle tab sends its own adjustment type. It used to send DECREASE with |settlement balance|,
   which the backend reads as "lower credit used" — the player's open exposure dropped instead of the
   settlement balance being cleared. */
vi.mock('@/shared/services/notification', () => ({ notify: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({ getCurrencySymbol: () => '₹', formatAmount: (value: number) => `INR ${value}` }),
}))
const auth = vi.hoisted(() => ({ agent: null as null | { id: string } }))
vi.mock('@/shared/core/authStore', () => ({
  useAuthStore: (selector: (state: { agent: null | { id: string }; permissions: Array<{ domain: string; actions: string[] }> }) => unknown) =>
    selector({ agent: auth.agent, permissions: [{ domain: 'players.credit', actions: ['view', 'update'] }] }),
}))

let calls: Array<{ name: string; variables: Record<string, unknown> }>
const success = vi.fn()
const close = vi.fn()

const player = {
  id: '42',
  name: 'Asha Rao',
  username: 'asha',
  playerType: 'AGENT_CREDIT',
  agentId: 'agent-7',
  creditLimit: 10000,
  creditUsed: 2000,
  creditAvailable: 7750,
  settlementBalance: -250,
  settlementBalanceSports: -300,
  settlementBalanceCasino: 50,
  settlementBalanceMatka: 0,
  wallet: { currency: 'INR' },
} as unknown as Player

function mount(p: Player = player) {
  const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(operation => new Observable(observer => {
      calls.push({ name: operation.operationName, variables: JSON.parse(JSON.stringify(operation.variables)) as Record<string, unknown> })
      queueMicrotask(() => {
        observer.next({ data: { adjustPlayerCredit: { __typename: 'AdjustPlayerCreditResult', success: true, message: 'ok', adjustment: null } } })
        observer.complete()
      })
    })),
  })
  return render(
    <ApolloProvider client={client}>
      <CreditAdjustmentModal open player={p} onClose={close} onSuccess={success} initialTab="settle" />
    </ApolloProvider>,
  )
}

beforeEach(() => { calls = []; auth.agent = null; success.mockClear(); close.mockClear() })
afterEach(cleanup)

async function settleAndReadInput() {
  fireEvent.click(screen.getByRole('button', { name: 'Settle Credit' }))
  await waitFor(() => assert.equal(success.mock.calls.length, 1))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'AdjustPlayerCredit')
  return (calls[0].variables as { input: Record<string, unknown> }).input
}

test('the owning agent settles its credit player with SETTLE and the absolute balance', async () => {
  auth.agent = { id: 'agent-7' }
  mount()
  const input = await settleAndReadInput()
  assert.deepEqual([input.adjustmentType, input.amount, input.playerId], ['SETTLE', 250, '42'])
})

test('an admin settles a whitelabel credit player with SETTLE, never DECREASE', async () => {
  mount({ ...player, playerType: 'WHITELABEL_CREDIT', agentId: null } as unknown as Player)
  const input = await settleAndReadInput()
  assert.equal(input.adjustmentType, 'SETTLE')
  assert.equal(input.amount, 250)
})
