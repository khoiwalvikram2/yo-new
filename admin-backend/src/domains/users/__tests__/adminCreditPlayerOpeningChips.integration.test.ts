/**
 * Owner decision 2026-11-04 (CREDIT D/W chips): an admin creating a credit player under a CREDIT agent sets its
 * credit reference and opening chips, as the agent can for its own player (createPlayerForAgent). Through the real
 * admin createPlayer against the database (DATABASE_URL):
 *   - the opening chips come out of the player's direct parent agent's free chips (chips move only between a direct
 *     parent and its child: never from the pool, never from a higher agent), in one transaction, booked in
 *     credit_chip_ledger as that agent-to-player DEPOSIT with the admin as the actor, and recorded with the admin as
 *     the actor of the create_player audit row;
 *   - the deposit keeps every refusal of the D/W chip service (ChipService): not enough free chips, a parent or a
 *     player that is not ACTIVE; and a parent below a suspended upline (owner decision 1) gives nothing either.
 *     Each refusal leaves no player behind and moves no chips.
 *
 * The file builds its own whitelabel tenant (vfyog-apoc-*, pool 1,000,000) and in after() deletes every row of that
 * tenant and nothing else, except its audit_logs rows: those are never deleted.
 *
 * Tree: A (root CREDIT, 10,000 chips from the pool) ─┬─ B (CREDIT, 1,000 from A)
 *                                                    └─ C (CREDIT, 500 from A; SUSPENDED) ── D (CREDIT, 200 from C)
 * The tests run in order and share state; each says the balances it expects.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/users/__tests__/adminCreditPlayerOpeningChips.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const hasDb = Boolean(process.env.DATABASE_URL)
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const T = `vfyog-apoc-${RUN}`
const POOL = 1_000_000
const ADMIN_ID = '999999902'

let db: any
let pgPool: any
let usersMutations: any

const ag = { A: '', B: '', C: '', D: '' }
const name = (key: string) => `vfyog_apoc_${key.toLowerCase()}_${RUN}`
let phoneSeq = 0
const phone = () => `8${String(Date.now()).slice(-7)}${String(++phoneSeq).padStart(2, '0')}`

const adminCtx = () => ({
	user: { sub: ADMIN_ID, type: 'admin', roles: ['Whitelabel Admin'] },
	tenant: T,
	whitelabel: { id: T },
	permissions: [{ domain: 'all', actions: ['*'] }],
})

async function q(query: ReturnType<typeof sql>): Promise<any[]> {
	const r = await db.execute(query)
	return r?.rows ?? []
}

async function mkAgent(key: string, parentId: string | null): Promise<string> {
	const [row] = await q(sql`
		INSERT INTO agents (tenant_id, scheme_type, allowed_domains, parent_agent_id, status, level_index)
		VALUES (${T}, 'CREDIT', ARRAY['sports']::text[], ${parentId}, 'ACTIVE', ${parentId ? 2 : 1})
		RETURNING id::text AS id`)
	const id = String(row.id)
	await db.execute(sql`INSERT INTO agent_credentials (agent_id, tenant_id, username, password_hash) VALUES (${id}::uuid, ${T}, ${name(key)}, 'x')`)
	await db.execute(sql`INSERT INTO agent_hierarchy_closure (ancestor_id, descendant_id, depth) VALUES (${id}::uuid, ${id}::uuid, 0)`)
	if (parentId) {
		await db.execute(sql`
			INSERT INTO agent_hierarchy_closure (ancestor_id, descendant_id, depth)
			SELECT ancestor_id, ${id}::uuid, depth + 1 FROM agent_hierarchy_closure WHERE descendant_id = ${parentId}::uuid`)
	}
	return id
}

const chips = async (agentId: string) => Number((await q(sql`SELECT chip_balance FROM agents WHERE id = ${agentId}::uuid`))[0].chip_balance)
const cash = async (playerId: number) =>
	Number((await q(sql`SELECT cash FROM wallets WHERE user_id = ${playerId} AND tenant = ${T} ORDER BY id LIMIT 1`))[0]?.cash ?? Number.NaN)
const poolAvailable = async () => Number((await q(sql`SELECT credit_available FROM whitelabels WHERE id = ${T}`))[0].credit_available)
const playerNamed = async (username: string) => (await q(sql`SELECT id FROM users WHERE tenant = ${T} AND username = ${username}`))[0] ?? null
const chipRows = async () => Number((await q(sql`SELECT count(*)::int AS n FROM credit_chip_ledger WHERE tenant_id = ${T}`))[0].n)
const balances = async () => [await chips(ag.A), await chips(ag.B), await chips(ag.C), await chips(ag.D), await poolAvailable()]

const input = (key: string, agentId: string, over: Record<string, unknown> = {}) => ({
	name: `VFYOG ${key}`,
	phone: phone(),
	username: name(key),
	password: 'longenough1',
	playerType: 'AGENT_CREDIT',
	agentId,
	...over,
})

/** A create that must be refused with `message` and leave nothing behind: no player, no chip move, no ledger row. */
async function refused(key: string, agentId: string, over: Record<string, unknown>, message: string) {
	const [before, rows] = [await balances(), await chipRows()]
	await assert.rejects(
		async () => usersMutations.createPlayer(null, { input: input(key, agentId, over) }, adminCtx()),
		(err: any) => (assert.equal(err?.message, message), true)
	)
	assert.equal(await playerNamed(name(key)), null, 'the refusal rolled the new player back')
	assert.deepEqual(await balances(), before, 'no chips moved')
	assert.equal(await chipRows(), rows, 'no chip ledger row')
}

