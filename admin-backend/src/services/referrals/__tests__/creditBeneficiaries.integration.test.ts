/**
 * Referral cash never reaches a credit player (decision 7 of docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md),
 * through the real referral services against the database (DATABASE_URL):
 *   - loss-share: a credit referrer earns nothing from its referee's loss, while a REGULAR referrer is paid as before;
 *   - an earning a credit referrer already holds is never paid: settleEarnings, processScheduledSettlements and
 *     releaseEscrow cancel its settlement and leave its wallets untouched.
 *
 * The file builds its own tenant: a LOSS_SHARE program (tier 1: 10%), a WHITELABEL_CREDIT referrer C who referred
 * E1 and a REGULAR referrer R who referred E2. In after() it deletes every row of that tenant and nothing else.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/services/referrals/__tests__/creditBeneficiaries.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const hasDb = Boolean(process.env.DATABASE_URL)
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const T = `refcredit-${RUN}`

let db: any
let pgPool: any
let referrals: typeof import('../referralIntegrationService.js').referralIntegrationService
let settlements: typeof import('../settlementService.js').settlementService

const u = { C: 0, R: 0, E1: 0, E2: 0 }
let ruleId = 0
let attributionC = 0

async function q(query: ReturnType<typeof sql>): Promise<any[]> {
	const r = await db.execute(query)
	return r?.rows ?? []
}

async function mkUser(username: string, type: string): Promise<number> {
	const [row] = await q(sql`
		INSERT INTO users (tenant, name, username, password_hash, player_type, status)
		VALUES (${T}, ${username + ' name'}, ${username}, 'x', ${type}, 'active')
		RETURNING id`)
	const id = Number(row.id)
	await db.execute(sql`INSERT INTO wallets (tenant, user_id, currency) VALUES (${T}, ${id}, 'INR')`)
	return id
}

async function attribute(referrerId: number, refereeId: number): Promise<number> {
	const [row] = await q(sql`
		INSERT INTO referral_attributions (tenant, referrer_id, referee_id, tier, status, confirmed_at)
		VALUES (${T}, ${referrerId}, ${refereeId}, 1, 'confirmed', now())
		RETURNING id`)
	return Number(row.id)
}

const wallet = async (userId: number) => {
	const [row] = await q(sql`SELECT cash, referral_balance, referral_bonus FROM wallets WHERE user_id = ${userId} AND tenant = ${T}`)
	return [Number(row.cash), Number(row.referral_balance), Number(row.referral_bonus)]
}
const earningsOf = async (referrerId: number) =>
	(await q(sql`SELECT id, net_amount::float8 AS net FROM referral_earnings WHERE tenant = ${T} AND referrer_id = ${referrerId} ORDER BY id`)).map(
		(r: any) => [Number(r.id), Number(r.net)]
	)
const settlementOf = async (earningId: number) =>
	(await q(sql`SELECT id, status::text AS status, escrow_status::text AS escrow FROM referral_settlements WHERE tenant = ${T} AND earning_id = ${earningId}`))[0] ?? null

/** An earning that predates the guard: written straight into referral_earnings for the credit referrer C. */
async function oldEarningForC(net: number): Promise<number> {
	const [row] = await q(sql`
		INSERT INTO referral_earnings (tenant, attribution_id, rule_id, referrer_id, referee_id, tier, rule_type, gross_amount, net_amount, currency)
		VALUES (${T}, ${attributionC}, ${ruleId}, ${u.C}, ${u.E1}, 1, 'LOSS_SHARE', ${net}, ${net}, 'INR')
		RETURNING id`)
	return Number(row.id)
}

