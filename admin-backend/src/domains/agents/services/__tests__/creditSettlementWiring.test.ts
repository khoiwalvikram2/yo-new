/**
 * The bet-status tools move no credit (CREDIT scheme on Deposit/Withdraw chips, 2026-11-02).
 *
 * updateCasinoBetStatus (the settleTestCasinoBet diagnostic) and updateMatkaBetStatus used to
 * release a credit player's credit through BetCreditValidationService.releaseCreditForBet and
 * book the bet's net P&L into the player's and the agent's / whitelabel's settlement balances.
 * Credit players (AGENT_CREDIT, WHITELABEL_CREDIT) now hold their chips in wallets.cash and play
 * on the cash-wallet path, where these tools only record the status, as they always did for cash
 * players: the provider callbacks and the matka settlement move the money. Credit players also
 * pay no referral loss-share, while a cash player's settled bet still reaches the referral hook.
 *
 * No database: the shared `db` handle is pointed at a drizzle pg-proxy that answers from
 * scripted rows (and throws for anything else) and records every statement it is sent, and
 * the referral hook is stubbed to record its calls.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { db, pool } from '@src/db/client.js'
import { referralIntegrationService } from '@src/services/referrals/referralIntegrationService.js'
import { updateMatkaBetStatus } from '@src/repos/matka/matkaBetsRepo.js'
import { updateCasinoBetStatus } from '@src/repos/casino/casinoBetsRepo.js'

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

/** Every statement the code sent, answered or not, flattened and lower-cased. */
let statements: string[] = []

function fakeDb(routes: Route[]) {
	return drizzle(async (sqlText: string, params: unknown[], method: string) => {
		const flat = sqlText.replace(/\s+/g, ' ').trim().toLowerCase()
		statements.push(flat)
		const route = routes.find((r) => r.match(flat))
		if (!route) throw new Error(`unexpected statement in test: ${flat}`)
		if (method === 'all') {
			const cols = resultColumns(sqlText)
			return { rows: route.rows.map((r) => cols.map((c) => r[c] ?? null)) }
		}
		return { rows: route.rows }
	}) as any
}

const METHODS = ['select', 'insert', 'update', 'delete', 'execute', 'transaction'] as const
const originals: Record<string, unknown> = {}
const originalReferral = referralIntegrationService.handleBetSettlement
let referrals: unknown[][] = []

function useFake(fake: any) {
	for (const m of ['select', 'insert', 'update', 'delete', 'execute'] as const) (db as any)[m] = fake[m].bind(fake)
	;(db as any).transaction = async (fn: (tx: any) => Promise<unknown>) => fn(fake)
}

before(() => {
	for (const m of METHODS) originals[m] = (db as any)[m]
	;(referralIntegrationService as any).handleBetSettlement = async (...args: unknown[]) => {
		referrals.push(args)
	}
})
beforeEach(() => {
	statements = []
	referrals = []
	const refuse = () => {
		throw new Error('real database access is not allowed in this test')
	}
	for (const m of METHODS) (db as any)[m] = refuse
})
after(async () => {
	for (const [m, f] of Object.entries(originals)) (db as any)[m] = f
	;(referralIntegrationService as any).handleBetSettlement = originalReferral
	await pool.end().catch(() => {})
})

const USER = 4712
const TENANT = 'wiringtest'
const BET = '00000000-0000-0000-0000-0000000000b1'
const AGENT = '00000000-0000-0000-0000-0000000000a7'
const CREDIT_TYPES = ['AGENT_CREDIT', 'WHITELABEL_CREDIT']

/**
 * The tool's only write is its own bet row: no credit, agent, whitelabel or wallet figure moves,
 * and no row is locked for a credit release.
 */
function assertStatusOnly(table: 'casino_bets' | 'matka_bets') {
	const writes = statements.filter((s) => !s.startsWith('select'))
	assert.equal(writes.length, 1, `exactly one write expected, got: ${writes.join(' | ')}`)
	assert.ok(writes[0].startsWith(`update "${table}"`), writes[0])
	assert.ok(!statements.some((s) => s.includes(' for update')), 'no row is locked for a credit release')
}

