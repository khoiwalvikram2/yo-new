/**
 * Credit release on matka / casino settlement passes the NET P&L, not the gross return.
 *
 * matka_bets.actual_win and casino_bets.payout are GROSS (stake included). For a credit
 * player releaseCreditForBet adds payoutAmount to the settlement balance on 'win', so the
 * repos passed the gross and overstated every credit win by the stake. Both repos now map
 * (stake, gross) through mapGrossSettlementToCredit.
 *
 * No database: the shared `db` handle is pointed at a drizzle pg-proxy that answers from
 * scripted rows (and throws for anything else), releaseCreditForBet is stubbed to record
 * its arguments, and the referral hook after the transaction is stubbed out.
 */
import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { db, pool } from '@src/db/client.js'
import { BetCreditValidationService } from '@src/domains/agents/services/BetCreditValidationService.js'
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

function fakeDb(routes: Route[]) {
	return drizzle(async (sqlText: string, params: unknown[], method: string) => {
		const flat = sqlText.replace(/\s+/g, ' ').trim().toLowerCase()
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
const originalRelease = BetCreditValidationService.prototype.releaseCreditForBet
const originalReferral = referralIntegrationService.handleBetSettlement

type ReleaseCall = { playerId: number; betAmount: number; betResult: string; payoutAmount: number; tenant: string; betId: unknown; domain: string; tx: unknown }
let releases: ReleaseCall[] = []

function useFake(fake: any) {
	for (const m of ['select', 'insert', 'update', 'delete', 'execute'] as const) (db as any)[m] = fake[m].bind(fake)
	;(db as any).transaction = async (fn: (tx: any) => Promise<unknown>) => fn(fake)
}

before(() => {
	for (const m of METHODS) originals[m] = (db as any)[m]
	BetCreditValidationService.prototype.releaseCreditForBet = async function (playerId, betAmount, betResult, payoutAmount, tenant, betId, domain, tx) {
		releases.push({ playerId, betAmount, betResult, payoutAmount, tenant: tenant as string, betId, domain: domain as string, tx })
	}
	;(referralIntegrationService as any).handleBetSettlement = async () => {}
})
beforeEach(() => {
	releases = []
	const refuse = () => {
		throw new Error('real database access is not allowed in this test')
	}
	for (const m of METHODS) (db as any)[m] = refuse
})
after(async () => {
	for (const [m, f] of Object.entries(originals)) (db as any)[m] = f
	BetCreditValidationService.prototype.releaseCreditForBet = originalRelease
	;(referralIntegrationService as any).handleBetSettlement = originalReferral
	await pool.end().catch(() => {})
})

const USER = 4712
const TENANT = 'wiringtest'
const BET = '00000000-0000-0000-0000-0000000000b1'
const creditPlayer = { player_type: 'AGENT_CREDIT', agent_id: '00000000-0000-0000-0000-0000000000a7' }

// ================================================================= matka
describe('updateMatkaBetStatus: credit release gets the net P&L of actual_win (gross)', () => {
	const matkaRoutes = (stored: { status: string; actualWin: string | null }, playerType = creditPlayer.player_type): Route[] => {
		const bet = { id: BET, tenant: TENANT, user_id: USER, bet_amount: '100.00', currency: 'INR', status: 'pending', actual_win: null }
		return [
			{ match: has('update "matka_bets"'), rows: [{ ...bet, status: stored.status, actual_win: stored.actualWin }] },
			{ match: has('from "matka_bets"'), rows: [bet] },
			{ match: has('from "users"'), rows: [{ ...creditPlayer, player_type: playerType }] },
		]
	}

	test('won with actual_win 250 on a 100 stake releases a 150 win', async () => {
		const fake = fakeDb(matkaRoutes({ status: 'won', actualWin: '250.00' }))
		useFake(fake)
		await updateMatkaBetStatus(BET, 'won', 250)
		assert.equal(releases.length, 1)
		const r = releases[0]
		assert.deepEqual(
			{ playerId: r.playerId, betAmount: r.betAmount, betResult: r.betResult, payoutAmount: r.payoutAmount, tenant: r.tenant, betId: r.betId, domain: r.domain },
			{ playerId: USER, betAmount: 100, betResult: 'win', payoutAmount: 150, tenant: TENANT, betId: BET, domain: 'matka' }
		)
		assert.equal(r.tx, fake, 'released inside the settlement transaction')
	})

	test('won with no amount passed reads the stored gross', async () => {
		useFake(fakeDb(matkaRoutes({ status: 'won', actualWin: '180.00' })))
		await updateMatkaBetStatus(BET, 'won')
		assert.equal(releases[0].betResult, 'win')
		assert.equal(releases[0].payoutAmount, 80)
	})

	test('lost with no return is a full-stake loss (unchanged)', async () => {
		useFake(fakeDb(matkaRoutes({ status: 'lost', actualWin: '0.00' })))
		await updateMatkaBetStatus(BET, 'lost', 0)
		assert.equal(releases[0].betResult, 'loss')
		assert.equal(releases[0].payoutAmount, 100)
	})

	test('lost carrying a partial return loses only stake - gross, as the matka P&L does', async () => {
		useFake(fakeDb(matkaRoutes({ status: 'lost', actualWin: '40.00' })))
		await updateMatkaBetStatus(BET, 'lost', 40)
		assert.equal(releases[0].betResult, 'loss')
		assert.equal(releases[0].payoutAmount, 60)
	})

	test('void releases the exposure with no settlement move (unchanged)', async () => {
		useFake(fakeDb(matkaRoutes({ status: 'void', actualWin: null })))
		await updateMatkaBetStatus(BET, 'void')
		assert.equal(releases[0].betResult, 'void')
		assert.equal(releases[0].payoutAmount, 0)
		assert.equal(releases[0].betAmount, 100)
	})

	test('a cash player gets no credit release', async () => {
		useFake(fakeDb(matkaRoutes({ status: 'won', actualWin: '250.00' }, 'CASH')))
		await updateMatkaBetStatus(BET, 'won', 250)
		assert.equal(releases.length, 0)
	})
})

// ================================================================= casino
describe('updateCasinoBetStatus: credit release gets the net P&L of payout (gross)', () => {
	const casinoRoutes = (stored: { status: string; payout: string | null }, playerType = creditPlayer.player_type): Route[] => {
		const bet = { id: BET, tenant: TENANT, user_id: USER, stake: '100.00', currency: 'INR', status: 'pending', payout: null, win_amount: null }
		return [
			{ match: has('update "casino_bets"'), rows: [{ ...bet, status: stored.status, payout: stored.payout, win_amount: stored.payout }] },
			{ match: has('from "casino_bets"'), rows: [bet] },
			{ match: has('from "users"'), rows: [{ ...creditPlayer, player_type: playerType }] },
		]
	}

	test('won with payout 250 on a 100 stake releases a 150 win', async () => {
		const fake = fakeDb(casinoRoutes({ status: 'won', payout: '250.00' }))
		useFake(fake)
		await updateCasinoBetStatus(BET, 'won', 250, 150, new Date())
		assert.equal(releases.length, 1)
		const r = releases[0]
		assert.deepEqual(
			{ playerId: r.playerId, betAmount: r.betAmount, betResult: r.betResult, payoutAmount: r.payoutAmount, tenant: r.tenant, betId: r.betId, domain: r.domain },
			{ playerId: USER, betAmount: 100, betResult: 'win', payoutAmount: 150, tenant: TENANT, betId: BET, domain: 'casino' }
		)
		assert.equal(r.tx, fake, 'released inside the settlement transaction')
	})

	test('won with no amount passed reads the stored payout', async () => {
		useFake(fakeDb(casinoRoutes({ status: 'won', payout: '180.00' })))
		await updateCasinoBetStatus(BET, 'won')
		assert.equal(releases[0].betResult, 'win')
		assert.equal(releases[0].payoutAmount, 80)
	})

	test('won returning exactly the stake is a 0 win', async () => {
		useFake(fakeDb(casinoRoutes({ status: 'won', payout: '100.00' })))
		await updateCasinoBetStatus(BET, 'won', 100, 0, new Date())
		assert.equal(releases[0].betResult, 'win')
		assert.equal(releases[0].payoutAmount, 0)
	})

	test('lost with a partial return loses only stake - payout', async () => {
		useFake(fakeDb(casinoRoutes({ status: 'lost', payout: '40.00' })))
		await updateCasinoBetStatus(BET, 'lost', 40, -60, new Date())
		assert.equal(releases[0].betResult, 'loss')
		assert.equal(releases[0].payoutAmount, 60)
	})

	test('lost with payout 0 is a full-stake loss (unchanged)', async () => {
		useFake(fakeDb(casinoRoutes({ status: 'lost', payout: '0.00' })))
		await updateCasinoBetStatus(BET, 'lost', 0, -100, new Date())
		assert.equal(releases[0].betResult, 'loss')
		assert.equal(releases[0].payoutAmount, 100)
	})

	test('void releases the exposure with no settlement move (unchanged)', async () => {
		useFake(fakeDb(casinoRoutes({ status: 'void', payout: null })))
		await updateCasinoBetStatus(BET, 'void')
		assert.equal(releases[0].betResult, 'void')
		assert.equal(releases[0].payoutAmount, 0)
		assert.equal(releases[0].betAmount, 100)
	})

	test('a cash player gets no credit release', async () => {
		useFake(fakeDb(casinoRoutes({ status: 'won', payout: '250.00' }, 'CASH')))
		await updateCasinoBetStatus(BET, 'won', 250, 150, new Date())
		assert.equal(releases.length, 0)
	})
})
