/**
 * /credit is the admin's Chips page (spec 2026-11-02 §8): the whitelabel pool's figures, the root accounts it
 * feeds (with D / W / CR for the admin) and the pool's own statement. This mounts the page against a mock
 * GraphQL server that answers by operation name and records every call, and reads what an admin sees.
 */
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ApolloClient, ApolloLink, ApolloProvider, InMemoryCache, Observable, type FetchResult, type NormalizedCacheObject } from '@apollo/client'
import { useAuthStore } from '@/shared/core/authStore'
import { chipAccountFixture, chipPoolFixture, chipTotalsFixture } from '@/modules/chips/chipTestKit'
import CreditManagementPage from './CreditManagementPage'

const guard = vi.hoisted(() => ({ allowed: true, calls: [] as unknown[] }))

vi.mock('@/ui/components/toast', () => ({ toast: vi.fn() }))
vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency = 'INR') => `${currency} ${Number(amount).toFixed(2)}`,
    getCurrencySymbol: () => '₹',
  }),
}))
vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({ formatDateTime: (value: string) => `shown:${value}`, formatDate: (value: string) => value }),
}))
vi.mock('@/shared/core/RBACGuard', () => ({
  RBACGuard: ({ required, children }: { required: unknown; children: ReactNode }) => {
    guard.calls.push(required)
    return guard.allowed ? <>{children}</> : <div role="alert">Access denied</div>
  },
}))

type Handler = (variables: Record<string, unknown>) => unknown
let calls: Array<{ name: string; variables: Record<string, unknown> }>
let handlers: Record<string, Handler>
const clients: ApolloClient<NormalizedCacheObject>[] = []

const ROOT_AGENT = chipAccountFixture({ id: 'root-agent', username: 'root1', parentAgentId: null, creditReference: 100000, balance: 95000, available: 95000, refPnl: -5000, downlineCount: 3 })
const WL_PLAYER = chipAccountFixture({ accountType: 'PLAYER', id: '41', username: 'wlplayer', parentAgentId: null, playerType: 'WHITELABEL_CREDIT', creditReference: 2000, balance: 2500, exposure: 300, available: 2200, refPnl: 500 })
const POOL = chipPoolFixture({ creditLimit: 1000000, used: 97500, available: 902500 })

function poolRow(id: string, transactionType: string, amount: number, balanceBefore: number, balanceAfter: number, extra: Record<string, unknown> = {}) {
  return {
    __typename: 'WhitelabelCreditTransaction', id, transactionType, amount, balanceBefore, balanceAfter,
    reason: null, createdBy: 'admin1', createdByType: 'admin', createdAt: '2026-11-02T10:00:00.000Z',
    playerId: null, playerName: null, playerEmail: null, playerUsername: null, playerPhone: null, ...extra,
  }
}

const agents = (payload: Record<string, unknown>) => ({ agents: { __typename: 'AgentsQuery', ...payload } })

function defaultHandlers(): Record<string, Handler> {
  return {
    ChipPool: () => agents({ chipPool: POOL }),
    ChipDownline: () => agents({
      chipDownline: {
        __typename: 'ChipDownline', parent: null, pool: POOL, items: [ROOT_AGENT, WL_PLAYER], total: 2,
        totals: chipTotalsFixture({ creditReference: 102000, balance: 97500, exposure: 300, available: 97200, refPnl: -4500 }),
      },
    }),
    MyWhitelabelCreditHistory: (variables) => {
      const rows = [
        poolRow('t1', 'USAGE', 5000, 907500, 902500, { reason: 'Chips to agent root1' }),
        poolRow('t2', 'RELEASE', 1000, 901500, 902500, { reason: 'Chips from player wlplayer', playerId: 41, playerUsername: 'wlplayer' }),
        poolRow('t3', 'ALLOCATION', 1000000, 0, 1000000, { reason: 'Credit allocation by Super Admin', createdBy: null }),
      ]
      // A full first page and its lookahead row, so Next is offered.
      const filler = Array.from({ length: 18 }, (_, index) => poolRow(`f${index}`, 'USAGE', 10, 1000, 990))
      return { myWhitelabelCreditHistory: variables.offset === 0 ? [...rows, ...filler] : [poolRow('p2', 'USAGE', 20, 990, 970)] }
    },
  }
}

function mount() {
  const link = new ApolloLink((operation) => new Observable<FetchResult>((observer) => {
    const variables = JSON.parse(JSON.stringify(operation.variables ?? {})) as Record<string, unknown>
    calls.push({ name: operation.operationName, variables })
    const timer = setTimeout(() => {
      const handler = handlers[operation.operationName]
      if (!handler) { observer.error(new Error(`No mock for ${operation.operationName}`)); return }
      const result = handler(variables)
      observer.next(result instanceof Error ? { data: null, errors: [{ message: result.message }] } as FetchResult : { data: result as Record<string, unknown> })
      observer.complete()
    }, 0)
    return () => clearTimeout(timer)
  }))
  const client = new ApolloClient({ link, cache: new InMemoryCache() })
  clients.push(client)
  return render(<ApolloProvider client={client}><MemoryRouter><CreditManagementPage /></MemoryRouter></ApolloProvider>)
}

const callsOf = (name: string) => calls.filter((call) => call.name === name)

beforeEach(() => {
  calls = []; handlers = defaultHandlers(); guard.allowed = true; guard.calls = []
  useAuthStore.setState({ agent: undefined, user: undefined, roles: ['Whitelabel Admin'], isReadOnly: false, agentPermissions: [], permissions: [{ domain: 'agents.credit', actions: ['update'] }] })
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.stop())
})

