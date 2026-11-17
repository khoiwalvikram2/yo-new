/**
 * Loss share pays the real referral upline, through the real referral services against the database (DATABASE_URL):
 * a referee's settled loss pays tier 1 to the person who referred it, tier 2 to the person who referred THAT one,
 * and so on up to tier 4, at the tier rates the admin editor saves ({"1": 10, "2": 5, "3": 3, "4": 2}).
 *
 * Before: the upline walk read the attributions in which the current person was the REFERRER, so every tier went to
 * the direct referrer (one earning per tier) and the real upline never earned.
 *
 * The file builds its own tenant (vfyog-refup-*): a LOSS_SHARE program of depth 4 and these chains, every
 * attribution confirmed unless it says otherwise:
 *   - U5 -> U4 -> U3 -> U2 -> U1 -> E   (a 5-level chain: only U1-U4 are paid)
 *   - R -> E2                            (a 1-level chain)
 *   - C1 <-> C2, C1 -> E3                (a cycle)
 *   - P -(pending)-> Q -> E4             (a pending link ends the upline)
 * In after() it deletes every row of that tenant and nothing else.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/services/referrals/__tests__/referralUpline.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const hasDb = Boolean(process.env.DATABASE_URL)
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const T = `vfyog-refup-${RUN}`

let db: any
let pgPool: any
let referrals: typeof import('../referralIntegrationService.js').referralIntegrationService

const u: Record<string, number> = {}

async function q(query: ReturnType<typeof sql>): Promise<any[]> {
	const r = await db.execute(query)
	return r?.rows ?? []
}

async function mkUser(key: string): Promise<number> {
	const username = `vfyog_ru_${key.toLowerCase()}_${RUN}`
	const [row] = await q(sql`
		INSERT INTO users (tenant, name, username, password_hash, player_type, status)
		VALUES (${T}, ${username + ' name'}, ${username}, 'x', 'REGULAR', 'active')
		RETURNING id`)
	const id = Number(row.id)
	await db.execute(sql`INSERT INTO wallets (tenant, user_id, currency) VALUES (${T}, ${id}, 'INR')`)
	u[key] = id
	return id
}

async function attribute(referrer: string, referee: string, status: 'confirmed' | 'pending' = 'confirmed'): Promise<void> {
	await db.execute(sql`
		INSERT INTO referral_attributions (tenant, referrer_id, referee_id, tier, status, confirmed_at)
		VALUES (${T}, ${u[referrer]}, ${u[referee]}, 1, ${status}, ${status === 'confirmed' ? sql`now()` : null})`)
}

/** The earnings of one referee's loss, as [referrer key, tier, net amount], in tier order. */
async function earningsFor(referee: string): Promise<Array<[string, number, number]>> {
	const names = new Map(Object.entries(u).map(([key, id]) => [id, key]))
	const rows = await q(sql`
		SELECT referrer_id, tier, net_amount::float8 AS net FROM referral_earnings
		WHERE tenant = ${T} AND referee_id = ${u[referee]} ORDER BY tier, id`)
	return rows.map((r: any) => [names.get(Number(r.referrer_id)) ?? String(r.referrer_id), Number(r.tier), Number(r.net)])
}

const referralBalance = async (key: string) =>
	Number((await q(sql`SELECT referral_balance FROM wallets WHERE user_id = ${u[key]} AND tenant = ${T}`))[0].referral_balance)

const lose = (referee: string, amount: number) =>
	referrals.handleBetSettlement(T, u[referee], -amount, 'INR' as any, 'sports', `vfyog-bet-${referee}-${RUN}`)

describe('loss share pays the real referral upline, tiers 1-4', { skip: !hasDb }, () => {
	before(async () => {
		;({ db, pool: pgPool } = await import('@src/db/client.js'))
		;({ referralIntegrationService: referrals } = await import('../referralIntegrationService.js'))

		await db.execute(sql`
			INSERT INTO whitelabels (id, name, domain, status, credit_limit, credit_used, credit_available)
			VALUES (${T}, 'Referral Upline Test', ${T + '.test'}, 'active', 0, 0, 0)`)
		for (const key of ['U1', 'U2', 'U3', 'U4', 'U5', 'E', 'R', 'E2', 'C1', 'C2', 'E3', 'P', 'Q', 'E4']) await mkUser(key)
		const [program] = await q(sql`
			INSERT INTO referral_programs (tenant, name, enabled_modes, max_depth)
			VALUES (${T}, 'Referral Upline Test', '["LOSS_SHARE"]'::jsonb, 4)
			RETURNING id`)
		// The shape the admin referral editor saves (referralRulesModel.ts): keyed by the tier number.
		await db.execute(sql`
			INSERT INTO referral_rules (program_id, tenant, rule_type, tier_rates, payout_type, is_active)
			VALUES (${Number(program.id)}, ${T}, 'LOSS_SHARE', '{"1": 10, "2": 5, "3": 3, "4": 2}'::jsonb, 'CASH', true)`)

		await attribute('U1', 'E')
		await attribute('U2', 'U1')
		await attribute('U3', 'U2')
		await attribute('U4', 'U3')
		await attribute('U5', 'U4')
		await attribute('R', 'E2')
		await attribute('C1', 'E3')
		await attribute('C2', 'C1')
		await attribute('C1', 'C2')
		await attribute('Q', 'E4')
		await attribute('P', 'Q', 'pending')
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

	it('a 4-level chain: tiers 1-4 go to U1, U2, U3 and U4 at 10%, 5%, 3% and 2%; U5, above tier 4, gets nothing', async () => {
		await lose('E', 1000)
		assert.deepEqual(await earningsFor('E'), [
			['U1', 1, 100],
			['U2', 2, 50],
			['U3', 3, 30],
			['U4', 4, 20],
		])
		// Settled at once, each to its own referral balance.
		assert.deepEqual(
			await Promise.all(['U1', 'U2', 'U3', 'U4', 'U5'].map(referralBalance)),
			[100, 50, 30, 20, 0]
		)
	})

	it('a 1-level chain pays only tier 1', async () => {
		await lose('E2', 1000)
		assert.deepEqual(await earningsFor('E2'), [['R', 1, 100]])
		assert.equal(await referralBalance('R'), 100)
	})

	it('a cycle stops: C1 and C2 are each paid once', async () => {
		await lose('E3', 1000)
		assert.deepEqual(await earningsFor('E3'), [
			['C1', 1, 100],
			['C2', 2, 50],
		])
		assert.deepEqual([await referralBalance('C1'), await referralBalance('C2')], [100, 50])
	})

	it('only confirmed attributions count: a pending link ends the upline', async () => {
		await lose('E4', 1000)
		assert.deepEqual(await earningsFor('E4'), [['Q', 1, 100]])
		assert.equal(await referralBalance('P'), 0)
	})
})
