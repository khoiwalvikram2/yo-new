/**
 * The chips API is reachable and matches its contract (spec docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md
 * §7, which the admin UI codes against): the schema declares every field, argument and type as written there; the
 * agents resolver maps carry a function for each field; the three moves demand agents.credit:update; and the
 * parser that probe:admin-authz, audit:admin and audit:unprobed use for the agents namespace sees every field the
 * schema declares (memory gw-probe-regex-docstring-trap). No database.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/resolvers/__tests__/chipApiWiring.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
	buildSchema,
	type GraphQLEnumType,
	type GraphQLField,
	type GraphQLInputObjectType,
	type GraphQLObjectType,
} from 'graphql'
import { typeDefs } from '@src/types/graphql.js'
import { AGENT_MUTATION_PERMISSIONS } from '../guardAgentMutations.js'
import { namespaceFields } from '../../../../../scripts/agentNamespaceFields.js'

const schema = buildSchema(typeDefs)

after(async () => {
	const { pool } = await import('@src/db/client.js')
	const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
	await closeRedisEmitter().catch(() => {})
	await pool.end().catch(() => {})
})

const signature = (f: GraphQLField<unknown, unknown>) =>
	`${f.name}(${f.args.map((a) => `${a.name}: ${String(a.type)}`).join(', ')}): ${String(f.type)}`
const objectFields = (name: string) =>
	Object.values((schema.getType(name) as GraphQLObjectType).getFields()).map((f) => `${f.name}: ${String(f.type)}`)
const inputFields = (name: string) =>
	Object.values((schema.getType(name) as GraphQLInputObjectType).getFields()).map((f) => `${f.name}: ${String(f.type)}`)

describe('chips API: the schema is the spec §7 contract', () => {
	it('AgentsQuery declares the five reads', () => {
		const fields = (schema.getType('AgentsQuery') as GraphQLObjectType).getFields()
		assert.deepEqual(
			['chipAccount', 'myChipAccount', 'chipDownline', 'chipStatement', 'chipPool'].map((n) => signature(fields[n])),
			[
				'chipAccount(accountType: ChipAccountType!, accountId: ID!): ChipAccount',
				'myChipAccount(): ChipAccount',
				'chipDownline(parentAgentId: ID, query: String, accountType: ChipAccountType, offset: Int, limit: Int): ChipDownline!',
				'chipStatement(accountType: ChipAccountType!, accountId: ID!, from: String, to: String, offset: Int, limit: Int): ChipStatementPage!',
				'chipPool(): ChipPool',
			]
		)
	})

	it('AgentsMutation declares the three moves', () => {
		const fields = (schema.getType('AgentsMutation') as GraphQLObjectType).getFields()
		assert.deepEqual(
			['depositChips', 'withdrawChips', 'setCreditReference'].map((n) => signature(fields[n])),
			[
				'depositChips(input: ChipTransferInput!): ChipTransferResult!',
				'withdrawChips(input: ChipTransferInput!): ChipTransferResult!',
				'setCreditReference(input: CreditReferenceInput!): ChipAccount!',
			]
		)
	})

	it('the chip types, inputs and enums', () => {
		assert.deepEqual((schema.getType('ChipAccountType') as GraphQLEnumType).getValues().map((v) => v.name), ['AGENT', 'PLAYER'])
		assert.deepEqual(
			(schema.getType('ChipMovementKind') as GraphQLEnumType).getValues().map((v) => v.name),
			['OPENING', 'DEPOSIT', 'WITHDRAW', 'CREDIT_REFERENCE']
		)
		assert.deepEqual(objectFields('ChipAccount'), [
			'accountType: ChipAccountType!',
			'id: ID!',
			'username: String!',
			'name: String',
			'status: String',
			'parentAgentId: ID',
			'playerType: String',
			'currency: String!',
			'creditReference: Float!',
			'balance: Float!',
			'exposure: Float!',
			'available: Float!',
			'downlineBalance: Float!',
			'refPnl: Float!',
			'downlineCount: Int!',
		])
		assert.deepEqual(objectFields('ChipPool'), ['currency: String!', 'creditLimit: Float!', 'used: Float!', 'available: Float!'])
		assert.deepEqual(objectFields('ChipTotals'), [
			'creditReference: Float!',
			'balance: Float!',
			'exposure: Float!',
			'available: Float!',
			'downlineBalance: Float!',
			'refPnl: Float!',
		])
		assert.deepEqual(objectFields('ChipDownline'), [
			'parent: ChipAccount',
			'pool: ChipPool',
			'items: [ChipAccount!]!',
			'total: Int!',
			'totals: ChipTotals!',
		])
		assert.deepEqual(objectFields('ChipStatementRow'), [
			'id: ID!',
			'createdAt: String!',
			'kind: ChipMovementKind!',
			'amount: Float!',
			'balanceBefore: Float!',
			'balanceAfter: Float!',
			'creditReferenceBefore: Float',
			'creditReferenceAfter: Float',
			'counterpartyType: String',
			'counterpartyId: ID',
			'counterpartyName: String',
			'remark: String',
			'createdBy: String',
		])
		assert.deepEqual(objectFields('ChipStatementPage'), ['rows: [ChipStatementRow!]!', 'total: Int!'])
		assert.deepEqual(objectFields('ChipTransferResult'), [
			'account: ChipAccount!',
			'parent: ChipAccount',
			'pool: ChipPool',
			'transferId: ID!',
		])
		assert.deepEqual(inputFields('ChipTransferInput'), [
			'accountType: ChipAccountType!',
			'accountId: ID!',
			'amount: Float!',
			'remark: String',
		])
		assert.deepEqual(inputFields('CreditReferenceInput'), [
			'accountType: ChipAccountType!',
			'accountId: ID!',
			'creditReference: Float!',
			'remark: String',
		])
	})

	it('the list fields and the creation inputs', () => {
		assert.equal(String((schema.getType('AgentAccount') as GraphQLObjectType).getFields().chips?.type), 'ChipAccount')
		assert.equal(String((schema.getType('User') as GraphQLObjectType).getFields().chips?.type), 'ChipAccount')
		for (const input of ['CreateAgentInput', 'CreatePlayerInput', 'CreatePlayerForAgentInput']) {
			assert.equal(String((schema.getType(input) as GraphQLInputObjectType).getFields().openingChips?.type), 'Float', input)
		}
	})
})

describe('chips API: resolvers and permissions', () => {
	it('every chip field has a resolver function in the live maps', async () => {
		const { domainResolvers } = await import('@src/domains/index.js')
		const maps = domainResolvers as unknown as Record<string, Record<string, unknown>>
		for (const n of ['chipAccount', 'myChipAccount', 'chipDownline', 'chipStatement', 'chipPool']) {
			assert.equal(typeof maps.AgentsQuery[n], 'function', `AgentsQuery.${n}`)
		}
		for (const n of ['depositChips', 'withdrawChips', 'setCreditReference']) {
			assert.equal(typeof maps.AgentsMutation[n], 'function', `AgentsMutation.${n}`)
		}
		assert.equal(typeof maps.AgentAccount.chips, 'function', 'AgentAccount.chips')
	})

	it('the three moves demand agents.credit:update', () => {
		for (const n of ['depositChips', 'withdrawChips', 'setCreditReference']) {
			assert.deepEqual(AGENT_MUTATION_PERMISSIONS[n], [['agents.credit', 'update']], n)
		}
	})

	it('a move with no session is refused by the guard before its body runs', async () => {
		const { domainResolvers } = await import('@src/domains/index.js')
		const m = (domainResolvers as any).AgentsMutation
		// The guard throws synchronously, before any body; wrapping each call in an async function turns that into
		// the rejection assert.rejects reads.
		await assert.rejects(async () => m.depositChips(null, { input: { accountType: 'AGENT', accountId: 'x', amount: 1 } }, { tenant: 't1' }, null), /Unauthorized: authentication required/)
		const noPermission = { user: { sub: '1', type: 'admin', roles: [] }, tenant: 't1', permissions: [{ domain: 'dashboard', actions: ['read'] }] }
		await assert.rejects(async () => m.withdrawChips(null, { input: {} }, noPermission, null), /Forbidden: insufficient permissions for agents\.credit:update/)
		await assert.rejects(async () => m.setCreditReference(null, { input: {} }, noPermission, null), /Forbidden: insufficient permissions for agents\.credit:update/)
	})

	it('the chip reads sit behind Query.agents, which refuses a caller without agents.list:view', async () => {
		const { domainResolvers } = await import('@src/domains/index.js')
		const noPermission = { user: { sub: '1', type: 'admin', roles: [] }, tenant: 't1', permissions: [{ domain: 'dashboard', actions: ['read'] }] }
		assert.throws(() => (domainResolvers as any).Query.agents(null, {}, noPermission, null), /Forbidden/)
	})
})

describe('chips API: the probes and audits see the agents namespace', () => {
	for (const type of ['AgentsQuery', 'AgentsMutation'] as const) {
		it(`${type}: the namespace parser sees every field the schema declares`, () => {
			const parsed = namespaceFields(type).map((f) => f.name).sort()
			const declared = Object.keys((schema.getType(type) as GraphQLObjectType).getFields()).sort()
			assert.deepEqual(parsed, declared)
		})
	}

	it('reads the chip fields with their argument types', () => {
		const query = new Map(namespaceFields('AgentsQuery').map((f) => [f.name, f.args]))
		assert.deepEqual(query.get('chipAccount'), [
			{ name: 'accountType', type: 'ChipAccountType!' },
			{ name: 'accountId', type: 'ID!' },
		])
		assert.deepEqual(query.get('chipPool'), [])
		const mutation = new Map(namespaceFields('AgentsMutation').map((f) => [f.name, f.args]))
		assert.deepEqual(mutation.get('depositChips'), [{ name: 'input', type: 'ChipTransferInput!' }])
	})
})