describe('referral cash never reaches a credit player', { skip: !hasDb }, () => {
	before(async () => {
		;({ db, pool: pgPool } = await import('@src/db/client.js'))
		;({ referralIntegrationService: referrals } = await import('../referralIntegrationService.js'))
		;({ settlementService: settlements } = await import('../settlementService.js'))

		await db.execute(sql`
			INSERT INTO whitelabels (id, name, domain, status, credit_limit, credit_used, credit_available)
			VALUES (${T}, 'Referral Credit Test', ${T + '.test'}, 'active', 0, 0, 0)`)
		u.C = await mkUser(`rc_c_${RUN}`, 'WHITELABEL_CREDIT')
		u.R = await mkUser(`rc_r_${RUN}`, 'REGULAR')
		u.E1 = await mkUser(`rc_e1_${RUN}`, 'REGULAR')
		u.E2 = await mkUser(`rc_e2_${RUN}`, 'REGULAR')
		// max_depth 1: only the direct referrer is a beneficiary here.
		const [program] = await q(sql`
			INSERT INTO referral_programs (tenant, name, enabled_modes, max_depth)
			VALUES (${T}, 'Referral Credit Test', '["LOSS_SHARE"]'::jsonb, 1)
			RETURNING id`)
		const [rule] = await q(sql`
			INSERT INTO referral_rules (program_id, tenant, rule_type, tier_rates, payout_type, is_active)
			VALUES (${Number(program.id)}, ${T}, 'LOSS_SHARE', '{"1": 10}'::jsonb, 'CASH', true)
			RETURNING id`)
		ruleId = Number(rule.id)
		attributionC = await attribute(u.C, u.E1)
		await attribute(u.R, u.E2)
	})

	after(async () => {
		// handleBetSettlement checks turnover milestones on setImmediate; let those reads finish first.
		await new Promise((resolve) => setTimeout(resolve, 300))
		if (db) {
			await db.execute(sql`DELETE FROM referral_settlements WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM referral_earnings WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM referral_attributions WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM referral_budgets WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM referral_rules WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM referral_programs WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM wallet_ledger WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM ledger_entries WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM wallets WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM users WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM whitelabels WHERE id = ${T}`)
		}
		await pgPool?.end().catch(() => {})
	})

	it("loss-share: a credit referrer earns nothing from its referee's loss; a REGULAR referrer is paid as before", async () => {
		await referrals.handleBetSettlement(T, u.E1, -1000, 'INR' as any, 'sports', `bet-e1-${RUN}`)
		await referrals.handleBetSettlement(T, u.E2, -1000, 'INR' as any, 'sports', `bet-e2-${RUN}`)

		assert.deepEqual(await earningsOf(u.C), [], 'no earning is created for the credit referrer')
		assert.deepEqual(await wallet(u.C), [0, 0, 0])

		const [[earningR, net]] = await earningsOf(u.R)
		assert.equal(net, 100, '10% of the 1,000 loss')
		assert.equal((await settlementOf(earningR))?.status, 'completed')
		assert.deepEqual(await wallet(u.R), [0, 100, 0], 'paid to the referral balance')
	})

	it('an earning a credit referrer already holds is never paid: settleEarnings cancels its settlement', async () => {
		const earning = await oldEarningForC(50)
		assert.deepEqual(await settlements.settleEarnings(T, u.C), { settled: 0, failed: 0 })
		assert.equal((await settlementOf(earning))?.status, 'cancelled')
		assert.deepEqual(await wallet(u.C), [0, 0, 0])

		// A cancelled earning has its settlement: no later run picks it up again.
		assert.deepEqual(await settlements.settleEarnings(T, u.C), { settled: 0, failed: 0 })
		assert.deepEqual(await wallet(u.C), [0, 0, 0])
	})

	it('processScheduledSettlements and releaseEscrow cancel a credit referrer\'s pending settlement instead of paying it', async () => {
		const pending = await oldEarningForC(30)
		const [scheduled] = await q(sql`
			INSERT INTO referral_settlements (tenant, earning_id, referrer_id, payout_type, cash_amount, bonus_amount, currency, status, escrow_status)
			VALUES (${T}, ${pending}, ${u.C}, 'CASH', 30, 0, 'INR', 'pending', 'none')
			RETURNING id`)
		assert.deepEqual(await settlements.processScheduledSettlements(T, new Date()), { settled: 0, failed: 0 })
		assert.equal((await settlementOf(pending))?.status, 'cancelled')
		assert.ok(scheduled.id)

		const escrowed = await oldEarningForC(20)
		const [held] = await q(sql`
			INSERT INTO referral_settlements (tenant, earning_id, referrer_id, payout_type, cash_amount, bonus_amount, currency, status, escrow_status)
			VALUES (${T}, ${escrowed}, ${u.C}, 'SPLIT', 10, 10, 'INR', 'pending', 'pending_kyc')
			RETURNING id`)
		assert.equal(await settlements.releaseEscrow(T, Number(held.id)), false, 'nothing was paid')
		assert.equal((await settlementOf(escrowed))?.status, 'cancelled')
		assert.deepEqual(await wallet(u.C), [0, 0, 0], 'neither the referral balance nor the referral bonus moved')
	})
})
