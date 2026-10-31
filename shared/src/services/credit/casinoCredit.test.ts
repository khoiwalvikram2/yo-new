/**
 * DB-backed round-trip tests for the shared casino credit module.
 *
 * Strategy: seed clearly-marked temp rows (high ids / temp tenant) committed in before(),
 * then run EACH scenario inside a db.transaction() that we ROLL BACK (by throwing a
 * sentinel) so seed rows are never permanently mutated between tests. Seeds are removed
 * in after(). No test data persists.
 */
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { db, pool } from '../../db/client.js'
import { sql } from 'drizzle-orm'
import {
	getCasinoCreditBalance,
	lockCasinoCreditForBet,
	releaseCasinoCreditForBet,
	reLockCasinoCreditForBet,
	creditCasinoSettlement,
} from './casinoCredit.js'

// --- Temp seed identifiers (clearly marked, unlikely to collide) ---
const AGENT_ID = '00000000-aaaa-bbbb-cccc-000000000001'
const TENANT_DEFAULT = 'default'
const WL_TENANT = 'casinocredit_test_wl'
const PLAYER_ID = 999000001 // AGENT_CREDIT under AGENT_ID, tenant=default
const WL_PLAYER_ID = 999000002 // WHITELABEL_CREDIT under WL_TENANT

const AGENT_LIMIT = 100000
const PLAYER_LIMIT = 50000
const WL_LIMIT = 100000

class Rollback extends Error {}

/** Run fn inside a transaction that is always rolled back. */
async function inRollback(fn: (tx: any) => Promise<void>): Promise<void> {
	try {
		await db.transaction(async (tx) => {
			await fn(tx)
			throw new Rollback()
		})
	} catch (e) {
		if (!(e instanceof Rollback)) throw e
	}
}

async function readUser(executor: any, id: number, tenant: string) {
	const r = await executor.execute(sql`
		SELECT credit_limit, credit_used, credit_available,
			settlement_balance, settlement_balance_sports,
			settlement_balance_casino, settlement_balance_matka
		FROM users WHERE id = ${id} AND tenant = ${tenant} LIMIT 1`)
	const row = (r as any).rows?.[0] ?? (r as any)[0]
	return {
		creditUsed: Number(row.credit_used),
		creditAvailable: Number(row.credit_available),
		settlement: Number(row.settlement_balance),
		settlementCasino: Number(row.settlement_balance_casino),
	}
}

async function readAgent(executor: any, id: string) {
	const r = await executor.execute(sql`
		SELECT credit_used, credit_available, settlement_balance, settlement_balance_casino
		FROM agents WHERE id = ${id} LIMIT 1`)
	const row = (r as any).rows?.[0] ?? (r as any)[0]
	return {
		creditUsed: Number(row.credit_used),
		creditAvailable: Number(row.credit_available),
		settlement: Number(row.settlement_balance),
		settlementCasino: Number(row.settlement_balance_casino),
	}
}

async function readApc(executor: any, agentId: string, playerId: number) {
	const r = await executor.execute(sql`
		SELECT current_balance, open_exposure, credit_used, credit_available
		FROM agent_player_credits WHERE agent_id = ${agentId} AND player_id = ${playerId} LIMIT 1`)
	const row = (r as any).rows?.[0] ?? (r as any)[0]
	return {
		currentBalance: Number(row.current_balance),
		openExposure: Number(row.open_exposure),
		creditUsed: Number(row.credit_used),
		creditAvailable: Number(row.credit_available),
	}
}

async function readWl(executor: any, id: string) {
	const r = await executor.execute(sql`
		SELECT credit_used, credit_available, settlement_balance, settlement_balance_casino
		FROM whitelabels WHERE id = ${id} LIMIT 1`)
	const row = (r as any).rows?.[0] ?? (r as any)[0]
	return {
		creditUsed: Number(row.credit_used),
		creditAvailable: Number(row.credit_available),
		settlement: Number(row.settlement_balance),
		settlementCasino: Number(row.settlement_balance_casino),
	}
}

