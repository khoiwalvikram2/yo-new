import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { profileActivityEntries, profileProductRows } from './overviewModel'

describe('profileProductRows', () => {
  test('joins bets and stake, open stake, GGR and P/L per product, with each share of the stake', () => {
    const rows = profileProductRows(
      { totalMatkaStake: 1000, totalSportsOpenStake: 850, plByProduct: { sports: 500, casino: -250, matka: 750 }, ggrByProduct: { sports: -500, casino: 250, matka: -750 } },
      [{ product: 'sports', betCount: 10, totalStake: 2500 }, { product: 'Casino', betCount: 6, totalStake: 1500 }],
      [{ product: 'Sports', exposure: 850 }],
    )
    assert.deepEqual(rows.map((row) => [row.label, row.bets, row.stake, row.openStake, row.ggr, row.pl, row.share]), [
      ['Sports', 10, 2500, 850, -500, 500, 50],
      ['Casino', 6, 1500, 0, 250, -250, 30],
      // No topProducts row: the settled stake from the KPIs, and no bet count to show.
      ['Matka', null, 1000, 0, -750, 750, 20],
    ])
  })
  test('no stake at all gives every product a zero share', () => {
    assert.deepEqual(profileProductRows(undefined).map((row) => [row.stake, row.share]), [[0, 0], [0, 0], [0, 0]])
  })
})

describe('profileActivityEntries', () => {
  test('reads each kind and its figures from JSON or object metadata', () => {
    const entries = profileActivityEntries([
      { id: 'bet-1', type: 'BET', timestamp: '2026-10-28T10:00:00Z', metadata: JSON.stringify({ product: 'sports', stake: 1500, status: 'won' }) },
      { id: 'dep-1', type: 'DEPOSIT', metadata: JSON.stringify({ amount: '50000.00', method: 'UPI' }) },
      { id: 'wd-1', type: 'WITHDRAWAL', metadata: { amount: 35000 } },
      { type: 'login', metadata: 'not json' },
    ])
    assert.deepEqual(entries.map((entry) => [entry.id, entry.kind, entry.product, entry.status, entry.amount, entry.method]), [
      ['bet-1', 'bet', 'sports', 'won', 1500, undefined],
      ['dep-1', 'deposit', undefined, undefined, 50000, 'UPI'],
      ['wd-1', 'withdrawal', undefined, undefined, 35000, undefined],
      ['activity-3', 'other', undefined, undefined, undefined, undefined],
    ])
  })
})
