/**
 * Plan W7: a credit player's open exposure stays on the player (users.credit_used and the
 * agent's agent_player_credits row). It is never cascaded into the agent's credit_used,
 * which already counts the player's whole limit.
 *
 * Covers the shared casino credit module, the shared exposure sync, admin-backend's sports
 * settlement recalculation, BetCreditValidationService's settlement release, and the
 * adjustPlayerCredit resolver (a DECREASE equal to |settlement| is a DECREASE; SETTLE is
 * explicit).
 *
 * No database: every statement goes to a drizzle pg-proxy that answers from a scripted
 * router and records it. The shared `db` handle is pointed at that proxy per test (and at
 * a throwing stub otherwise), so nothing reaches the real database.
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { db, pool } from '@/db/client'
import {
	lockCasinoCreditForBet,
	releaseCasinoCreditForBet,
	reLockCasinoCreditForBet,
	creditCasinoSettlement,
} from '@shared/services/credit/casinoCredit.js'
import { syncCreditPlayerOpenExposureInTx } from '@shared/services/credit/creditPlayerExposure.js'
import { recalculateUserExposure } from '@src/services/sports/sportsSettlementService.js'
import { BetCreditValidationService } from '../BetCreditValidationService.js'
import { AgentsRepo } from '@/repos/agents/AgentsRepo'
import { AgentPlayerCreditsRepo } from '@/repos/agents/AgentPlayerCreditsRepo'
import { settlementsMutationResolvers } from '@src/domains/settlements/resolvers/mutations.js'

type Stmt = { sql: string; flat: string; params: unknown[]; method: string }
type Route = { match: (flat: string) => boolean; rows: Record<string, unknown>[] }
const has = (...parts: string[]) => (s: string) => parts.every((p) => s.includes(p.toLowerCase()))

function resultColumns(sqlText: string): string[] {
	const sel = /^\s*select (.+?) from /is.exec(sqlText)
	const ret = /\sreturning (.+)$/is.exec(sqlText)
	const list = sel?.[1] ?? ret?.[1]
	if (!list) return []
	return list.split(/,\s*/).map((c) => {
		const ids = c.match(/"([^"]+)"/g)
		return ids ? ids[ids.length - 1].replace(/"/g, '') : c.trim()
	})
}

function fakeDb(routes: Route[]) {
	const log: Stmt[] = []
	const proxy = drizzle(async (sqlText: string, params: unknown[], method: string) => {
		const flat = sqlText.replace(/\s+/g, ' ').trim().toLowerCase()
		log.push({ sql: sqlText, flat, params, method })
		const route = routes.find((r) => r.match(flat))
		const rows = route ? route.rows : []
		if (method === 'all') {
			const cols = resultColumns(sqlText)
			return { rows: rows.map((r) => cols.map((c) => r[c] ?? null)) }
		}
		return { rows }
	})
	return { db: proxy as any, log }
}

const METHODS = ['select', 'insert', 'update', 'delete', 'execute', 'transaction'] as const
const originals: Record<string, unknown> = {}
function refuseRealDb() {
	const refuse = () => {
		throw new Error('real database access is not allowed in this test')
	}
	for (const m of METHODS) (db as any)[m] = refuse
}
/** Route the shared admin `db` handle (and its transactions) to a fake. */
function useFakeAsSharedDb(fake: any) {
	for (const m of ['select', 'insert', 'update', 'delete', 'execute'] as const) (db as any)[m] = fake[m].bind(fake)
	;(db as any).transaction = async (fn: (tx: any) => Promise<unknown>) => fn(fake)
}
before(() => {
	for (const m of METHODS) originals[m] = (db as any)[m]
	refuseRealDb()
})
after(async () => {
	for (const [m, f] of Object.entries(originals)) (db as any)[m] = f
	await pool.end().catch(() => {})
})

const AGENT = '00000000-0000-0000-0000-0000000000a7'
const USER = 4711
const TENANT = 'w7test'

