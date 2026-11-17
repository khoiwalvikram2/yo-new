/**
 * setUserBonusAllowed refuses to turn bonuses on for a credit player (AGENT_CREDIT, WHITELABEL_CREDIT): spec
 * docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md decision 7. A credit player's cash wallet holds its
 * chips, which move only through Deposit / Withdraw by its direct upline. Turning bonuses off stays allowed, and
 * other players are unchanged.
 *
 * No database: the pg pool is a tripwire. A refusal must come before any write; a call the guard lets through
 * reaches the write and trips it (DB_TOUCHED), which is how these tests see that it went through.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/users/__tests__/setUserBonusAllowedCredit.test.ts
 */
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '@src/db/client.js'
import { AgentsRepo } from '@/repos/agents/AgentsRepo.js'
import { ChipRepo } from '@/repos/agents/ChipRepo.js'
import { PlayerAuthService } from '@src/domains/players/services/PlayerAuthService.js'
import { deriveAgentPermissions } from '@src/domains/agents/services/AgentPermissionsService.js'
import { usersMutationResolvers } from '../resolvers/mutations.js'

const TENANT = 'bonus-credit-test'
const CREDIT_AGENT = '33333333-3333-4333-8333-333333333333'
const PLAYERS: Record<number, string> = {
	201: 'AGENT_CREDIT',
	202: 'WHITELABEL_CREDIT',
	203: 'REGULAR',
	204: 'SHARING_AGENT_PLAYER',
	205: 'COMMISSION_AGENT_PLAYER',
}
const REFUSAL = 'Credit players cannot receive bonuses: their chips move only through Deposit / Withdraw'

let dbTouches = 0
let reads: Array<[number, string]> = []

const adminCtx = () => ({ tenant: TENANT, user: { sub: '1', roles: ['Whitelabel Admin'] }, permissions: [{ domain: 'all', actions: ['*'] }] })
const agentCtx = () => ({
	tenant: TENANT,
	user: { type: 'agent', agentId: CREDIT_AGENT, sub: CREDIT_AGENT, isReadOnly: false },
	permissions: deriveAgentPermissions(['sports', 'casino', 'matka']),
})
const call = (id: number, allow: boolean, ctx: any) => (usersMutationResolvers as any).setUserBonusAllowed(null, { id: String(id), allow }, ctx)
/** The call went through the guard and reached the write: drizzle wraps the tripwire's error as the cause. */
const reachedWrite = (err: any) => {
	assert.match(`${err?.message} ${err?.cause?.message ?? ''}`, /DB_TOUCHED/)
	assert.match(String(err?.message), /update "users" set "bonus_allowed"/)
	return true
}

beforeEach(() => {
	dbTouches = 0
	reads = []
	// Tripwire: anything that would reach PostgreSQL fails loudly instead.
	mock.method(pool as any, 'query', async () => {
		dbTouches++
		throw new Error('DB_TOUCHED')
	})
	mock.method(pool as any, 'connect', async () => {
		dbTouches++
		throw new Error('DB_TOUCHED')
	})
	mock.method(ChipRepo.prototype, 'readPlayer', async (_executor: unknown, id: number, tenant: string) => {
		reads.push([id, tenant])
		const playerType = PLAYERS[id]
		return playerType
			? { id, tenant, username: `p${id}`, name: `p${id}`, email: null, status: 'active', playerType, agentId: null, creditLimit: 0 }
			: null
	})
	// The credit agent's scope holds every test player; the agent is a CREDIT agent, not a SHARING one.
	mock.method(PlayerAuthService.prototype, 'getAgentPlayerIds', async () => Object.keys(PLAYERS).map(Number))
	mock.method(AgentsRepo.prototype, 'findById', async (id: string) => ({ id, tenantId: TENANT, schemeType: 'CREDIT', status: 'ACTIVE' }) as any)
})

afterEach(() => {
	mock.restoreAll()
})

describe('setUserBonusAllowed: no bonuses for credit players', () => {
	it('refuses to turn bonuses on for an AGENT_CREDIT or a WHITELABEL_CREDIT player, before anything is written', async () => {
		for (const id of [201, 202]) {
			await assert.rejects(() => call(id, true, adminCtx()), (err: any) => (assert.equal(err?.message, REFUSAL), true))
		}
		assert.deepEqual(reads, [[201, TENANT], [202, TENANT]], "the player's type is read in the caller's tenant")
		assert.equal(dbTouches, 0, 'nothing was written')
	})

	it("refuses an agent too (a credit agent's own player)", async () => {
		await assert.rejects(() => call(201, true, agentCtx()), (err: any) => (assert.equal(err?.message, REFUSAL), true))
		assert.equal(dbTouches, 0)
	})

	it('turning bonuses off for a credit player is allowed: it reaches the write', async () => {
		for (const id of [201, 202]) await assert.rejects(() => call(id, false, adminCtx()), reachedWrite)
		assert.deepEqual(reads, [], 'no type read is needed to turn bonuses off')
	})

	it('other players are unchanged: turning bonuses on reaches the write', async () => {
		for (const id of [203, 204, 205]) await assert.rejects(() => call(id, true, adminCtx()), reachedWrite)
		assert.equal(reads.length, 3)
	})

	it('an unknown player is left to the write, which answers "User not found" as before', async () => {
		await assert.rejects(() => call(999, true, adminCtx()), reachedWrite)
	})
})