// ================================================================= casino
describe('updateCasinoBetStatus: records the status only, credit players included', () => {
	const casinoRoutes = (stored: { status: string; payout: string | null }, playerType: string): Route[] => {
		const bet = { id: BET, tenant: TENANT, user_id: USER, stake: '100.00', currency: 'INR', status: 'active', payout: null, win_amount: null }
		return [
			{ match: has('update "casino_bets"'), rows: [{ ...bet, status: stored.status, payout: stored.payout, win_amount: stored.payout }] },
			{ match: has('from "casino_bets"'), rows: [bet] },
			{ match: has('from "users"'), rows: [{ id: USER, player_type: playerType, agent_id: AGENT }] },
		]
	}

	for (const playerType of CREDIT_TYPES) {
		for (const [status, payout, net] of [['won', '250.00', 150], ['lost', '40.00', -60], ['lost', '0.00', -100]] as const) {
			test(`${playerType} ${status} with payout ${payout}: no credit release and no referral loss-share`, async () => {
				useFake(fakeDb(casinoRoutes({ status, payout }, playerType)))
				const bet = await updateCasinoBetStatus(BET, status, Number(payout), net, new Date())
				assert.equal(bet?.status, status)
				assertStatusOnly('casino_bets')
				assert.equal(referrals.length, 0)
			})
		}

		test(`${playerType} void: no credit release`, async () => {
			useFake(fakeDb(casinoRoutes({ status: 'void', payout: null }, playerType)))
			const bet = await updateCasinoBetStatus(BET, 'void')
			assert.equal(bet?.status, 'void')
			assertStatusOnly('casino_bets')
			assert.equal(referrals.length, 0)
		})
	}

	test('a cash player is unchanged: status only, and a loss still reaches the referral hook', async () => {
		useFake(fakeDb(casinoRoutes({ status: 'lost', payout: '40.00' }, 'REGULAR')))
		await updateCasinoBetStatus(BET, 'lost', 40, -60, new Date())
		assertStatusOnly('casino_bets')
		assert.deepEqual(referrals, [[TENANT, USER, -60, 'INR', 'casino']])
	})
})

// ================================================================= matka
describe('updateMatkaBetStatus: records the status only, credit players included', () => {
	const matkaRoutes = (stored: { status: string; actualWin: string | null }, playerType: string): Route[] => {
		const bet = { id: BET, tenant: TENANT, user_id: USER, bet_amount: '100.00', currency: 'INR', status: 'pending', actual_win: null }
		return [
			{ match: has('update "matka_bets"'), rows: [{ ...bet, status: stored.status, actual_win: stored.actualWin }] },
			{ match: has('from "matka_bets"'), rows: [bet] },
			{ match: has('from "users"'), rows: [{ id: USER, player_type: playerType, agent_id: AGENT }] },
		]
	}

	for (const playerType of CREDIT_TYPES) {
		for (const [status, actualWin] of [['won', '250.00'], ['lost', '40.00'], ['lost', '0.00']] as const) {
			test(`${playerType} ${status} with actual_win ${actualWin}: no credit release and no referral loss-share`, async () => {
				useFake(fakeDb(matkaRoutes({ status, actualWin }, playerType)))
				const bet = await updateMatkaBetStatus(BET, status, Number(actualWin))
				assert.equal(bet?.status, status)
				assertStatusOnly('matka_bets')
				assert.equal(referrals.length, 0)
			})
		}

		test(`${playerType} void: no credit release`, async () => {
			useFake(fakeDb(matkaRoutes({ status: 'void', actualWin: null }, playerType)))
			const bet = await updateMatkaBetStatus(BET, 'void')
			assert.equal(bet?.status, 'void')
			assertStatusOnly('matka_bets')
			assert.equal(referrals.length, 0)
		})
	}

	test('a cash player is unchanged: status only, and a loss still reaches the referral hook', async () => {
		useFake(fakeDb(matkaRoutes({ status: 'lost', actualWin: '40.00' }, 'REGULAR')))
		await updateMatkaBetStatus(BET, 'lost', 40)
		assertStatusOnly('matka_bets')
		assert.deepEqual(referrals, [[TENANT, USER, -60, 'INR', 'matka']])
	})
})