describe('the Chips page (/credit)', () => {
  test('a whitelabel admin sees the pool and its root accounts with D / W / CR, past no guard', async () => {
    mount()
    assert.ok(screen.getByRole('heading', { name: 'Chips', level: 1 }))
    const pool = within(screen.getByRole('group', { name: 'Whitelabel pool' }))
    await pool.findByText('INR 1000000.00')
    // Pool used and Given out happen to be equal here (97,500): only root deposits moved this pool.
    assert.equal(pool.getAllByText('INR 97500.00').length, 2); assert.ok(pool.getByText('INR 902500.00'))
    assert.ok(pool.getByText('Pool used')); assert.ok(pool.getByText('Given out'))

    const table = await screen.findByRole('table', { name: 'Root accounts' })
    await within(table).findByText('root1')
    assert.ok(within(table).getByText('wlplayer'))
    // The admin's own downline: no parent named.
    assert.deepEqual(callsOf('ChipDownline')[0].variables, { parentAgentId: null, query: null, accountType: null, offset: 0, limit: 20 })
    // Root accounts are the admin's to move chips for.
    assert.ok(screen.getByRole('button', { name: 'Deposit chips to root1' }))
    assert.ok(screen.getByRole('button', { name: 'Withdraw chips from wlplayer' }))
    assert.ok(screen.getByRole('button', { name: 'Set credit reference for root1' }))
    assert.equal(guard.calls.length, 0)
    // The statement is asked for only once its tab opens.
    assert.equal(callsOf('MyWhitelabelCreditHistory').length, 0)
  })

  test('an admin without agents.credit:update reads the figures but gets no D / W / CR', async () => {
    useAuthStore.setState({ permissions: [] })
    mount()
    const table = await screen.findByRole('table', { name: 'Root accounts' })
    await within(table).findByText('root1')
    assert.equal(screen.queryByRole('button', { name: 'Deposit chips to root1' }), null)
    assert.equal(screen.queryByRole('button', { name: 'Set credit reference for wlplayer' }), null)
  })

  test('without the whitelabel role the page asks for credit.management:view, and a refusal reads nothing', async () => {
    useAuthStore.setState({ roles: ['Support'] }); guard.allowed = false
    mount()
    assert.ok(screen.getByRole('alert'))
    assert.deepEqual(guard.calls[0], [{ domain: 'credit.management', actions: ['view'] }])
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(calls.length, 0)
  })

  test('a Finance Manager with credit.management:view is let in by the rule the sidebar link reads (T068)', async () => {
    useAuthStore.setState({ roles: ['Finance Manager'], permissions: [{ domain: 'credit.management', actions: ['view'] }] }); guard.allowed = false
    mount()
    await within(screen.getByRole('group', { name: 'Whitelabel pool' })).findByText('INR 1000000.00')
    assert.equal(screen.queryByRole('alert'), null)
    assert.equal(guard.calls.length, 0, 'the shared rule admitted it; the guard only words a refusal')
  })

  test('the pool statement signs each movement from the pool side and pages with a lookahead row', async () => {
    mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Pool statement' }))
    const table = await screen.findByRole('table', { name: 'Pool statement' })
    await within(table).findByText('Chips to agent root1')
    assert.deepEqual(callsOf('MyWhitelabelCreditHistory')[0].variables, { limit: 21, offset: 0 })

    const out = within(within(table).getByText('Chips to agent root1').closest('tr') as HTMLElement)
    assert.ok(out.getByText('Chips out')); assert.ok(out.getByText('−INR 5000.00')); assert.ok(out.getByText('INR 902500.00'))
    const back = within(within(table).getByText('Chips from player wlplayer').closest('tr') as HTMLElement)
    assert.ok(back.getByText('Chips in')); assert.ok(back.getByText('+INR 1000.00'))
    assert.equal(back.getByRole('link', { name: 'wlplayer' }).getAttribute('href'), '/players/profile/41')
    const topUp = within(within(table).getByText('Credit allocation by Super Admin').closest('tr') as HTMLElement)
    assert.ok(topUp.getByText('Pool top-up')); assert.ok(topUp.getByText('System'))
    // 20 rows on screen; the 21st only says another page exists.
    assert.equal(within(table).getAllByRole('row').length, 21)
    assert.ok(screen.getByText('(more available)', { exact: false }))

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => assert.deepEqual(callsOf('MyWhitelabelCreditHistory').at(-1)?.variables, { limit: 21, offset: 20 }))
    await screen.findByText('Page 2')
    await waitFor(() => assert.equal(within(screen.getByRole('table', { name: 'Pool statement' })).getAllByRole('row').length, 2))
  })

  test('Refresh asks the pool, the root accounts and the statement again', async () => {
    mount()
    fireEvent.click(screen.getByRole('tab', { name: 'Pool statement' }))
    await screen.findByText('Chips to agent root1')
    fireEvent.click(screen.getByRole('tab', { name: 'Root accounts' }))
    await screen.findByText('root1')
    const before = { pool: callsOf('ChipPool').length, downline: callsOf('ChipDownline').length }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => assert.ok(callsOf('ChipPool').length > before.pool))
    await waitFor(() => assert.ok(callsOf('ChipDownline').length > before.downline))
    fireEvent.click(screen.getByRole('tab', { name: 'Pool statement' }))
    await screen.findByText('Chips to agent root1')
  })

  test('a pool that cannot be read says so in the server words, with a retry', async () => {
    handlers.ChipPool = () => new Error('Only an administrator can read the pool')
    mount()
    await screen.findByText('Only an administrator can read the pool')
    handlers.ChipPool = defaultHandlers().ChipPool
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await within(await screen.findByRole('group', { name: 'Whitelabel pool' })).findByText('INR 1000000.00')
  })
})