before(async () => {
	// Clean any stale seeds first.
	await pool.query(`DELETE FROM agent_credit_ledger WHERE tenant_id IN ($1,$2)`, [WL_TENANT, TENANT_DEFAULT + '__never'])
	await pool.query(`DELETE FROM agent_player_credits WHERE agent_id = $1`, [AGENT_ID])
	await pool.query(`DELETE FROM users WHERE id IN ($1,$2)`, [PLAYER_ID, WL_PLAYER_ID])
	await pool.query(`DELETE FROM agents WHERE id = $1`, [AGENT_ID])
	await pool.query(`DELETE FROM whitelabels WHERE id = $1`, [WL_TENANT])

	// Whitelabel (tenant) for WL_TENANT.
	await pool.query(
		`INSERT INTO whitelabels (id, name, domain, status, credit_limit, credit_used, credit_available,
			settlement_balance, settlement_balance_sports, settlement_balance_casino, settlement_balance_matka)
		 VALUES ($1,$2,$3,'active',$4,0,$4,0,0,0,0)`,
		[WL_TENANT, 'Casino Credit Test WL', 'casinocredit-test.example.com', WL_LIMIT]
	)

	// Agent: limit 100000, used 0, settlement 0.
	await pool.query(
		`INSERT INTO agents (id, tenant_id, scheme_type, allowed_domains, status,
			credit_limit, credit_used, credit_available,
			settlement_balance, settlement_balance_sports, settlement_balance_casino, settlement_balance_matka)
		 VALUES ($1,$2,'CREDIT',$3,'active',$4,0,$4,0,0,0,0)`,
		[AGENT_ID, TENANT_DEFAULT, ['casino'], AGENT_LIMIT]
	)

	// AGENT_CREDIT player under the agent.
	await pool.query(
		`INSERT INTO users (id, tenant, name, username, password_hash, status, player_type, agent_id,
			credit_limit, credit_used, credit_available,
			settlement_balance, settlement_balance_sports, settlement_balance_casino, settlement_balance_matka)
		 VALUES ($1,$2,'CC Test Player','cc_test_player','x','active','AGENT_CREDIT',$3,$4,0,$4,0,0,0,0)`,
		[PLAYER_ID, TENANT_DEFAULT, AGENT_ID, PLAYER_LIMIT]
	)

	// agent_player_credits row.
	await pool.query(
		`INSERT INTO agent_player_credits (agent_id, player_id, credit_limit, current_balance, open_exposure, credit_used, credit_available)
		 VALUES ($1,$2,$3,0,0,0,$3)`,
		[AGENT_ID, PLAYER_ID, PLAYER_LIMIT]
	)

	// WHITELABEL_CREDIT player under WL_TENANT (no agent).
	await pool.query(
		`INSERT INTO users (id, tenant, name, username, password_hash, status, player_type, agent_id,
			credit_limit, credit_used, credit_available,
			settlement_balance, settlement_balance_sports, settlement_balance_casino, settlement_balance_matka)
		 VALUES ($1,$2,'CC WL Player','cc_wl_player','x','active','WHITELABEL_CREDIT',NULL,$3,0,$3,0,0,0,0)`,
		[WL_PLAYER_ID, WL_TENANT, WL_LIMIT]
	)
})

after(async () => {
	await pool.query(`DELETE FROM agent_credit_ledger WHERE tenant_id IN ($1,$2)`, [WL_TENANT, TENANT_DEFAULT])
		.catch(() => {})
	await pool.query(`DELETE FROM agent_player_credits WHERE agent_id = $1`, [AGENT_ID])
	await pool.query(`DELETE FROM users WHERE id IN ($1,$2)`, [PLAYER_ID, WL_PLAYER_ID])
	await pool.query(`DELETE FROM agents WHERE id = $1`, [AGENT_ID])
	await pool.query(`DELETE FROM whitelabels WHERE id = $1`, [WL_TENANT])
	await pool.end()
})

// 0. balance callback sees credit, not cash=0.
test('getCasinoCreditBalance returns credit for AGENT_CREDIT player', async () => {
	const res = await getCasinoCreditBalance(db, PLAYER_ID, TENANT_DEFAULT)
	assert.equal(res.creditPlayer, true)
	assert.equal(res.creditAvailable, PLAYER_LIMIT)
})

