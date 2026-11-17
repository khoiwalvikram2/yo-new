import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapStatusesForSports } from '@src/domains/bets/resolvers/queries.js'

describe('Bet List status filter on sports bets', () => {
  it('reads settled as the won and lost bets settlement writes', () => {
    assert.deepEqual(mapStatusesForSports(['settled'])?.sort(), ['lost', 'settled', 'won'])
  })

  it('keeps the sports statuses and reads the casino/matka open statuses as open sports bets', () => {
    assert.deepEqual(mapStatusesForSports(['matched', 'cancelled', 'void', 'won', 'lost', 'unmatched']), ['matched', 'cancelled', 'void', 'won', 'lost', 'unmatched'])
    assert.deepEqual(mapStatusesForSports(['active'])?.sort(), ['matched', 'unmatched'])
    assert.deepEqual(mapStatusesForSports(['pending', 'won'])?.sort(), ['matched', 'unmatched', 'won'])
  })

  it('drops what is not a sports status and leaves no filter for none', () => {
    assert.deepEqual(mapStatusesForSports(['won', 'bogus']), ['won'])
    assert.equal(mapStatusesForSports([]), undefined)
    assert.equal(mapStatusesForSports(undefined), undefined)
  })
})