const agentWrites = (log: Stmt[]) => log.filter((s) => /^update agents\b/.test(s.flat))
const agentReads = (log: Stmt[]) => log.filter((s) => /^select\b/.test(s.flat) && /\bfrom "?agents"?\b/.test(s.flat))

// ================================================================= casino (shared)
describe('casino credit: exposure stays on the player', () => {
	const playerRow = (used: number, settlementCasino = 0) => ({
		id: USER,
		player_type: 'AGENT_CREDIT',
		agent_id: AGENT,
		credit_limit: '1000',
		credit_used: String(used),
		credit_available: String(1000 - used + settlementCasino),
		settlement_balance: String(settlementCasino),
		settlement_balance_sports: '0',
		settlement_balance_casino: String(settlementCasino),
		settlement_balance_matka: '0',
	})

	test('lock: the agent row is neither read nor written; apc follows with the player invariant', async () => {
		const { db: tx, log } = fakeDb([{ match: has('from users', 'for update'), rows: [playerRow(0)] }])
		const res = await lockCasinoCreditForBet(tx, { userId: USER, tenant: TENANT, betAmount: 300 })
		assert.equal(res.ok, true)
		assert.equal(agentReads(log).length, 0)
		assert.equal(agentWrites(log).length, 0, "the agent's credit_used is the credit it handed down")
		const apc = log.find((s) => s.flat.startsWith('update agent_player_credits'))!
		assert.match(apc.flat, /credit_available = greatest\(0, coalesce\(credit_limit, 0\) - \$\d+ \+ coalesce\(current_balance, 0\) \+ \$\d+\)/)
		assert.equal(apc.params[0], 0, 'no settlement change on lock')
		assert.equal(apc.params[1], 300, 'open_exposure = the player credit_used after the lock')
	})

	test('release (loss): the agent gets the settlement delta only, as one increment', async () => {
		const { db: tx, log } = fakeDb([{ match: has('from users', 'for update'), rows: [playerRow(300)] }])
		await releaseCasinoCreditForBet(tx, { userId: USER, tenant: TENANT, betAmount: 300, betResult: 'loss', payoutAmount: 300 })
		const writes = agentWrites(log)
		assert.equal(writes.length, 1)
		assert.doesNotMatch(writes[0].flat, /credit_used =/, 'agent credit_used is not released either')
		assert.match(writes[0].flat, /settlement_balance_casino = coalesce\(settlement_balance_casino, 0\) \+ \$1/)
		assert.equal(writes[0].params[0], -300)
		assert.equal(agentReads(log).length, 0, 'no read-then-write of the agent row')
		const apc = log.find((s) => s.flat.startsWith('update agent_player_credits'))!
		assert.equal(apc.params[0], -300, 'current_balance -= loss')
		assert.equal(apc.params[1], 0, 'open_exposure follows the released player credit_used')
	})

	test('void release writes nothing to the agent; relock and payUp keep credit_used off the agent', async () => {
		let f = fakeDb([{ match: has('from users', 'for update'), rows: [playerRow(300)] }])
		await releaseCasinoCreditForBet(f.db, { userId: USER, tenant: TENANT, betAmount: 300, betResult: 'void', payoutAmount: 0 })
		assert.equal(agentWrites(f.log).length, 0)

		f = fakeDb([{ match: has('from users', 'for update'), rows: [playerRow(0, -300)] }])
		await reLockCasinoCreditForBet(f.db, { userId: USER, tenant: TENANT, betAmount: 300, balanceChange: -300, betId: '00000000-0000-0000-0000-00000000be70' })
		assert.equal(agentWrites(f.log).length, 1)
		assert.doesNotMatch(agentWrites(f.log)[0].flat, /credit_used =/)
		assert.equal(agentWrites(f.log)[0].params[0], 300)

		f = fakeDb([{ match: has('from users', 'for update'), rows: [playerRow(0)] }])
		await creditCasinoSettlement(f.db, { userId: USER, tenant: TENANT, amount: 50 })
		assert.doesNotMatch(agentWrites(f.log)[0].flat, /credit_used =/)
	})
})

