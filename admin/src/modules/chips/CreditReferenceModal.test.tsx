import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useAuthStore } from '@/shared/core/authStore'
import type { ChipAccount } from '@/lib/graphql/chips'
import { CreditReferenceModal } from './CreditReferenceModal'
import { agentSession, chipAccountFixture, chipServer, renderWithChips, type ChipServer } from './chipTestKit'
import styles from './Chips.module.css'

const toastSpy = vi.hoisted(() => vi.fn())
vi.mock('@/ui/components/toast', () => ({ toast: toastSpy }))
vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency = 'INR') => `${currency} ${Number(amount).toFixed(2)}`,
    getCurrencySymbol: () => '₹',
  }),
}))

// A sub-agent 5,000 short of its reference: balance + downline = 95,000 against 100,000.
const SUB_AGENT = chipAccountFixture({ id: 'agent-2', username: 'agent2', parentAgentId: 'agent-1', creditReference: 100000, balance: 90000, downlineBalance: 5000, refPnl: -5000 })
const servers: ChipServer[] = []

function serve(account: ChipAccount, extra: Parameters<typeof chipServer>[0] = {}) {
  const server = chipServer({
    ChipAccount: () => ({ chipAccount: account }),
    SetCreditReference: (variables) => {
      const input = variables.input as { creditReference: number }
      return { setCreditReference: { ...account, creditReference: input.creditReference, refPnl: account.refPnl + account.creditReference - input.creditReference } }
    },
    ...extra,
  })
  servers.push(server)
  return server
}

function open(account: ChipAccount, server: ChipServer) {
  const onOpenChange = vi.fn()
  const onDone = vi.fn()
  renderWithChips(<CreditReferenceModal open onOpenChange={onOpenChange} account={account} onDone={onDone} />, server)
  return { onOpenChange, onDone }
}

const field = () => screen.getByRole('textbox', { name: 'New credit reference' })
const save = () => screen.getByRole('button', { name: 'Save reference' })
const refPnlFigure = () => {
  const node = document.querySelector<HTMLElement>('[data-figure="refPnl"]')
  assert.ok(node, 'the Ref P/L figure renders')
  return node
}

beforeEach(() => {
  toastSpy.mockReset()
  useAuthStore.setState({ agent: agentSession(), user: undefined, roles: [], permissions: [], agentPermissions: [], isReadOnly: false })
})

afterEach(() => {
  servers.splice(0).forEach((server) => server.client.stop())
})

describe('CreditReferenceModal', () => {
  test('starts from the current reference, previews Ref P/L and saves the new one', async () => {
    const server = serve(SUB_AGENT)
    const { onOpenChange, onDone } = open(SUB_AGENT, server)
    assert.ok(await screen.findByRole('dialog', { name: 'Credit reference' }))
    assert.ok(screen.getByText(/Ref P\/L is the balance plus the downline less this reference/))
    assert.match((field() as HTMLInputElement).value, /^100000(\.00)?$/)
    assert.ok(screen.getByText('This is the current reference.'))
    assert.equal(save().hasAttribute('disabled'), true, 'nothing to save until the reference changes')
    const now = screen.getByText('−INR 5000.00')
    assert.ok(now.classList.contains(styles.loss))

    fireEvent.change(field(), { target: { value: '90000' } })
    assert.ok(refPnlFigure().textContent?.includes('After: +INR 5000.00 · Upline owes'), 'a lower reference turns the shortfall into a surplus')
    assert.ok(screen.getByText('+INR 5000.00').classList.contains(styles.gain))
    fireEvent.change(screen.getByRole('textbox', { name: 'Remark' }), { target: { value: 'New terms' } })
    fireEvent.click(save())

    await waitFor(() => assert.equal(onOpenChange.mock.calls.length, 1, 'the dialog closes on success'))
    assert.deepEqual(server.callsOf('SetCreditReference').map((call) => call.variables), [
      { input: { accountType: 'AGENT', accountId: 'agent-2', creditReference: 90000, remark: 'New terms' } },
    ])
    assert.deepEqual(toastSpy.mock.calls[0], [{ tone: 'ok', message: 'Credit reference for agent2 set to INR 90000.00' }])
    assert.equal(onDone.mock.calls[0][0].creditReference, 90000)
  })

  test('a reference below 0 is refused before it is sent', async () => {
    const server = serve(SUB_AGENT)
    open(SUB_AGENT, server)
    await screen.findByRole('dialog', { name: 'Credit reference' })
    fireEvent.change(field(), { target: { value: '-1' } })
    assert.ok(screen.getByText('The credit reference cannot be below 0'))
    assert.equal(save().hasAttribute('disabled'), true)
    assert.equal(server.callsOf('SetCreditReference').length, 0)
  })

  test('0 is a valid reference; the server’s refusal is shown and the dialog stays open', async () => {
    const server = serve(SUB_AGENT, { SetCreditReference: () => new Error('Only the direct upline can move chips for this account') })
    const { onOpenChange } = open(SUB_AGENT, server)
    await screen.findByRole('dialog', { name: 'Credit reference' })
    fireEvent.change(field(), { target: { value: '0' } })
    assert.equal(save().hasAttribute('disabled'), false)
    fireEvent.click(save())
    const alert = await screen.findByRole('alert')
    assert.ok(alert.textContent?.includes('Only the direct upline can move chips for this account'))
    assert.deepEqual(server.callsOf('SetCreditReference')[0].variables, { input: { accountType: 'AGENT', accountId: 'agent-2', creditReference: 0, remark: null } })
    assert.equal(onOpenChange.mock.calls.length, 0)
    assert.equal(toastSpy.mock.calls.length, 0)
  })

  test('a player’s note leaves out the downline', async () => {
    const player = chipAccountFixture({ accountType: 'PLAYER', id: 'player-1', username: 'player1', parentAgentId: 'agent-1', creditReference: 1000, balance: 1000, refPnl: 0 })
    open(player, serve(player))
    await screen.findByRole('dialog', { name: 'Credit reference' })
    assert.ok(screen.getByText(/Ref P\/L is the balance less this reference/))
    assert.ok(screen.getByText('Nothing owed'))
  })
})
