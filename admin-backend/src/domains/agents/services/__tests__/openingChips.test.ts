/**
 * Opening chips come only from the new account's direct upline (decision 3 of
 * docs/superpowers/specs/2026-11-02-credit-dw-chips-design.md, applied at creation, §4.4): the rule
 * (openingChipsUplineRefusal / assertOpeningChipsFromDirectUpline), the read of the new account's place on the
 * creation transaction, and depositOpeningChipsInTx refusing before the deposit runs. Allowed and refused cases for
 * each creator kind. No database: the repo and the service are fakes.
 *
 * The three create paths against the database are in openingChips.integration.test.ts.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/openingChips.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ChipError, type ChipActor } from '../ChipService.js'
import {
	assertOpeningChipsFromDirectUpline,
	depositOpeningChipsInTx,
	OPENING_CHIPS_DIRECT_UPLINE_ONLY,
	openingChipsRestrictedUplineRefusal,
	openingChipsUplineRefusal,
	readOpeningChipsPlace,
	type OpeningChipsPlace,
} from '../openingChips.js'

const A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2'

const byAgent = (agentId: string): ChipActor => ({ createdBy: agentId, createdByType: 'agent' })
const byAdmin: ChipActor = { createdBy: '7', createdByType: 'admin' }
const bySystem: ChipActor = { createdBy: null, createdByType: 'system' }

const agentUnder = (parentAgentId: string | null): OpeningChipsPlace => ({ accountType: 'AGENT', parentAgentId })
const agentPlayerOf = (agentId: string): OpeningChipsPlace => ({ accountType: 'PLAYER', playerType: 'AGENT_CREDIT', agentId })
const whitelabelPlayer: OpeningChipsPlace = { accountType: 'PLAYER', playerType: 'WHITELABEL_CREDIT', agentId: null }

const isUplineRefusal = (err: unknown) => {
	assert.ok(err instanceof ChipError, String(err))
	assert.equal(err.code, 'NOT_DIRECT_PARENT')
	assert.equal(err.message, OPENING_CHIPS_DIRECT_UPLINE_ONLY)
	return true
}

after(async () => {
	// Importing ChipService loads the db client; close its pool so the run can exit.
	const { pool } = await import('@src/db/client.js')
	await pool.end().catch(() => {})
})

describe('openingChipsUplineRefusal: only the direct upline gives opening chips', () => {
	it('the refusal text is the one the create forms show', () => {
		assert.equal(
			OPENING_CHIPS_DIRECT_UPLINE_ONLY,
			'Opening chips can only come from the direct upline. Create the account with 0 opening chips; its upline can then deposit.'
		)
	})

	it('an agent: allowed for its own direct sub-agent and its own AGENT_CREDIT player', () => {
		assert.equal(openingChipsUplineRefusal(byAgent(A), agentUnder(A)), null)
		assert.equal(openingChipsUplineRefusal(byAgent(A), agentPlayerOf(A)), null)
		// Ids compare like the direct-parent rule of the chip moves: trimmed, case-insensitive.
		assert.equal(openingChipsUplineRefusal(byAgent(A.toUpperCase()), agentUnder(` ${A} `)), null)
	})

	it('an agent: refused for its sub-agent, a sub-agent of another agent, a root agent or a WHITELABEL_CREDIT player', () => {
		isUplineRefusal(openingChipsUplineRefusal(byAgent(A), agentPlayerOf(B)))
		isUplineRefusal(openingChipsUplineRefusal(byAgent(A), agentUnder(B)))
		isUplineRefusal(openingChipsUplineRefusal(byAgent(A), agentUnder(null)))
		isUplineRefusal(openingChipsUplineRefusal(byAgent(A), whitelabelPlayer))
		isUplineRefusal(openingChipsUplineRefusal(byAgent(A), { accountType: 'PLAYER', playerType: 'AGENT_CREDIT', agentId: null }))
	})

	it('an admin: allowed for a root CREDIT agent and a WHITELABEL_CREDIT player (the whitelabel pool is their parent)', () => {
		assert.equal(openingChipsUplineRefusal(byAdmin, agentUnder(null)), null)
		assert.equal(openingChipsUplineRefusal(byAdmin, whitelabelPlayer), null)
	})

	it("an admin: allowed for an AGENT_CREDIT player under an agent, the chips being that agent's (owner decision 2026-11-04)", () => {
		assert.equal(openingChipsUplineRefusal(byAdmin, agentPlayerOf(A)), null)
		assert.equal(openingChipsUplineRefusal(byAdmin, agentPlayerOf(B)), null)
	})

	it('an admin: still refused for a sub-agent under an agent, and for an AGENT_CREDIT player with no agent', () => {
		isUplineRefusal(openingChipsUplineRefusal(byAdmin, agentUnder(A)))
		isUplineRefusal(openingChipsUplineRefusal(byAdmin, { accountType: 'PLAYER', playerType: 'AGENT_CREDIT', agentId: null }))
	})

	it('a system creator is nobody\'s upline', () => {
		isUplineRefusal(openingChipsUplineRefusal(bySystem, agentUnder(null)))
		isUplineRefusal(openingChipsUplineRefusal(bySystem, whitelabelPlayer))
	})

	it('assertOpeningChipsFromDirectUpline: 0 opening chips is always allowed; more than 0 only from the direct upline', () => {
		assert.doesNotThrow(() => assertOpeningChipsFromDirectUpline(byAdmin, agentPlayerOf(A), 0))
		assert.doesNotThrow(() => assertOpeningChipsFromDirectUpline(byAgent(A), agentPlayerOf(B), 0))
		assert.doesNotThrow(() => assertOpeningChipsFromDirectUpline(byAdmin, whitelabelPlayer, 100))
		assert.doesNotThrow(() => assertOpeningChipsFromDirectUpline(byAgent(A), agentUnder(A), 100))
		assert.doesNotThrow(() => assertOpeningChipsFromDirectUpline(byAdmin, agentPlayerOf(A), 100))
		assert.throws(() => assertOpeningChipsFromDirectUpline(byAdmin, agentUnder(A), 100), isUplineRefusal)
		assert.throws(() => assertOpeningChipsFromDirectUpline(byAgent(A), agentPlayerOf(B), 0.01), isUplineRefusal)
	})
})

describe("openingChipsRestrictedUplineRefusal: an admin moves no chips of an agent its upline has restricted", () => {
	it('null when every agent above it is ACTIVE', () => {
		assert.equal(openingChipsRestrictedUplineRefusal('sub', null), null)
	})

	it('refused, naming the agent and the upline that restricts it, for a suspended, blocked or inactive upline', () => {
		for (const status of ['SUSPENDED', 'BLOCKED', 'INACTIVE']) {
			const err = openingChipsRestrictedUplineRefusal('sub', { id: A, username: 'root', status })
			assert.ok(err instanceof ChipError)
			assert.equal(err.code, 'NOT_ACTIVE')
			assert.equal(err.message, `Opening chips: Chips cannot be deposited while agent sub's upline root is ${status.toLowerCase()}`)
		}
		// An upline with no credentials row is named by its id.
		assert.match(String(openingChipsRestrictedUplineRefusal('sub', { id: A, username: null, status: 'BLOCKED' })?.message), new RegExp(`upline ${A} is blocked$`))
	})
})

/** A ChipRepo fake for the place read: one agent row and one player row per id. */
function fakeRepo(rows: { agents?: Record<string, any>; players?: Record<number, any> }, seen: unknown[][] = []) {
	return {
		readAgent: async (tx: unknown, id: string) => (seen.push(['agent', tx, id]), rows.agents?.[id] ?? null),
		readPlayer: async (tx: unknown, id: number, tenant: string) =>
			(seen.push(['player', tx, id, tenant]), rows.players?.[id]?.tenant === tenant ? rows.players[id] : null),
	}
}
const agentRow = (id: string, parentAgentId: string | null, over: Record<string, unknown> = {}) => ({
	id, tenantId: 't1', schemeType: 'CREDIT', status: 'ACTIVE', parentAgentId, chipBalance: 0, creditLimit: 0, username: 'n', ...over,
})
const playerRow = (id: number, playerType: string, agentId: string | null, over: Record<string, unknown> = {}) => ({
	id, tenant: 't1', username: 'p', name: 'p', email: null, status: 'active', playerType, agentId, creditLimit: 0, ...over,
})

