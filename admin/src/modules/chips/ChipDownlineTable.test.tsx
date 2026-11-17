import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import { ChipDownlineTable } from './ChipDownlineTable'
import { agentSession, chipAccountFixture, chipServer, chipTotalsFixture, renderWithChips, type ChipServer } from './chipTestKit'
import styles from './Chips.module.css'

vi.mock('@/ui/components/toast', () => ({ toast: vi.fn() }))
vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency = 'INR') => `${currency} ${Number(amount).toFixed(2)}`,
    getCurrencySymbol: () => '₹',
  }),
}))

const ME = chipAccountFixture({ id: 'agent-1', username: 'agent1', balance: 95000, available: 95000, downlineBalance: 9700, creditReference: 100000, refPnl: 4700, downlineCount: 2 })
const AGENT_2 = chipAccountFixture({ id: 'agent-2', username: 'agent2', name: 'Second Agent', parentAgentId: 'agent-1', creditReference: 10000, balance: 9000, exposure: 100, available: 9000, downlineBalance: 2000, refPnl: 1000, downlineCount: 2 })
const PLAYER_1 = chipAccountFixture({ accountType: 'PLAYER', id: 'player-1', username: 'player1', parentAgentId: 'agent-1', playerType: 'AGENT_CREDIT', creditReference: 1000, balance: 700, exposure: 200, available: 500, refPnl: -300, status: 'SUSPENDED' })
const AGENT_3 = chipAccountFixture({ id: 'agent-3', username: 'agent3', parentAgentId: 'agent-2', creditReference: 0, balance: 1500, available: 1500, refPnl: 1500, downlineCount: 0 })
const PLAYER_5 = chipAccountFixture({ accountType: 'PLAYER', id: 'player-5', username: 'player5', parentAgentId: 'agent-2', creditReference: 500, balance: 500, available: 500, refPnl: 0 })

const servers: ChipServer[] = []

function mount() {
  const server = chipServer({
    ChipDownline: (variables) => {
      const second = variables.parentAgentId === 'agent-2'
      const items = second ? [AGENT_3, PLAYER_5] : [AGENT_2, PLAYER_1].filter((item) => !variables.accountType || item.accountType === variables.accountType)
      return {
        chipDownline: {
          __typename: 'ChipDownline',
          parent: second ? AGENT_2 : ME,
          pool: null,
          items,
          total: items.length,
          totals: second
            ? chipTotalsFixture({ creditReference: 500, balance: 2000, available: 2000, refPnl: 1500 })
            : chipTotalsFixture({ creditReference: 11000, balance: 9700, exposure: 300, available: 9500, downlineBalance: 2000, refPnl: 700 }),
        },
      }
    },
  })
  servers.push(server)
  renderWithChips(<ChipDownlineTable />, server)
  return server
}

const rowOf = (name: string) => {
  const row = screen.getByText(name).closest('tr')
  assert.ok(row, `a row for ${name}`)
  return row
}

beforeEach(() => useAuthStore.setState({ agent: agentSession(), user: undefined, permissions: [], agentPermissions: [], isReadOnly: false }))
afterEach(() => {
  servers.splice(0).forEach((server) => server.client.stop())
})

describe('ChipDownlineTable View action for admins', () => {
  test('an admin reading the page through credit.management:view alone (Finance Manager) gets no View', async () => {
    useAuthStore.setState({ agent: undefined, user: { id: 'admin-1', name: 'Admin' }, roles: ['Finance Manager'], permissions: [{ domain: 'credit.management', actions: ['view'] }], agentPermissions: [], isReadOnly: false })
    mount()
    await screen.findByText('agent2')
    assert.equal(within(rowOf('agent2')).queryByRole('link', { name: 'View agent2' }), null)
    assert.equal(within(rowOf('player1')).queryByRole('link', { name: 'View player1' }), null)
  })

  test('agents.list:view shows View on agent rows only; players.profile:view on player rows', async () => {
    useAuthStore.setState({ agent: undefined, user: { id: 'admin-1', name: 'Admin' }, roles: ['Reports Viewer'], permissions: [{ domain: 'credit.management', actions: ['view'] }, { domain: 'agents.list', actions: ['view'] }], agentPermissions: [], isReadOnly: false })
    mount()
    await screen.findByText('agent2')
    assert.ok(within(rowOf('agent2')).getByRole('link', { name: 'View agent2' }))
    assert.equal(within(rowOf('player1')).queryByRole('link', { name: 'View player1' }), null)
  })
})

