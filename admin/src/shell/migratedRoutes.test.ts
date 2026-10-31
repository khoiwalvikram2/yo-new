/**
 * A migrated route renders on the kit and follows the theme toggle; every other route keeps the
 * forced-light wrapper its antd and Tailwind pages depend on (S "Migrated routes"). The marker is the
 * route's own `handle`, read from the leaf match only, so a layout route cannot flip the pages inside
 * it and a path prefix cannot flip its siblings.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { isMigratedMatch } from './migratedRoutes'

describe('isMigratedMatch', () => {
  test('is true when the leaf match carries migrated: true', () => {
    assert.equal(isMigratedMatch([{ handle: undefined }, { handle: { migrated: true } }]), true)
  })

  test('is false when the leaf carries no handle', () => {
    assert.equal(isMigratedMatch([{ handle: { migrated: true } }, {}]), false)
  })

  test('is false when a parent is migrated but the leaf is not', () => {
    // A layout route must never mark the pages it wraps.
    assert.equal(isMigratedMatch([{ handle: { migrated: true } }, { handle: { migrated: false } }]), false)
  })

  test('is false for an empty match list', () => {
    assert.equal(isMigratedMatch([]), false)
  })

  test('requires the literal true, not a truthy value', () => {
    assert.equal(isMigratedMatch([{ handle: { migrated: 1 as unknown as boolean } }]), false)
  })

  test('ignores a handle that is not an object with the flag', () => {
    assert.equal(isMigratedMatch([{ handle: 'migrated' }]), false)
    assert.equal(isMigratedMatch([{ handle: null }]), false)
  })
})
