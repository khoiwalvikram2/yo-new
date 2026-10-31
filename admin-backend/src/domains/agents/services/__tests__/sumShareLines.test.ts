import test from 'node:test'
import assert from 'node:assert/strict'
import { sumShareLines } from '../SettlementService.js'

// CR-16: settlement totals must come from SHARE lines ONLY. Summing SETTLEMENT/ADJUSTMENT
// lines double-counts prior settlements on re-settle and causes double-settle.

test('sumShareLines sums only SHARE lines', () => {
	const lines = [
		{ lineType: 'SHARE', amount: 100 },
		{ lineType: 'SHARE', amount: 50 },
	]
	assert.equal(sumShareLines(lines), 150)
})

test('sumShareLines ignores SETTLEMENT lines (prevents double-count on re-settle)', () => {
	const lines = [
		{ lineType: 'SHARE', amount: 100 },
		{ lineType: 'SETTLEMENT', amount: -100 }, // prior settlement
		{ lineType: 'SHARE', amount: 40 },
	]
	// Old buggy behavior summed everything → 40. SHARE-only → 140.
	assert.equal(sumShareLines(lines), 140)
})

test('sumShareLines ignores ADJUSTMENT lines', () => {
	const lines = [
		{ lineType: 'SHARE', amount: 200 },
		{ lineType: 'ADJUSTMENT', amount: 999 },
		{ lineType: 'COMMISSION', amount: 12 },
	]
	assert.equal(sumShareLines(lines), 200)
})

test('sumShareLines handles string amounts and non-finite values', () => {
	const lines = [
		{ lineType: 'SHARE', amount: '75.5' },
		{ lineType: 'SHARE', amount: 'not-a-number' },
		{ lineType: 'SHARE', amount: 24.5 },
	]
	assert.equal(sumShareLines(lines), 100)
})

test('sumShareLines returns 0 when no SHARE lines', () => {
	assert.equal(sumShareLines([{ lineType: 'SETTLEMENT', amount: 500 }]), 0)
	assert.equal(sumShareLines([]), 0)
})
