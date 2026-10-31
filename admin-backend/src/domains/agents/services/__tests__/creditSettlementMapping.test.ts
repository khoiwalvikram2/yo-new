/**
 * mapGrossSettlementToCredit: a settled bet's GROSS return (stake included) becomes the
 * (betResult, payoutAmount) pair BetCreditValidationService.releaseCreditForBet expects,
 * so a credit player's settlement balance moves by exactly the bet's net P&L.
 *
 * releaseCreditForBet moves the settlement balance by +payoutAmount on 'win' and by
 * -(payoutAmount > 0 ? payoutAmount : betAmount) on 'loss'. `settlementDelta` below is that
 * rule, so every case can assert the end result (delta = gross - stake) and not only the
 * shape. Mirrors user-backend's mapCasinoSettlementToCredit, plus rounding to cents.
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mapGrossSettlementToCredit } from '../creditSettlementMapping.js'

/** The settlement-balance move releaseCreditForBet makes for this pair. */
function settlementDelta(stake: number, m: { betResult: 'win' | 'loss'; payoutAmount: number }): number {
	if (m.betResult === 'win') return m.payoutAmount
	return -(m.payoutAmount > 0 ? m.payoutAmount : stake)
}

describe('mapGrossSettlementToCredit', () => {
	test('a win above the stake pays the net profit, not the gross return', () => {
		const m = mapGrossSettlementToCredit(100, 250)
		assert.deepEqual(m, { betResult: 'win', payoutAmount: 150 })
		assert.equal(settlementDelta(100, m), 150)
	})

	test('a return equal to the stake is a win with a 0 delta', () => {
		const m = mapGrossSettlementToCredit(100, 100)
		assert.deepEqual(m, { betResult: 'win', payoutAmount: 0 })
		assert.equal(settlementDelta(100, m), 0)
	})

	test('a partial return below the stake is a loss of stake - gross', () => {
		const m = mapGrossSettlementToCredit(100, 40)
		assert.deepEqual(m, { betResult: 'loss', payoutAmount: 60 })
		assert.equal(settlementDelta(100, m), -60)
	})

	test('a total loss (gross 0) is a -stake delta', () => {
		const m = mapGrossSettlementToCredit(100, 0)
		assert.deepEqual(m, { betResult: 'loss', payoutAmount: 100 })
		assert.equal(settlementDelta(100, m), -100)
	})

	test('rounds to cents', () => {
		// 250.1 - 100.2 is 149.89999999999998 in floating point.
		assert.deepEqual(mapGrossSettlementToCredit(100.2, 250.1), { betResult: 'win', payoutAmount: 149.9 })
		assert.deepEqual(mapGrossSettlementToCredit(100, 33.333), { betResult: 'loss', payoutAmount: 66.67 })
	})

	test('a shortfall under half a cent is a 0 win, never a loss of 0 (which would debit the full stake)', () => {
		const m = mapGrossSettlementToCredit(10, 9.996)
		assert.equal(m.betResult, 'win')
		assert.ok(Object.is(m.payoutAmount, 0), 'payoutAmount is +0, not -0')
		assert.equal(settlementDelta(10, m), 0)
	})

	test('the settlement delta equals the rounded net P&L across stakes and returns', () => {
		for (const stake of [1, 10, 99.99, 100, 2500.5]) {
			for (const gross of [0, 0.01, stake / 3, stake - 0.01, stake, stake + 0.01, stake * 1.9, stake * 36]) {
				const m = mapGrossSettlementToCredit(stake, gross)
				const net = Math.round((gross - stake) * 100) / 100
				assert.equal(settlementDelta(stake, m), net === 0 ? 0 : net, `stake ${stake} gross ${gross}`)
				assert.ok(m.payoutAmount >= 0, 'releaseCreditForBet rejects a negative payoutAmount')
			}
		}
	})

	test('a negative or non-finite amount is refused rather than turned into an over-sized loss', () => {
		assert.throws(() => mapGrossSettlementToCredit(100, -5), RangeError)
		assert.throws(() => mapGrossSettlementToCredit(100, Number.NaN), RangeError)
		assert.throws(() => mapGrossSettlementToCredit(Number.NaN, 100), RangeError)
	})
})
