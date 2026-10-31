/**
 * The CREDIT money model (plan W7, owner decision 2).
 *
 *  - agent credit_used = Σ child agents' limits + Σ direct players' limits (never exposure)
 *  - the whitelabel pool moves only for the root agent's limit and WHITELABEL_CREDIT players;
 *    releases mirror allocations exactly
 *  - balance writes are SQL increments / guarded single UPDATEs (no stale read-then-write)
 *  - credit alerts fire after operations that move an agent's usage
 *  - a DECREASE is never a settlement (SETTLE is explicit)
 *
 * No database: the shared `db` handle's query methods are replaced with ones that throw,
 * `db.transaction` runs the callback on a drizzle pg-proxy that records every statement,
 * and the repos the service is given are stubs.
 */
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { db, pool } from '@/db/client'
import {
	agentCreditUsedFromAllocations,
	creditAlertTypeFor,
	creditAvailableOf,
	isPlayerCreditAdjustmentType,
	isPlayerSettlementAdjustment,
	shouldMoveWhitelabelPool,
} from '../creditMath.js'
import { CreditService } from '../CreditService.js'
import { applyAgentCreditLimitDelta, applySettlementDeltas } from '@/repos/agents/creditBalanceSql'
import { WhitelabelCreditService } from '@src/domains/common/services/WhitelabelCreditService.js'
import { AgentCreditAlertsRepo } from '@/repos/agents/AgentCreditAlertsRepo'

// ---------------------------------------------------------------- fake database
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

