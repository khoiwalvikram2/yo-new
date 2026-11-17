import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import type { ChipAccount } from '@/lib/graphql/chips'
import { ChipTransferModal } from './ChipTransferModal'
import { agentSession, chipAccountFixture, chipPoolFixture, chipServer, renderWithChips, type ChipServer } from './chipTestKit'

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock('@/ui/components/toast', () => ({ toast: toastSpy }))
vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency = 'INR') => `${currency} ${Number(amount).toFixed(2)}`,
    getCurrencySymbol: () => '₹',
  }),
}))

const AGENT = chipAccountFixture({ id: 'agent-1', username: 'agent1', balance: 1000, available: 1000 })
const PLAYER = chipAccountFixture({
  accountType: 'PLAYER',
  id: 'player-1',
  username: 'player1',
  parentAgentId: 'agent-1',
  playerType: 'AGENT_CREDIT',
  creditReference: 1000,
  balance: 700,
  exposure: 200,
  available: 500,
  refPnl: -300,
})

const servers: ChipServer[] = []

function transferResult(account: ChipAccount) {
  return { __typename: 'ChipTransferResult', account, parent: AGENT, pool: null, transferId: 'transfer-1' }
}

function serve(account: ChipAccount, extra: Parameters<typeof chipServer>[0] = {}) {
  const server = chipServer({
    ChipAccount: (variables) => ({ chipAccount: variables.accountId === AGENT.id ? AGENT : account }),
    ChipPool: () => ({ chipPool: chipPoolFixture() }),
    DepositChips: () => ({ depositChips: transferResult(account) }),
    WithdrawChips: () => ({ withdrawChips: transferResult(account) }),
    ...extra,
  })
  servers.push(server)
  return server
}

function open(account: ChipAccount, server: ChipServer, direction: 'deposit' | 'withdraw' = 'deposit') {
  const onOpenChange = vi.fn()
  const onDone = vi.fn()
  renderWithChips(<ChipTransferModal open onOpenChange={onOpenChange} account={account} direction={direction} onDone={onDone} />, server)
  return { onOpenChange, onDone }
}

const side = (name: 'parent' | 'child') => {
  const node = document.querySelector<HTMLElement>(`[data-side="${name}"]`)
  assert.ok(node, `the ${name} side renders`)
  return node
}
const amountField = () => screen.getByRole('textbox', { name: 'Amount' })
const submitButton = (name: string) => screen.getByRole('button', { name })
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true'

beforeEach(() => {
  toastSpy.mockReset()
  useAuthStore.setState({ agent: agentSession(), user: undefined, roles: [], permissions: [], agentPermissions: [], isReadOnly: false })
})

afterEach(() => {
  servers.splice(0).forEach((server) => server.client.stop())
})

