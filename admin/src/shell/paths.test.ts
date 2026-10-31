/**
 * normalizePath and pathMatches decide which row counts as the "active" row for the current
 * pathname (decision 7, resolveSection). A wrong boundary rule would make '/playersX' match
 * '/players', or drop a trailing slash inconsistently between the router and the panel.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { normalizePath, pathMatches } from './paths'

describe('normalizePath', () => {
  test('drops query and hash, trims trailing slashes, and turns empty into the root (N1)', () => {
    assert.deepEqual(
      ['/players/', '/', '', '/a?b=1#c', '//', '/settlement?tab=history'].map(normalizePath),
      ['/players', '/', '/', '/a', '/', '/settlement'],
    )
  })
})

describe('pathMatches', () => {
  test('matches the target itself or a child on a "/" boundary, never a same-prefix sibling (N2)', () => {
    assert.equal(pathMatches('/players/create', '/players'), true)
    assert.equal(pathMatches('/playersX', '/players'), false)
    assert.equal(pathMatches('/bets/', '/bets'), true)
    assert.equal(pathMatches('/anything', '/'), false)
    assert.equal(pathMatches('/', '/'), true)
  })
})
