/**
 * The credit-player filter for referral beneficiaries (decision 7 of
 * docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md): which referrers are credit players, read once per
 * list. No database: the player-type reader is a fake. The services that use it are exercised against the database
 * in creditBeneficiaries.integration.test.ts.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/services/referrals/__tests__/creditBeneficiaries.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { creditPlayerIdsAmong, isCreditBeneficiary, withoutCreditBeneficiaries, type PlayerTypeReader } from '../creditBeneficiaries.js'

const TYPES: Record<number, string> = {
	1: 'REGULAR',
	2: 'AGENT_CREDIT',
	3: 'WHITELABEL_CREDIT',
	4: 'SHARING_AGENT_PLAYER',
	5: 'COMMISSION_AGENT_PLAYER',
}

function fakeReader() {
	const calls: Array<[string, number[]]> = []
	const read: PlayerTypeReader = async (tenant, ids) => {
		calls.push([tenant, ids])
		return ids.filter((id) => TYPES[id]).map((id) => ({ id, playerType: TYPES[id] }))
	}
	return { calls, read }
}

after(async () => {
	// Importing the module loads the db client; close its pool so the run can exit.
	const { pool } = await import('@src/db/client.js')
	await pool.end().catch(() => {})
})

describe('credit beneficiaries', () => {
	it('creditPlayerIdsAmong: AGENT_CREDIT and WHITELABEL_CREDIT only, in one read of the distinct valid ids', async () => {
		const f = fakeReader()
		const credit = await creditPlayerIdsAmong('t1', [1, 2, 3, 4, 5, 2, 3, 0, -1, Number.NaN, 99], f.read)
		assert.deepEqual([...credit].sort(), [2, 3])
		assert.deepEqual(f.calls, [['t1', [1, 2, 3, 4, 5, 99]]])
	})

	it('creditPlayerIdsAmong: nothing to read for an empty or invalid list', async () => {
		const f = fakeReader()
		assert.equal((await creditPlayerIdsAmong('t1', [], f.read)).size, 0)
		assert.equal((await creditPlayerIdsAmong('t1', [0, Number.NaN], f.read)).size, 0)
		assert.deepEqual(f.calls, [])
	})

	it('isCreditBeneficiary: true for a credit player only', async () => {
		const f = fakeReader()
		assert.deepEqual(
			await Promise.all([1, 2, 3, 4, 5, 99].map((id) => isCreditBeneficiary('t1', id, f.read))),
			[false, true, true, false, false, false]
		)
	})

	it('withoutCreditBeneficiaries: drops the earnings of credit referrers and keeps the rest in order', async () => {
		const f = fakeReader()
		const earnings = [
			{ referrerId: 1, tier: 1, netAmount: 10 },
			{ referrerId: 2, tier: 2, netAmount: 5 },
			{ referrerId: 4, tier: 3, netAmount: 2 },
			{ referrerId: 3, tier: 4, netAmount: 1 },
			{ referrerId: 1, tier: 1, netAmount: 7 },
		]
		const kept = await withoutCreditBeneficiaries('t1', earnings, f.read)
		assert.deepEqual(kept, [earnings[0], earnings[2], earnings[4]])
		assert.equal(f.calls.length, 1, 'one read for the whole list')
		assert.deepEqual(await withoutCreditBeneficiaries('t1', [], f.read), [])
		assert.equal(f.calls.length, 1, 'no read for no earnings')
	})

	it('a failed read is not swallowed', async () => {
		const broken: PlayerTypeReader = async () => {
			throw new Error('connection lost')
		}
		await assert.rejects(withoutCreditBeneficiaries('t1', [{ referrerId: 1 }], broken), /connection lost/)
		await assert.rejects(isCreditBeneficiary('t1', 1, broken), /connection lost/)
	})
})