describe("admin createPlayer: a credit player's credit reference and opening chips under a CREDIT agent", { skip: !hasDb }, () => {
	let p1 = 0
	let transferId = ''

	before(async () => {
		;({ db, pool: pgPool } = await import('@src/db/client.js'))
		;({ usersMutationResolvers: usersMutations } = await import('@src/domains/users/resolvers/mutations.js'))
		const { ChipService } = await import('@src/domains/agents/services/ChipService.js')

		await db.execute(sql`
			INSERT INTO whitelabels (id, name, domain, status, credit_limit, credit_used, credit_available)
			VALUES (${T}, 'VFYOG Admin Opening Chips', ${T + '.test'}, 'active', ${POOL}, 0, ${POOL})`)
		ag.A = await mkAgent('A', null)
		ag.B = await mkAgent('B', ag.A)
		ag.C = await mkAgent('C', ag.A)
		ag.D = await mkAgent('D', ag.C)
		const service = new ChipService()
		await service.depositChips({ kind: 'admin', tenant: T, userId: ADMIN_ID }, { accountType: 'AGENT', accountId: ag.A, amount: 10_000 })
		await service.depositChips({ kind: 'agent', tenant: T, agentId: ag.A }, { accountType: 'AGENT', accountId: ag.B, amount: 1_000 })
		await service.depositChips({ kind: 'agent', tenant: T, agentId: ag.A }, { accountType: 'AGENT', accountId: ag.C, amount: 500 })
		await service.depositChips({ kind: 'agent', tenant: T, agentId: ag.C }, { accountType: 'AGENT', accountId: ag.D, amount: 200 })
		await db.execute(sql`UPDATE agents SET status = 'SUSPENDED' WHERE id = ${ag.C}::uuid`)
		assert.deepEqual(await balances(), [8_500, 1_000, 300, 200, POOL - 10_000])
	})

	after(async () => {
		if (db) {
			// createPlayer writes its audit row after it returns: let the rows land before the pool closes.
			for (let i = 0; i < 30; i++) {
				const [row] = await q(sql`SELECT count(*)::int AS n FROM audit_logs WHERE tenant = ${T} AND action = 'create_player'`)
				if (row.n >= 2) break
				await new Promise((resolve) => setTimeout(resolve, 100))
			}
			// audit_logs rows are never deleted: this tenant's stay, under its id.
			await db.execute(sql`DELETE FROM credit_chip_ledger WHERE tenant_id = ${T}`)
			await db.execute(sql`DELETE FROM agent_credit_ledger WHERE tenant_id = ${T}`)
			await db.execute(sql`DELETE FROM wallet_ledger WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM ledger_entries WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM player_limits WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM wallets WHERE tenant = ${T}`)
			await db.execute(sql`DELETE FROM agent_player_credits WHERE player_id IN (SELECT id FROM users WHERE tenant = ${T})`)
			await db.execute(sql`DELETE FROM users WHERE tenant = ${T}`)
			await db.execute(sql`
				DELETE FROM agent_hierarchy_closure
				WHERE ancestor_id IN (SELECT id FROM agents WHERE tenant_id = ${T})
				   OR descendant_id IN (SELECT id FROM agents WHERE tenant_id = ${T})`)
			await db.execute(sql`DELETE FROM agent_wallets WHERE agent_id IN (SELECT id FROM agents WHERE tenant_id = ${T})`)
			await db.execute(sql`DELETE FROM agent_credentials WHERE tenant_id = ${T}`)
			await db.execute(sql`DELETE FROM agents WHERE tenant_id = ${T}`)
			await db.execute(sql`DELETE FROM whitelabels WHERE id = ${T}`)
		}
		const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
		await closeRedisEmitter().catch(() => {})
		await pgPool?.end().catch(() => {})
	})

	it("B's new player: credit reference 2,000 and opening chips 300, out of B's chips only", async () => {
		const out = await usersMutations.createPlayer(null, { input: input('P1', ag.B, { creditLimit: 2000, openingChips: 300 }) }, adminCtx())
		p1 = Number(out.user.id)
		assert.equal(out.success, true)
		// One level: B to its player. A, C, D and the pool do not move.
		assert.equal(await cash(p1), 300)
		assert.deepEqual(await balances(), [8_500, 700, 300, 200, POOL - 10_000])

		const [user] = await q(sql`SELECT player_type, agent_id::text AS agent_id, credit_limit FROM users WHERE id = ${p1}`)
		assert.deepEqual([user.player_type, user.agent_id, Number(user.credit_limit)], ['AGENT_CREDIT', ag.B, 2000])
		const [apc] = await q(sql`SELECT credit_limit FROM agent_player_credits WHERE player_id = ${p1} AND agent_id = ${ag.B}::uuid`)
		assert.equal(Number(apc.credit_limit), 2000)
	})

	it('the chips are booked as the parent-to-player DEPOSIT in credit_chip_ledger, the admin as the actor', async () => {
		const rows = await q(sql`
			SELECT transfer_id::text AS transfer_id, account_type::text AS account_type, account_id, counterparty_type::text AS counterparty_type,
			       counterparty_id, kind::text AS kind, amount::float8 AS amount, balance_before::float8 AS before, balance_after::float8 AS after,
			       credit_reference_after::float8 AS reference, remark, created_by, created_by_type
			FROM credit_chip_ledger
			WHERE tenant_id = ${T} AND transfer_id = (SELECT transfer_id FROM credit_chip_ledger WHERE tenant_id = ${T} AND account_type = 'player' AND account_id = ${String(p1)})
			ORDER BY amount`)
		assert.equal(rows.length, 2, 'one transfer, two rows')
		transferId = rows[0].transfer_id
		const strip = ({ transfer_id, ...rest }: any) => rest
		assert.deepEqual(rows.map(strip), [
			{ account_type: 'agent', account_id: ag.B, counterparty_type: 'player', counterparty_id: String(p1), kind: 'DEPOSIT', amount: -300, before: 1000, after: 700, reference: 0, remark: 'Opening chips', created_by: ADMIN_ID, created_by_type: 'admin' },
			{ account_type: 'player', account_id: String(p1), counterparty_type: 'agent', counterparty_id: ag.B, kind: 'DEPOSIT', amount: 300, before: 0, after: 300, reference: 2000, remark: 'Opening chips', created_by: ADMIN_ID, created_by_type: 'admin' },
		])
		// The player's own statement shows the chips arriving.
		const statement = await q(sql`SELECT type FROM ledger_entries WHERE tenant = ${T} AND wallet_id = (SELECT id FROM wallets WHERE user_id = ${p1} ORDER BY id LIMIT 1)`)
		assert.deepEqual(statement.map((r: any) => r.type), ['CHIP_DEPOSIT'])
	})

	it('the create_player audit row names the admin as the actor, with the credit reference, the chips and their transfer', async () => {
		let row: any = null
		for (let i = 0; i < 30 && !row; i++) {
			;[row] = await q(sql`SELECT actor_id, after FROM audit_logs WHERE tenant = ${T} AND action = 'create_player' AND resource_id = ${String(p1)}`)
			if (!row) await new Promise((resolve) => setTimeout(resolve, 100))
		}
		assert.ok(row, 'the audit row landed')
		assert.equal(row.actor_id, ADMIN_ID)
		const after = typeof row.after === 'string' ? JSON.parse(row.after) : row.after
		assert.deepEqual(
			{ agentId: after.agentId, playerType: after.playerType, creditLimit: after.creditLimit, openingChips: after.openingChips, from: after.openingChipsFrom, transfer: after.openingChipsTransferId },
			{ agentId: ag.B, playerType: 'AGENT_CREDIT', creditLimit: 2000, openingChips: 300, from: ag.B, transfer: transferId }
		)
	})

	it('a credit reference alone moves no chips', async () => {
		const out = await usersMutations.createPlayer(null, { input: input('P2', ag.B, { creditLimit: 1500 }) }, adminCtx())
		const id = Number(out.user.id)
		const [user] = await q(sql`SELECT credit_limit FROM users WHERE id = ${id}`)
		assert.deepEqual([Number(user.credit_limit), await cash(id)], [1500, 0])
		assert.deepEqual(await balances(), [8_500, 700, 300, 200, POOL - 10_000])
		assert.equal(Number((await q(sql`SELECT count(*)::int AS n FROM credit_chip_ledger WHERE tenant_id = ${T} AND account_id = ${String(id)}`))[0].n), 0)
	})

	it("refused: more opening chips than the parent's free chips", async () => {
		await refused('P3', ag.B, { creditLimit: 100, openingChips: 700.01 }, 'Opening chips: Not enough chips: available 700.00')
	})

	it('refused: a suspended parent', async () => {
		await refused('P4', ag.C, { openingChips: 10 }, 'Agent is not active. Status: SUSPENDED')
	})

	it("refused: an ACTIVE parent below a suspended upline (owner decision 1) gives no chips", async () => {
		await refused('P5', ag.D, { openingChips: 50 }, `Opening chips: Chips cannot be deposited while agent ${name('D')}'s upline ${name('C')} is suspended`)
	})

	it("refused: the D/W service's own rule for the new player, here a player created suspended", async () => {
		await refused('P6', ag.B, { openingChips: 10, status: 'SUSPENDED' }, `Opening chips: Chips cannot be deposited while player ${name('P6')} is suspended`)
	})
})
