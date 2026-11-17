/**
 * The Chips page (/credit) is open to credit.management:view (owner decision 2026-11-04): Finance Manager holds it
 * without agents.list:view, and every read the page makes sat under Query.agents, which refused that whole namespace
 * without agents.list:view. Query.agents now lets credit.management:view in for the page's two reads, chipPool and
 * chipDownline, and every other AgentsQuery field still demands agents.list:view. The moves are untouched:
 * guardAgentMutations still demands agents.credit:update.
 *
 * Executed through the GraphQL schema with the live agents resolver maps. ChipService is stubbed, so no database is
 * reached; the isolated Matka QA database is selected anyway, so nothing could land on the main one.
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/resolvers/__tests__/chipsPageReadGate.test.ts
 */
import { after, afterEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchema, graphql, type GraphQLObjectType } from 'graphql'
import { isolateDatabase } from '../../../../../../tmp/domain-visibility-integration-fixtures.js'
isolateDatabase()
const { typeDefs } = await import('@src/types/graphql.js')
const { agentsResolvers, CHIPS_PAGE_READS } = await import('../index.js')
const { chipService } = await import('../../services/ChipService.js')
const { AGENT_MUTATION_PERMISSIONS } = await import('../guardAgentMutations.js')

after(async () => {
	const { pool } = await import('@src/db/client.js')
	const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
	await closeRedisEmitter().catch(() => {})
	await pool.end().catch(() => {})
})
afterEach(() => mock.restoreAll())

const schema = buildSchema(typeDefs)
for (const [typeName, fields] of Object.entries({
	Query: { agents: agentsResolvers.Query.agents },
	Mutation: { agents: agentsResolvers.Mutation.agents },
	AgentsQuery: agentsResolvers.AgentsQuery,
	AgentsMutation: agentsResolvers.AgentsMutation,
})) {
	const defined = (schema.getType(typeName) as GraphQLObjectType).getFields()
	for (const [name, resolve] of Object.entries(fields as Record<string, any>)) if (defined[name]) defined[name].resolve = resolve
}
// graphql-js answers with null-prototype objects; a JSON copy compares as plain data.
const run = async (source: string, contextValue: unknown) => JSON.parse(JSON.stringify(await graphql({ schema, source, contextValue })))

const TENANT = 'vfyog2-wl'
const AGENT_ID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const FORBIDDEN = 'Forbidden: insufficient permissions to access agents'
const admin = (permissions: unknown[]) => ({ tenant: TENANT, whitelabel: { id: TENANT }, user: { sub: '914206', type: 'admin', roles: ['Finance Manager'] }, permissions })
const financeManager = admin([{ domain: 'credit.management', actions: ['view'] }])
const account = { accountType: 'AGENT', id: AGENT_ID, username: 'vfyog2root', currency: 'INR', creditReference: 500, balance: 300, exposure: 0, available: 300, downlineBalance: 0, refPnl: 200, downlineCount: 0 }
const totals = { creditReference: 500, balance: 300, exposure: 0, available: 300, downlineBalance: 0, refPnl: 200 }
const pool = { currency: 'INR', creditLimit: 100000, used: 300, available: 99700 }

/** Stubs the chip reads; returns the callers each one saw. */
function stubChipReads() {
	const callers: Record<string, any[]> = { getPool: [], getDownline: [], getStatement: [], getAccount: [] }
	mock.method(chipService, 'getPool', async (caller: any) => (callers.getPool.push(caller), pool))
	mock.method(chipService, 'getDownline', async (caller: any) => (callers.getDownline.push(caller), { parent: null, pool, items: [account], total: 1, totals }))
	mock.method(chipService, 'getStatement', async (caller: any) => (callers.getStatement.push(caller), { rows: [], total: 0 }))
	mock.method(chipService, 'getAccount', async (caller: any) => (callers.getAccount.push(caller), account))
	return callers
}

const PAGE_READS = `{ agents {
	chipPool { currency creditLimit used available }
	chipDownline(limit: 20) { total items { id username balance } pool { available } totals { balance } }
} }`

