import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { ChipStatementTable } from './ChipStatementTable'
import { chipRowFixture, chipServer, renderWithChips, type ChipServer } from './chipTestKit'
import styles from './Chips.module.css'

vi.mock('@/shared/core/CurrencyContext', () => ({
  useCurrency: () => ({
    formatAmount: (amount: number, currency = 'INR') => `${currency} ${Number(amount).toFixed(2)}`,
    getCurrencySymbol: () => '₹',
  }),
}))
vi.mock('@/shared/core/useFormatDate', () => ({
  useFormatDate: () => ({ formatDateTime: (value: string) => `at ${value}` }),
}))

const ROWS = [
  chipRowFixture({ id: 'r3', createdAt: '2026-11-02T12:00:00.000Z', kind: 'WITHDRAW', amount: -200, balanceBefore: 1500, balanceAfter: 1300, remark: 'Cash paid', counterpartyName: 'agent1' }),
  chipRowFixture({ id: 'r2', createdAt: '2026-11-02T11:00:00.000Z', kind: 'CREDIT_REFERENCE', amount: 0, balanceBefore: 1500, balanceAfter: 1500, creditReferenceBefore: 1000, creditReferenceAfter: 1200, counterpartyType: null, counterpartyId: null, counterpartyName: null }),
  chipRowFixture({ id: 'r1', createdAt: '2026-11-02T10:00:00.000Z', kind: 'DEPOSIT', amount: 500, balanceBefore: 1000, balanceAfter: 1500, counterpartyType: 'whitelabel', counterpartyId: 'tenant-1', counterpartyName: null }),
]

const servers: ChipServer[] = []
function serve(handler: Parameters<typeof chipServer>[0]['ChipStatement']) {
  const server = chipServer({ ChipStatement: handler })
  servers.push(server)
  return server
}

afterEach(() => {
  servers.splice(0).forEach((server) => server.client.stop())
})

const rowOf = (text: string) => {
  const row = screen.getByText(text).closest('tr')
  assert.ok(row, `a row holds ${text}`)
  return row
}

describe('ChipStatementTable', () => {
  test('each movement: date, kind, signed amount in its colour, running balance, the other side and the remark', async () => {
    const server = serve(() => ({ chipStatement: { __typename: 'ChipStatementPage', rows: ROWS, total: 3 } }))
    renderWithChips(<ChipStatementTable accountType="PLAYER" accountId="player-1" currency="INR" />, server)

    await screen.findByText('at 2026-11-02T12:00:00.000Z')
    assert.deepEqual(server.callsOf('ChipStatement').map((call) => call.variables), [
      { accountType: 'PLAYER', accountId: 'player-1', from: null, to: null, offset: 0, limit: 20 },
    ])
    const table = screen.getByRole('table', { name: 'Chip statement' })
    assert.deepEqual(within(table).getAllByRole('columnheader').map((cell) => cell.textContent), ['Date', 'Kind', 'Amount', 'Balance', 'Counterparty', 'Remark'])

    const withdraw = rowOf('at 2026-11-02T12:00:00.000Z')
    assert.ok(within(withdraw).getByText('Withdraw'))
    assert.ok(within(withdraw).getByText('−INR 200.00').classList.contains(styles.loss), 'chips out are rose')
    assert.ok(within(withdraw).getByText('INR 1300.00'), 'the running balance')
    assert.ok(within(withdraw).getByText('agent1'))
    assert.ok(within(withdraw).getByText('Agent'))
    assert.ok(within(withdraw).getByText('Cash paid'))

    const reference = rowOf('at 2026-11-02T11:00:00.000Z')
    assert.ok(within(reference).getByText('Credit reference'))
    assert.ok(within(reference).getByText('INR 1000.00 → INR 1200.00'), 'a reference change shows before and after')
    assert.ok(within(reference).queryByText(/INR 0\.00/) === null, 'and no amount')

    const deposit = rowOf('at 2026-11-02T10:00:00.000Z')
    assert.ok(within(deposit).getByText('+INR 500.00').classList.contains(styles.gain), 'chips in are green')
    assert.ok(within(deposit).getByText('Whitelabel pool'))
  })

  test('pages through the server: the next page asks for the next offset', async () => {
    const server = serve((variables) => ({
      chipStatement: {
        __typename: 'ChipStatementPage',
        rows: [chipRowFixture({ id: `row-${String(variables.offset)}`, remark: `page at ${String(variables.offset)}` })],
        total: 45,
      },
    }))
    renderWithChips(<ChipStatementTable accountType="AGENT" accountId="agent-2" from="2026-11-01T00:00:00.000Z" to="2026-11-02T23:59:59.999Z" />, server)
    await screen.findByText('page at 0')
    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    await screen.findByText('page at 20')
    assert.deepEqual(server.callsOf('ChipStatement').map((call) => call.variables), [
      { accountType: 'AGENT', accountId: 'agent-2', from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T23:59:59.999Z', offset: 0, limit: 20 },
      { accountType: 'AGENT', accountId: 'agent-2', from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T23:59:59.999Z', offset: 20, limit: 20 },
    ])
  })

  test('an account with no movements says so', async () => {
    const server = serve(() => ({ chipStatement: { __typename: 'ChipStatementPage', rows: [], total: 0 } }))
    renderWithChips(<ChipStatementTable accountType="PLAYER" accountId="player-9" />, server)
    assert.ok(await screen.findByText('No chip movements yet'))
  })

  test('a failed read shows the server’s words and retries', async () => {
    let fail = true
    const server = serve(() => (fail ? new Error('You cannot see this account') : { chipStatement: { __typename: 'ChipStatementPage', rows: [chipRowFixture({ remark: 'back again' })], total: 1 } }))
    renderWithChips(<ChipStatementTable accountType="PLAYER" accountId="player-9" />, server)
    assert.ok(await screen.findByText('You cannot see this account'))
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => assert.ok(screen.queryByText('back again') !== null, 'the retry loads the rows'))
  })
})
