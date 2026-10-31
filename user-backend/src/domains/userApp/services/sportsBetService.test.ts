import assert from 'node:assert/strict'
import test from 'node:test'
import { __sportsBetTestUtils } from './sportsBetService.js'

const { normalizeMarketType, mergeSettings, pickSettings, normalizeLegs } = __sportsBetTestUtils

test('normalizeMarketType maps variants to exchange/bookmaker/fancy', () => {
  assert.equal(normalizeMarketType('EXCHANGE'), 'exchange')
  assert.equal(normalizeMarketType('bookmaker'), 'bookmaker')
  assert.equal(normalizeMarketType('fancy'), 'fancy')
  assert.equal(normalizeMarketType(undefined), 'exchange')
})

test('mergeSettings prefers event over league over sport and falls back to defaults', () => {
  const sport = { exchangeMinStake: 10, exchangeMaxStake: 200, exchangeExposureCap: 500 }
  const league = { exchangeMinStake: 20, exchangeExposureCap: 400 }
  const event = { exchangeMinStake: 30, exchangeMaxStake: 150 }

  const merged = mergeSettings(sport, league, event)
  const exchange = pickSettings(merged, 'exchange')

  assert.equal(exchange.minStake, 30) // event overrides league and sport
  assert.equal(exchange.maxStake, 150) // event value used
  assert.equal(exchange.exposureCap, 400) // falls back to league when event missing
})

test('mergeSettings uses sport defaults when league/event empty', () => {
  const sport = { exchangeMinStake: 5, exchangeMaxStake: 50, exchangeExposureCap: 120 }
  const merged = mergeSettings(sport, null, null)
  const exchange = pickSettings(merged, 'exchange')

  assert.equal(exchange.minStake, 5)
  assert.equal(exchange.maxStake, 50)
  assert.equal(exchange.exposureCap, 120)
})

test('normalizeLegs uses provided legs or legacy payload', () => {
  const fromInput = normalizeLegs({ stake: 99, legs: [{ eventId: 'e1', marketId: 'm1', selectionId: 's1', selectionType: 'back', odds: 2 }] }, null)
  assert.equal(fromInput.length, 1)
  assert.equal(fromInput[0]?.stake, 99)

  const fromLegacy = normalizeLegs(null, {
    eventId: 'e2',
    marketId: 'm2',
    selectionId: 's2',
    selectionType: 'lay',
    odds: 3,
    stake: 40,
  })
  assert.equal(fromLegacy.length, 1)
  assert.equal(fromLegacy[0]?.selectionType, 'lay')
  assert.equal(fromLegacy[0]?.stake, 40)
})