describe('the Chips page reads for credit.management:view', () => {
	it('opens exactly chipPool and chipDownline, the two reads the page makes', () => {
		assert.deepEqual([...CHIPS_PAGE_READS].sort(), ['chipDownline', 'chipPool'])
	})

	it('a credit.management:view role without agents.list:view reads the pool and the root accounts, scoped to its tenant', async () => {
		for (const permissions of [[{ domain: 'credit.management', actions: ['view'] }], [{ domain: 'credit', actions: ['read'] }]]) {
			const callers = stubChipReads()
			const result = await run(PAGE_READS, admin(permissions))
			assert.equal(result.errors, undefined, JSON.stringify(result.errors))
			assert.deepEqual(result.data.agents.chipPool, pool)
			assert.deepEqual(result.data.agents.chipDownline.items, [{ id: AGENT_ID, username: 'vfyog2root', balance: 300 }])
			assert.deepEqual(callers.getPool.map((c) => [c.kind, c.tenant]), [['admin', TENANT]])
			assert.deepEqual(callers.getDownline.map((c) => [c.kind, c.tenant]), [['admin', TENANT]])
			mock.restoreAll()
		}
	})

	it('the same role is still refused every other agents field, the agents list among them', async () => {
		const callers = stubChipReads()
		const list = await run('{ agents { agentsPage(limit: 5) { total } } }', financeManager)
		assert.deepEqual(list.errors?.map((e: any) => [e.message, e.path?.join('.')]), [[FORBIDDEN, 'agents.agentsPage']])
		const statement = await run(`{ agents { chipStatement(accountType: AGENT, accountId: "${AGENT_ID}") { total } } }`, financeManager)
		assert.deepEqual(statement.errors?.map((e: any) => e.message), [FORBIDDEN])
		// Every field of AgentsQuery but the two page reads refuses before its body runs.
		const others = Object.keys((schema.getType('AgentsQuery') as GraphQLObjectType).getFields()).filter((name) => !CHIPS_PAGE_READS.has(name))
		assert.equal(others.length, 23)
		for (const name of others) {
			const resolve = (agentsResolvers.AgentsQuery as Record<string, (...args: unknown[]) => unknown>)[name]
			await assert.rejects(async () => resolve(null, { agentId: AGENT_ID }, financeManager, null), { message: FORBIDDEN }, name)
		}
		assert.deepEqual([callers.getStatement.length, callers.getAccount.length], [0, 0])
	})

	it('a caller holding neither permission is refused at the namespace, as before', async () => {
		const callers = stubChipReads()
		for (const ctx of [admin([{ domain: 'dashboard', actions: ['read'] }]), { tenant: TENANT, whitelabel: { id: TENANT } }]) {
			const result = await run(PAGE_READS, ctx)
			assert.equal(result.data, null)
			assert.deepEqual(result.errors?.map((e: any) => [e.message, e.path?.join('.')]), [[FORBIDDEN, 'agents']])
		}
		assert.deepEqual([callers.getPool.length, callers.getDownline.length], [0, 0])
	})

	it('agents.list:view holders and agents read every chip field as before; an agent stays in its own subtree', async () => {
		const callers = stubChipReads()
		const lister = admin([{ domain: 'agents.list', actions: ['view'] }])
		const read = await run(`{ agents { chipPool { used } chipStatement(accountType: AGENT, accountId: "${AGENT_ID}") { total } chipAccount(accountType: AGENT, accountId: "${AGENT_ID}") { id } } }`, lister)
		assert.equal(read.errors, undefined, JSON.stringify(read.errors))
		const agent = { tenant: TENANT, whitelabel: { id: TENANT }, user: { sub: AGENT_ID, type: 'agent', agentId: AGENT_ID, roles: [] }, permissions: [{ domain: 'agents', actions: ['view', 'manage', 'read'] }] }
		const downline = await run('{ agents { chipDownline { total } } }', agent)
		assert.equal(downline.errors, undefined, JSON.stringify(downline.errors))
		assert.deepEqual(callers.getDownline.map((c) => [c.kind, c.agentId]), [['agent', AGENT_ID]])
	})

	it('the moves are unchanged: D/W and CR still demand agents.credit:update', async () => {
		const moved = mock.fn()
		mock.method(chipService, 'depositChips', moved)
		mock.method(chipService, 'withdrawChips', moved)
		for (const field of ['depositChips', 'withdrawChips']) {
			assert.deepEqual(AGENT_MUTATION_PERMISSIONS[field], [['agents.credit', 'update']])
			const result = await run(`mutation { agents { ${field}(input: { accountType: AGENT, accountId: "${AGENT_ID}", amount: 10 }) { transferId } } }`, financeManager)
			assert.deepEqual(result.errors?.map((e: any) => e.message), ['Forbidden: insufficient permissions for agents.credit:update'])
		}
		assert.deepEqual(AGENT_MUTATION_PERMISSIONS.setCreditReference, [['agents.credit', 'update']])
		assert.equal(moved.mock.callCount(), 0)
	})
})