function fakeTx(routes: Route[]) {
	const log: Stmt[] = []
	const tx = drizzle(async (sqlText: string, params: unknown[], method: string) => {
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
	return { tx: tx as any, log }
}

let currentTx: any = null
const originals: Record<string, unknown> = {}
before(() => {
	const refuse = () => {
		throw new Error('real database access is not allowed in this test')
	}
	for (const m of ['select', 'insert', 'update', 'delete', 'execute', 'transaction']) {
		originals[m] = (db as any)[m]
		;(db as any)[m] = refuse
	}
	;(db as any).transaction = async (fn: (tx: any) => Promise<unknown>) => {
		if (!currentTx) throw new Error('no fake transaction set')
		return fn(currentTx)
	}
})
after(async () => {
	for (const [m, f] of Object.entries(originals)) (db as any)[m] = f
	await pool.end().catch(() => {})
})

// ---------------------------------------------------------------- stubs
type AgentRow = {
	tenantId: string
	parentAgentId: string | null
	creditLimit: number
	creditUsed: number
	settlementBalance: number
	creditAlertThreshold?: number
}
function agentsRepoStub(rows: Record<string, AgentRow>) {
	const calls: Array<{ id: string; updates: any }> = []
	return {
		calls,
		async findById(id: string) {
			const a = rows[id]
			return a ? { id, tenantId: a.tenantId, parentAgentId: a.parentAgentId, schemeType: 'CREDIT' } : null
		},
		async getCreditFields(id: string) {
			const a = rows[id]
			if (!a) return null
			return {
				creditLimit: a.creditLimit,
				creditUsed: a.creditUsed,
				creditAvailable: creditAvailableOf(a),
				creditAlertThreshold: a.creditAlertThreshold ?? 80,
				settlementBalance: a.settlementBalance,
				settlementBalanceSports: 0,
				settlementBalanceCasino: a.settlementBalance,
				settlementBalanceMatka: 0,
			}
		},
		async lockAndUpdateCredit(id: string, updates: any) {
			calls.push({ id, updates })
			const a = rows[id]
			const used = a.creditUsed + Number(updates.creditUsedDelta ?? 0)
			if (updates.requireAvailableForDelta && Number(updates.creditUsedDelta) > creditAvailableOf(a)) {
				throw new Error('Insufficient credit')
			}
			return {
				creditUsed: used,
				creditAvailable: creditAvailableOf({ ...a, creditUsed: used }),
				creditLimit: a.creditLimit,
				settlementBalance: a.settlementBalance,
			}
		},
		async updateCreditBalance(id: string, updates: any) {
			calls.push({ id, updates: { absolute: updates } })
		},
		async listChildren() {
			return []
		},
	}
}
function ledgerStub() {
	const rows: any[] = []
	return {
		rows,
		async recordTransaction(input: any, tx?: any) {
			rows.push({ input, inTx: Boolean(tx) })
			return {}
		},
	}
}

const poolCalls: Array<{ op: 'deduct' | 'add'; tenant: string; amount: number; inTx: boolean }> = []
const alertCalls: any[] = []
before(() => {
	;(WhitelabelCreditService.prototype as any).deductCredit = async function (t: string, amount: number, _r?: string, tx?: any) {
		poolCalls.push({ op: 'deduct', tenant: t, amount, inTx: Boolean(tx) })
	}
	;(WhitelabelCreditService.prototype as any).addCredit = async function (t: string, amount: number, _r?: string, tx?: any) {
		poolCalls.push({ op: 'add', tenant: t, amount, inTx: Boolean(tx) })
	}
	;(AgentCreditAlertsRepo.prototype as any).createAlertIfNoneActive = async function (input: any) {
		alertCalls.push(input)
		return null
	}
})

function service(rows: Record<string, AgentRow>) {
	const repo = agentsRepoStub(rows)
	const ledger = ledgerStub()
	const svc = new CreditService(repo as any, ledger as any)
	const alertsChecked: string[] = []
	const realCheck = svc.checkCreditAlerts.bind(svc)
	svc.checkCreditAlerts = async (...ids: Array<string | null | undefined>) => {
		alertsChecked.push(...(ids.filter(Boolean) as string[]))
		return realCheck(...ids)
	}
	return { svc, repo, ledger, alertsChecked }
}

const agentLimitRow = (limit: number, used: number, settlement = 0) => ({
	credit_limit: String(limit),
	credit_used: String(used),
	credit_available: String(Math.max(0, limit - used + settlement)),
	settlement_balance: String(settlement),
})

// ================================================================= pure model
describe('credit model (pure)', () => {
	test("an agent's credit_used is the limits it handed down", () => {
		assert.equal(agentCreditUsedFromAllocations([600, 150.25], [200, 49.75]), 1000)
		assert.equal(agentCreditUsedFromAllocations([], []), 0)
		assert.equal(agentCreditUsedFromAllocations([Number.NaN, 100], [50]), 150)
	})

	test('a fully allocated agent is not over its limit when its players bet (no double count)', () => {
		// Limit 1000: 600 to a sub-agent, 400 to a player who now has 300 open exposure.
		const used = agentCreditUsedFromAllocations([600], [400])
		assert.equal(used, 1000, 'the exposure is not added again')
		assert.equal(creditAvailableOf({ creditLimit: 1000, creditUsed: used, settlementBalance: 0 }), 0)
		assert.equal(creditAlertTypeFor({ creditLimit: 1000, creditUsed: used, creditAlertThreshold: 80 })?.type, 'THRESHOLD_EXCEEDED')
		// The old model counted 1000 + 300 = 1300: OVER_LIMIT.
		assert.equal(creditAlertTypeFor({ creditLimit: 1000, creditUsed: 1300, creditAlertThreshold: 80 })?.type, 'OVER_LIMIT')
	})

	test('availability is max(0, limit - used + settlement) for every row type', () => {
		assert.equal(creditAvailableOf({ creditLimit: 1000, creditUsed: 400, settlementBalance: -100 }), 500)
		assert.equal(creditAvailableOf({ creditLimit: 1000, creditUsed: 400, settlementBalance: 250 }), 850)
		assert.equal(creditAvailableOf({ creditLimit: 1000, creditUsed: 1200, settlementBalance: 100 }), 0)
	})

	test('the whitelabel pool moves only for the root agent and WHITELABEL_CREDIT players', () => {
		assert.equal(shouldMoveWhitelabelPool('wl1', 'root_agent'), true)
		assert.equal(shouldMoveWhitelabelPool('wl1', 'whitelabel_player'), true)
		assert.equal(shouldMoveWhitelabelPool('wl1', 'sub_agent'), false)
		assert.equal(shouldMoveWhitelabelPool('wl1', 'agent_player'), false)
		for (const t of ['root_agent', 'whitelabel_player', 'sub_agent', 'agent_player'] as const) {
			assert.equal(shouldMoveWhitelabelPool('default', t), false, 'the default tenant has no pool')
			assert.equal(shouldMoveWhitelabelPool(null, t), false)
		}
	})

	test('alert thresholds', () => {
		assert.equal(creditAlertTypeFor({ creditLimit: 1000, creditUsed: 790, creditAlertThreshold: 80 }), null)
		assert.deepEqual(creditAlertTypeFor({ creditLimit: 1000, creditUsed: 800, creditAlertThreshold: 80 }), { type: 'THRESHOLD_EXCEEDED', usagePercentage: 80 })
		assert.equal(creditAlertTypeFor({ creditLimit: 1000, creditUsed: 1001, creditAlertThreshold: 80 })?.type, 'OVER_LIMIT')
		assert.equal(creditAlertTypeFor({ creditLimit: 0, creditUsed: 0, creditAlertThreshold: 80 }), null)
		assert.equal(creditAlertTypeFor({ creditLimit: 0, creditUsed: 5, creditAlertThreshold: 80 })?.type, 'OVER_LIMIT')
	})

	test('a DECREASE is never a settlement; SETTLE is explicit', () => {
		assert.equal(isPlayerSettlementAdjustment('DECREASE'), false)
		assert.equal(isPlayerSettlementAdjustment('SETTLE'), true)
		assert.equal(isPlayerCreditAdjustmentType('SETTLE'), true)
		assert.equal(isPlayerCreditAdjustmentType('DECREASE'), true)
		assert.equal(isPlayerCreditAdjustmentType('settle'), false)
		assert.equal(isPlayerCreditAdjustmentType(undefined), false)
	})
})

// ================================================================= SQL shape
describe('atomic balance writes (SQL shape)', () => {
	test('a limit change is ONE guarded UPDATE computed from the row, with no read before it', async () => {
		const { tx, log } = fakeTx([{ match: has('update agents', 'set credit_limit'), rows: [agentLimitRow(700, 500)] }])
		const after = await applyAgentCreditLimitDelta(tx, 'child-1', -300, { requireAvailable: 300, keepLimitCoveringUsed: true })
		assert.equal(after.creditLimit, 700)
		assert.equal(log.length, 1, 'no SELECT before the write')
		const s = log[0].flat
		assert.match(s, /^update agents set credit_limit = coalesce\(credit_limit, 0\) \+ \$1/)
		assert.match(s, /credit_available = greatest\(0, coalesce\(credit_limit, 0\) \+ \$\d+ - coalesce\(credit_used, 0\) \+ coalesce\(settlement_balance, 0\)\)/)
		assert.match(s, /where id = \$\d+ and coalesce\(credit_limit, 0\) \+ \$\d+ >= 0/)
		assert.match(s, /coalesce\(credit_limit, 0\) - coalesce\(credit_used, 0\) \+ coalesce\(settlement_balance, 0\) >= \$\d+/, 'available guard in WHERE')
		assert.match(s, /coalesce\(credit_limit, 0\) \+ \$\d+ >= coalesce\(credit_used, 0\)/, 'limit-covers-used guard in WHERE')
		assert.ok(log[0].params.includes(-300) && log[0].params.includes('child-1') && log[0].params.includes(300))
	})

	test('a failed guard writes nothing and explains why', async () => {
		const { tx, log } = fakeTx([
			{ match: has('update agents'), rows: [] },
			{ match: has('select credit_limit, credit_used, settlement_balance from agents'), rows: [agentLimitRow(1000, 900)] },
		])
		await assert.rejects(
			applyAgentCreditLimitDelta(tx, 'child-1', -300, { requireAvailable: 300, keepLimitCoveringUsed: true }),
			/not have enough available credit\. Available: 100, Requested: 300/
		)
		assert.equal(log.filter((s) => s.flat.startsWith('update')).length, 1)
	})

	test('settlement deltas move the domain balance and availability, never credit_used', async () => {
		const { tx, log } = fakeTx([{ match: has('update agents'), rows: [agentLimitRow(1000, 400, -50)] }])
		await applySettlementDeltas(tx, 'agents', 'a1', { casino: -50 })
		const s = log[0].flat
		assert.match(s, /settlement_balance_casino = coalesce\(settlement_balance_casino, 0\) \+ \$\d+/)
		assert.doesNotMatch(s, /credit_used =/)
		assert.doesNotMatch(s, /updated_at/, 'agents has no updated_at column')
		assert.equal(log.length, 1)
	})
})

// ================================================================= CreditService
describe('CreditService: pool rule, symmetry, increments, alerts', () => {
	test('allocating to a sub-agent comes from the parent, not the pool; child limit is an increment', async () => {
		poolCalls.length = 0
		const { svc, repo, ledger, alertsChecked } = service({
			parent: { tenantId: 'wl1', parentAgentId: 'root', creditLimit: 1000, creditUsed: 200, settlementBalance: 0 },
			child: { tenantId: 'wl1', parentAgentId: 'parent', creditLimit: 0, creditUsed: 0, settlementBalance: 0 },
		})
		const { tx, log } = fakeTx([{ match: has('update agents', 'set credit_limit'), rows: [agentLimitRow(300, 0)] }])
		currentTx = tx
		await svc.allocateCreditToSubAgent('parent', 'child', 300, undefined, { createdBy: 'not-a-uuid', createdByType: 'admin' })

		assert.deepEqual(poolCalls, [], 'the whitelabel pool is not debited again below the root')
		assert.deepEqual(repo.calls[0], { id: 'parent', updates: { creditUsedDelta: 300, requireAvailableForDelta: true } })
		const childWrite = log.find((s) => s.flat.startsWith('update agents set credit_limit'))
		assert.ok(childWrite && childWrite.params.includes(300) && childWrite.params.includes('child'))
		assert.equal(log.filter((s) => /from agents/.test(s.flat) && !s.flat.startsWith('update')).length, 0, 'no stale read of the child')
		assert.equal(ledger.rows.length, 1)
		assert.equal(ledger.rows[0].input.transactionType, 'ALLOCATION')
		assert.equal(ledger.rows[0].inTx, true)
		assert.equal(ledger.rows[0].input.balanceBefore, 800)
		assert.equal(ledger.rows[0].input.balanceAfter, 500)
		assert.equal(ledger.rows[0].input.createdBy, undefined, 'only uuids reach created_by')
		assert.deepEqual(alertsChecked, ['parent', 'child'])
	})

	test('releasing from a sub-agent mirrors the allocation: back to the parent, not the pool', async () => {
		poolCalls.length = 0
		const { svc, repo, ledger } = service({
			parent: { tenantId: 'wl1', parentAgentId: 'root', creditLimit: 1000, creditUsed: 500, settlementBalance: 0 },
			child: { tenantId: 'wl1', parentAgentId: 'parent', creditLimit: 300, creditUsed: 0, settlementBalance: 0 },
		})
		const { tx, log } = fakeTx([{ match: has('update agents', 'set credit_limit'), rows: [agentLimitRow(0, 0)] }])
		currentTx = tx
		await svc.releaseCreditFromSubAgent('parent', 'child', 300)

		assert.deepEqual(poolCalls, [], 'no pool refund (there was no pool debit)')
		assert.deepEqual(repo.calls[0], { id: 'parent', updates: { creditUsedDelta: -300 } })
		const childWrite = log.find((s) => s.flat.startsWith('update agents set credit_limit'))!
		assert.ok(childWrite.params.includes(-300))
		assert.match(childWrite.flat, /\+ coalesce\(settlement_balance, 0\) >= \$\d+/, 'child must have the amount available')
		assert.match(childWrite.flat, />= coalesce\(credit_used, 0\)/, 'child limit must still cover what it handed down')
		assert.equal(ledger.rows[0].input.transactionType, 'RELEASE')
		assert.equal(ledger.rows[0].input.balanceBefore, 500)
		assert.equal(ledger.rows[0].input.balanceAfter, 800)
	})

	test("the root agent's limit moves the pool both ways; a sub-agent's limit cannot be set directly", async () => {
		poolCalls.length = 0
		const rootRow = { tenant_id: 'wl1', parent_agent_id: null, scheme_type: 'CREDIT', credit_alert_threshold: '80', ...agentLimitRow(1000, 200) }
		const { svc } = service({ root: { tenantId: 'wl1', parentAgentId: null, creditLimit: 1000, creditUsed: 200, settlementBalance: 0 } })
		currentTx = fakeTx([{ match: has('from agents', 'for update'), rows: [rootRow] }]).tx
		await svc.adjustCreditLimit('root', 1500)
		currentTx = fakeTx([{ match: has('from agents', 'for update'), rows: [{ ...rootRow, ...agentLimitRow(1500, 200) }] }]).tx
		await svc.adjustCreditLimit('root', 1200)
		assert.deepEqual(poolCalls, [
			{ op: 'deduct', tenant: 'wl1', amount: 500, inTx: true },
			{ op: 'add', tenant: 'wl1', amount: 300, inTx: true },
		])

		const sub = service({ sub: { tenantId: 'wl1', parentAgentId: 'root', creditLimit: 100, creditUsed: 0, settlementBalance: 0 } })
		await assert.rejects(sub.svc.adjustCreditLimit('sub', 500), /allocated by its parent/)

		poolCalls.length = 0
		const dflt = service({ root: { tenantId: 'default', parentAgentId: null, creditLimit: 1000, creditUsed: 0, settlementBalance: 0 } })
		currentTx = fakeTx([{ match: has('from agents', 'for update'), rows: [{ ...rootRow, tenant_id: 'default' }] }]).tx
		await dflt.svc.adjustCreditLimit('root', 2000)
		assert.deepEqual(poolCalls, [], 'the default tenant has no pool')
	})

	test('adjustCreditLimit refuses a limit below the LOCKED usage', async () => {
		const { svc, repo } = service({ root: { tenantId: 'wl1', parentAgentId: null, creditLimit: 1000, creditUsed: 0, settlementBalance: 0 } })
		// The plain read would say used 0; the locked row says 900.
		currentTx = fakeTx([{ match: has('from agents', 'for update'), rows: [{ tenant_id: 'wl1', parent_agent_id: null, scheme_type: 'CREDIT', credit_alert_threshold: '80', ...agentLimitRow(1000, 900) }] }]).tx
		await assert.rejects(svc.adjustCreditLimit('root', 800), /Current usage: 900/)
		assert.equal(repo.calls.length, 0)
	})

	test("deposits to and withdrawals from an agent's player never touch the pool; player writes are increments", async () => {
		poolCalls.length = 0
		const { svc, repo, ledger } = service({ ag: { tenantId: 'wl1', parentAgentId: null, creditLimit: 1000, creditUsed: 0, settlementBalance: 0 } })
		const playerRow = { agent_id: 'ag', player_type: 'AGENT_CREDIT', ...agentLimitRow(100, 40, 0), settlement_balance_sports: '0', settlement_balance_casino: '0', settlement_balance_matka: '0' }
		const routes: Route[] = [
			{ match: has('from users', 'for update'), rows: [playerRow] },
			{ match: has('update users set credit_limit'), rows: [agentLimitRow(150, 40)] },
		]
		const dep = fakeTx(routes)
		currentTx = dep.tx
		await svc.depositCredit('ag', 'player', '7', 50)
		const wit = fakeTx(routes)
		currentTx = wit.tx
		await svc.withdrawCredit('ag', 'player', '7', 50)

		assert.deepEqual(poolCalls, [])
		assert.deepEqual(repo.calls.map((c) => c.updates.creditUsedDelta), [50, -50])
		const depWrite = dep.log.find((s) => s.flat.startsWith('update users set credit_limit'))!
		assert.match(depWrite.flat, /credit_limit = coalesce\(credit_limit, 0\) \+ \$1/)
		const witWrite = wit.log.find((s) => s.flat.startsWith('update users set credit_limit'))!
		assert.ok(witWrite.params.includes(-50))
		assert.match(witWrite.flat, /\+ coalesce\(settlement_balance, 0\) >= \$\d+/, 'player must have the amount available')
		// The player row is locked before the agent is touched (player -> agent order).
		const lockIdx = dep.log.findIndex((s) => /from users/.test(s.flat) && /for update/.test(s.flat))
		assert.equal(lockIdx, 0)
		// agent_player_credits follows the player, with the player invariant.
		const apc = dep.log.find((s) => s.flat.startsWith('insert into agent_player_credits'))!
		assert.match(apc.flat, /credit_available = greatest\(0, excluded\.credit_limit - excluded\.credit_used \+ agent_player_credits\.current_balance\)/)
		assert.deepEqual(ledger.rows.map((r) => r.input.transactionType), ['DEPOSIT', 'WITHDRAWAL'])
	})

	test('WHITELABEL_CREDIT player deposits debit the pool and withdrawals refund the same amount', async () => {
		poolCalls.length = 0
		const { svc, ledger } = service({})
		const wlPlayer = { agent_id: null, player_type: 'WHITELABEL_CREDIT', ...agentLimitRow(1000, 0), settlement_balance_sports: '0', settlement_balance_casino: '0', settlement_balance_matka: '0' }
		const routes: Route[] = [
			{ match: has('from users', 'for update'), rows: [wlPlayer] },
			{ match: has('update users set credit_limit'), rows: [agentLimitRow(1200, 0)] },
		]
		currentTx = fakeTx(routes).tx
		await svc.depositCreditToWhitelabelPlayer(9, 'wl1', 200)
		currentTx = fakeTx(routes).tx
		await svc.withdrawCreditFromWhitelabelPlayer(9, 'wl1', 200)
		currentTx = fakeTx(routes).tx
		await svc.adjustWhitelabelPlayerCreditLimit(9, 'wl1', 1500)
		assert.deepEqual(poolCalls, [
			{ op: 'deduct', tenant: 'wl1', amount: 200, inTx: true },
			{ op: 'add', tenant: 'wl1', amount: 200, inTx: true },
			{ op: 'deduct', tenant: 'wl1', amount: 500, inTx: true },
		])
		assert.ok(ledger.rows.every((r) => r.inTx), 'ledger rows commit with the balance change')
	})

	test('transfers between siblings leave the parent and the pool alone, and lock in id order', async () => {
		poolCalls.length = 0
		const { svc, repo } = service({
			parent: { tenantId: 'wl1', parentAgentId: null, creditLimit: 1000, creditUsed: 600, settlementBalance: 0 },
			b: { tenantId: 'wl1', parentAgentId: 'parent', creditLimit: 300, creditUsed: 0, settlementBalance: 0 },
			a: { tenantId: 'wl1', parentAgentId: 'parent', creditLimit: 300, creditUsed: 0, settlementBalance: 0 },
		})
		const t = fakeTx([{ match: has('update agents set credit_limit'), rows: [agentLimitRow(250, 0)] }])
		currentTx = t.tx
		await svc.transferCredit('parent', 'b', 'a', 50)
		const writes = t.log.filter((s) => s.flat.startsWith('update agents'))
		assert.equal(writes.length, 2)
		assert.ok(writes[0].params.includes('a') && writes[0].params.includes(50), "'a' < 'b': the destination row is written first")
		assert.ok(writes[1].params.includes('b') && writes[1].params.includes(-50))
		assert.equal(repo.calls.length, 0, 'parent credit_used unchanged')
		assert.deepEqual(poolCalls, [])
	})

	test('alerts fire at the threshold and on over-limit; alerting never throws', async () => {
		alertCalls.length = 0
		const { svc } = service({
			near: { tenantId: 'wl1', parentAgentId: null, creditLimit: 1000, creditUsed: 850, settlementBalance: 0 },
			over: { tenantId: 'wl1', parentAgentId: null, creditLimit: 1000, creditUsed: 1200, settlementBalance: 0 },
			fine: { tenantId: 'wl1', parentAgentId: null, creditLimit: 1000, creditUsed: 500, settlementBalance: 0 },
		})
		await svc.checkCreditAlerts('near', 'over', 'fine', null, 'near')
		assert.deepEqual(alertCalls.map((a) => [a.agentId, a.alertType]), [['near', 'THRESHOLD_EXCEEDED'], ['over', 'OVER_LIMIT']])

		const broken = new CreditService({ getCreditFields: async () => { throw new Error('db down') } } as any, ledgerStub() as any)
		await broken.checkCreditAlerts('x')
	})
})