describe('readOpeningChipsPlace: the new account, read on the creation transaction', () => {
	it('an agent: its parent agent; a player: its type and agent', async () => {
		const tx = { rollback() {} } as any
		const seen: unknown[][] = []
		const repo = fakeRepo({ agents: { [B]: agentRow(B, A) }, players: { 42: playerRow(42, 'AGENT_CREDIT', A) } }, seen)
		assert.deepEqual(await readOpeningChipsPlace(tx, 't1', 'AGENT', B, repo as any), { accountType: 'AGENT', parentAgentId: A })
		assert.deepEqual(await readOpeningChipsPlace(tx, 't1', 'PLAYER', '42', repo as any), {
			accountType: 'PLAYER',
			playerType: 'AGENT_CREDIT',
			agentId: A,
		})
		assert.deepEqual(seen, [['agent', tx, B], ['player', tx, 42, 't1']], 'both reads run on the creation transaction')
	})

	it('null when the account is missing, in another tenant or not on CREDIT chips (the deposit refuses those itself)', async () => {
		const tx = { rollback() {} } as any
		const seen: unknown[][] = []
		const repo = fakeRepo(
			{
				agents: { [A]: agentRow(A, null, { tenantId: 't2' }), [B]: agentRow(B, null, { schemeType: 'SHARING' }) },
				players: { 5: playerRow(5, 'REGULAR', null), 6: playerRow(6, 'WHITELABEL_CREDIT', null, { tenant: 't2' }) },
			},
			seen
		)
		assert.equal(await readOpeningChipsPlace(tx, 't1', 'AGENT', A, repo as any), null)
		assert.equal(await readOpeningChipsPlace(tx, 't1', 'AGENT', B, repo as any), null)
		assert.equal(await readOpeningChipsPlace(tx, 't1', 'PLAYER', 5, repo as any), null)
		assert.equal(await readOpeningChipsPlace(tx, 't1', 'PLAYER', 6, repo as any), null)
		assert.equal(await readOpeningChipsPlace(tx, 't1', 'PLAYER', 'not-a-number', repo as any), null)
		assert.equal(seen.length, 4, 'a malformed player id is not read at all')
	})
})