describe('ChipTransferModal', () => {
  test('shows both sides’ free chips, caps a deposit at the parent’s and sends the move', async () => {
    const server = serve(PLAYER)
    const { onOpenChange, onDone } = open(PLAYER, server)

    assert.ok(await screen.findByRole('dialog', { name: 'Deposit chips' }))
    await waitFor(() => assert.ok(side('parent').textContent?.includes('INR 1000.00'), 'the parent agent’s free chips load'))
    assert.ok(screen.getByText('agent1'))
    assert.ok(side('child').textContent?.includes('INR 500.00'), 'the player’s free chips are balance − exposure')
    assert.deepEqual(server.callsOf('ChipAccount').map((call) => call.variables).sort((a, b) => String(a.accountId).localeCompare(String(b.accountId))), [
      { accountType: 'AGENT', accountId: 'agent-1' },
      { accountType: 'PLAYER', accountId: 'player-1' },
    ])
    assert.equal(server.callsOf('ChipPool').length, 0, 'an agent parent needs no pool')

    fireEvent.change(amountField(), { target: { value: '1500' } })
    assert.ok(screen.getByText('Not enough chips: agent1 has INR 1000.00 free'))
    assert.equal(submitButton('Deposit chips').hasAttribute('disabled'), true)

    fireEvent.change(amountField(), { target: { value: '250.5' } })
    assert.ok(screen.queryByText(/Not enough chips/) === null, 'the error clears for an amount the parent can cover')
    assert.ok(side('parent').textContent?.includes('After: INR 749.50'))
    assert.ok(side('child').textContent?.includes('After: INR 750.50'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Remark' }), { target: { value: '  cash  ' } })
    fireEvent.click(submitButton('Deposit chips'))

    await waitFor(() => assert.equal(onOpenChange.mock.calls.length, 1, 'the dialog closes on success'))
    assert.deepEqual(onOpenChange.mock.calls[0], [false])
    assert.deepEqual(server.callsOf('DepositChips').map((call) => call.variables), [
      { input: { accountType: 'PLAYER', accountId: 'player-1', amount: 250.5, remark: 'cash' } },
    ])
    assert.equal(server.callsOf('WithdrawChips').length, 0)
    assert.deepEqual(toastSpy.mock.calls[0], [{ tone: 'ok', message: 'Deposited INR 250.50 to player1' }])
    assert.equal(onDone.mock.calls.length, 1)
    assert.equal(onDone.mock.calls[0][1], 'deposit')
    assert.equal(onDone.mock.calls[0][0].transferId, 'transfer-1')
  })

  test('a root account’s other side is the whitelabel pool', async () => {
    useAuthStore.setState({ agent: undefined, user: { id: 'admin-1', name: 'Admin' }, permissions: [{ domain: 'all', actions: ['*'] }] })
    const root = chipAccountFixture({ id: 'agent-7', username: 'root7', parentAgentId: null, balance: 0, available: 0, refPnl: -100000 })
    const server = serve(root)
    open(root, server)

    await waitFor(() => assert.ok(side('parent').textContent?.includes('INR 900000.00'), 'the pool’s available figure loads'))
    assert.ok(screen.getByText('Whitelabel pool'))
    assert.equal(server.callsOf('ChipPool').length, 1)
    assert.deepEqual(server.callsOf('ChipAccount').map((call) => call.variables), [{ accountType: 'AGENT', accountId: 'agent-7' }], 'no parent agent is read')
    fireEvent.change(amountField(), { target: { value: '900000.01' } })
    assert.ok(screen.getByText('Not enough chips: Whitelabel pool has INR 900000.00 free'))
  })

  test('"Settle to credit reference" deposits what a downline owes (Ref P/L < 0)', async () => {
    open(PLAYER, serve(PLAYER), 'withdraw')
    await screen.findByRole('dialog', { name: 'Withdraw chips' })
    assert.ok(screen.getByText('Owes upline · settling deposits INR 300.00'))
    fireEvent.click(screen.getByRole('button', { name: 'Settle to credit reference' }))
    assert.ok(pressed('Deposit'), 'a negative Ref P/L is settled by a deposit')
    assert.match((amountField() as HTMLInputElement).value, /^300(\.00)?$/)
    assert.ok(screen.getByRole('dialog', { name: 'Deposit chips' }))
  })

  test('"Settle to credit reference" withdraws what a downline is owed (Ref P/L > 0)', async () => {
    const owed = chipAccountFixture({ ...PLAYER, refPnl: 400 })
    open(owed, serve(owed))
    await screen.findByRole('dialog', { name: 'Deposit chips' })
    assert.ok(screen.getByText('Upline owes · settling withdraws INR 400.00'))
    fireEvent.click(screen.getByRole('button', { name: 'Settle to credit reference' }))
    assert.ok(pressed('Withdraw'), 'a positive Ref P/L is settled by a withdrawal')
    assert.match((amountField() as HTMLInputElement).value, /^400(\.00)?$/)
    assert.ok(submitButton('Withdraw chips'))
  })

  test('nothing to settle when the balance meets the reference', async () => {
    const level = chipAccountFixture({ ...PLAYER, refPnl: 0 })
    open(level, serve(level))
    await screen.findByRole('dialog', { name: 'Deposit chips' })
    assert.ok(screen.getByText('The balance meets the credit reference'))
    assert.equal(screen.getByRole('button', { name: 'Settle to credit reference' }).hasAttribute('disabled'), true)
  })

  test('a withdrawal is capped by the account’s free chips, and the server’s refusal is shown as it words it', async () => {
    const server = serve(PLAYER, { WithdrawChips: () => new Error('Not enough chips: available 1,200.00') })
    const { onOpenChange, onDone } = open(PLAYER, server, 'withdraw')
    await screen.findByRole('dialog', { name: 'Withdraw chips' })

    fireEvent.change(amountField(), { target: { value: '600' } })
    assert.ok(screen.getByText('Not enough free chips: player1 has INR 500.00 free'), 'exposure is not free')
    fireEvent.change(amountField(), { target: { value: '100' } })
    fireEvent.click(submitButton('Withdraw chips'))

    const alert = await screen.findByRole('alert')
    assert.ok(alert.textContent?.includes('Not enough chips: available 1,200.00'))
    assert.deepEqual(server.callsOf('WithdrawChips').map((call) => call.variables), [
      { input: { accountType: 'PLAYER', accountId: 'player-1', amount: 100, remark: null } },
    ])
    assert.equal(onOpenChange.mock.calls.length, 0, 'the dialog stays open')
    assert.equal(onDone.mock.calls.length, 0)
    assert.equal(toastSpy.mock.calls.length, 0)
  })

  test('deposits pause for an account that is not active; withdrawals still work', async () => {
    const suspended = chipAccountFixture({ ...PLAYER, status: 'SUSPENDED' })
    open(suspended, serve(suspended))
    await screen.findByRole('dialog', { name: 'Deposit chips' })
    assert.ok(screen.getByText('Deposits are paused while player1 is suspended. Withdrawals still work.'))
    fireEvent.change(amountField(), { target: { value: '100' } })
    assert.equal(submitButton('Deposit chips').hasAttribute('disabled'), true)

    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    assert.ok(screen.queryByText(/Deposits are paused/) === null, 'the pause notice is for deposits only')
    assert.equal(submitButton('Withdraw chips').hasAttribute('disabled'), false)
  })

  test('renders nothing while closed', () => {
    const server = serve(PLAYER)
    renderWithChips(<ChipTransferModal open={false} onOpenChange={() => {}} account={PLAYER} direction="deposit" />, server)
    assert.ok(screen.queryByRole('dialog') === null, 'no dialog while closed')
    assert.equal(server.calls.length, 0, 'no figures are read for a closed dialog')
  })
})