// ================================================================= shared sync
describe('sports exposure sync: credit_used = sports exposure + open casino stake', () => {
	test('the shared sync writes the player and apc, never the agent', async () => {
		const { db: tx, log } = fakeDb([
			{ match: has('from users', 'for update'), rows: [{ player_type: 'AGENT_CREDIT', agent_id: AGENT, credit_limit: '1000', settlement_balance: '50' }] },
			{ match: has('from casino_bets'), rows: [{ total: '200' }] },
		])
		const res = await syncCreditPlayerOpenExposureInTx(tx, { userId: USER, tenant: TENANT, sportsExposure: 300 })
		assert.deepEqual(res, { creditUsed: 500, creditAvailable: 550, openCasinoStake: 200 })
		const u = log.find((s) => s.flat.startsWith('update users'))!
		assert.deepEqual(u.params.slice(0, 2), [500, 550])
		assert.equal(agentWrites(log).length + agentReads(log).length, 0)
		const apc = log.find((s) => s.flat.startsWith('update agent_player_credits'))!
		assert.match(apc.flat, /credit_available = greatest\(0, coalesce\(credit_limit, 0\) - \$\d+ \+ coalesce\(current_balance, 0\)\)/)
	})
})

// ================================================================= admin sports recalc
describe('admin recalculateUserExposure (sports settlement): casino locks survive, agent untouched', () => {
	const routes = (withBet: boolean, openCasino: number): Route[] => [
		{ match: has('select "player_type" from "users"'), rows: [{ player_type: 'AGENT_CREDIT' }] },
		{ match: has('from users', 'for update', 'agent_id::text'), rows: [{ player_type: 'AGENT_CREDIT', agent_id: AGENT, credit_limit: '1000', settlement_balance: '0' }] },
		{ match: has('from "sports_bets"'), rows: withBet ? [{ id: 'b1', market_id: 'm1', selection_id: 's1', side: 'back', price: '2', stake: '300', odds_size: null }] : [] },
		{ match: has('from "sports_markets"'), rows: [{ id: 'm1', type: 'match_odds', event_id: 'e1' }] },
		{ match: has('from "sports_runners"'), rows: [{ id: 'r1', market_id: 'm1', selection_code: 's1', name: 'A' }, { id: 'r2', market_id: 'm1', selection_code: 's2', name: 'B' }] },
		{ match: has('from casino_bets'), rows: [{ total: String(openCasino) }] },
	]

	test('credit_used = book exposure 300 + open casino 200; the row is locked before the book is read', async () => {
		const { db: tx, log } = fakeDb(routes(true, 200))
		const exposure = await recalculateUserExposure(USER, TENANT, tx)
		assert.equal(exposure, 300)
		const u = log.find((s) => s.flat.startsWith('update users'))!
		assert.deepEqual(u.params.slice(0, 2), [500, 500], 'before W7 this wrote 300 and freed the casino lock')
		assert.equal(agentWrites(log).length + agentReads(log).length, 0, 'before W7 the exposure delta was added to the agent')
		const lockIdx = log.findIndex((s) => s.flat.startsWith('select id from users') && s.flat.includes('for update'))
		const betsIdx = log.findIndex((s) => s.flat.includes('from "sports_bets"'))
		assert.ok(lockIdx >= 0 && lockIdx < betsIdx)
	})

	test('the last sports bet settling still syncs credit_used (it used to keep the old exposure)', async () => {
		const { db: tx, log } = fakeDb(routes(false, 200))
		await recalculateUserExposure(USER, TENANT, tx)
		const u = log.find((s) => s.flat.startsWith('update users'))
		assert.ok(u, 'credit row written on the no-open-bets path')
		assert.deepEqual(u!.params.slice(0, 2), [200, 800])
	})
})