describe('ChipDownlineTable', () => {
  test('the direct downline: figures per account, Ref P/L in its colour, a totals row and the parent line', async () => {
    const server = mount()
    await screen.findByText('player1')
    assert.deepEqual(server.callsOf('ChipDownline').map((call) => call.variables), [
      { parentAgentId: null, query: null, accountType: null, offset: 0, limit: 20 },
    ])
    const table = screen.getByRole('table', { name: 'Chip downline' })
    assert.deepEqual(within(table).getAllByRole('columnheader').map((cell) => cell.textContent), ['Username', 'Type', 'Credit Ref', 'Balance', 'Exposure', 'Available', 'Ref P/L', 'Actions'])

    const agent = screen.getByRole('button', { name: "Open agent2's downline" }).closest('tr')
    assert.ok(agent)
    assert.ok(within(agent).getByText('Second Agent'))
    assert.ok(within(agent).getByText('2 in downline'))
    assert.ok(within(agent).getByText('INR 10000.00'))
    assert.equal(within(agent).getAllByText('INR 9000.00').length, 2, 'balance and available')
    assert.ok(within(agent).getByText('+INR 1000.00').classList.contains(styles.gain))
    assert.ok(within(agent).getByText('Upline owes'))
    assert.ok(within(agent).getByRole('button', { name: 'Deposit chips to agent2' }))
    assert.equal(within(agent).getByRole('link', { name: 'View agent2' }).getAttribute('href'), '/agents/agent-2')

    const player = rowOf('player1')
    assert.ok(within(player).getByText('Player'))
    assert.ok(within(player).getByText('suspended'), 'a paused account says so')
    assert.ok(within(player).getByText('−INR 300.00').classList.contains(styles.loss))
    assert.ok(within(player).getByText('Owes upline'))
    assert.equal(within(player).getByRole('button', { name: 'Deposit chips to player1' }).getAttribute('aria-disabled'), 'true')
    assert.equal(within(player).getByRole('link', { name: 'View player1' }).getAttribute('href'), '/players/profile/player-1')

    const totals = within(table).getByText('Total').closest('tr')
    assert.ok(totals)
    assert.deepEqual(
      within(totals).getAllByRole('cell').map((cell) => cell.textContent),
      ['Total', '2 accounts', 'INR 11000.00', 'INR 9700.00', 'INR 300.00', 'INR 9500.00', '+INR 700.00Upline owes', ''],
    )
    assert.ok(screen.getByText(/agent1: balance/).textContent?.includes('agent1: balance INR 95000.00 · downline INR 9700.00 · Ref P/L +INR 4700.00'))
  })

  test('an agent row opens that agent’s downline, where its own children are not ours to move; the trail walks back', async () => {
    const server = mount()
    fireEvent.click(await screen.findByRole('button', { name: "Open agent2's downline" }))
    await screen.findByText('player5')
    assert.deepEqual(server.callsOf('ChipDownline').map((call) => call.variables.parentAgentId), [null, 'agent-2'])

    const trail = screen.getByRole('navigation', { name: 'Downline trail' })
    assert.ok(within(trail).getByRole('button', { name: 'Downline' }))
    assert.equal(within(trail).getByText('agent2').getAttribute('aria-current'), 'page')
    assert.ok(screen.getByText(/agent2: balance/))

    const grandchild = rowOf('agent3')
    assert.ok(within(grandchild).queryByRole('button', { name: /Deposit chips/ }) === null, 'D / W / CR are the direct parent’s only')
    assert.ok(within(grandchild).getByRole('link', { name: 'View agent3' }))
    assert.ok(within(grandchild).queryByRole('button', { name: "Open agent3's downline" }) === null, 'an agent with no downline does not open')

    fireEvent.click(within(trail).getByRole('button', { name: 'Downline' }))
    await screen.findByText('player1')
    assert.deepEqual(server.callsOf('ChipDownline').map((call) => call.variables.parentAgentId), [null, 'agent-2', null])
    assert.ok(screen.queryByRole('navigation', { name: 'Downline trail' }) === null, 'the trail goes at the top')
  })

  test('pages through the server, and a new level starts again at the first page', async () => {
    const server = chipServer({
      ChipDownline: (variables) => ({
        chipDownline: {
          __typename: 'ChipDownline',
          parent: variables.parentAgentId === 'agent-2' ? AGENT_2 : ME,
          pool: null,
          items: variables.parentAgentId === 'agent-2' ? [AGENT_3] : [AGENT_2, PLAYER_1],
          total: 45,
          totals: chipTotalsFixture(),
        },
      }),
    })
    servers.push(server)
    renderWithChips(<ChipDownlineTable />, server)
    await screen.findByText('player1')
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => assert.equal(server.callsOf('ChipDownline').length, 2))
    fireEvent.click(await screen.findByRole('button', { name: "Open agent2's downline" }))
    await screen.findByText('agent3')
    assert.deepEqual(server.callsOf('ChipDownline').map((call) => [call.variables.parentAgentId, call.variables.offset]), [
      [null, 0],
      [null, 20],
      ['agent-2', 0],
    ])
  })

  test('search and the account type filter go to the server', async () => {
    const server = mount()
    await screen.findByText('player1')
    fireEvent.click(screen.getByRole('button', { name: 'Players' }))
    await waitFor(() => assert.ok(screen.queryByText('agent2') === null, 'only players are left'))
    const search = screen.getByRole('searchbox', { name: 'Search the downline' })
    fireEvent.change(search, { target: { value: ' play ' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    await waitFor(() => assert.equal(server.callsOf('ChipDownline').length, 3))
    assert.deepEqual(server.callsOf('ChipDownline').map((call) => [call.variables.accountType, call.variables.query]), [
      [null, null],
      ['PLAYER', null],
      ['PLAYER', 'play'],
    ])
  })
})
