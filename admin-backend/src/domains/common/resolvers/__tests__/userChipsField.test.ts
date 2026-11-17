/**
 * User.chips on the User field resolvers the schema actually uses: domains/index.ts maps User to
 * commonResolvers.User, so this is what makes single-user reads such as user(id) return a credit player's chips,
 * and not only the rows usersPage fills in one batch (spec docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md
 * §7). ChipService's batch read is stubbed on its prototype; no database.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/common/resolvers/__tests__/userChipsField.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { commonResolvers } from '../index.js'
import { ChipService, type ChipAccount } from '@src/domains/agents/services/ChipService.js'

const originalRead = ChipService.prototype.chipAccountsForPlayers
after(async () => {
	ChipService.prototype.chipAccountsForPlayers = originalRead
	// Importing the resolvers loads the db client and the realtime module; close what they may have opened.
	const { pool } = await import('@src/db/client.js')
	const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
	await closeRedisEmitter().catch(() => {})
	await pool.end().catch(() => {})
})

const adminCtx = () => ({ user: { sub: '7', type: 'admin', roles: [] }, tenant: 't1', whitelabel: { id: 't1' }, permissions: [] })
const agentCtx = (agentId: string) => ({ user: { sub: agentId, type: 'agent', agentId, roles: [] }, tenant: 't1', whitelabel: { id: 't1' }, permissions: [] })
const account = (id: string): ChipAccount => ({
	accountType: 'PLAYER',
	id,
	username: `player_${id}`,
	name: null,
	status: 'active',
	parentAgentId: null,
	playerType: 'WHITELABEL_CREDIT',
	currency: 'INR',
	creditReference: 1000,
	balance: 250,
	exposure: 0,
	available: 250,
	downlineBalance: 0,
	refPnl: -750,
	downlineCount: 0,
})
const chipsOf = (user: Record<string, unknown>, ctx: unknown) => (commonResolvers.User as any).chips(user, {}, ctx)

describe('User.chips on the live User type resolvers', () => {
	it('domains/index.ts maps User with commonResolvers.User last, and that map resolves chips', () => {
		const src = readFileSync(join(process.cwd(), 'src', 'domains', 'index.ts'), 'utf8')
		// The users map is spread first since B105 (its VIP and agent fields); the common map's fields win over it.
		assert.match(src, /^\s*User: \{ \.\.\.usersResolvers\.User, \.\.\.commonResolvers\.User \},/m)
		assert.equal(typeof (commonResolvers.User as any).chips, 'function')
	})

	it("a single-user read loads a credit player's chips once, in the caller's tenant", async () => {
		const reads: Array<[string, string[]]> = []
		ChipService.prototype.chipAccountsForPlayers = (async (tenant: string, ids: readonly string[]) => {
			reads.push([tenant, [...ids]])
			return new Map(ids.map((id) => [id, account(id)]))
		}) as any
		const chips = await chipsOf({ id: '42', playerType: 'WHITELABEL_CREDIT' }, adminCtx())
		assert.equal(chips?.id, '42')
		assert.equal(chips?.balance, 250)
		assert.deepEqual(reads, [['t1', ['42']]])
	})

	it("an agent never gets a whitelabel credit player's chips this way", async () => {
		ChipService.prototype.chipAccountsForPlayers = (async (_tenant: string, ids: readonly string[]) =>
			new Map(ids.map((id) => [id, account(id)]))) as any
		assert.equal(await chipsOf({ id: '43', playerType: 'WHITELABEL_CREDIT' }, agentCtx('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1')), null)
	})

	it('keeps the value a list already filled, and answers null for a cash player, without a read', async () => {
		ChipService.prototype.chipAccountsForPlayers = (async () => {
			throw new Error('chips must not be read here')
		}) as any
		const filled = account('7')
		assert.equal(await chipsOf({ id: '7', playerType: 'AGENT_CREDIT', chips: filled }, adminCtx()), filled)
		assert.equal(await chipsOf({ id: '8', playerType: 'AGENT_CREDIT', chips: null }, adminCtx()), null)
		assert.equal(await chipsOf({ id: '9', playerType: 'REGULAR' }, adminCtx()), null)
	})
})