// 1. lock reject (fail-closed): nothing mutated.
test('lock reject (fail-closed) mutates nothing', async () => {
	await inRollback(async (tx) => {
		const before = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		const beforeAgent = await readAgent(tx, AGENT_ID)
		const beforeApc = await readApc(tx, AGENT_ID, PLAYER_ID)

		const res = await lockCasinoCreditForBet(tx, {
			userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: PLAYER_LIMIT + 1,
		})
		assert.equal(res.ok, false)
		assert.equal(res.creditPlayer, true)
		assert.equal(res.reason, 'insufficient_credit')

		const after = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		const afterAgent = await readAgent(tx, AGENT_ID)
		const afterApc = await readApc(tx, AGENT_ID, PLAYER_ID)
		assert.deepEqual(after, before)
		assert.deepEqual(afterAgent, beforeAgent)
		assert.deepEqual(afterApc, beforeApc)
	})
})

// 2. lock success.
test('lock success updates player/apc exposure, not the agent credit_used (W7)', async () => {
	await inRollback(async (tx) => {
		const res = await lockCasinoCreditForBet(tx, { userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 1000 })
		assert.equal(res.ok, true)
		assert.equal(res.creditAvailable, 49000)

		const u = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		assert.equal(u.creditUsed, 1000)
		assert.equal(u.creditAvailable, 49000)

		// The agent's credit_used is the credit it handed down; the player's exposure is
		// not added to it again.
		const a = await readAgent(tx, AGENT_ID)
		assert.equal(a.creditUsed, 0)
		assert.equal(a.creditAvailable, AGENT_LIMIT)

		const apc = await readApc(tx, AGENT_ID, PLAYER_ID)
		assert.equal(apc.openExposure, 1000)
		assert.equal(apc.creditUsed, 1000)
	})
})

// 3. void round-trip -> baseline.
test('void round-trip returns to baseline', async () => {
	await inRollback(async (tx) => {
		await lockCasinoCreditForBet(tx, { userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 1000 })
		await releaseCasinoCreditForBet(tx, {
			userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 1000, betResult: 'void', payoutAmount: 0,
		})

		const u = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		assert.equal(u.creditUsed, 0)
		assert.equal(u.creditAvailable, PLAYER_LIMIT)
		assert.equal(u.settlementCasino, 0)
		assert.equal(u.settlement, 0)

		const a = await readAgent(tx, AGENT_ID)
		assert.equal(a.creditUsed, 0)
		assert.equal(a.creditAvailable, AGENT_LIMIT)
		assert.equal(a.settlementCasino, 0)

		const apc = await readApc(tx, AGENT_ID, PLAYER_ID)
		assert.equal(apc.openExposure, 0)
		assert.equal(apc.creditUsed, 0)
		assert.equal(apc.currentBalance, 0)
	})
})

// 4. loss.
test('loss releases exposure and books -loss to settlement_casino', async () => {
	await inRollback(async (tx) => {
		await lockCasinoCreditForBet(tx, { userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 1000 })
		await releaseCasinoCreditForBet(tx, {
			userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 1000, betResult: 'loss', payoutAmount: 1000,
		})

		const u = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		assert.equal(u.creditUsed, 0)
		assert.equal(u.settlementCasino, -1000)
		assert.equal(u.creditAvailable, 49000) // 50000 - 0 + (-1000)

		const a = await readAgent(tx, AGENT_ID)
		assert.equal(a.creditUsed, 0)
		assert.equal(a.settlementCasino, -1000)
		assert.equal(a.creditAvailable, 99000) // 100000 - 0 + (-1000)

		const apc = await readApc(tx, AGENT_ID, PLAYER_ID)
		assert.equal(apc.currentBalance, -1000)
		assert.equal(apc.openExposure, 0)
	})
})

