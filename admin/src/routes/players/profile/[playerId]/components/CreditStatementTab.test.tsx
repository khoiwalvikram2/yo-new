/**
 * The Credit Statement tab against a recording Apollo link. The period control has its own suite
 * (modules/reporting/ui/ReportingPeriodFilter.test.tsx) and is a deterministic stand-in here.
 * The clock is fixed at 2026-10-22 11:30 IST, so the default period is 22 Sep – 22 Oct.
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { CreditStatementTab } from './CreditStatementTab'
import styles from '../PlayerProfile.module.css'

vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number, currency = 'INR') => `${currency} ${value.toFixed(2)}` }) }))

vi.mock('@/modules/reporting/ui/ReportingPeriodFilter', () => ({
  ReportingPeriodFilter: ({ dateFrom, dateTo, preset, onChange }: { dateFrom: string; dateTo: string; preset?: string; onChange: (from: string, to: string, preset: 'allTime' | 'today' | 'yesterday' | 'custom') => void }) => (
    <div role="group" aria-label="Period (stub)">
      <output data-testid="period-state">{`${preset}|${dateFrom}|${dateTo}`}</output>
      <button type="button" onClick={() => onChange('2026-10-22', '2026-10-22', 'today')}>Apply Today</button>
    </div>
  ),
}))

const NOW = new Date('2026-10-22T06:00:00.000Z')

const row = (fields: Record<string, unknown>) => ({
  __typename: 'CreditStatementRow', domain: null, reference: null, details: null, balanceAfter: null, valueBefore: null, valueAfter: null, ...fields,
})

/* Opening 0 → sports +500 (500) → limit 10000→12000 (no change) → settlement −500 (0) → casino −250 (−250). Newest first. */
const STATEMENT = {
  __typename: 'PlayerCreditStatement',
  playerId: 'p1', playerType: 'AGENT_CREDIT', dateFrom: '2026-09-21T18:30:00.000Z', dateTo: '2026-10-22T18:29:59.999Z',
  openingBalance: 0, closingBalance: -250, totalRows: 450, limit: 200, offset: 0,
  summary: { __typename: 'CreditStatementSummary', creditLimit: 12000, creditUsed: 400, creditAvailable: 11350, settlementBalance: -250, settlementBalanceSports: 0, settlementBalanceCasino: -250, settlementBalanceMatka: 0 },
  totals: { __typename: 'CreditStatementTotals', totalWon: 500, totalLost: 250, netResult: 250, settlementsTotal: -500, settlementCount: 1, betCount: 2 },
  rows: [
    row({ id: 'casino:c1', type: 'BET_SETTLED', occurredAt: '2026-10-04T10:00:00.000Z', domain: 'casino', reference: 'Live Roulette', details: 'Evolution', amount: -250, affectsBalance: true, balanceAfter: -250 }),
    row({ id: 'ledger:s1', type: 'SETTLEMENT', occurredAt: '2026-10-03T10:00:00.000Z', reference: 'Settlement', details: 'Player credit settlement: 500 → 0', amount: -500, affectsBalance: true, balanceAfter: 0, valueBefore: 500, valueAfter: 0 }),
    row({ id: 'ledger:l1', type: 'LIMIT_CHANGE', occurredAt: '2026-10-02T10:00:00.000Z', details: 'Credit limit adjustment: 10000 → 12000', amount: 2000, affectsBalance: false, valueBefore: 10000, valueAfter: 12000 }),
    row({ id: 'sports:b1', type: 'BET_SETTLED', occurredAt: '2026-10-01T10:00:00.000Z', domain: 'sports', reference: 'India v Australia', details: 'Match Odds', amount: 500, affectsBalance: true, balanceAfter: 500 }),
  ],
}

let calls: Array<Record<string, unknown>>
let refusal: string | null
let downloads: string[]
let blobs: Blob[]

function renderTab() {
  const link = new ApolloLink((operation) => new Observable((observer) => {
    calls.push(structuredClone(operation.variables) as Record<string, unknown>)
    queueMicrotask(() => {
      if (refusal) observer.next({ errors: [{ message: refusal }] })
      else observer.next({ data: { playerCreditStatement: STATEMENT } })
      observer.complete()
    })
  }))
  return render(<MockedProvider cache={new InMemoryCache()} link={link}><CreditStatementTab playerId="p1" /></MockedProvider>)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  calls = []
  refusal = null
  downloads = []
  blobs = []
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:statement' }) })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
})

afterEach(() => {
  vi.useRealTimers()
})

test('asks for the last 30 days (IST), 200 rows from the top, for this player', async () => {
  renderTab()
  await screen.findByRole('table', { name: 'Credit statement rows' })
  assert.deepEqual(calls[0], { playerId: 'p1', dateFrom: '2026-09-22', dateTo: '2026-10-22', limit: 200, offset: 0 })
})

test('signed amounts are coloured and worded; informational rows keep the balance', async () => {
  renderTab()
  const table = await screen.findByRole('table', { name: 'Credit statement rows' })
  await within(table).findByText('Live Roulette')
  assert.equal(within(table).getAllByRole('row').length, 5)
  for (const el of within(table).getAllByText('+INR 500.00')) assert.ok(el.classList.contains(styles.positive))
  for (const el of within(table).getAllByText('−INR 250.00')) assert.ok(el.classList.contains(styles.negative))
  assert.ok(within(table).getByText('−INR 500.00').classList.contains(styles.negative))
  within(table).getByText('Player won')
  within(table).getByText('Player lost')
  within(table).getByText('Paid to player')
  within(table).getByText('Limit raised')
  within(table).getByText('No change')
  within(table).getByText(/Limit INR 10000\.00 → INR 12000\.00/)
  assert.equal(screen.getAllByText('Collect from player').length, 3)
  assert.equal(screen.getAllByText('Paid to player').length, 2)
  screen.getByText('Sports INR 0.00 · Casino −INR 250.00 · Matka INR 0.00')
})

test('a new period and a new page re-query; a new period goes back to the first page', async () => {
  renderTab()
  await screen.findByRole('table', { name: 'Credit statement rows' })
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  await waitFor(() => assert.equal(calls.at(-1)?.offset, 200))
  fireEvent.click(screen.getByRole('button', { name: 'Apply Today' }))
  await waitFor(() => assert.deepEqual(calls.at(-1), { playerId: 'p1', dateFrom: '2026-10-22', dateTo: '2026-10-22', limit: 200, offset: 0 }))
})

test('Download CSV saves the loaded rows as a CSV named after the player and period', async () => {
  renderTab()
  const table = await screen.findByRole('table', { name: 'Credit statement rows' })
  await within(table).findByText('Live Roulette')
  fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
  assert.deepEqual(downloads, ['credit-statement-p1-2026-09-22-to-2026-10-22.csv'])
  assert.equal(blobs[0]?.type, 'text/csv;charset=utf-8;')
})

test('a refusal is shown in words and nothing can be downloaded', async () => {
  refusal = 'The credit statement is for credit players only (AGENT_CREDIT or WHITELABEL_CREDIT). This player is REGULAR.'
  renderTab()
  await screen.findByText('Failed to load the credit statement')
  assert.ok(screen.getAllByText(refusal).length >= 1)
  assert.equal((screen.getByRole('button', { name: 'Download CSV' }) as HTMLButtonElement).disabled, true)
})
