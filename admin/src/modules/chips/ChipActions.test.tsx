import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, screen } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import type { ChipAccount } from '@/lib/graphql/chips'
import { ChipActions } from './ChipActions'
import { agentSession, chipAccountFixture, chipPoolFixture, chipServer, renderWithChips, type ChipServer } from './chipTestKit'

vi.mock('@/ui/components/toast', () => ({ toast: vi.fn() }))
vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency = 'INR') => `${currency} ${Number(amount).toFixed(2)}`,
    getCurrencySymbol: () => '₹',
  }),
}))

const CHILD = chipAccountFixture({ id: 'agent-2', username: 'agent2', parentAgentId: 'agent-1' })
const GRANDCHILD = chipAccountFixture({ id: 'agent-3', username: 'agent3', parentAgentId: 'agent-2' })
const ROOT = chipAccountFixture({ id: 'agent-1', username: 'agent1', parentAgentId: null })
const servers: ChipServer[] = []

function mount(account: ChipAccount, variant?: 'compact' | 'full') {
  const server = chipServer({
    ChipAccount: (variables) => ({ chipAccount: variables.accountId === account.id ? account : ROOT }),
    ChipPool: () => ({ chipPool: chipPoolFixture() }),
  })
  servers.push(server)
  renderWithChips(<ChipActions account={account} variant={variant} />, server)
  return server
}

const signInAgent = (overrides: Parameters<typeof agentSession>[0] = {}, isReadOnly = false) =>
  useAuthStore.setState({ agent: agentSession(overrides), user: undefined, permissions: [], agentPermissions: [], isReadOnly })
const signInAdmin = (permissions: Array<{ domain: string; actions: string[] }>) =>
  useAuthStore.setState({ agent: undefined, user: { id: 'admin-1', name: 'Admin' }, permissions, agentPermissions: [], isReadOnly: false })

const actionNames = () => screen.queryAllByRole('button').map((button) => button.getAttribute('aria-label'))

beforeEach(() => signInAgent())
afterEach(() => {
  servers.splice(0).forEach((server) => server.client.stop())
})

describe('ChipActions: only the direct parent moves chips', () => {
  test('an agent gets D, W and CR on its own sub-agent', () => {
    mount(CHILD)
    assert.deepEqual(actionNames(), ['Deposit chips to agent2', 'Withdraw chips from agent2', 'Set credit reference for agent2'])
    assert.deepEqual(screen.getAllByRole('button').map((button) => button.textContent), ['D', 'W', 'CR'])
  })

  test('nothing on a grandchild, which is its own parent’s to move', () => {
    mount(GRANDCHILD)
    assert.ok(screen.queryByRole('group', { name: 'Chips for agent3' }) === null, 'no actions group renders')
    assert.deepEqual(actionNames(), [])
  })

  test('nothing for an agent of another scheme', () => {
    signInAgent({ schemeType: 'COMMISSION' })
    mount(CHILD)
    assert.deepEqual(actionNames(), [])
  })

  test('nothing for a read-only (inactive) agent', () => {
    signInAgent({}, true)
    mount(CHILD)
    assert.deepEqual(actionNames(), [])
  })

  test('an admin with agents.credit:update acts on root accounts only', () => {
    signInAdmin([{ domain: 'agents.credit', actions: ['update'] }])
    mount(ROOT)
    assert.equal(actionNames().length, 3)
  })

  test('an admin does not reach below the root', () => {
    signInAdmin([{ domain: 'all', actions: ['*'] }])
    mount(CHILD)
    assert.deepEqual(actionNames(), [])
  })

  test('an admin without agents.credit:update gets nothing', () => {
    signInAdmin([{ domain: 'agents.list', actions: ['view'] }])
    mount(ROOT)
    assert.deepEqual(actionNames(), [])
  })
})

describe('ChipActions: the dialogs', () => {
  test('D opens the deposit dialog, W the withdrawal, CR the credit reference', async () => {
    mount(CHILD)
    fireEvent.click(screen.getByRole('button', { name: 'Deposit chips to agent2' }))
    assert.ok(await screen.findByRole('dialog', { name: 'Deposit chips' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.ok(screen.queryByRole('dialog') === null, 'Cancel closes the dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw chips from agent2' }))
    assert.ok(await screen.findByRole('dialog', { name: 'Withdraw chips' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Set credit reference for agent2' }))
    assert.ok(await screen.findByRole('dialog', { name: 'Credit reference' }))
  })

  test('a suspended account takes no deposit: D is disabled, W still opens', async () => {
    mount(chipAccountFixture({ ...CHILD, status: 'SUSPENDED' }))
    const deposit = screen.getByRole('button', { name: 'Deposit chips to agent2' })
    assert.equal(deposit.getAttribute('aria-disabled'), 'true')
    fireEvent.click(deposit)
    assert.ok(screen.queryByRole('dialog') === null, 'a disabled D opens nothing')
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw chips from agent2' }))
    assert.ok(await screen.findByRole('dialog', { name: 'Withdraw chips' }))
  })

  test('an agent that is not active cannot deposit either', () => {
    signInAgent({ status: 'SUSPENDED' })
    mount(CHILD)
    assert.equal(screen.getByRole('button', { name: 'Deposit chips to agent2' }).getAttribute('aria-disabled'), 'true')
    assert.equal(screen.getByRole('button', { name: 'Withdraw chips from agent2' }).getAttribute('aria-disabled'), null)
  })

  test('the full variant words its buttons for a page head', () => {
    mount(CHILD, 'full')
    assert.deepEqual(screen.getAllByRole('button').map((button) => button.textContent), ['Deposit chips', 'Withdraw chips', 'Credit reference'])
  })
})