// 5. win.
test('win releases exposure and books +payout to settlement_casino', async () => {
	await inRollback(async (tx) => {
		await lockCasinoCreditForBet(tx, { userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 1000 })
		await releaseCasinoCreditForBet(tx, {
			userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 1000, betResult: 'win', payoutAmount: 2500,
		})

		const u = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		assert.equal(u.creditUsed, 0)
		assert.equal(u.settlementCasino, 2500)
		assert.equal(u.creditAvailable, PLAYER_LIMIT + 2500)

		const a = await readAgent(tx, AGENT_ID)
		assert.equal(a.settlementCasino, 2500)
	})
})

// 5b. Zero-stake release (marker bet) must NOT throw: exposure no-op, settlement still applies.
test('zero-stake release is a no-op on exposure but still books settlement (no throw)', async () => {
	await inRollback(async (tx) => {
		// A genuine bet locks 1000; then a zero-stake "win" of 300 settles with no exposure to release.
		await lockCasinoCreditForBet(tx, { userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 1000 })
		const before = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		await releaseCasinoCreditForBet(tx, {
			userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 0, betResult: 'win', payoutAmount: 300,
		})
		const u = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		assert.equal(u.creditUsed, before.creditUsed) // exposure unchanged (no stake to release)
		assert.equal(u.settlementCasino, 300) // settlement still credited
	})
})

// 5c. Zero-stake void is a pure no-op (no throw, nothing changes).
test('zero-stake void release is a clean no-op', async () => {
	await inRollback(async (tx) => {
		const before = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		await releaseCasinoCreditForBet(tx, {
			userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 0, betResult: 'void', payoutAmount: 0,
		})
		const u = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		assert.equal(u.creditUsed, before.creditUsed)
		assert.equal(u.settlementCasino, before.settlementCasino)
	})
})

// 6. relock reverses a release.
test('relock reverses a loss release back to post-lock state', async () => {
	await inRollback(async (tx) => {
		await lockCasinoCreditForBet(tx, { userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 1000 })
		await releaseCasinoCreditForBet(tx, {
			userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 1000, betResult: 'loss', payoutAmount: 1000,
		})
		// release applied settlement delta = -1000; pass that as balanceChange; relock negates it.
		await reLockCasinoCreditForBet(tx, {
			userId: PLAYER_ID, tenant: TENANT_DEFAULT, betAmount: 1000, balanceChange: -1000,
		})

		const u = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		assert.equal(u.creditUsed, 1000) // back to post-lock
		assert.equal(u.settlementCasino, 0)
		assert.equal(u.creditAvailable, 49000)

		const a = await readAgent(tx, AGENT_ID)
		assert.equal(a.creditUsed, 0) // W7: exposure is not cascaded into the agent
		assert.equal(a.settlementCasino, 0)

		const apc = await readApc(tx, AGENT_ID, PLAYER_ID)
		assert.equal(apc.openExposure, 1000)
		assert.equal(apc.creditUsed, 1000)
		assert.equal(apc.currentBalance, 0)

		// One ledger row written.
		const r = await tx.execute(sql`
			SELECT amount, balance_before, balance_after, reason, transaction_type, created_by_type
			FROM agent_credit_ledger
			WHERE tenant_id = ${TENANT_DEFAULT} AND reason = 'Casino settlement reversal - re-lock credit'
			ORDER BY created_at DESC LIMIT 1`)
		const led = (r as any).rows?.[0] ?? (r as any)[0]
		assert.ok(led, 'ledger row exists')
		assert.equal(Number(led.amount), 1000)
		assert.equal(Number(led.balance_before), 0)
		assert.equal(Number(led.balance_after), 1000)
		assert.equal(led.transaction_type, 'USAGE')
		assert.equal(led.created_by_type, 'system')
	})
})