describe('depositOpeningChipsInTx refuses a creator that is not the direct upline, before the deposit runs', () => {
	function fakeService() {
		const calls: unknown[][] = []
		return { calls, service: { depositOpeningChips: async (input: unknown, tx: unknown) => (calls.push([input, tx]), { transferId: 'tr-1' }) } }
	}
	const tx = { rollback() {} } as any
	const repo = fakeRepo({
		agents: { [A]: agentRow(A, null), [B]: agentRow(B, A), ['c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3']: agentRow('c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', B) },
		players: { 41: playerRow(41, 'WHITELABEL_CREDIT', null), 42: playerRow(42, 'AGENT_CREDIT', A), 43: playerRow(43, 'AGENT_CREDIT', B) },
	})
	const p = (accountType: 'AGENT' | 'PLAYER', accountId: string | number, actor: ChipActor) => ({ tenant: ' t1 ', accountType, accountId, amount: 25, actor })

	it('allowed: the deposit runs on the creation transaction with the remark "Opening chips"', async () => {
		for (const input of [
			p('AGENT', A, byAdmin), // admin, root agent: from the pool
			p('PLAYER', 41, byAdmin), // admin, WHITELABEL_CREDIT player: from the pool
			p('AGENT', B, byAgent(A)), // agent, its own direct sub-agent
			p('PLAYER', 42, byAgent(A)), // agent, its own AGENT_CREDIT player
			p('PLAYER', 42, byAdmin), // admin, an AGENT_CREDIT player of A: from A's chips (owner decision 2026-11-04)
		]) {
			const f = fakeService()
			assert.deepEqual(await depositOpeningChipsInTx(input, tx, f.service as any, repo as any), { transferId: 'tr-1' })
			assert.deepEqual(f.calls, [[{ ...input, remark: 'Opening chips' }, tx]], `${input.accountType} ${input.accountId}`)
		}
	})

	it('refused with the direct-upline message, and no deposit runs', async () => {
		for (const input of [
			p('AGENT', B, byAdmin), // admin, a sub-agent under A
			p('PLAYER', 43, byAgent(A)), // agent A, a player of its sub-agent B
			p('AGENT', 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', byAgent(A)), // agent A, a sub-agent of its sub-agent B
			p('PLAYER', 41, byAgent(A)), // an agent, a WHITELABEL_CREDIT player
		]) {
			const f = fakeService()
			await assert.rejects(depositOpeningChipsInTx(input, tx, f.service as any, repo as any), isUplineRefusal)
			assert.equal(f.calls.length, 0, `${input.accountType} ${input.accountId}: nothing deposited`)
		}
	})

	it("an account the read cannot place is left to the deposit's own refusal", async () => {
		const refusing = {
			depositOpeningChips: async () => {
				throw new ChipError('NOT_FOUND', 'Player not found')
			},
		}
		await assert.rejects(depositOpeningChipsInTx(p('PLAYER', 99, byAdmin), tx, refusing as any, repo as any), (err: any) => {
			assert.ok(err instanceof ChipError)
			assert.equal(err.code, 'NOT_FOUND')
			assert.equal(err.message, 'Opening chips: Player not found')
			return true
		})
	})

	it('a failed read is not swallowed', async () => {
		const broken = {
			readAgent: async () => {
				throw new Error('connection lost')
			},
			readPlayer: async () => null,
		}
		const f = fakeService()
		await assert.rejects(depositOpeningChipsInTx(p('AGENT', B, byAgent(A)), tx, f.service as any, broken as any), /^Error: connection lost$/)
		assert.equal(f.calls.length, 0)
	})
})
