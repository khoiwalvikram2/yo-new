import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'
import { playerBetSearch, playerBetTotals, playerBetsCsv, resolveDateRange, type BetRow } from './playerBetsModel'
afterEach(() => vi.useRealTimers())
function row(overrides: Partial<BetRow> = {}): BetRow { return { id: 'bet-1', product: 'sports', userId: 'player-1', status: 'won', stake: 100, liability: 200, return: 130, netAmount: 30, currency: 'INR', createdAt: '2026-10-09T10:00:00Z', settledAt: null, ...overrides } }
test('date range preserves explicit pairs and the original inclusive IST calendar windows', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
  assert.deepEqual(resolveDateRange('today', 'explicit-from', 'explicit-to'), { from: 'explicit-from', to: 'explicit-to' })
  assert.deepEqual(resolveDateRange('all_time', null, null), {})
  assert.deepEqual(resolveDateRange('today', null, null), { from: '2026-10-08T18:30:00.000Z', to: '2026-10-09T18:29:59.999Z' })
  assert.deepEqual(resolveDateRange('yesterday', null, null), { from: '2026-10-07T18:30:00.000Z', to: '2026-10-08T18:29:59.999Z' })
  assert.deepEqual(resolveDateRange('7d', null, null), { from: '2026-10-01T18:30:00.000Z', to: '2026-10-09T18:29:59.999Z' })
})
test('search is case-insensitive, current-page-only and includes all original name fields', () => {
  const rows = [row({ id: 'one', eventName: 'India v Australia' }), row({ id: 'two', product: 'casino', campaign: { id: 'campaign', name: 'Welcome Package' } })]
  assert.deepEqual(playerBetSearch(rows, 'AUSTRALIA').map(item => item.id), ['one'])
  assert.deepEqual(playerBetSearch(rows, 'package').map(item => item.id), ['two'])
  assert.equal(playerBetSearch(rows, ''), rows)
})
test('totals preserve sports liability fallback and Matka void/cancelled exclusions', () => {
  const rows = [row({ stake: 50, liability: 0, pl: 20 }), row({ id: 'casino', product: 'casino', stake: 10, netAmount: -5 }), row({ id: 'matka', product: 'matka', stake: 5, actualWin: 50 }), row({ id: 'void', product: 'matka', status: 'void', stake: 7, actualWin: 700 })]
  assert.deepEqual(playerBetTotals(rows), { totalStake: 72, totalPL: 60, currency: 'INR' })
  assert.deepEqual(playerBetTotals([]), { totalStake: 0, totalPL: 0, currency: 'INR' })
})
test('CSV keeps original raw money/currency fields while safely quoting commas/quotes/newlines', () => {
  const text = playerBetsCsv([row({ campaign: { id: 'campaign', name: 'Welcome, "VIP"\nBonus' }, return: 0, netAmount: 0, walletType: 'referralBonus' })])
  assert.ok(text.startsWith('Bet ID,Product,Status,Wallet,Campaign,Stake,Return,Net,Currency,Created\n'))
  assert.ok(text.includes('"Welcome, ""VIP""\nBonus"'))
  assert.ok(text.includes(',100,0,0,INR,'))
})
