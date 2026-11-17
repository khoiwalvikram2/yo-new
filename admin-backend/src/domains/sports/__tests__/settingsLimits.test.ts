import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { defaultStakeLimitsProblem, sportsLimitsProblem, stakePairProblem } from '@src/domains/sports/settingsLimits.js'

describe('sports settings limits', () => {
  it('refuses a min stake above its max, naming both', () => {
    assert.equal(
      sportsLimitsProblem({ exchangeMinStake: 5000, exchangeMaxStake: 100 }),
      'Exchange Min Stake (5000) cannot exceed Exchange Max Stake (100).',
    )
    assert.match(sportsLimitsProblem({ fancyMinStake: '20.00', fancyMaxStake: '10.00' }) ?? '', /^Fancy Min Stake \(20\)/)
    assert.match(stakePairProblem('Bookmaker', -1, null) ?? '', /cannot be negative/)
  })

  it('refuses odds below 1.01 and a min odds above the max', () => {
    assert.equal(sportsLimitsProblem({ exchangeMinOdds: 0 }), 'Min Odds must be at least 1.01.')
    assert.equal(sportsLimitsProblem({ exchangeMaxOdds: 1 }), 'Max Odds must be at least 1.01.')
    assert.equal(sportsLimitsProblem({ exchangeMinOdds: 50, exchangeMaxOdds: 1.5 }), 'Min Odds (50) cannot exceed Max Odds (1.5).')
  })

  it('accepts agreeing limits, equal pairs and unset fields', () => {
    assert.equal(sportsLimitsProblem({}), null)
    assert.equal(sportsLimitsProblem({ exchangeMinStake: 100, exchangeMaxStake: 100, exchangeMinOdds: 1.01, exchangeMaxOdds: 1000 }), null)
    assert.equal(sportsLimitsProblem({ exchangeMinStake: 5000, exchangeMaxStake: null, bookmakerMaxStake: 0, fancyMinStake: undefined }), null)
  })

  it('checks the app-config default stake limits by their own keys', () => {
    assert.deepEqual(defaultStakeLimitsProblem({ exchangeMin: 10, exchangeMax: 100000, bookmakerMin: 500, bookmakerMax: 50 }), {
      field: 'bookmakerMin',
      message: 'Bookmaker Min Stake (500) cannot exceed Bookmaker Max Stake (50).',
    })
    assert.equal(defaultStakeLimitsProblem({ exchangeMin: 10, exchangeMax: 100000, fancyMin: null }), null)
  })
})
