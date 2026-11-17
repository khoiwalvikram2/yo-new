/**
 * Credit players' exposure.
 *
 * Covers admin-backend's sports settlement recalculation (D/W chips: wallets.exposure only,
 * credit players included). The old credit-model bet helpers this file also covered (the
 * shared casino credit lock/release, the shared credit_used sync and BetCreditValidationService's
 * settlement release) were deleted with the bet-engine close-out: credit players now bet on the
 * cash-wallet path. Its adjustPlayerCredit block went when that mutation started refusing every
 * type (credit moves as chips); settlementAuthz.test.ts covers the refusal.
 *
 * No database: every statement goes to a drizzle pg-proxy that answers from a scripted
 * router and records it. The shared `db` handle points at a throwing stub, so nothing
 * reaches the real database.
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { db, pool } from '@/db/client'
import { recalculateUserExposure } from '@src/services/sports/sportsSettlementService.js'

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
before(() => {
	for (const m of METHODS) originals[m] = (db as any)[m]
	refuseRealDb()
})
after(async () => {
	for (const [m, f] of Object.entries(originals)) (db as any)[m] = f
	await pool.end().catch(() => {})
})

const USER = 4711
const TENANT = 'w7test'

// ================================================================= admin sports recalc
// D/W chips: credit players hold their chips in wallets.cash, so the sports settlement
// recalculation treats them like cash players and writes wallets.exposure only.
describe('admin recalculateUserExposure (sports settlement): wallets.exposure only, for credit players too', () => {
	const routes = (withBet: boolean): Route[] => [
		{ match: has('from "users"'), rows: [{ player_type: 'AGENT_CREDIT' }] },
		{ match: has('from "sports_bets"'), rows: withBet ? [{ id: 'b1', market_id: 'm1', selection_id: 's1', side: 'back', price: '2', stake: '300', odds_size: null }] : [] },
		{ match: has('from "sports_markets"'), rows: [{ id: 'm1', type: 'match_odds', event_id: 'e1' }] },
		{ match: has('from "sports_runners"'), rows: [{ id: 'r1', market_id: 'm1', selection_code: 's1', name: 'A' }, { id: 'r2', market_id: 'm1', selection_code: 's2', name: 'B' }] },
		{ match: has('from casino_bets'), rows: [{ total: '200' }] },
	]
	const creditModel = (log: Stmt[]) =>
		log.filter((s) => /player_type|credit_used|credit_available|settlement_balance|agent_player_credits|casino_bets|for update|\bagents\b/.test(s.flat))

	test('book exposure 300 goes to wallets.exposure; no users lock, credit_used, apc or agent statement', async () => {
		const { db: tx, log } = fakeDb(routes(true))
		const exposure = await recalculateUserExposure(USER, TENANT, tx)
		assert.equal(exposure, 300)
		const writes = log.filter((s) => /^(update|insert|delete)\b/.test(s.flat))
		assert.equal(writes.length, 1)
		assert.match(writes[0].flat, /^update "wallets" set "exposure" = \$1/)
		assert.equal(String(writes[0].params[0]), '300')
		assert.deepEqual(creditModel(log).map((s) => s.flat), [], 'nothing from the old credit model runs')
	})

	test('the last sports bet settling sets wallets.exposure to 0 and writes nothing else', async () => {
		const { db: tx, log } = fakeDb(routes(false))
		assert.equal(await recalculateUserExposure(USER, TENANT, tx), 0)
		const writes = log.filter((s) => /^(update|insert|delete)\b/.test(s.flat))
		assert.equal(writes.length, 1)
		assert.match(writes[0].flat, /^update "wallets"/)
		assert.deepEqual(creditModel(log).map((s) => s.flat), [])
	})
})
