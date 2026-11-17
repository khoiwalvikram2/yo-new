/**
 * The chips API resolvers (spec docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md §7) against a fake
 * ChipService: what each resolver hands the service, the audit row a move writes, the batch loaders behind
 * AgentAccount.chips and User.chips (one read per list, the caller's tenant, an agent kept inside its own
 * subtree), and the opening-chips helpers the three create paths share. No database.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/resolvers/__tests__/chipResolvers.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
	agentAccountChips,
	attachPlayerChips,
	buildChipMutationResolvers,
	buildChipQueryResolvers,
	createChipListLoaders,
	userChips,
} from '../chipResolvers.js'
import { ChipError, type ChipAccount, type ChipCaller } from '../../services/ChipService.js'
import {
	creatorActorOf,
	creditReferenceOf,
	depositOpeningChipsInTx,
	lockOpeningChipsParent,
	openingChipsOf,
} from '../../services/openingChips.js'

const A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'
const X = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3'

const adminCtx = (tenant = 't1') => ({ user: { sub: '7', type: 'admin', roles: [] }, tenant, whitelabel: { id: tenant }, permissions: [] })
const agentCtx = (agentId: string, user: Record<string, unknown> = {}) => ({
	user: { sub: agentId, type: 'agent', agentId, roles: [], isReadOnly: false, ...user },
	tenant: 't1',
	whitelabel: { id: 't1' },
	permissions: [],
})
const account = (over: Partial<ChipAccount> = {}): ChipAccount => ({
	accountType: 'AGENT',
	id: A,
	username: 'a',
	name: null,
	status: 'ACTIVE',
	parentAgentId: null,
	playerType: null,
	currency: 'INR',
	creditReference: 0,
	balance: 0,
	exposure: 0,
	available: 0,
	downlineBalance: 0,
	refPnl: 0,
	downlineCount: 0,
	...over,
})
const tick = () => new Promise((resolve) => setImmediate(resolve))

after(async () => {
	// Importing the resolvers loads the db client and the audit module; close what they may have opened.
	const { pool } = await import('@src/db/client.js')
	const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
	await closeRedisEmitter().catch(() => {})
	await pool.end().catch(() => {})
})

describe('AgentsQuery chip reads', () => {
	function fake() {
		const calls: Array<[string, ...unknown[]]> = []
		const service = {
			getAccount: async (...a: unknown[]) => (calls.push(['getAccount', ...a]), account()),
			getMyAccount: async (...a: unknown[]) => (calls.push(['getMyAccount', ...a]), null),
			getDownline: async (...a: unknown[]) => (calls.push(['getDownline', ...a]), { parent: null, pool: null, items: [], total: 0, totals: {} }),
			getStatement: async (...a: unknown[]) => (calls.push(['getStatement', ...a]), { rows: [], total: 0 }),
			getPool: async (...a: unknown[]) => (calls.push(['getPool', ...a]), null),
		}
		return { calls, q: buildChipQueryResolvers(service as any) }
	}

	it('builds the caller from the session and hands the arguments through', async () => {
		const { calls, q } = fake()
		await q.chipAccount(null, { accountType: 'AGENT', accountId: B }, agentCtx(A))
		await q.myChipAccount(null, {}, adminCtx())
		await q.chipDownline(null, { parentAgentId: B, query: 'x', accountType: 'PLAYER', offset: 5, limit: 10 } as any, agentCtx(A))
		await q.chipDownline(null, undefined as any, adminCtx())
		await q.chipStatement(null, { accountType: 'PLAYER', accountId: '42', from: '2026-11-01', to: null } as any, adminCtx())
		await q.chipPool(null, {}, adminCtx('t9'))
		const agentCaller = { kind: 'agent', tenant: 't1', agentId: A, readOnly: false }
		const adminCaller = { kind: 'admin', tenant: 't1', userId: '7' }
		assert.deepEqual(calls, [
			['getAccount', agentCaller, 'AGENT', B],
			['getMyAccount', adminCaller],
			['getDownline', agentCaller, { parentAgentId: B, query: 'x', accountType: 'PLAYER', offset: 5, limit: 10 }],
			['getDownline', adminCaller, {}],
			['getStatement', adminCaller, { accountType: 'PLAYER', accountId: '42', from: '2026-11-01', to: null }],
			['getPool', { kind: 'admin', tenant: 't9', userId: '7' }],
		])
	})

	it('refuses a caller with no session before the service is asked anything', async () => {
		const { calls, q } = fake()
		for (const read of [
			() => q.chipAccount(null, { accountType: 'AGENT', accountId: A }, { tenant: 't1' }),
			() => q.myChipAccount(null, {}, {}),
			() => q.chipDownline(null, {}, undefined),
			() => q.chipStatement(null, { accountType: 'AGENT', accountId: A } as any, { tenant: 't1' }),
			() => q.chipPool(null, {}, { tenant: 't1' }),
		]) {
			await assert.rejects(read(), /Unauthorized: authentication required/)
		}
		assert.deepEqual(calls, [])
	})
})

describe('AgentsMutation chip moves', () => {
	const result = (over: Record<string, unknown> = {}) => ({
		account: account({ id: B, balance: 600, parentAgentId: A }),
		parent: account({ id: A, balance: 400 }),
		pool: null,
		transferId: 'tr-1',
		...over,
	})

	function fake(audit: (e: any) => Promise<unknown> = async () => 1) {
		const calls: Array<[string, unknown, unknown]> = []
		const audits: any[] = []
		const service = {
			depositChips: async (caller: unknown, input: unknown) => (calls.push(['depositChips', caller, input]), result()),
			withdrawChips: async (caller: unknown, input: unknown) => (
				calls.push(['withdrawChips', caller, input]),
				result({ account: account({ accountType: 'PLAYER', id: '42', playerType: 'WHITELABEL_CREDIT', balance: 10 }), parent: null, pool: { currency: 'INR', creditLimit: 1, used: 0, available: 1 } })
			),
			setCreditReference: async (caller: unknown, input: unknown) => (calls.push(['setCreditReference', caller, input]), account({ id: B, creditReference: 3000 })),
		}
		const m = buildChipMutationResolvers(service as any, async (e) => {
			audits.push(e)
			return audit(e)
		})
		return { calls, audits, m }
	}

	it('hands the input to the service and writes the activity-log row', async () => {
		const { calls, audits, m } = fake()
		const input = { accountType: 'AGENT', accountId: B, amount: 100, remark: 'top up' }
		const out = await m.depositChips(null, { input } as any, agentCtx(A))
		assert.equal(out.transferId, 'tr-1')
		assert.deepEqual(calls, [['depositChips', { kind: 'agent', tenant: 't1', agentId: A, readOnly: false }, input]])
		await tick()
		assert.deepEqual(audits, [
			{
				tenant: 't1',
				actorId: A,
				domain: 'agents.chips',
				action: 'deposit_chips',
				resourceType: 'agent',
				resourceId: B,
				after: { amount: 100, remark: 'top up', transferId: 'tr-1', balanceAfter: 600, parentAgentId: A, actorType: 'agent' },
			},
		])
	})

	it('records a withdrawal from a player and a credit-reference change by an admin', async () => {
		const { audits, m } = fake()
		await m.withdrawChips(null, { input: { accountType: 'PLAYER', accountId: '42', amount: 5 } } as any, adminCtx())
		await m.setCreditReference(null, { input: { accountType: 'AGENT', accountId: B, creditReference: 3000, remark: null } } as any, adminCtx())
		await tick()
		assert.deepEqual(
			audits.map((a) => [a.action, a.actorId, a.resourceType, a.resourceId]),
			[
				['withdraw_chips', '7', 'player', '42'],
				['set_credit_reference', '7', 'agent', B],
			]
		)
		assert.deepEqual(audits[1].after, { creditReference: 3000, remark: null, actorType: 'admin' })
	})

	it('a failed audit write never fails a move that has committed', async () => {
		const { m } = fake(async () => {
			throw new Error('audit down')
		})
		const out = await m.depositChips(null, { input: { accountType: 'AGENT', accountId: B, amount: 1 } } as any, agentCtx(A))
		assert.equal(out.transferId, 'tr-1')
		await tick()
	})

	it('a read-only agent and a caller with no session are refused before the service', async () => {
		const { calls, audits, m } = fake()
		const input = { accountType: 'AGENT', accountId: B, amount: 1 }
		await assert.rejects(m.depositChips(null, { input } as any, agentCtx(A, { isReadOnly: true })), /Your account is inactive/)
		await assert.rejects(m.withdrawChips(null, { input } as any, { tenant: 't1' }), /Unauthorized: authentication required/)
		await assert.rejects(m.setCreditReference(null, { input: { ...input, creditReference: 1 } } as any, {}), /Unauthorized/)
		assert.deepEqual(calls, [])
		await tick()
		assert.deepEqual(audits, [])
	})

	it("a service refusal reaches the caller unchanged and writes no audit row", async () => {
		const audits: any[] = []
		const m = buildChipMutationResolvers(
			{ depositChips: async () => { throw new ChipError('NOT_DIRECT_PARENT', 'Only the direct upline can move chips for this account') } } as any,
			async (e) => audits.push(e)
		)
		await assert.rejects(m.depositChips(null, { input: { accountType: 'AGENT', accountId: X, amount: 1 } } as any, agentCtx(A)), (err: any) => {
			assert.ok(err instanceof ChipError)
			assert.equal(err.code, 'NOT_DIRECT_PARENT')
			return true
		})
		await tick()
		assert.deepEqual(audits, [])
	})
})

describe('AgentAccount.chips and User.chips: batch loaders', () => {
	const admin: ChipCaller = { kind: 'admin', tenant: 't1', userId: '7' }
	const agentA: ChipCaller = { kind: 'agent', tenant: 't1', agentId: A }

	function service() {
		const calls: Array<[string, string, readonly unknown[]]> = []
		return {
			calls,
			chipAccountsForAgents: async (tenant: string, ids: readonly string[]) => {
				calls.push(['agents', tenant, ids])
				return new Map([
					[A, account({ id: A })],
					[B, account({ id: B, parentAgentId: A })],
					[X, account({ id: X })],
				].filter(([id]) => ids.includes(id as string)) as Array<[string, ChipAccount]>)
			},
			chipAccountsForPlayers: async (tenant: string, ids: readonly (string | number)[]) => {
				calls.push(['players', tenant, ids])
				const all: Array<[string, ChipAccount]> = [
					['1', account({ accountType: 'PLAYER', id: '1', playerType: 'AGENT_CREDIT', parentAgentId: A })],
					['2', account({ accountType: 'PLAYER', id: '2', playerType: 'AGENT_CREDIT', parentAgentId: X })],
					['3', account({ accountType: 'PLAYER', id: '3', playerType: 'WHITELABEL_CREDIT', parentAgentId: null })],
				]
				return new Map(all.filter(([id]) => ids.map(String).includes(id)))
			},
		}
	}

	it('a list of agents costs one read, in the caller tenant, with ids normalised', async () => {
		const svc = service()
		const loaders = createChipListLoaders(admin, svc as any, async () => {
			throw new Error('an admin is not filtered by subtree')
		})
		const out = await Promise.all([A.toUpperCase(), B, X, 'not-an-agent'].map((id) => loaders.agents.load(id.toLowerCase())))
		assert.equal(svc.calls.length, 1)
		assert.equal(svc.calls[0][1], 't1')
		assert.deepEqual(out.map((a) => a?.id ?? null), [A, B, X, null])
	})

	it("an agent caller sees only its own subtree's chips, with one closure read for the list", async () => {
		const svc = service()
		const subtreeCalls: Array<[string, readonly string[]]> = []
		const loaders = createChipListLoaders(agentA, svc as any, async (ancestor, ids) => {
			subtreeCalls.push([ancestor, ids])
			return new Set([A, B].filter((id) => ids.includes(id)))
		})
		const agents = await Promise.all([A, B, X].map((id) => loaders.agents.load(id)))
		assert.deepEqual(agents.map((a) => a?.id ?? null), [A, B, null], 'X sits in another subtree')
		const players = await Promise.all(['1', '2', '3', '4'].map((id) => loaders.players.load(id)))
		assert.deepEqual(players.map((p) => p?.id ?? null), ['1', null, null, null], "another subtree's player and a WHITELABEL_CREDIT player stay hidden")
		assert.equal(subtreeCalls.length, 2)
		assert.equal(subtreeCalls[0][0], A)
		assert.deepEqual([...subtreeCalls[1][1]].sort(), [A, X].sort(), 'the players are checked through their agents')
		assert.equal(svc.calls.filter(([kind]) => kind === 'players').length, 1)
	})

	it('an admin sees every credit player of its tenant', async () => {
		const loaders = createChipListLoaders(admin, service() as any)
		const players = await Promise.all(['1', '2', '3'].map((id) => loaders.players.load(id)))
		assert.deepEqual(players.map((p) => p?.id), ['1', '2', '3'])
	})

	it('answers null without a read for other schemes and player types, and keeps a value a list already filled', async () => {
		// No session in these contexts: a read would throw, so returning null proves nothing was loaded.
		assert.equal(await agentAccountChips({ id: A, schemeType: 'SHARING' }, {}, {}), null)
		assert.equal(await agentAccountChips({ id: A, schemeType: null }, {}, {}), null, "the redacted upline parentAgent returns to an agent")
		assert.equal(await userChips({ id: 5, playerType: 'REGULAR' }, {}, {}), null)
		const filled = account({ accountType: 'PLAYER', id: '5' })
		assert.equal(await userChips({ id: 5, playerType: 'AGENT_CREDIT', chips: filled }, {}, {}), filled)
		const rows: any[] = [{ id: 1, playerType: 'REGULAR' }, { id: 2, playerType: 'SHARING_AGENT_PLAYER' }]
		await attachPlayerChips(rows, {})
		assert.deepEqual(rows.map((r) => r.chips), [null, null])
	})
})

describe('opening chips and the credit reference at creation (spec §4.4)', () => {
	it('openingChipsOf: missing or zero is no deposit; refuses NaN, Infinity and negatives; rounds to 2 decimals', () => {
		for (const raw of [undefined, null, '', 0, 0.004]) assert.equal(openingChipsOf(raw), 0)
		assert.equal(openingChipsOf(12.345), 12.35)
		assert.equal(openingChipsOf('25'), 25)
		for (const [raw, message] of [
			[-1, 'Opening chips cannot be negative'],
			['abc', 'Opening chips must be a number'],
			[Infinity, 'Opening chips must be a number'],
			[Number.NaN, 'Opening chips must be a number'],
		] as const) {
			assert.throws(() => openingChipsOf(raw), (err: any) => err instanceof ChipError && err.code === 'INVALID_INPUT' && err.message === message)
		}
	})

	it('creditReferenceOf: missing is 0; a reference is >= 0 and rounded', () => {
		assert.equal(creditReferenceOf(undefined), 0)
		assert.equal(creditReferenceOf(''), 0)
		assert.equal(creditReferenceOf(1000.004), 1000)
		assert.equal(creditReferenceOf('250.5'), 250.5)
		assert.throws(() => creditReferenceOf(-1), /Credit reference cannot be negative/)
		assert.throws(() => creditReferenceOf('x'), /Credit reference must be a number/)
	})

	it('creatorActorOf: the agent id for an agent, the admin user id for an admin', () => {
		assert.deepEqual(creatorActorOf(agentCtx(A)), { createdBy: A, createdByType: 'agent' })
		assert.deepEqual(creatorActorOf(adminCtx()), { createdBy: '7', createdByType: 'admin' })
		assert.deepEqual(creatorActorOf({ user: { id: 9 } }), { createdBy: '9', createdByType: 'admin' })
		assert.deepEqual(creatorActorOf({}), { createdBy: null, createdByType: 'admin' })
	})

	it('lockOpeningChipsParent locks the parent agent in its tenant, or the pool', async () => {
		const calls: string[] = []
		const repo = {
			lockAgent: async (_tx: unknown, id: string) => (calls.push(`agent:${id}`), id === X ? { tenantId: 't2' } : { tenantId: 't1' }),
			lockPool: async (_tx: unknown, tenant: string) => (calls.push(`pool:${tenant}`), null),
		}
		await lockOpeningChipsParent({} as any, 't1', A, repo as any)
		await lockOpeningChipsParent({} as any, 't1', null, repo as any)
		await assert.rejects(lockOpeningChipsParent({} as any, 't1', X, repo as any), (err: any) => err instanceof ChipError && err.code === 'NOT_FOUND')
		assert.deepEqual(calls, [`agent:${A}`, 'pool:t1', `agent:${X}`])
	})

	it('depositOpeningChipsInTx deposits with the remark "Opening chips" and names the opening chips in a refusal', async () => {
		const seen: any[] = []
		const tx = { rollback() {} } as any
		const p = { tenant: 't1', accountType: 'PLAYER' as const, accountId: '42', amount: 50, actor: { createdBy: A, createdByType: 'agent' as const } }
		// The new player as the creation transaction sees it: agent A's own AGENT_CREDIT player, so A is its direct
		// upline (the refusals of other creators are in services/__tests__/openingChips.test.ts).
		const place = {
			readAgent: async () => null,
			readPlayer: async () => ({ id: 42, tenant: 't1', username: 'p', name: 'p', email: null, status: 'active', playerType: 'AGENT_CREDIT', agentId: A, creditLimit: 0 }),
		}
		await depositOpeningChipsInTx(p, tx, { depositOpeningChips: async (input: any, t: any) => (seen.push([input, t]), { transferId: 't' }) } as any, place as any)
		assert.deepEqual(seen, [[{ ...p, remark: 'Opening chips' }, tx]])

		const refuse = { depositOpeningChips: async () => { throw new ChipError('NOT_ACTIVE', 'Chips cannot be deposited while agent a is suspended') } }
		await assert.rejects(depositOpeningChipsInTx(p, tx, refuse as any, place as any), (err: any) => {
			assert.ok(err instanceof ChipError)
			assert.equal(err.code, 'NOT_ACTIVE')
			assert.equal(err.message, 'Opening chips: Chips cannot be deposited while agent a is suspended')
			return true
		})
		const broken = { depositOpeningChips: async () => { throw new Error('connection lost') } }
		await assert.rejects(depositOpeningChipsInTx(p, tx, broken as any, place as any), /^Error: connection lost$/)
	})
})
