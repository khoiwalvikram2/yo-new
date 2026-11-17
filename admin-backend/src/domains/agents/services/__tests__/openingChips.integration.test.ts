/**
 * Opening chips come only from the new account's direct upline (decision 3 of
 * docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md at creation, §4.4), through the three real create
 * paths against the database (DATABASE_URL): createAgent, the admin createPlayer and the agent's
 * createPlayerForAgent. For each creator kind, the allowed case deposits from the right parent, and the refused
 * case leaves no account behind and moves no chips.
 *
 * The file builds its own whitelabel tenant (pool 1,000,000) and in after() deletes every row of that tenant and
 * nothing else, except its audit_logs rows: those are never deleted (memory gw-audit-logs-resource-id-shared).
 *
 * Owner decision 2026-11-04: an admin creating an AGENT_CREDIT player under an agent may give it opening chips, out
 * of that agent's own chips (its direct parent's); a sub-agent an admin creates under an agent still gets none.
 *
 * Tree: A (root CREDIT, 10,000 chips from the pool) ── B (CREDIT, 1,000 chips from A).
 * The tests run in order and share state; each says the balances it expects.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/openingChips.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const hasDb = Boolean(process.env.DATABASE_URL)
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const T = `openchips-${RUN}`
const POOL = 1_000_000
const UPLINE_ONLY = 'Opening chips can only come from the direct upline. Create the account with 0 opening chips; its upline can then deposit.'

let db: any
let pgPool: any
let agentsMutation: any
let usersMutations: any
let playersMutations: any
let agentPermissions: any[] = []

const ag = { A: '', B: '' }
let phoneSeq = 0
const phone = () => `9${String(Date.now()).slice(-7)}${String(++phoneSeq).padStart(2, '0')}`

const adminCtx = () => ({
	user: { sub: '999999999', type: 'admin', roles: ['Whitelabel Admin'] },
	tenant: T,
	whitelabel: { id: T },
	permissions: [{ domain: 'all', actions: ['*'] }],
})
const agentCtx = (agentId: string) => ({
	user: { sub: agentId, type: 'agent', agentId, roles: [], isReadOnly: false },
	tenant: T,
	whitelabel: { id: T },
	permissions: agentPermissions,
})

async function q(query: ReturnType<typeof sql>): Promise<any[]> {
	const r = await db.execute(query)
	return r?.rows ?? []
}

async function mkAgent(username: string, parentId: string | null): Promise<string> {
	const [row] = await q(sql`
		INSERT INTO agents (tenant_id, scheme_type, allowed_domains, parent_agent_id, status, level_index)
		VALUES (${T}, 'CREDIT', ARRAY['sports']::text[], ${parentId}, 'ACTIVE', ${parentId ? 2 : 1})
		RETURNING id::text AS id`)
	const id = String(row.id)
	await db.execute(sql`INSERT INTO agent_credentials (agent_id, tenant_id, username, password_hash) VALUES (${id}::uuid, ${T}, ${username}, 'x')`)
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
const agentNamed = async (username: string) =>
	(await q(sql`SELECT a.id::text AS id, a.parent_agent_id::text AS parent FROM agents a JOIN agent_credentials c ON c.agent_id = a.id
		WHERE a.tenant_id = ${T} AND c.username = ${username}`))[0] ?? null
const playerNamed = async (username: string) =>
	(await q(sql`SELECT id, player_type, agent_id::text AS agent_id FROM users WHERE tenant = ${T} AND username = ${username}`))[0] ?? null
const chipRows = async () => Number((await q(sql`SELECT count(*)::int AS n FROM credit_chip_ledger WHERE tenant_id = ${T}`))[0].n)

const upline = (err: unknown) => {
	assert.equal((err as Error)?.message, UPLINE_ONLY)
	return true
}

const creditAgent = (username: string, over: Record<string, unknown> = {}) => ({
	schemeType: 'CREDIT', allowedDomains: ['sports'], username, password: 'secret123', currency: 'INR', ...over,
})

describe('opening chips only from the direct upline, through the create paths', { skip: !hasDb }, () => {
	before(async () => {
		;({ db, pool: pgPool } = await import('@src/db/client.js'))
		const { agentsResolvers } = await import('@src/domains/agents/resolvers/index.js')
		agentsMutation = agentsResolvers.AgentsMutation
		;({ usersMutationResolvers: usersMutations } = await import('@src/domains/users/resolvers/mutations.js'))
		;({ playersMutationResolvers: playersMutations } = await import('@src/domains/players/resolvers/mutations.js'))
		const { deriveAgentPermissions } = await import('../AgentPermissionsService.js')
		agentPermissions = deriveAgentPermissions(['sports'] as any)
		const { ChipService } = await import('../ChipService.js')

		await db.execute(sql`
			INSERT INTO whitelabels (id, name, domain, status, credit_limit, credit_used, credit_available)
			VALUES (${T}, 'Opening Chips Test', ${T + '.test'}, 'active', ${POOL}, 0, ${POOL})`)
		ag.A = await mkAgent(`oc_a_${RUN}`, null)
		ag.B = await mkAgent(`oc_b_${RUN}`, ag.A)
		const service = new ChipService()
		await service.depositChips({ kind: 'admin', tenant: T, userId: '999999999' }, { accountType: 'AGENT', accountId: ag.A, amount: 10_000 })
		await service.depositChips({ kind: 'agent', tenant: T, agentId: ag.A }, { accountType: 'AGENT', accountId: ag.B, amount: 1_000 })
		assert.deepEqual([await chips(ag.A), await chips(ag.B), await poolAvailable()], [9_000, 1_000, POOL - 10_000])
	})

	after(async () => {
		if (db) {
			// audit_logs rows are never deleted, not even a test tenant's: this tenant's few rows stay, under its id.
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

	it('admin, createAgent: a root CREDIT agent gets its opening chips from the pool', async () => {
		const row = await agentsMutation.createAgent(null, { input: creditAgent(`oc_root_${RUN}`, { openingChips: 300 }) }, adminCtx())
		assert.deepEqual([await chips(row.id), await poolAvailable()], [300, POOL - 10_300])
	})

	it("admin, createAgent: a sub-agent under A with opening chips is refused; no agent, A's chips untouched", async () => {
		const before = await chipRows()
		await assert.rejects(
			async () => agentsMutation.createAgent(null, { input: creditAgent(`oc_sub_admin_${RUN}`, { parentAgentId: ag.A, openingChips: 300 }) }, adminCtx()),
			upline
		)
		assert.equal(await agentNamed(`oc_sub_admin_${RUN}`), null, 'the refusal rolled the new agent back')
		assert.equal(await chips(ag.A), 9_000)
		assert.equal(await chipRows(), before, 'no chip ledger row')

		// With 0 opening chips the admin may create it; A deposits afterwards if it wants to.
		const row = await agentsMutation.createAgent(null, { input: creditAgent(`oc_sub_admin_${RUN}`, { parentAgentId: ag.A }) }, adminCtx())
		assert.deepEqual([row.parentAgentId, await chips(row.id), await chips(ag.A)], [ag.A, 0, 9_000])
	})

	it("agent, createAgent: A's own direct sub-agent gets its opening chips from A", async () => {
		const row = await agentsMutation.createAgent(null, { input: creditAgent(`oc_sub_a_${RUN}`, { openingChips: 200 }) }, agentCtx(ag.A))
		assert.deepEqual([row.parentAgentId, await chips(row.id), await chips(ag.A)], [ag.A, 200, 8_800])
	})

	it('admin, createPlayer: a WHITELABEL_CREDIT player gets its opening chips from the pool', async () => {
		const out = await usersMutations.createPlayer(
			null,
			{ input: { name: 'OC WL', phone: phone(), username: `oc_wl_${RUN}`, password: 'longenough1', playerType: 'WHITELABEL_CREDIT', openingChips: 50 } },
			adminCtx()
		)
		assert.deepEqual([await cash(Number(out.user.id)), await poolAvailable()], [50, POOL - 10_350])
	})

	it("admin, createPlayer: an AGENT_CREDIT player of A gets its opening chips from A, its direct parent (owner decision 2026-11-04)", async () => {
		const before = await chipRows()
		const input = { name: 'OC AP', phone: phone(), username: `oc_ap_${RUN}`, password: 'longenough1', playerType: 'AGENT_CREDIT', agentId: ag.A }
		const out = await usersMutations.createPlayer(null, { input: { ...input, openingChips: 50 } }, adminCtx())
		// One level only: from A to its new player. The pool and B do not move.
		assert.deepEqual([await cash(Number(out.user.id)), await chips(ag.A), await chips(ag.B), await poolAvailable()], [50, 8_750, 1_000, POOL - 10_350])
		assert.equal(await chipRows(), before + 2, "the transfer's two ledger rows")
	})

	it("agent, createPlayerForAgent: A's own player gets its opening chips from A", async () => {
		const out = await playersMutations.createPlayerForAgent(
			null,
			{ input: { agentId: 'self', name: 'OC Own', username: `oc_own_${RUN}`, phone: phone(), password: 'longenough1', openingChips: 75 } },
			agentCtx(ag.A)
		)
		assert.deepEqual([await cash(Number(out.playerId)), await chips(ag.A)], [75, 8_675])
	})

	it("agent, createPlayerForAgent: a player for A's sub-agent B with opening chips is refused; nothing written", async () => {
		const before = await chipRows()
		await assert.rejects(
			async () =>
				playersMutations.createPlayerForAgent(
					null,
					{ input: { agentId: ag.B, name: 'OC Sub', username: `oc_subp_${RUN}`, phone: phone(), password: 'longenough1', openingChips: 75 } },
					agentCtx(ag.A)
				),
			// createPlayerForAgent refuses this one itself, before the creation transaction, in its own words.
			(err: any) => (assert.match(String(err?.message), /^Opening chips (must be 0 when creating a player for a sub-agent|can only come from the direct upline)/), true)
		)
		assert.equal(await playerNamed(`oc_subp_${RUN}`), null)
		assert.deepEqual([await chips(ag.A), await chips(ag.B), await chipRows()], [8_675, 1_000, before])
	})

	it('admin createPlayer writes its audit row after it returns: let the rows land before the pool closes', async () => {
		for (let i = 0; i < 30; i++) {
			const [row] = await q(sql`SELECT count(*)::int AS n FROM audit_logs WHERE tenant = ${T} AND action = 'create_player'`)
			// Two admin creations (WL, AP) and one agent creation.
			if (row.n >= 3) break
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	})
})
