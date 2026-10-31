import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  eventHasAnyAllowedProviderMarket,
  isAllowedIngestMarketName,
  normalizeIngestMarketName,
} from '../ingestMarketAllowlist.js'

describe('isAllowedIngestMarketName', () => {
  it('allows Match Odds with case, trim, and internal whitespace', () => {
    assert.equal(isAllowedIngestMarketName('Match Odds'), true)
    assert.equal(isAllowedIngestMarketName('  match odds  '), true)
    assert.equal(isAllowedIngestMarketName('MATCH ODDS'), true)
  })

  it('rejects Completed Match, Tied Match, and other provider names', () => {
    assert.equal(isAllowedIngestMarketName('Completed Match'), false)
    assert.equal(isAllowedIngestMarketName('Tied Match'), false)
    assert.equal(isAllowedIngestMarketName('Match Odds Including Tie'), false)
    assert.equal(isAllowedIngestMarketName('To Win the Toss'), false)
    assert.equal(isAllowedIngestMarketName('1st Innings 10 Overs Line'), false)
    assert.equal(isAllowedIngestMarketName('1st Innings Runs'), false)
    assert.equal(isAllowedIngestMarketName('Nicholas Pooran Runs Line'), false)
  })

  it('normalizes internal whitespace for Match Odds', () => {
    assert.equal(normalizeIngestMarketName('Match   Odds'), 'match odds')
    assert.equal(isAllowedIngestMarketName('Match   Odds'), true)
  })
})

describe('eventHasAnyAllowedProviderMarket', () => {
  it('returns true when the list includes Match Odds', () => {
    assert.equal(
      eventHasAnyAllowedProviderMarket([
        { marketName: 'To Win the Toss' },
        { marketName: 'Match Odds' },
      ]),
      true
    )
  })

  it('returns false when there is no Match Odds (e.g. only Completed Match)', () => {
    assert.equal(
      eventHasAnyAllowedProviderMarket([
        { marketName: 'Completed Match' },
        { marketName: 'Tied Match' },
      ]),
      false
    )
  })

  it('returns false when none match', () => {
    assert.equal(
      eventHasAnyAllowedProviderMarket([{ marketName: 'Top Batter' }, { marketName: '1st Innings Runs' }]),
      false
    )
  })
})