// ================================================================= BetCreditValidationService
describe('BetCreditValidationService.releaseCreditForBet: settlement increments, no agent credit_used', () => {
	const player = {
		id: USER, player_type: 'AGENT_CREDIT', agent_id: AGENT,
		credit_limit: '1000', credit_used: '400', credit_available: '600',
		settlement_balance: '0', settlement_balance_sports: '0', settlement_balance_casino: '0', settlement_balance_matka: '0',
	}
	const routes = (): Route[] => [
		{ match: has('from users', 'for update'), rows: [player] },
		{ match: has('update agents'), rows: [{ credit_limit: '5000', credit_used: '1000', credit_available: '4150', settlement_balance: '150' }] },
		{ match: has('from "agent_player_credits"'), rows: [{ id: 'apc1', agent_id: AGENT, player_id: USER, credit_limit: '1000', current_balance: '0', open_exposure: '400', credit_used: '400', credit_available: '600' }] },
		{ match: has('update agent_player_credits'), rows: [{ id: 'apc1' }] },
	]

	test('sports win: agent settlement_balance_sports += payout as one increment; credit_used untouched', async () => {
		const { db: tx, log } = fakeDb(routes())
		const svc = new BetCreditValidationService(new AgentsRepo(), new AgentPlayerCreditsRepo())
		await svc.releaseCreditForBet(USER, 100, 'win', 150, TENANT, undefined, 'sports', tx)
		const writes = agentWrites(log)
		assert.equal(writes.length, 1)
		assert.match(writes[0].flat, /settlement_balance_sports = coalesce\(settlement_balance_sports, 0\) \+ \$1/)
		assert.doesNotMatch(writes[0].flat, /credit_used =/)
		assert.equal(writes[0].params[0], 150)
		assert.equal(agentReads(log).length, 0, 'the agent row is not read with a plain SELECT first')
		const apc = log.find((s) => s.flat.startsWith('update agent_player_credits'))!
		assert.match(apc.flat, /current_balance = coalesce\(current_balance, 0\) \+ \$1/, 'apc is an increment too')
	})

	test('casino loss: the player releases its exposure, the agent only takes the settlement', async () => {
		const { db: tx, log } = fakeDb(routes())
		const svc = new BetCreditValidationService(new AgentsRepo(), new AgentPlayerCreditsRepo())
		await svc.releaseCreditForBet(USER, 100, 'loss', 100, TENANT, undefined, 'casino', tx)
		const userWrite = log.find((s) => /^update "users"/.test(s.flat))!
		assert.ok(userWrite.params.includes('300'), 'player credit_used 400 - 100')
		const writes = agentWrites(log)
		assert.doesNotMatch(writes[0].flat, /credit_used =/)
		assert.equal(writes[0].params[1], -100, 'settlement_balance_casino -= 100')
	})
})

