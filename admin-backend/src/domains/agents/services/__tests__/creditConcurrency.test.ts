import test from 'node:test'
import assert from 'node:assert/strict'
import { canApplyCreditDelta } from '../creditMath.js'

test('rejects when delta exceeds available under the locked snapshot', () => {
	assert.deepEqual(canApplyCreditDelta({ creditLimit: 100, creditUsed: 90, settlementBalance: 0 }, 20), { ok: false, reason: 'insufficient' })
	assert.deepEqual(canApplyCreditDelta({ creditLimit: 100, creditUsed: 80, settlementBalance: 0 }, 20), { ok: true, newUsed: 100 })
	assert.deepEqual(canApplyCreditDelta({ creditLimit: 100, creditUsed: 80, settlementBalance: 10 }, 25), { ok: true, newUsed: 105 })
})
