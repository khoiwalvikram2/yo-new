/**
 * The chips API through its real resolvers against the database (DATABASE_URL), spec
 * docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md §4.4, §6 and §7:
 *   - read scope and authorisation for each caller shape: no session, an agent of another subtree, an admin of
 *     another tenant, a caller without agents.credit:update, a read-only agent;
 *   - AgentAccount.chips and usersPage's User.chips: one batch read per list, scoped like the list;
 *   - the credit-limit mutations are gone from the live map, and settleAgent refuses a CREDIT agent;
 *   - the create paths with opening chips: createAgent (root from the pool, sub-agent from its parent),
 *     createPlayerForAgent and the admin createPlayer; a refused opening deposit leaves no account behind;
 *   - adjustWallet no longer moves a credit player's chips.
 *
 * The file builds two whitelabel tenants of its own and in after() deletes every row of those tenants and nothing
 * else, except their audit_logs rows: those are never deleted (memory gw-audit-logs-resource-id-shared). The chip moves run
 * through the real guard and resolvers with a recording audit writer, so no audit write outlives the test.
 *
 * Tree (tenant T, pool 1,000,000 available; tenant T2 has a pool and nothing else):
 *   A (root CREDIT) ── B (CREDIT)        X (root CREDIT, another subtree)        S (root SHARING)
 *   players: pA (AGENT_CREDIT of A), pB (of B), pX (of X), pW (WHITELABEL_CREDIT), pR (REGULAR)
 * The tests run in order and share state; each says the balances it expects.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/resolvers/__tests__/chipResolvers.integration.test.ts
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const hasDb = Boolean(process.env.DATABASE_URL)
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const T = `chipres-${RUN}`
const T2 = `chipres2-${RUN}`
const POOL = 1_000_000

let db: any
let pgPool: any
let agentsResolvers: any
let moves: any
let ChipService: typeof import('../../services/ChipService.js').ChipService
let usersMutations: any
let usersQueries: any
let playersMutations: any
let attachPlayerChips: typeof import('../chipResolvers.js').attachPlayerChips
const audits: any[] = []

const ag = { A: '', B: '', X: '', S: '' }
const pl = { pA: 0, pB: 0, pX: 0, pW: 0, pR: 0 }

const ALL = [{ domain: 'all', actions: ['*'] }]
const adminCtx = (tenant = T, permissions: any[] = ALL) => ({
	user: { sub: '999999999', type: 'admin', roles: ['Whitelabel Admin'] },
	tenant,
	whitelabel: { id: tenant },
	permissions,
})
let agentPermissions: any[] = []
const agentCtx = (agentId: string, user: Record<string, unknown> = {}) => ({
	user: { sub: agentId, type: 'agent', agentId, roles: [], isReadOnly: false, ...user },
	tenant: T,
	whitelabel: { id: T },
	permissions: agentPermissions,
})
const noSession = () => ({ tenant: T, whitelabel: { id: T } })

async function q(query: ReturnType<typeof sql>): Promise<any[]> {
	const r = await db.execute(query)
	return r?.rows ?? []
}

async function mkAgent(username: string, parentId: string | null, scheme = 'CREDIT'): Promise<string> {
	const [row] = await q(sql`
		INSERT INTO agents (tenant_id, scheme_type, allowed_domains, parent_agent_id, status)
		VALUES (${T}, ${scheme}, ARRAY['sports']::text[], ${parentId}, 'ACTIVE')
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

async function mkPlayer(username: string, type: string, agentId: string | null): Promise<number> {
	const [row] = await q(sql`
		INSERT INTO users (tenant, name, username, password_hash, player_type, agent_id, status)
		VALUES (${T}, ${username + ' name'}, ${username}, 'x', ${type}, ${agentId}, 'active')
		RETURNING id`)
	const id = Number(row.id)
	await db.execute(sql`INSERT INTO wallets (tenant, user_id, currency) VALUES (${T}, ${id}, 'INR')`)
	return id
}

const chips = async (agentId: string) => Number((await q(sql`SELECT chip_balance FROM agents WHERE id = ${agentId}::uuid`))[0].chip_balance)
const cash = async (playerId: number) =>
	Number((await q(sql`SELECT cash FROM wallets WHERE user_id = ${playerId} AND tenant = ${T} ORDER BY id LIMIT 1`))[0]?.cash ?? Number.NaN)
const poolAvailable = async (tenant = T) => Number((await q(sql`SELECT credit_available FROM whitelabels WHERE id = ${tenant}`))[0].credit_available)

const refusal = (message: string | RegExp) => (err: unknown) => {
	const text = (err as Error)?.message ?? String(err)
	if (typeof message === 'string') assert.equal(text, message)
	else assert.match(text, message)
	return true
}

describe('chips API through its resolvers, against the database', { skip: !hasDb }, () => {
	before(async () => {
		;({ db, pool: pgPool } = await import('@src/db/client.js'))
		;({ agentsResolvers } = await import('../index.js'))
		const { guardAgentMutations } = await import('../guardAgentMutations.js')
		const chipResolvers = await import('../chipResolvers.js')
		attachPlayerChips = chipResolvers.attachPlayerChips
		const chipModule = await import('../../services/ChipService.js')
		ChipService = chipModule.ChipService
		moves = guardAgentMutations(
			chipResolvers.buildChipMutationResolvers(chipModule.chipService, async (entry) => {
				audits.push(entry)
				return null
			})
		)
		;({ usersMutationResolvers: usersMutations } = await import('@src/domains/users/resolvers/mutations.js'))
		;({ usersQueryResolvers: usersQueries } = await import('@src/domains/users/resolvers/queries.js'))
		;({ playersMutationResolvers: playersMutations } = await import('@src/domains/players/resolvers/mutations.js'))
		const { deriveAgentPermissions } = await import('../../services/AgentPermissionsService.js')
		agentPermissions = deriveAgentPermissions(['sports'] as any)

		for (const tenant of [T, T2]) {
			await db.execute(sql`
				INSERT INTO whitelabels (id, name, domain, status, credit_limit, credit_used, credit_available)
				VALUES (${tenant}, 'Chip API Test', ${tenant + '.test'}, 'active', ${POOL}, 0, ${POOL})`)
		}
		ag.A = await mkAgent('chipres_a', null)
		ag.B = await mkAgent('chipres_b', ag.A)
		ag.X = await mkAgent('chipres_x', null)
		ag.S = await mkAgent('chipres_s', null, 'SHARING')
		pl.pA = await mkPlayer('chipres-pa', 'AGENT_CREDIT', ag.A)
		pl.pB = await mkPlayer('chipres-pb', 'AGENT_CREDIT', ag.B)
		pl.pX = await mkPlayer('chipres-px', 'AGENT_CREDIT', ag.X)
		pl.pW = await mkPlayer('chipres-pw', 'WHITELABEL_CREDIT', null)
		pl.pR = await mkPlayer('chipres-pr', 'REGULAR', null)
	})

	after(async () => {
		if (db) {
			for (const tenant of [T, T2]) {
				// audit_logs rows are never deleted, not even a test tenant's: these tenants' few rows stay, under their ids.
				await db.execute(sql`DELETE FROM credit_chip_ledger WHERE tenant_id = ${tenant}`)
				await db.execute(sql`DELETE FROM agent_credit_ledger WHERE tenant_id = ${tenant}`)
				await db.execute(sql`DELETE FROM wallet_ledger WHERE tenant = ${tenant}`)
				await db.execute(sql`DELETE FROM ledger_entries WHERE tenant = ${tenant}`)
				await db.execute(sql`DELETE FROM player_limits WHERE tenant = ${tenant}`)
				await db.execute(sql`DELETE FROM wallets WHERE tenant = ${tenant}`)
				await db.execute(sql`DELETE FROM agent_player_credits WHERE player_id IN (SELECT id FROM users WHERE tenant = ${tenant})`)
				await db.execute(sql`DELETE FROM users WHERE tenant = ${tenant}`)
				await db.execute(sql`
					DELETE FROM agent_hierarchy_closure
					WHERE ancestor_id IN (SELECT id FROM agents WHERE tenant_id = ${tenant})
					   OR descendant_id IN (SELECT id FROM agents WHERE tenant_id = ${tenant})`)
				await db.execute(sql`DELETE FROM agent_wallets WHERE agent_id IN (SELECT id FROM agents WHERE tenant_id = ${tenant})`)
				await db.execute(sql`DELETE FROM agent_credentials WHERE tenant_id = ${tenant}`)
				await db.execute(sql`DELETE FROM agents WHERE tenant_id = ${tenant}`)
				await db.execute(sql`DELETE FROM whitelabels WHERE id = ${tenant}`)
			}
		}
		const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
		await closeRedisEmitter().catch(() => {})
		await pgPool?.end().catch(() => {})
	})

	it('seed: the direct parent moves chips through the guarded resolvers', async () => {
		await moves.depositChips(null, { input: { accountType: 'AGENT', accountId: ag.A, amount: 10000 } }, adminCtx())
		await moves.depositChips(null, { input: { accountType: 'AGENT', accountId: ag.X, amount: 1000 } }, adminCtx())
		const toB = await moves.depositChips(null, { input: { accountType: 'AGENT', accountId: ag.B, amount: 2000, remark: 'b' } }, agentCtx(ag.A))
		assert.equal(toB.parent.id, ag.A)
		assert.equal(toB.parent.balance, 8000)
		await moves.depositChips(null, { input: { accountType: 'PLAYER', accountId: String(pl.pA), amount: 300 } }, agentCtx(ag.A))
		await moves.depositChips(null, { input: { accountType: 'PLAYER', accountId: String(pl.pB), amount: 100 } }, agentCtx(ag.B))
		const toW = await moves.depositChips(null, { input: { accountType: 'PLAYER', accountId: String(pl.pW), amount: 50 } }, adminCtx())
		assert.equal(toW.parent, null)
		assert.equal(toW.pool.available, POOL - 11050)
		assert.deepEqual([await chips(ag.A), await chips(ag.B), await chips(ag.X)], [7700, 1900, 1000])
		assert.deepEqual([await cash(pl.pA), await cash(pl.pB), await cash(pl.pW)], [300, 100, 50])
		await new Promise((resolve) => setImmediate(resolve))
		assert.equal(audits.filter((a) => a.action === 'deposit_chips').length, 6)
	})

	it('reads: an agent sees itself and its subtree, nothing else', async () => {
		const read = agentsResolvers.AgentsQuery
		const ctx = agentCtx(ag.A)
		assert.equal((await read.chipAccount(null, { accountType: 'AGENT', accountId: ag.B }, ctx))?.balance, 1900)
		assert.equal((await read.chipAccount(null, { accountType: 'PLAYER', accountId: String(pl.pB) }, ctx))?.balance, 100)
		for (const [accountType, accountId] of [['AGENT', ag.X], ['PLAYER', String(pl.pX)], ['PLAYER', String(pl.pW)]]) {
			assert.equal(await read.chipAccount(null, { accountType, accountId }, ctx), null, `${accountType} ${accountId}`)
		}
		const me = await read.myChipAccount(null, {}, ctx)
		assert.deepEqual([me.id, me.balance, me.downlineBalance, me.refPnl, me.downlineCount], [ag.A, 7700, 2300, 10000, 2])
		const downline = await read.chipDownline(null, {}, ctx)
		assert.deepEqual(downline.items.map((a: any) => a.id).sort(), [ag.B, String(pl.pA)].sort())
		assert.equal(downline.pool, null)
		await assert.rejects(read.chipDownline(null, { parentAgentId: ag.X }, ctx), refusal('Agent not found'))
		await assert.rejects(read.chipStatement(null, { accountType: 'AGENT', accountId: ag.X }, ctx), refusal('Agent not found'))
		assert.equal(await read.chipPool(null, {}, ctx), null)
		const statement = await read.chipStatement(null, { accountType: 'AGENT', accountId: ag.B }, ctx)
		assert.equal(statement.total, 2, 'B: in from A, out to pB')
	})

	it('reads: an admin of another tenant sees nothing of this one; no session is refused', async () => {
		const read = agentsResolvers.AgentsQuery
		const other = adminCtx(T2)
		assert.equal(await read.chipAccount(null, { accountType: 'AGENT', accountId: ag.A }, other), null)
		assert.equal(await read.chipAccount(null, { accountType: 'PLAYER', accountId: String(pl.pW) }, other), null)
		await assert.rejects(read.chipStatement(null, { accountType: 'AGENT', accountId: ag.A }, other), refusal('Agent not found'))
		const downline = await read.chipDownline(null, {}, other)
		assert.deepEqual([downline.total, downline.pool?.available], [0, POOL])
		assert.equal(await read.myChipAccount(null, {}, other), null)

		assert.throws(() => agentsResolvers.Query.agents(null, {}, noSession()), /Forbidden/)
		await assert.rejects(read.chipAccount(null, { accountType: 'AGENT', accountId: ag.A }, noSession()), /Unauthorized: authentication required/)

		const mine = adminCtx()
		const pool = await read.chipPool(null, {}, mine)
		assert.equal(pool.available, POOL - 11050)
		const root = await read.chipDownline(null, {}, mine)
		assert.deepEqual(root.items.map((a: any) => a.id).sort(), [ag.A, ag.X, String(pl.pW)].sort())
	})

	it('moves: only the direct parent, inside its own scope and tenant, with the permission', async () => {
		const deposit = (accountType: string, accountId: string, ctx: any) =>
			moves.depositChips(null, { input: { accountType, accountId, amount: 10 } }, ctx)
		await assert.rejects(async () => deposit('AGENT', ag.A, agentCtx(ag.X)), refusal('Agent not found'))
		await assert.rejects(async () => deposit('PLAYER', String(pl.pX), agentCtx(ag.A)), refusal('Player not found'))
		await assert.rejects(async () => deposit('PLAYER', String(pl.pB), agentCtx(ag.A)), refusal('Only the direct upline can move chips for this account'))
		await assert.rejects(async () => deposit('AGENT', ag.A, agentCtx(ag.A)), refusal('Only the direct upline can move chips for this account'))
		await assert.rejects(async () => deposit('AGENT', ag.B, adminCtx()), refusal('Only the direct upline can move chips for this account'))
		await assert.rejects(async () => deposit('AGENT', ag.A, adminCtx(T2)), refusal('Agent not found'))
		await assert.rejects(async () => deposit('AGENT', ag.B, noSession()), refusal('Unauthorized: authentication required'))
		await assert.rejects(async () => deposit('AGENT', ag.A, adminCtx(T, [{ domain: 'dashboard', actions: ['read'] }])), /Forbidden: insufficient permissions for agents\.credit:update/)
		await assert.rejects(async () => deposit('AGENT', ag.B, agentCtx(ag.A, { isReadOnly: true })), /Your account is inactive/)
		assert.deepEqual([await chips(ag.A), await chips(ag.B), await chips(ag.X), await poolAvailable(T2)], [7700, 1900, 1000, POOL], 'nothing moved')
	})

	it('moves: a withdrawal and a credit reference by the direct parent', async () => {
		const back = await moves.withdrawChips(null, { input: { accountType: 'AGENT', accountId: ag.B, amount: 400 } }, agentCtx(ag.A))
		assert.deepEqual([back.account.balance, back.parent.balance], [1500, 8100])
		const ref = await moves.setCreditReference(null, { input: { accountType: 'AGENT', accountId: ag.B, creditReference: 3000 } }, agentCtx(ag.A))
		assert.deepEqual([ref.creditReference, ref.balance, ref.downlineBalance, ref.refPnl], [3000, 1500, 100, -1400])
		await new Promise((resolve) => setImmediate(resolve))
		assert.deepEqual(audits.slice(-2).map((a) => [a.action, a.actorId, a.resourceId]), [
			['withdraw_chips', ag.A, ag.B],
			['set_credit_reference', ag.A, ag.B],
		])
	})

	it('AgentAccount.chips: one batch read per list, scoped to the caller', async () => {
		const original = ChipService.prototype.chipAccountsForAgents
		let reads = 0
		ChipService.prototype.chipAccountsForAgents = function (this: any, ...args: any[]) {
			reads++
			return (original as any).apply(this, args)
		}
		try {
			const field = agentsResolvers.AgentAccount.chips
			const rows = [ag.A, ag.B, ag.X].map((id) => ({ id, schemeType: 'CREDIT' })).concat([{ id: ag.S, schemeType: 'SHARING' }])
			const asAgent = agentCtx(ag.A)
			const seen = await Promise.all(rows.map((row) => field(row, {}, asAgent)))
			assert.deepEqual(seen.map((a: any) => a?.balance ?? null), [8100, 1500, null, null])
			assert.equal(reads, 1, 'one read for the whole list')

			const asAdmin = adminCtx()
			const page = await agentsResolvers.AgentsQuery.agentsPage(null, { schemeType: 'CREDIT', limit: 50, includeStats: false }, asAdmin)
			const listed = await Promise.all(page.items.map((item: any) => field(item, {}, asAdmin)))
			assert.deepEqual(new Map(listed.map((a: any) => [a.id, a.balance])), new Map([[ag.A, 8100], [ag.B, 1500], [ag.X, 1000]]))
			assert.equal(reads, 2)

			assert.equal(await field({ id: ag.A, schemeType: 'CREDIT' }, {}, adminCtx(T2)), null, 'another tenant')
		} finally {
			ChipService.prototype.chipAccountsForAgents = original
		}
	})

	it("usersPage fills User.chips in one batch read, scoped like the page", async () => {
		const info = {
			fieldNodes: [
				{ selectionSet: { selections: [{ kind: 'Field', name: { value: 'items' }, selectionSet: { selections: [{ kind: 'Field', name: { value: 'chips' } }] } }] } },
			],
			fragments: {},
		}
		const original = ChipService.prototype.chipAccountsForPlayers
		let reads = 0
		ChipService.prototype.chipAccountsForPlayers = function (this: any, ...args: any[]) {
			reads++
			return (original as any).apply(this, args)
		}
		try {
			const page = await usersQueries.usersPage(null, { limit: 50 }, adminCtx(), info)
			const byId = new Map(page.items.map((u: any) => [Number(u.id), u.chips?.balance ?? null]))
			assert.deepEqual(
				[pl.pA, pl.pB, pl.pX, pl.pW, pl.pR].map((id) => byId.get(id)),
				[300, 100, 0, 50, null],
				'credit players carry their chips; a REGULAR player none'
			)
			assert.equal(reads, 1)

			const rows: any[] = [pl.pA, pl.pB, pl.pX, pl.pW, pl.pR].map((id, i) => ({ id, playerType: i === 4 ? 'REGULAR' : i === 3 ? 'WHITELABEL_CREDIT' : 'AGENT_CREDIT' }))
			await attachPlayerChips(rows, agentCtx(ag.A))
			assert.deepEqual(rows.map((r) => r.chips?.balance ?? null), [300, 100, null, null, null], "an agent never sees another subtree's or the whitelabel's players")
		} finally {
			ChipService.prototype.chipAccountsForPlayers = original
		}
	})

	it('the credit-limit mutations are gone from the live map, and settleAgent refuses a CREDIT agent', async () => {
		const live = agentsResolvers.AgentsMutation
		for (const name of ['depositCredit', 'withdrawCredit', 'adjustSubAgentCredit', 'adjustAgentCredit', 'settleSharingAgent']) {
			assert.equal(live[name], undefined, `${name} is still in the live map`)
		}
		const chipsOnly = refusal('Credit now moves as chips: use Deposit / Withdraw')
		await assert.rejects(async () => live.settleAgent(null, { input: { agentId: ag.B, periodFrom: '2026-10-01', periodTo: '2026-10-08', currency: 'INR' } }, agentCtx(ag.A)), chipsOnly)
		assert.deepEqual([await chips(ag.A), await chips(ag.B)], [8100, 1500], 'nothing moved')
	})

	it('createAgent: a root CREDIT agent gets its credit reference and its opening chips from the pool', async () => {
		const poolBefore = await poolAvailable()
		const row = await agentsResolvers.AgentsMutation.createAgent(
			null,
			{ input: { schemeType: 'CREDIT', allowedDomains: ['sports'], username: 'chipres_root2', password: 'secret123', currency: 'INR', creditLimit: 50000, openingChips: 5000 } },
			adminCtx()
		)
		const [agent] = await q(sql`SELECT chip_balance, credit_limit, credit_used FROM agents WHERE id = ${row.id}::uuid`)
		assert.deepEqual([Number(agent.chip_balance), Number(agent.credit_limit), Number(agent.credit_used)], [5000, 50000, 0])
		assert.equal(await poolAvailable(), poolBefore - 5000)
		const ledger = await q(sql`
			SELECT account_type::text AS account_type, amount::float8 AS amount, kind::text AS kind, remark, created_by_type
			FROM credit_chip_ledger WHERE tenant_id = ${T} AND (account_id = ${row.id} OR counterparty_id = ${row.id}) ORDER BY account_type`)
		assert.deepEqual(ledger.map((r: any) => [r.account_type, r.amount, r.kind, r.remark, r.created_by_type]), [
			['agent', 5000, 'DEPOSIT', 'Opening chips', 'admin'],
			['whitelabel', -5000, 'DEPOSIT', 'Opening chips', 'admin'],
		])
	})

	it("createAgent: a sub-agent's opening chips come from its parent; a refused deposit leaves no agent behind", async () => {
		const row = await agentsResolvers.AgentsMutation.createAgent(
			null,
			{ input: { schemeType: 'CREDIT', allowedDomains: ['sports'], username: 'chipres_sub_ok', password: 'secret123', currency: 'INR', creditLimit: 800, openingChips: 500 } },
			agentCtx(ag.A)
		)
		assert.deepEqual([await chips(row.id), await chips(ag.A)], [500, 7600])
		assert.equal(row.parentAgentId, ag.A)

		await assert.rejects(
			async () =>
				agentsResolvers.AgentsMutation.createAgent(
					null,
					{ input: { schemeType: 'CREDIT', allowedDomains: ['sports'], username: 'chipres_sub_poor', password: 'secret123', currency: 'INR', openingChips: 1_000_000 } },
					agentCtx(ag.A)
				),
			refusal('Opening chips: Not enough chips: available 7,600.00')
		)
		const left = await q(sql`SELECT count(*)::int AS n FROM agent_credentials WHERE tenant_id = ${T} AND username = 'chipres_sub_poor'`)
		assert.equal(left[0].n, 0)
		assert.equal(await chips(ag.A), 7600)
	})

	it("createPlayerForAgent: an agent's own credit player with its credit reference and opening chips", async () => {
		const out = await playersMutations.createPlayerForAgent(
			null,
			{ input: { agentId: 'self', name: 'Chip Player', username: `chipres_pn_${RUN}`, phone: `91${Date.now().toString().slice(-8)}`, password: 'longenough1', creditLimit: 1000, openingChips: 250 } },
			agentCtx(ag.A)
		)
		const playerId = Number(out.playerId)
		const [user] = await q(sql`SELECT player_type, agent_id::text AS agent_id, credit_limit, credit_available FROM users WHERE id = ${playerId}`)
		assert.deepEqual([user.player_type, user.agent_id, Number(user.credit_limit), Number(user.credit_available)], ['AGENT_CREDIT', ag.A, 1000, 0])
		assert.deepEqual([await cash(playerId), await chips(ag.A)], [250, 7350])
		const statement = await q(sql`SELECT type FROM ledger_entries WHERE tenant = ${T} AND wallet_id = (SELECT id FROM wallets WHERE user_id = ${playerId} ORDER BY id LIMIT 1)`)
		assert.deepEqual(statement.map((r: any) => r.type), ['CHIP_DEPOSIT'])
	})

	it('createPlayer (admin): opening chips from the pool for a WHITELABEL_CREDIT player; an AGENT_CREDIT one gets them only from its agent', async () => {
		const poolBefore = await poolAvailable()
		const wl = await usersMutations.createPlayer(
			null,
			{ input: { name: 'WL Chip Player', phone: `92${Date.now().toString().slice(-8)}`, username: `chipres_wl_${RUN}`, password: 'longenough1', playerType: 'WHITELABEL_CREDIT', creditLimit: 2000, openingChips: 150 } },
			adminCtx()
		)
		// Chips move only between a direct parent and its child (decision 3). An admin creating an AGENT_CREDIT player
		// under A may give it opening chips (owner decision 2026-11-04): they come out of A's own chips, not the pool.
		const apInput = { name: 'Agent Chip Player', phone: `93${Date.now().toString().slice(-8)}`, username: `chipres_ap_${RUN}`, password: 'longenough1', playerType: 'AGENT_CREDIT', agentId: ag.A }
		await assert.rejects(
			async () => usersMutations.createPlayer(null, { input: { ...apInput, openingChips: 100_000 } }, adminCtx()),
			refusal('Opening chips: Not enough chips: available 7,350.00')
		)
		const refused = await q(sql`SELECT count(*)::int AS n FROM users WHERE tenant = ${T} AND username = ${`chipres_ap_${RUN}`}`)
		assert.equal(refused[0].n, 0, 'the refusal rolled the player back')
		const ap = await usersMutations.createPlayer(null, { input: { ...apInput, openingChips: 100 } }, adminCtx())
		assert.deepEqual([await cash(Number(wl.user.id)), await cash(Number(ap.user.id))], [150, 100])
		assert.equal(await poolAvailable(), poolBefore - 150)
		assert.equal(await chips(ag.A), 7250)

		// createPlayer writes its audit row after it returns; let it land before after() clears the tenant.
		for (let i = 0; i < 30; i++) {
			const [row] = await q(sql`SELECT count(*)::int AS n FROM audit_logs WHERE tenant = ${T} AND action = 'create_player' AND resource_id IN (${wl.user.id}, ${ap.user.id})`)
			if (row.n >= 2) break
			await new Promise((resolve) => setTimeout(resolve, 100))
		}

		// A refused opening deposit rolls its player back: agent B's own new player, more chips than B has.
		await assert.rejects(
			async () =>
				playersMutations.createPlayerForAgent(
					null,
					{ input: { agentId: 'self', name: 'Too Rich', phone: `94${Date.now().toString().slice(-8)}`, username: `chipres_rich_${RUN}`, password: 'longenough1', openingChips: 999999 } },
					agentCtx(ag.B)
				),
			refusal('Opening chips: Not enough chips: available 1,500.00')
		)
		const left = await q(sql`SELECT count(*)::int AS n FROM users WHERE tenant = ${T} AND username = ${`chipres_rich_${RUN}`}`)
		assert.equal(left[0].n, 0, 'the refused deposit rolled the player back')
		assert.equal(await chips(ag.B), 1500)
	})

	it("adjustWallet no longer moves a credit player's chips", async () => {
		await assert.rejects(
			async () => usersMutations.adjustWallet(null, { userId: String(pl.pA), amount: 100 }, adminCtx()),
			refusal("A credit player's chips move only through Deposit / Withdraw chips")
		)
		assert.equal(await cash(pl.pA), 300)
	})
})
