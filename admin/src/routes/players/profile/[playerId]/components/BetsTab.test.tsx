import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing'
import { BetsTab, getAllCols } from './BetsTab'
vi.mock('@/shared/core/CurrencyContext', () => ({ useCurrency: () => ({ formatAmount: (value: number, currency = 'INR') => `${currency} ${value.toFixed(2)}` }) }))
let calls: Array<{ playerId: string; filter: Record<string, unknown> }>
/** The PlayerBetCounts requests (all three product totals), kept apart from the page requests in `calls`. */
let countCalls: Array<Record<string, unknown>>
/** Bets per product in the fixture. */
let productRows: Record<string, number>
let networkFail: boolean
let graphFail: boolean
let exportBlob: Blob | undefined
function page(props = { playerId: 'player-1', dateRange: 'all_time', dateFrom: null as string | null, dateTo: null as string | null }) {
  const localCalls = calls, localCountCalls = countCalls
  const link = new ApolloLink(operation => new Observable(observer => {
    const counting = operation.operationName === 'PlayerBetCounts'
    if (counting) localCountCalls.push(structuredClone(operation.variables))
    else localCalls.push(structuredClone(operation.variables) as { playerId: string; filter: Record<string, unknown> })
    queueMicrotask(() => {
      if (networkFail) { observer.error(new Error('Network offline')); return }
      if (graphFail) { observer.next({ errors: [{ message: 'GraphQL bet read refused' }] }); observer.complete(); return }
      if (counting) {
        observer.next({ data: Object.fromEntries(['sports', 'casino', 'matka'].map(product => [product, { __typename: 'PlayerBetsPage', total: matchingRows(operation.variables[product]).length }])) }); observer.complete(); return
      }
      const filter = operation.variables.filter
      const offset = Number(filter.offset)
      const matching = matchingRows(filter)
      observer.next({ data: { playerBets: { __typename: 'PlayerBetsPage', items: matching.slice(offset, offset + Number(filter.limit)), total: matching.length, hasMore: offset + Number(filter.limit) < matching.length } } }); observer.complete()
    })
  }))
  return render(<MockedProvider cache={new InMemoryCache()} link={link}><BetsTab {...props} /></MockedProvider>)
}
/** The fixture bets one PlayerBets filter matches (product, status, wallet and search). */
function matchingRows(filter: Record<string, any>) {
      const product = String(filter.product)
      const rows = Array.from({ length: productRows[product] ?? 125 }, (_, index) => ({
        __typename: 'PlayerBet', id: `${product}-${index}`, product, userId: 'player-1', status: filter.status ?? 'won', stake: 100, liability: 150, return: 200, netAmount: 25, currency: 'USD', createdAt: '2026-10-09T10:00:00Z', settledAt: '2026-10-09T11:00:00Z',
        sportId: 'sport-1', sportName: 'Cricket', leagueId: 'league-1', leagueName: 'IPL', eventId: 'event-1', eventName: index ? 'England v Australia' : 'India v Australia', marketId: 'market-1', marketName: 'Match Odds', selectionId: 'selection-1', selectionName: 'India', odds: 1.8, oddsSize: 100, side: 'back', pl: 20, result: '123', eventResult: 'India won', ipAddress: '192.0.2.1', deviceInfo: 'Preview browser', location: 'Delhi', country: 'IN',
        gameId: 'game-1', gameName: 'Roulette', providerId: 'provider-1', providerName: 'Provider', vendorName: 'Vendor', tableId: 'table-1', winAmount: 200, sessionId: 'session-1', gameRoundId: 'round-1', transactionId: 'txn-1',
        matkaId: 'matka-1', matkaName: 'Kalyan', matkaType: 'worli', bidType: 'jodi', bidNumbers: '12', marketSession: 'open', payoutMultiplier: 9, potentialWin: 900, actualWin: 900, payout: 200,
        walletType: filter.walletType ?? 'bonus', campaign: { __typename: 'BonusCampaign', id: 'campaign-1', name: 'Welcome, VIP', type: 'deposit', distributionType: 'roll_over', wageringReq: 10, validTo: '2026-12-01T00:00:00Z', validFrom: '2026-10-01T00:00:00Z', domain: product, status: 'active', startDate: '2026-10-01T00:00:00Z', endDate: '2026-12-01T00:00:00Z', amount: 0, percentage: 0, amountType: 'fixed' },
      }))
      return rows.filter(row => !filter.search || row.eventName.toLowerCase().includes(String(filter.search).toLowerCase()))
}
beforeEach(() => {
  calls = []; countCalls = []; productRows = { sports: 125, casino: 125, matka: 125 }; networkFail = false; graphFail = false; exportBlob = undefined
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((blob: Blob) => { exportBlob = blob; return 'blob:preview' }) }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
test('query preserves player/product/date/paging filters and independent product pagination', async () => {
  page({ playerId: 'player-1', dateRange: '7d', dateFrom: 'from-explicit', dateTo: 'to-explicit' }); await screen.findByRole('table', { name: 'Sports player bets' })
  assert.deepEqual(calls[0], { playerId: 'player-1', filter: { product: 'sports', status: null, walletType: null, search: null, dateFrom: 'from-explicit', dateTo: 'to-explicit', limit: 50, offset: 0 } })
  fireEvent.click(screen.getByRole('button', { name: 'Next page' })); await waitFor(() => assert.ok(calls.some(call => call.filter.product === 'sports' && call.filter.offset === 50)))
  fireEvent.click(screen.getByRole('tab', { name: /^Casino/ })); await screen.findByRole('table', { name: 'Casino player bets' }); assert.equal(calls.at(-1)?.filter.offset, 0)
  fireEvent.click(screen.getByRole('tab', { name: /^Sports/ })); await screen.findByRole('table', { name: 'Sports player bets' }); assert.equal(calls.at(-1)?.filter.offset, 50)
})
test('status/wallet filters retain exact values, reset pages and Clear All restores nullable filters', async () => {
  page(); await screen.findByRole('table', { name: 'Sports player bets' }); fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'lost' } }); await waitFor(() => assert.equal(calls.at(-1)?.filter.status, 'lost'))
  fireEvent.change(screen.getByRole('combobox', { name: 'Wallet' }), { target: { value: 'referralBonus' } }); await waitFor(() => assert.equal(calls.at(-1)?.filter.walletType, 'referralBonus'))
  fireEvent.click(screen.getByRole('button', { name: 'Clear all' })); await waitFor(() => assert.equal(calls.at(-1)?.filter.walletType, null)); assert.equal(calls.at(-1)?.filter.status, null); assert.equal(calls.at(-1)?.filter.offset, 0)
})
test('all original product columns, currency forwarding and public all-product columns remain', async () => {
  page(); const sports = await screen.findByRole('table', { name: 'Sports player bets' }); assert.equal(within(sports).getAllByRole('columnheader').length, 14); within(sports).getByRole('columnheader', { name: 'Liability' }); assert.ok(within(sports).getAllByText('USD 150.00').length > 0)
  fireEvent.click(screen.getByRole('tab', { name: /^Casino/ })); const casino = await screen.findByRole('table', { name: 'Casino player bets' }); assert.equal(within(casino).getAllByRole('columnheader').length, 13); within(casino).getByRole('columnheader', { name: 'Win Amt' })
  fireEvent.click(screen.getByRole('tab', { name: /^Matka/ })); const matka = await screen.findByRole('table', { name: 'Matka player bets' }); assert.equal(within(matka).getAllByRole('columnheader').length, 13); within(matka).getByRole('columnheader', { name: 'Potential Win' }); assert.ok(within(matka).getAllByText('+USD 800.00').length > 0)
  assert.equal(getAllCols(value => value, value => value).length, 13)
})
test('campaign and bet detail popovers preserve metadata including explicit zero campaign values', async () => {
  page(); const table = await screen.findByRole('table', { name: 'Sports player bets' }); fireEvent.click(within(table).getAllByRole('button', { name: 'Campaign details: Welcome, VIP' })[0]); const campaign = await screen.findByRole('dialog', { name: 'Campaign details' })
  within(campaign).getByText('Roll Over'); assert.equal(within(campaign).getAllByText('0').length, 1); within(campaign).getByText('0%'); within(campaign).getByText('10x')
  fireEvent.keyDown(campaign, { key: 'Escape' }); await waitFor(() => assert.equal(Boolean(screen.queryByRole('dialog', { name: 'Campaign details' })), false))
  fireEvent.click(screen.getByRole('button', { name: 'View details for bet sports-0' })); const details = await screen.findByRole('dialog', { name: 'Bet Details' }); within(details).getByText('192.0.2.1'); within(details).getByText('Preview browser')
})
test('search queries all bets before pagination and export requests the complete filtered result', async () => {
  page(); await screen.findByRole('table', { name: 'Sports player bets' }); const before = calls.length; fireEvent.change(screen.getByRole('textbox', { name: 'Search bets' }), { target: { value: 'India v' } }); await waitFor(() => assert.equal(calls.at(-1)?.filter.search, 'India v')); const table = await screen.findByRole('table', { name: 'Sports player bets' }); await waitFor(() => assert.equal(within(table).getAllByRole('row').length, 2)); assert.ok(calls.length > before)
  fireEvent.click(screen.getByRole('button', { name: 'Export' })); await waitFor(() => assert.ok(exportBlob)); assert.equal(calls.at(-1)?.filter.limit, 500); assert.equal((HTMLAnchorElement.prototype.click as ReturnType<typeof vi.fn>).mock.calls.length, 1); assert.equal((URL.revokeObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0], 'blob:preview')
})
test('network failure pauses requests but Retry reconnects, and GraphQL-only Retry actually refetches', async () => {
  networkFail = true; const failed = page(); await screen.findByText('Error loading bets'); await screen.findByText('Network offline'); networkFail = false; await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })) }); await screen.findByRole('table', { name: 'Sports player bets' }); assert.equal(calls.length, 2); failed.unmount()
  graphFail = true; page(); await screen.findByText('GraphQL bet read refused'); const before = calls.length; graphFail = false; await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })) }); await screen.findByRole('table', { name: 'Sports player bets' }); assert.equal(calls.length, before + 1)
})
test('every product total shows up front, and the tab opens on the first product that has bets', async () => {
  // A casino-only player: the headline and the product tabs used to read 0 until the Casino tab was opened.
  productRows = { sports: 0, casino: 7, matka: 0 }
  page(); const casino = await screen.findByRole('table', { name: 'Casino player bets' })
  await waitFor(() => assert.equal((screen.getByText('Total Bets').nextElementSibling as HTMLElement).textContent, '7'))
  for (const name of ['Sports (0)', 'Casino (7)', 'Matka (0)']) assert.ok(screen.getByRole('tab', { name }), name)
  assert.equal(within(casino).getAllByRole('row').length, 8, 'the header and the 7 casino bets')
  // One request counts all three products under the page's own filters, one row each.
  const filter = { status: null, walletType: null, search: null, dateFrom: null, dateTo: null, limit: 1, offset: 0 }
  assert.deepEqual(countCalls[0], { playerId: 'player-1', sports: { product: 'sports', ...filter }, casino: { product: 'casino', ...filter }, matka: { product: 'matka', ...filter } })
  // A product the admin picks stays open, bets or not.
  fireEvent.click(screen.getByRole('tab', { name: 'Matka (0)' })); await screen.findByRole('table', { name: 'Matka player bets' })
  await screen.findByText('No bets found')
  assert.equal(screen.getByRole('tab', { name: 'Matka (0)' }).getAttribute('aria-selected'), 'true')
})
