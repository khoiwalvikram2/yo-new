/**
 * Credit players (AGENT_CREDIT, WHITELABEL_CREDIT) bet on Deposit/Withdraw chips held in their cash
 * wallet, so the admin Matka status path treats them like every other player: updateMatkaBetStatus
 * records the status only, releases no credit and pushes nothing to the agent or the whitelabel. Their
 * settled bets also earn their referrer no loss-share (referralEligibleMatkaBets).
 *
 * No database: the shared `db` handle is pointed at a drizzle pg-proxy that answers from scripted
 * rows, throws for any other statement and records every statement it sees.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { db, pool } from '@src/db/client.js'
import { referralIntegrationService } from '@src/services/referrals/referralIntegrationService.js'
import { referralEligibleMatkaBets, updateMatkaBetStatus } from '@src/repos/matka/matkaBetsRepo.js'

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

let statements: string[] = []
function fakeDb(routes: Route[]) {
	return drizzle(async (sqlText: string, _params: unknown[], method: string) => {
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
let referrals: Array<{ tenant: string; userId: number; netRevenue: number; domain: string }> = []

function useFake(fake: any) {
	for (const m of ['select', 'insert', 'update', 'delete', 'execute'] as const) (db as any)[m] = fake[m].bind(fake)
	;(db as any).transaction = async (fn: (tx: any) => Promise<unknown>) => fn(fake)
}

before(() => {
	for (const m of METHODS) originals[m] = (db as any)[m]
	;(referralIntegrationService as any).handleBetSettlement = async (tenant: string, userId: number, netRevenue: number, _currency: string, domain: string) => {
		referrals.push({ tenant, userId, netRevenue, domain })
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

const USER = 4713
const TENANT = 'matka-status-test'
const BET = '00000000-0000-0000-0000-0000000000c3'
// Any statement that would move a credit figure or reach the upline's balances.
const CREDIT_OR_UPLINE = /"?(agents|whitelabels|agent_player_credits|wallets)"?\b|credit_used|credit_available|settlement_balance/

function routes(stored: { status: string; actualWin: string | null }, playerType: string, transitioned = true): Route[] {
	const bet = { id: BET, tenant: TENANT, user_id: USER, bet_amount: '100.00', currency: 'INR', status: 'pending', actual_win: null }
	return [
		{ match: has('update "matka_bets"'), rows: transitioned ? [{ ...bet, status: stored.status, actual_win: stored.actualWin }] : [] },
		{ match: has('from "matka_bets"'), rows: [transitioned ? bet : { ...bet, status: stored.status, actual_win: stored.actualWin }] },
		{ match: has('from "users"'), rows: [{ id: USER, player_type: playerType }] },
	]
}

describe('updateMatkaBetStatus follows the cash path for credit players', () => {
	for (const playerType of ['AGENT_CREDIT', 'WHITELABEL_CREDIT']) {
		test(`${playerType}: a win records the status only, with no credit release and no referral loss-share`, async () => {
			useFake(fakeDb(routes({ status: 'won', actualWin: '250.00' }, playerType)))
			const bet = await updateMatkaBetStatus(BET, 'won', 250)
			assert.equal(bet?.status, 'won')
			assert.equal(bet?.actualWin, '250.00')
			assert.ok(!statements.some((s) => CREDIT_OR_UPLINE.test(s)), `no credit or upline statement: ${statements.join(' | ')}`)
			assert.ok(!statements.some((s) => s.startsWith('update "users"')))
			assert.equal(referrals.length, 0)
		})

		test(`${playerType}: a loss and a void move nothing either`, async () => {
			useFake(fakeDb(routes({ status: 'lost', actualWin: '0.00' }, playerType)))
			assert.equal((await updateMatkaBetStatus(BET, 'lost', 0))?.status, 'lost')
			useFake(fakeDb(routes({ status: 'void', actualWin: null }, playerType)))
			assert.equal((await updateMatkaBetStatus(BET, 'void'))?.status, 'void')
			assert.ok(!statements.some((s) => CREDIT_OR_UPLINE.test(s)), `no credit or upline statement: ${statements.join(' | ')}`)
			assert.equal(referrals.length, 0)
		})
	}

	test('a cash player still reports the net result to the referral hook', async () => {
		useFake(fakeDb(routes({ status: 'lost', actualWin: '40.00' }, 'REGULAR')))
		await updateMatkaBetStatus(BET, 'lost', 40)
		assert.deepEqual(referrals, [{ tenant: TENANT, userId: USER, netRevenue: -60, domain: 'matka' }])
		assert.ok(!statements.some((s) => CREDIT_OR_UPLINE.test(s)))
	})

	test('an already-settled bet is not settled again and runs no hook', async () => {
		useFake(fakeDb(routes({ status: 'won', actualWin: '250.00' }, 'REGULAR', false)))
		const bet = await updateMatkaBetStatus(BET, 'won', 250)
		assert.equal(bet?.status, 'won')
		assert.equal(referrals.length, 0)
	})
})

describe('referralEligibleMatkaBets', () => {
	test('drops the bets of credit players and keeps everyone else, in one read', async () => {
		const players = [
			{ id: 1, player_type: 'REGULAR' },
			{ id: 2, player_type: 'AGENT_CREDIT' },
			{ id: 3, player_type: 'WHITELABEL_CREDIT' },
			{ id: 4, player_type: 'SHARING_AGENT_PLAYER' },
		]
		const fake = fakeDb([{ match: has('from "users"'), rows: players }])
		const bets = [1, 2, 3, 4, 2, 1].map((userId, i) => ({ id: `bet-${i}`, userId }))
		const kept = await referralEligibleMatkaBets(TENANT, bets, fake)
		assert.deepEqual(kept.map((bet) => bet.id), ['bet-0', 'bet-3', 'bet-5'])
		assert.equal(statements.length, 1)
		assert.ok(statements[0].includes('"tenant" = $1'), statements[0])
	})

	test('reads nothing for no bets', async () => {
		assert.deepEqual(await referralEligibleMatkaBets(TENANT, [], fakeDb([])), [])
		assert.equal(statements.length, 0)
	})
})
