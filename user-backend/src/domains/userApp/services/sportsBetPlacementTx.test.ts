/**
 * Unit tests for sports placement helpers (no DB).
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { computeSportsPlacementLiability } from './sportsBetPlacementTx.js'

test('computeSportsPlacementLiability exchange back = stake', () => {
  assert.equal(computeSportsPlacementLiability('exchange', 'back', 100, 2.0, null), 100)
})

test('computeSportsPlacementLiability exchange lay = (odds-1)*stake', () => {
  assert.equal(computeSportsPlacementLiability('exchange', 'lay', 100, 3.0, null), 200)
})

test('computeSportsPlacementLiability fancy back with oddsSize uses stake liability', () => {
  assert.equal(computeSportsPlacementLiability('fancy', 'back', 50, 10, 100), 50)
})

test('computeSportsPlacementLiability fancy lay uses stake * oddsSize/100', () => {
  assert.equal(computeSportsPlacementLiability('fancy', 'lay', 100, 5, 80), 80)
})
