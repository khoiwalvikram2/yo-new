/**
 * The referral upline that tiered rules (LOSS_SHARE) pay, and the tier rates they read. No database: the "who
 * referred this person" reader is a fake. The same walk against the database, through a real bet settlement, is in
 * referralUpline.integration.test.ts.
 *
 * Before: each step read the attributions in which the current person was the REFERRER (its own referees), so
 * tiers 2-4 repeated the direct referrer, the real upline never earned, and the direct referrer was paid once per
 * tier. Each step now reads who referred the current referrer.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/services/referrals/__tests__/referralUpline.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { tierValue, walkReferralUpline, type ReferrerOfReader } from '../rewardsCalculator.js'

/** Who referred whom: referee id -> referrer id. */
function fakeReader(referredBy: Record<number, number>) {
	const reads: Array<[number, string]> = []
	const read: ReferrerOfReader = async (userId, tenant) => {
		reads.push([userId, tenant])
		return referredBy[userId] ?? null
	}
	return { reads, read }
}

after(async () => {
	// Importing the calculator loads the db client; close its pool so the run can exit.
	const { pool } = await import('@src/db/client.js')
	await pool.end().catch(() => {})
})

describe('walkReferralUpline: who each tier pays', () => {
	// The referee 100 was referred by 1; 1 by 2; 2 by 3; 3 by 4; 4 by 5.
	const chain = { 100: 1, 1: 2, 2: 3, 3: 4, 4: 5 }

	it('a 4-level chain pays tiers 1-4 to four different people, each the referrer of the one below', async () => {
		const f = fakeReader(chain)
		assert.deepEqual(await walkReferralUpline('t1', 1, 4, f.read, 100), [
			{ referrerId: 1, tier: 1 },
			{ referrerId: 2, tier: 2 },
			{ referrerId: 3, tier: 3 },
			{ referrerId: 4, tier: 4 },
		])
		// Each step asks who referred the current referrer, in the event's tenant; nothing is read past tier 4.
		assert.deepEqual(f.reads, [[1, 't1'], [2, 't1'], [3, 't1']])
	})

	it('a 1-level chain pays only tier 1', async () => {
		const f = fakeReader({ 100: 7 })
		assert.deepEqual(await walkReferralUpline('t1', 7, 4, f.read, 100), [{ referrerId: 7, tier: 1 }])
		assert.deepEqual(f.reads, [[7, 't1']])
	})

	it("the program's depth caps the tiers, and never above 4", async () => {
		assert.deepEqual(
			(await walkReferralUpline('t1', 1, 2, fakeReader(chain).read, 100)).map((m) => m.referrerId),
			[1, 2]
		)
		assert.deepEqual(
			(await walkReferralUpline('t1', 1, 9, fakeReader(chain).read, 100)).map((m) => m.referrerId),
			[1, 2, 3, 4]
		)
		const direct = fakeReader(chain)
		assert.deepEqual(await walkReferralUpline('t1', 1, 1, direct.read, 100), [{ referrerId: 1, tier: 1 }])
		assert.deepEqual(direct.reads, [], 'one tier needs no upline read')
		assert.deepEqual(await walkReferralUpline('t1', 1, 0, fakeReader(chain).read, 100), [])
	})

	it('a cycle stops: nobody is paid twice for one event', async () => {
		// 1 referred 100; 2 referred 1; 1 referred 2.
		const f = fakeReader({ 100: 1, 1: 2, 2: 1 })
		assert.deepEqual(await walkReferralUpline('t1', 1, 4, f.read, 100), [
			{ referrerId: 1, tier: 1 },
			{ referrerId: 2, tier: 2 },
		])
		// The referee itself, met on the way up, is not paid on its own loss either.
		assert.deepEqual(await walkReferralUpline('t1', 1, 4, fakeReader({ 100: 1, 1: 100, 3: 4 }).read, 100), [
			{ referrerId: 1, tier: 1 },
		])
		// A person who referred themselves.
		assert.deepEqual(await walkReferralUpline('t1', 5, 4, fakeReader({ 5: 5 }).read), [{ referrerId: 5, tier: 1 }])
	})

	it('an agent referral (referrer 0) or an invalid id is no user upline', async () => {
		assert.deepEqual(await walkReferralUpline('t1', 0, 4, fakeReader({}).read, 100), [])
		assert.deepEqual(await walkReferralUpline('t1', Number.NaN, 4, fakeReader({}).read, 100), [])
		assert.deepEqual(
			await walkReferralUpline('t1', 1, 4, fakeReader({ 1: 0 }).read, 100),
			[{ referrerId: 1, tier: 1 }],
			'the walk stops at a referrer 0'
		)
	})

	it('a failed read is not swallowed', async () => {
		const broken: ReferrerOfReader = async () => {
			throw new Error('connection lost')
		}
		await assert.rejects(walkReferralUpline('t1', 1, 4, broken, 100), /connection lost/)
	})
})

describe('tierValue: the tier rates in the shape the admin editor saves', () => {
	it('reads the editor\'s shape, {"1": 10, "2": 5} (numeric keys arrive as strings from the database)', () => {
		const saved = JSON.parse('{"1": 10, "2": 5, "3": 2.5, "4": 1}')
		assert.deepEqual([1, 2, 3, 4].map((tier) => tierValue(saved, tier)), [10, 5, 2.5, 1])
		assert.equal(tierValue({ 1: 10 }, 1), 10)
	})

	it('reads the older "tier1" shape too, and the editor\'s key first when both are there', () => {
		assert.equal(tierValue({ tier2: 5 }, 2), 5)
		assert.equal(tierValue({ '2': 7, tier2: 5 }, 2), 7)
	})

	it('a missing, empty or non-numeric entry is 0; a numeric string is its number', () => {
		assert.equal(tierValue({ '1': 10 }, 3), 0)
		assert.equal(tierValue({}, 1), 0)
		assert.equal(tierValue(null, 1), 0)
		assert.equal(tierValue(undefined, 1), 0)
		assert.equal(tierValue({ '1': 'abc' }, 1), 0)
		assert.equal(tierValue({ '1': '12.5' }, 1), 12.5)
	})
})