// 7. pure settlement credit (payUp / additional-win): settlement +amount, exposure unchanged.
test('creditCasinoSettlement books +amount to settlement_casino with exposure unchanged', async () => {
	await inRollback(async (tx) => {
		const before = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		const beforeAgent = await readAgent(tx, AGENT_ID)
		const beforeApc = await readApc(tx, AGENT_ID, PLAYER_ID)

		const res = await creditCasinoSettlement(tx, {
			userId: PLAYER_ID, tenant: TENANT_DEFAULT, amount: 500,
		})
		assert.equal(res.creditPlayer, true)

		const u = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		assert.equal(u.settlementCasino, before.settlementCasino + 500)
		assert.equal(u.settlement, before.settlement + 500)
		assert.equal(u.creditAvailable, before.creditAvailable + 500)
		assert.equal(u.creditUsed, before.creditUsed) // exposure unchanged

		const a = await readAgent(tx, AGENT_ID)
		assert.equal(a.settlementCasino, beforeAgent.settlementCasino + 500)
		assert.equal(a.creditAvailable, beforeAgent.creditAvailable + 500)
		assert.equal(a.creditUsed, beforeAgent.creditUsed) // exposure unchanged

		const apc = await readApc(tx, AGENT_ID, PLAYER_ID)
		assert.equal(apc.currentBalance, beforeApc.currentBalance + 500)
		assert.equal(apc.openExposure, beforeApc.openExposure) // exposure unchanged
		assert.equal(apc.creditUsed, beforeApc.creditUsed)
	})
})

// 8. non-credit player: creditCasinoSettlement is a no-op signal.
test('creditCasinoSettlement returns creditPlayer:false for non-credit player', async () => {
	await inRollback(async (tx) => {
		// Flip the seeded player to a non-credit type inside the rolled-back tx.
		await tx.execute(sql`UPDATE users SET player_type = 'REGULAR' WHERE id = ${PLAYER_ID} AND tenant = ${TENANT_DEFAULT}`)
		const before = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		const res = await creditCasinoSettlement(tx, { userId: PLAYER_ID, tenant: TENANT_DEFAULT, amount: 500 })
		assert.equal(res.creditPlayer, false)
		const after = await readUser(tx, PLAYER_ID, TENANT_DEFAULT)
		assert.deepEqual(after, before) // nothing mutated
	})
})

// WHITELABEL void round-trip.
// Exposure is tracked ONLY on the player's users row; the whitelabels aggregate
// credit_used is NEVER changed by this module (matches original lockCreditForBet,
// which has no whitelabel branch). A void is a perfect inverse at the player level.
test('WHITELABEL void round-trip: player-row tracks exposure, whitelabel credit_used unchanged', async () => {
	await inRollback(async (tx) => {
		// Seeded whitelabel baseline (credit_used=0, settlement_casino=0).
		const wlBaseline = await readWl(tx, WL_TENANT)

		const lock = await lockCasinoCreditForBet(tx, { userId: WL_PLAYER_ID, tenant: WL_TENANT, betAmount: 1000 })
		assert.equal(lock.ok, true)
		assert.equal(lock.creditAvailable, WL_LIMIT - 1000)

		// Lock tracks exposure on the player's users row.
		let u = await readUser(tx, WL_PLAYER_ID, WL_TENANT)
		assert.equal(u.creditUsed, 1000)
		assert.equal(u.creditAvailable, WL_LIMIT - 1000)

		// Lock does NOT touch the whitelabels row at all.
		let wl = await readWl(tx, WL_TENANT)
		assert.equal(wl.creditUsed, wlBaseline.creditUsed) // unchanged (stays 0)
		assert.equal(wl.settlementCasino, wlBaseline.settlementCasino) // unchanged (stays 0)

		await releaseCasinoCreditForBet(tx, {
			userId: WL_PLAYER_ID, tenant: WL_TENANT, betAmount: 1000, betResult: 'void', payoutAmount: 0,
		})

		// Player row returns to baseline (perfect inverse).
		u = await readUser(tx, WL_PLAYER_ID, WL_TENANT)
		assert.equal(u.creditUsed, 0)
		assert.equal(u.creditAvailable, WL_LIMIT)
		assert.equal(u.settlementCasino, 0)

		// Whitelabel credit_used UNCHANGED from baseline (never touched by lock; release
		// leaves credit_used alone too). Settlement_casino back at baseline (void delta 0).
		wl = await readWl(tx, WL_TENANT)
		assert.equal(wl.creditUsed, wlBaseline.creditUsed) // stays 0, NOT 1000
		assert.equal(wl.settlementCasino, wlBaseline.settlementCasino) // delta 0
	})
})
