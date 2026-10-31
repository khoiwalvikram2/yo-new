/**
 * Spec decision 14: the rail's brand tile shows the whitelabel's initials the way the mockup shows
 * "G7" for GoldBet77, and the profile Avatar uses the same rule. A wrong rule shows the wrong brand
 * mark on every page, so each branch of the rule has a named case here, plus the fallback that
 * brandInitials (T23) turns into "GD".
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { initialsOf } from './initials'

describe('initialsOf', () => {
  test('a name ending in a digit gives its first alphanumeric and its last digit', () => {
    assert.equal(initialsOf('GoldBet77'), 'G7')
    assert.equal(initialsOf('Win-99'), 'W9')
    assert.equal(initialsOf('Bet 365'), 'B5')
    assert.equal(initialsOf('agent77'), 'A7')
  })

  test('two or more words give the first alphanumeric of each of the first two words', () => {
    assert.equal(initialsOf('Royal Casino'), 'RC')
    assert.equal(initialsOf('Rahul S.'), 'RS')
    assert.equal(initialsOf('royal casino club'), 'RC')
  })

  test('otherwise the first two alphanumerics, skipping words that have none', () => {
    assert.equal(initialsOf('Winzo'), 'WI')
    assert.equal(initialsOf('GameDash'), 'GA')
    assert.equal(initialsOf('- Casino'), 'CA')
  })

  test('a name with a single alphanumeric character gives that character', () => {
    assert.equal(initialsOf('X'), 'X')
    assert.equal(initialsOf('7'), '7')
    assert.equal(initialsOf(' 7 '), '7')
    assert.equal(initialsOf('x.'), 'X')
  })

  test('surrounding and repeated whitespace is ignored', () => {
    assert.equal(initialsOf('  GoldBet77  '), 'G7')
    assert.equal(initialsOf('  Royal   Casino '), 'RC')
  })

  test('letters in any script count as alphanumeric', () => {
    assert.equal(initialsOf('élodie durand'), 'ÉD')
    assert.equal(initialsOf('李 小龙'), '李小')
  })

  test('a name with no alphanumeric character gives the fallback', () => {
    assert.equal(initialsOf(null, 'GD'), 'GD')
    assert.equal(initialsOf(undefined, 'GD'), 'GD')
    assert.equal(initialsOf('', 'GD'), 'GD')
    assert.equal(initialsOf('   ', 'GD'), 'GD')
    assert.equal(initialsOf('--', 'GD'), 'GD')
    assert.equal(initialsOf('Winzo', 'GD'), 'WI')
  })

  test('the fallback defaults to an empty string', () => {
    assert.equal(initialsOf(null), '')
    assert.equal(initialsOf(''), '')
    assert.equal(initialsOf('--'), '')
  })
})
