/**
 * Commission tally rules: tally OFF no cross-offset, tally ON cross-offset, zero-payable clamp.
 * Run with: node --import tsx --test src/domains/agents/services/__tests__/commissionTallyRules.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { applyTallyRulesForSettlement } from '../commissionTallyRules.js';

describe('Commission tally rules', () => {
	it('tally OFF: one negative domain + one positive domain => no cross-offset', () => {
		// Sports +100, Casino -50, Matka +20. Tally OFF => effective = 100 + 0 + 20 = 120
		const r = applyTallyRulesForSettlement(100, -50, 20, false, null);
		assert.strictEqual(r.effectiveSportsCommission, 100);
		assert.strictEqual(r.effectiveCasinoCommission, 0);
		assert.strictEqual(r.effectiveMatkaCommission, 20);
		assert.strictEqual(r.effectiveCalculatedTotal, 120);
	});

	it('tally OFF: empty tallyDomains => same as disabled', () => {
		const r = applyTallyRulesForSettlement(100, -50, 20, true, []);
		assert.strictEqual(r.effectiveCalculatedTotal, 120);
	});

	it('tally ON: selected domains include negative => cross-offset applies', () => {
		// Sports +100, Casino -50, Matka +20. Tally ON [sports, casino, matka] => group net = 70, contribution = 70
		const r = applyTallyRulesForSettlement(100, -50, 20, true, ['sports', 'casino', 'matka']);
		assert.strictEqual(r.effectiveCalculatedTotal, 70);
		assert.ok(r.effectiveSportsCommission > 0);
		assert.ok(r.effectiveCasinoCommission <= 0); // negative raw => proportional negative share of positive total
		assert.ok(r.effectiveMatkaCommission > 0);
	});

	it('tally ON: group net negative => effective total 0', () => {
		// Sports +10, Casino -50, Matka +10 => group net -30
		const r = applyTallyRulesForSettlement(10, -50, 10, true, ['sports', 'casino', 'matka']);
		assert.strictEqual(r.effectiveCalculatedTotal, 0);
		assert.strictEqual(r.effectiveSportsCommission, 0);
		assert.strictEqual(r.effectiveCasinoCommission, 0);
		assert.strictEqual(r.effectiveMatkaCommission, 0);
	});

	it('tally ON: partial domains (sports + casino only)', () => {
		// Sports +100, Casino -30, Matka +50. Tally [sports, casino] => group 70; matka separate max(0,50)=50
		const r = applyTallyRulesForSettlement(100, -30, 50, true, ['sports', 'casino']);
		assert.strictEqual(r.effectiveCalculatedTotal, 70 + 50);
		assert.strictEqual(r.effectiveMatkaCommission, 50);
	});

	it('zero-payable clamp: final net <= 0 => effective total 0', () => {
		const r = applyTallyRulesForSettlement(-10, -5, 0, true, ['sports', 'casino', 'matka']);
		assert.strictEqual(r.effectiveCalculatedTotal, 0);
	});

	it('SHARING/CREDIT non-regression: tally logic does not affect non-commission (caller uses effective total only for COMMISSION)', () => {
		// Just ensure the function is deterministic and does not throw for valid inputs
		const r = applyTallyRulesForSettlement(0, 0, 0, false, null);
		assert.strictEqual(r.effectiveCalculatedTotal, 0);
		assert.strictEqual(r.effectiveSportsCommission, 0);
		assert.strictEqual(r.effectiveCasinoCommission, 0);
		assert.strictEqual(r.effectiveMatkaCommission, 0);
	});
});
