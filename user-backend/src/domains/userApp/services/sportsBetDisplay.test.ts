import test from 'node:test'
import assert from 'node:assert/strict'
import { settledSportsBetProfit } from './sportsBetDisplay.js'

const bet = { status: 'settled', side: 'back', stake: 100, price: 2.5, liability: 150, marketType: 'exchange' }
test('historical display prefers stored settlement P/L, including a stored zero', () => {
  assert.equal(settledSportsBetProfit({ ...bet, pl: -100 }), -100)
  assert.equal(settledSportsBetProfit({ ...bet, result: 'lost', pl: 0 }), 0)
  assert.equal(settledSportsBetProfit({ ...bet, side: 'lay', result: 'won', pl: 73.25 }), 73.25)
})
test('fallback outcomes distinguish back/lay wins and losses', () => {
  assert.equal(settledSportsBetProfit({ ...bet, result: 'won' }), 150)
  assert.equal(settledSportsBetProfit({ ...bet, result: 'lost' }), -100)
  assert.equal(settledSportsBetProfit({ ...bet, side: 'lay', result: 'won' }), 100)
  assert.equal(settledSportsBetProfit({ ...bet, side: 'lay', result: 'lost' }), -150)
})
test('Fancy uses odds size and void/cancelled rows have no fallback loss', () => {
  assert.equal(settledSportsBetProfit({ ...bet, marketType: 'fancy', oddsSize: 90, result: 'won' }), 90)
  assert.equal(settledSportsBetProfit({ ...bet, marketType: 'fancy', side: 'lay', oddsSize: 90, liability: 90, result: 'lost' }), -90)
  assert.equal(settledSportsBetProfit({ ...bet, status: 'void', result: 'lost' }), 0)
  assert.equal(settledSportsBetProfit({ ...bet, status: 'cancelled' }), 0)
})
test('open rows do not expose a historical P/L in place of their potential winnings', () => {
  for (const status of ['matched', 'unmatched', 'pending', 'open']) assert.equal(settledSportsBetProfit({ ...bet, status, pl: 0 }), undefined)
})