// ================================================================= adjustPlayerCredit resolver
describe('adjustPlayerCredit: DECREASE is never a settlement; SETTLE is explicit and locked', () => {
	const admin = { user: { id: 'adm-1', type: 'admin' }, permissions: [{ domain: 'all', actions: ['*'] }], tenant: 'wl1' }
	const wlPlayer = (sports: number, casino: number, used = 800) => ({
		id: 9, tenant: 'wl1', name: 'P', username: 'p', player_type: 'WHITELABEL_CREDIT', agent_id: null,
		credit_limit: '1000', credit_used: String(used), credit_available: String(1000 - used + sports + casino),
		settlement_balance: String(sports + casino), settlement_balance_sports: String(sports),
		settlement_balance_casino: String(casino), settlement_balance_matka: '0',
	})
	const routes = (p: Record<string, unknown>): Route[] => [
		{ match: has('from "users"'), rows: [p] },
		{ match: has('from users', 'for update'), rows: [p] },
		{ match: has('update users set credit_used'), rows: [{ credit_limit: '1000', credit_used: '300', settlement_balance: p.settlement_balance as string }] },
		{ match: has('update whitelabels'), rows: [{ credit_limit: '100000', credit_used: '1000', credit_available: '99500', settlement_balance: '500' }] },
		{ match: has('from whitelabels', 'for update'), rows: [{ credit_limit: '100000', credit_used: '1000', settlement_balance: '0' }] },
		{ match: has('insert into "player_credit_adjustments"'), rows: [{ id: 'adj1', tenant: 'wl1', player_id: 9, adjustment_type: 'X', amount: '500', created_at: '2026-10-21T00:00:00.000Z' }] },
		{ match: has('insert into "agent_credit_ledger"'), rows: [{ id: 'led1', amount: '500', balance_before: '0', balance_after: '0', created_at: '2026-10-21T00:00:00.000Z' }] },
	]
	const call = (input: Record<string, unknown>) =>
		(settlementsMutationResolvers as any).adjustPlayerCredit(null, { input }, admin)

	test('a DECREASE equal to |settlement balance| lowers credit_used and leaves the settlement alone', async () => {
		const f = fakeDb(routes(wlPlayer(-200, -300)))
		useFakeAsSharedDb(f.db)
		try {
			const res = await call({ playerId: '9', adjustmentType: 'DECREASE', amount: 500 })
			assert.equal(res.success, true, res.message)
			const dec = f.log.find((s) => s.flat.startsWith('update users set credit_used'))!
			assert.ok(dec.params.includes(-500))
			assert.equal(f.log.filter((s) => /settlement_balance(_\w+)? = 0/.test(s.flat)).length, 0, 'no settlement reset')
			assert.equal(f.log.filter((s) => /^update whitelabels/.test(s.flat)).length, 0, 'no settlement cascade')
		} finally {
			refuseRealDb()
		}
	})

	test('SETTLE zeroes the player and takes the same domain amounts off the whitelabel, in one locked transaction', async () => {
		const f = fakeDb(routes(wlPlayer(-200, -300)))
		useFakeAsSharedDb(f.db)
		try {
			const res = await call({ playerId: '9', adjustmentType: 'SETTLE', amount: 500, notes: 'week 42' })
			assert.equal(res.success, true, res.message)
			const lockIdx = f.log.findIndex((s) => /from users/.test(s.flat) && /for update/.test(s.flat))
			const zero = f.log.findIndex((s) => /^update users set settlement_balance = 0/.test(s.flat))
			assert.ok(lockIdx >= 0 && lockIdx < zero)
			const wl = f.log.find((s) => /^update whitelabels/.test(s.flat))!
			assert.deepEqual(wl.params.slice(0, 3), [200, 300, 0], 'reverse of the player domain balances')
			assert.doesNotMatch(wl.flat, /credit_used =/)
			const ledgers = f.log.filter((s) => s.flat.startsWith('insert into "agent_credit_ledger"'))
			assert.ok(ledgers.some((s) => s.params.includes('ADJUSTMENT') && s.params.some((p) => typeof p === 'string' && /settlement/i.test(p))))
		} finally {
			refuseRealDb()
		}
	})

	test('SETTLE for an amount that no longer matches the locked balance is refused, nothing written', async () => {
		const f = fakeDb(routes(wlPlayer(-200, -300)))
		useFakeAsSharedDb(f.db)
		try {
			const res = await call({ playerId: '9', adjustmentType: 'SETTLE', amount: 400 })
			assert.equal(res.success, false)
			assert.match(res.message, /Reload/)
			assert.equal(f.log.filter((s) => /^(update|insert)/.test(s.flat)).length, 0)
		} finally {
			refuseRealDb()
		}
	})

	test('unknown adjustment types are refused', async () => {
		const f = fakeDb(routes(wlPlayer(0, 0)))
		useFakeAsSharedDb(f.db)
		try {
			const res = await call({ playerId: '9', adjustmentType: 'RESET', amount: 1 })
			assert.equal(res.success, false)
			assert.match(res.message, /Unknown adjustment type/)
		} finally {
			refuseRealDb()
		}
	})
})
