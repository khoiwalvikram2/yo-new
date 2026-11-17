import 'dotenv/config'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import * as tables from '@shared/db/schema.js'
import { moneyMinor } from '@shared/matka/rules.js'
import { ensureMatkaInstance } from '@shared/matka/catalogue.js'
import { matkaSchedule } from '@shared/matka/schedule.js'
import { declareAndSettleMatka, reverseMatkaResult, voidAndRefundMatkaBet } from '@shared/matka/settlement.js'

// Setup is deliberately explicit; this test can never target the configured app DB.
const record = JSON.parse(fs.readFileSync(path.resolve('../tmp/matka-test-database-2026-10-25.json'), 'utf8'))
if (!/^gw_matka_test_20261025_\d+$/.test(record.name) || !process.env.DATABASE_URL) throw new Error('Run tmp/setup-matka-test-database.ts first')
const target = new URL(process.env.DATABASE_URL)
if (target.pathname === '/' + record.name) throw new Error('The app environment must not point to the isolated test DB')
target.pathname = '/' + record.name
process.env.DATABASE_URL = target.toString()
const { db, pool } = await import('../../db/client.js')
const { placeMatkaEntries } = await import('./betService.js')
const { ownMatkaWallet, playerMatkaMarket } = await import('./readService.js')
const resultRows = (value: any) => value?.rows ?? value ?? []
// The credit-limit and upline figures that a credit player's Matka bet must never move.
const CREDIT_FIGURES = ['creditLimit', 'creditUsed', 'creditAvailable', 'settlementBalance', 'settlementBalanceSports', 'settlementBalanceCasino', 'settlementBalanceMatka', 'chipBalance', 'currentBalance', 'openExposure']
const creditFigures = (row: any) => Object.fromEntries(CREDIT_FIGURES.filter(key => key in row).map(key => [key, Number(row[key] ?? 0)]))
async function cashLedgerReconciles(tx: any, tenant: string) {
  const rows = await tx.select().from(tables.walletLedger).where(eq(tables.walletLedger.tenant, tenant))
  assert.ok(rows.length > 0 && rows.every((row: any) => row.walletType === 'cash' && row.meta?.walletType === 'cash'), 'every Matka movement is on the cash wallet')
  const inconsistent = resultRows(await tx.execute(sql`SELECT count(*) n FROM wallet_ledger WHERE tenant=${tenant} AND balance_after<>balance_before+CASE WHEN direction='credit' THEN amount ELSE -amount END`))[0]
  assert.equal(Number(inconsistent.n), 0)
  assert.equal((await tx.select().from(tables.creditChipLedger).where(eq(tables.creditChipLedger.tenantId, tenant))).length, 0, 'a bet writes no chip ledger rows')
}
const clock = new Date('2026-10-25T04:00:00Z')
class Rollback extends Error {}

test.before(async () => {
  assert.equal((await pool.query('SELECT current_database() name')).rows[0].name, record.name)
  assert.equal((await pool.query('SELECT marker FROM matka_workflow_test_marker')).rows[0].marker, record.marker)
})
test.after(async () => { await pool.end() })
async function rollback(fn: (tx: any) => Promise<void>) {
  try { await db.transaction(async tx => { await fn(tx); throw new Rollback() }) } catch (error) { if (!(error instanceof Rollback)) throw error }
}
async function seed(tx: any, kind = 'worli', playerType = 'REGULAR') {
  const tenant = 'matka-qa-' + randomUUID().slice(0, 12)
  await tx.insert(tables.whitelabels).values({ id: tenant, name: 'Isolated Matka QA', domain: tenant + '.invalid', creditLimit: '10000', creditAvailable: '10000' })
  await tx.insert(tables.appConfigs).values({ whitelabelId: tenant, matkaEnabled: true, maintenance: false, baseCurrency: 'INR', timeZone: 'UTC' })
  const [player] = await tx.insert(tables.users).values({ tenant, name: 'Matka test fixture', passwordHash: 'isolated-test-not-a-real-password', status: 'active', playerType, matkaVisible: true, matkaBetAllowed: true, creditLimit: '10000', creditAvailable: '10000' }).returning()
  const [wallet] = await tx.insert(tables.wallets).values({ tenant, userId: player.id, cash: '100000', bonus: '10000', referralBonus: '10000', currency: 'INR' }).returning()
  const [market] = await tx.insert(tables.matkas).values({ tenant, name: 'Matka QA Market', code: 'qa-market', timezone: 'UTC', status: 'active', schedule: { openTime: '12:00', closeTime: '21:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }, limits: { minBet: 10, maxBet: 10000 }, visibility: {}, settings: { matkaType: kind, betWindowMinsBeforeOpen: 15, betWindowMinsBeforeClose: 10 } }).returning()
  await tx.insert(tables.matkaDefaultRates).values({ tenant, entries: { entries: Object.entries({ SINGLE: 9, JODI: 90, SINGLE_PANNA: 150, DOUBLE_PANNA: 300, TRIPLE_PANNA: 800, HALF_SANGAM: 1000, FULL_SANGAM: 10000, AB: 90, A: 9, B: 9 }).map(([betType, payoutMultiplier]) => ({ betType, payoutMultiplier })) } })
  const operator = { tenant, actorId: '123' }
  const input = (entries: any[], extra: any = {}) => ({ marketId: market.id, runDate: '2026-10-25', walletType: 'CASH' as const, requestKey: randomUUID(), entries, ...extra })
  const entry = (bidType = 'single', selection = '5', amount = 10, session = 'OPEN') => ({ bidType, selection, amount, session })
  const balance = async (field = 'cash') => Number((await tx.select().from(tables.wallets).where(eq(tables.wallets.id, wallet.id)))[0][field])
  return { tenant, player, wallet, market, operator, input, entry, balance }
}
function freeze(t: any) { t.mock.timers.enable({ apis: ['Date'], now: clock.getTime() }) }

for (const [schemeType, playerType] of [['SHARING', 'SHARING_AGENT_PLAYER'], ['COMMISSION', 'COMMISSION_AGENT_PLAYER']]) {
  test(`${schemeType} player Matka placement, win/loss, replay, reversal and refunds conserve its cash wallet`, async t => {
    freeze(t)
    await rollback(async tx => {
      const f = await seed(tx, 'worli', playerType)
      const [agent] = await tx.insert(tables.agents).values({ tenantId: f.tenant, schemeType, allowedDomains: ['sports', 'casino', 'matka'], status: 'ACTIVE' }).returning()
      await tx.insert(tables.agentHierarchyClosure).values({ ancestorId: agent.id, descendantId: agent.id, depth: 0 })
      await tx.update(tables.users).set({ agentId: agent.id }).where(eq(tables.users.id, f.player.id))
      const input = f.input([f.entry('single', '5', 100), f.entry('single', '4', 200)])
      const placed = await placeMatkaEntries(f.player.id, f.tenant, input, tx)
      assert.equal(await f.balance(), 99700)
      await placeMatkaEntries(f.player.id, f.tenant, input, tx)
      assert.equal(await f.balance(), 99700)
      const result = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: input.runDate, type: 'open', result: '267' }, f.operator)
      assert.deepEqual(result.impact, { betsSettled: 2, winners: 1, totalPayout: 900 })
      assert.equal(await f.balance(), 100600)
      await reverseMatkaResult(tx, { id: result.id, reason: 'Isolated scheme audit' }, f.operator)
      assert.equal(await f.balance(), 99700)
      for (const bet of placed.bets) await voidAndRefundMatkaBet(tx, bet.id, 'Isolated scheme audit', f.operator)
      assert.equal(await f.balance(), 100000)
    })
  })
}

test('cash placement, request replay, both result sessions, rollback and redeclaration reconcile exactly', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx), input = f.input([f.entry('Single', '5', 100), f.entry('Jodi', '58', 10, 'CLOSE'), f.entry('single-patti', '279', 20, 'CLOSE')])
    const accepted = await placeMatkaEntries(f.player.id, f.tenant, input, tx)
    assert.equal(await f.balance(), 99870); assert.equal(accepted.bets.length, 3)
    assert.equal((await placeMatkaEntries(f.player.id, f.tenant, input, tx)).replayed, true); assert.equal(await f.balance(), 99870)
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, { ...input, entries: [f.entry('single', '4')] }, tx), /different entries/)
    const open = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: input.runDate, type: 'open', result: '267', idempotencyKey: 'open-qa-key' }, f.operator)
    assert.deepEqual(open.impact, { betsSettled: 1, winners: 1, totalPayout: 900 }); assert.equal(await f.balance(), 100770)
    await declareAndSettleMatka(tx, { matkaId: f.market.id, date: input.runDate, type: 'open', result: '267', idempotencyKey: 'open-qa-key' }, f.operator)
    assert.equal(await f.balance(), 100770)
    const close = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: input.runDate, type: 'close', result: '279', idempotencyKey: 'close-qa-key' }, f.operator)
    assert.deepEqual(close.impact, { betsSettled: 2, winners: 2, totalPayout: 3900 }); assert.equal(await f.balance(), 104670)
    await assert.rejects(reverseMatkaResult(tx, { id: open.id, reason: 'qa' }, f.operator), /Close result/)
    const reversal = await reverseMatkaResult(tx, { id: close.id, reason: 'qa correction' }, f.operator)
    assert.deepEqual(reversal.impact, close.impact); assert.equal(await f.balance(), 100770)
    await assert.rejects(declareAndSettleMatka(tx, { matkaId: f.market.id, date: input.runDate, type: 'close', result: '279', idempotencyKey: 'close-qa-key' }, f.operator), /already used/)
    const corrected = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: input.runDate, type: 'close', result: '128', idempotencyKey: 'corrected-qa-key' }, f.operator)
    assert.equal(corrected.impact.winners, 0); assert.equal(await f.balance(), 100770)
    const inconsistent = resultRows(await tx.execute(sql`SELECT count(*) n FROM wallet_ledger WHERE tenant=${f.tenant} AND balance_after<>balance_before+CASE WHEN direction='credit' THEN amount ELSE -amount END`))[0]
    assert.equal(Number(inconsistent.n), 0)
  })
})
test('an insufficient balance or ledger failure rolls back the entire request', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx)
    await tx.update(tables.wallets).set({ cash: '15' }).where(eq(tables.wallets.id, f.wallet.id))
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5', 10), f.entry('single', '6', 10)]), tx), /Insufficient/)
    assert.equal(await f.balance(), 15)
    assert.equal((await tx.select().from(tables.matkaBetBatches).where(eq(tables.matkaBetBatches.tenant, f.tenant))).length, 0)
    await tx.execute(sql`ALTER TABLE wallet_ledger ADD CONSTRAINT qa_matka_ledger_failure CHECK (category<>'matka_bet') NOT VALID`)
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry()]), tx))
    assert.equal(await f.balance(), 15)
    assert.equal((await tx.select().from(tables.ledgerEntries).where(eq(tables.ledgerEntries.tenant, f.tenant))).length, 0)
  })
})

test('visibility off blocks fresh entries while accepted replay, settlement and refunds remain available', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx), input = f.input([f.entry('single', '5', 100)])
    const accepted = await placeMatkaEntries(f.player.id, f.tenant, input, tx)
    const refundable = await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '6', 100)]), tx)
    await tx.update(tables.users).set({ matkaVisible: false, matkaBetAllowed: false }).where(eq(tables.users.id, f.player.id))
    assert.equal((await placeMatkaEntries(f.player.id, f.tenant, input, tx)).replayed, true)
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry()]), tx), /disabled|hidden/)
    await voidAndRefundMatkaBet(tx, refundable.bets[0].id, 'Visibility QA refund', f.operator)
    const settled = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: input.runDate, type: 'open', result: '267' }, f.operator)
    assert.equal(settled.impact.winners, 1); assert.equal(await f.balance(), 100800)
    assert.equal((await tx.select().from(tables.matkaBets).where(eq(tables.matkaBets.id, accepted.bets[0].id)))[0].status, 'won')
  })
})
test('Open cutoff locks Jodi and both Sangams while Close singles remain available; stale dates and per-number splitting are rejected', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx)
    t.mock.timers.setTime(new Date('2026-10-25T12:30:00Z').getTime())
    for (const e of [f.entry('jodi', '58', 10, 'CLOSE'), f.entry('half-sangam', '5-279', 10, 'CLOSE'), f.entry('full-sangam', '267-279', 10, 'CLOSE')]) await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([e]), tx), /Open betting is closed/)
    await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '8', 10, 'CLOSE')]), tx)
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '8', 10, 'CLOSE')], { runDate: '2026-10-24' }), tx), /date changed/)
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '8', 10000, 'CLOSE')]), tx), /including existing/)
  })
})
test('void refunds the original stake once, and published/spent winnings cannot be silently voided or reversed', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx), placed = await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5', 100)]), tx)
    await voidAndRefundMatkaBet(tx, placed.bets[0].id, 'qa refund', f.operator); await voidAndRefundMatkaBet(tx, placed.bets[0].id, 'qa retry', f.operator)
    assert.equal(await f.balance(), 100000)
    const next = await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5', 100)]), tx)
    const result = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: '2026-10-25', type: 'open', result: '267' }, f.operator)
    await assert.rejects(voidAndRefundMatkaBet(tx, next.bets[0].id, 'qa', f.operator), /Rollback/)
    await tx.update(tables.wallets).set({ cash: '0' }).where(eq(tables.wallets.id, f.wallet.id))
    await assert.rejects(reverseMatkaResult(tx, { id: result.id, reason: 'qa' }, f.operator), /no longer available/)
    const [stored] = await tx.select().from(tables.matkaResults).where(eq(tables.matkaResults.id, result.id)); assert.equal(stored.rolledBackAt, null)
    assert.equal((await tx.select().from(tables.matkaBets).where(eq(tables.matkaBets.id, next.bets[0].id)))[0].status, 'won')
  })
})
test('a WHITELABEL_CREDIT player stakes, wins, loses, rolls back and voids on its cash chips only', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx, 'worli', 'WHITELABEL_CREDIT')
    await tx.update(tables.wallets).set({ cash: '1000', bonus: '0', referralBonus: '0' }).where(eq(tables.wallets.id, f.wallet.id))
    const [playerBefore] = await tx.select().from(tables.users).where(eq(tables.users.id, f.player.id))
    const [whitelabelBefore] = await tx.select().from(tables.whitelabels).where(eq(tables.whitelabels.id, f.tenant))
    // The stake comes off the chips at placement, as for a cash player.
    const placed = await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5', 100), f.entry('single', '4', 200)]), tx)
    assert.equal(placed.balance, 700); assert.equal(await f.balance(), 700)
    assert.ok(placed.bets.every((bet: any) => bet.walletType === 'cash'))
    assert.equal((await tx.select().from(tables.matkaBetBatches).where(eq(tables.matkaBetBatches.id, placed.batchId)))[0].walletType, 'cash')
    // Open 267 (digit 5): the single 5 wins the gross 900 into cash; the single 4 loses its stake.
    const result = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: '2026-10-25', type: 'open', result: '267' }, f.operator)
    assert.deepEqual(result.impact, { betsSettled: 2, winners: 1, totalPayout: 900 }); assert.equal(await f.balance(), 1600)
    assert.deepEqual(result.settledBets.map((bet: any) => bet.status).sort(), ['lost', 'won'])
    await reverseMatkaResult(tx, { id: result.id, reason: 'Isolated credit correction' }, f.operator)
    assert.equal(await f.balance(), 700)
    for (const bet of placed.bets) await voidAndRefundMatkaBet(tx, bet.id, 'Isolated credit refund', f.operator)
    assert.equal(await f.balance(), 1000)
    const [playerAfter] = await tx.select().from(tables.users).where(eq(tables.users.id, f.player.id))
    const [whitelabelAfter] = await tx.select().from(tables.whitelabels).where(eq(tables.whitelabels.id, f.tenant))
    assert.deepEqual(creditFigures(playerAfter), creditFigures(playerBefore))
    assert.deepEqual(creditFigures(whitelabelAfter), creditFigures(whitelabelBefore))
    await cashLedgerReconciles(tx, f.tenant)
  })
})
test('a credit player can stake only its free chips (balance - exposure), from the main wallet only', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx, 'worli', 'WHITELABEL_CREDIT')
    // 150 of the 500 chips are held by an open sports liability, so 350 are free.
    await tx.update(tables.wallets).set({ cash: '500', exposure: '150', bonus: '0', referralBonus: '0' }).where(eq(tables.wallets.id, f.wallet.id))
    assert.deepEqual((await ownMatkaWallet(f.tenant, f.player.id, tx)).data, [{ walletType: 'CASH', label: 'Main wallet', balance: 350, currency: 'INR' }])
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5', 400)]), tx), /Insufficient available balance/)
    for (const walletType of ['BONUS', 'REFERRAL_BONUS']) await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry()], { walletType }), tx), /Credit players use the main wallet/)
    assert.equal(await f.balance(), 500)
    assert.equal((await tx.select().from(tables.matkaBets).where(eq(tables.matkaBets.tenant, f.tenant))).length, 0)
    const placed = await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5', 350)]), tx)
    assert.equal(placed.balance, 0); assert.equal(await f.balance(), 150); assert.equal(await f.balance('exposure'), 150)
    assert.equal((await ownMatkaWallet(f.tenant, f.player.id, tx)).data[0].balance, 0)
  })
})
test('a Matka bet placed before chips (wallet type credit) refunds, settles and reverses on the cash wallet', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx, 'worli', 'WHITELABEL_CREDIT')
    await tx.update(tables.wallets).set({ cash: '1000', bonus: '0', referralBonus: '0' }).where(eq(tables.wallets.id, f.wallet.id))
    // Migration 0019 took open credit stakes off the opening chips, so a legacy open bet looks like
    // a cash bet whose stake is already taken: 1000 - 2 x 100 = 800.
    const placed = await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5', 100), f.entry('single', '6', 100)]), tx)
    await tx.update(tables.matkaBets).set({ walletType: 'credit' }).where(eq(tables.matkaBets.batchId, placed.batchId))
    assert.equal(await f.balance(), 800)
    const six = placed.bets.find((bet: any) => bet.betNumbers === '6')!, five = placed.bets.find((bet: any) => bet.betNumbers === '5')!
    await voidAndRefundMatkaBet(tx, six.id, 'Isolated legacy refund', f.operator)
    assert.equal(await f.balance(), 900)
    const result = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: '2026-10-25', type: 'open', result: '267' }, f.operator)
    assert.deepEqual(result.impact, { betsSettled: 1, winners: 1, totalPayout: 900 }); assert.equal(await f.balance(), 1800)
    await reverseMatkaResult(tx, { id: result.id, reason: 'Isolated legacy correction' }, f.operator)
    assert.equal(await f.balance(), 900)
    assert.equal((await tx.select().from(tables.matkaBets).where(eq(tables.matkaBets.id, five.id)))[0].status, 'active')
    await cashLedgerReconciles(tx, f.tenant)
  })
})
test('Starline, Jackpot and Satta AB/A/B use their own result/session rules', async t => {
  freeze(t)
  await rollback(async tx => {
    for (const kind of ['starline', 'jackpot', 'sattaMatka']) {
      const f = await seed(tx, kind), entries = kind === 'starline' ? [f.entry('single', '5')] : kind === 'jackpot' ? [f.entry('jodi', '02', 10, 'CLOSE')] : [f.entry('AB', '02', 10, 'CLOSE'), f.entry('A', '0', 10, 'CLOSE'), f.entry('B', '2', 10, 'CLOSE')]
      await placeMatkaEntries(f.player.id, f.tenant, f.input(entries), tx)
      const result = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: '2026-10-25', type: kind === 'starline' ? 'open' : 'close', result: kind === 'starline' ? '267' : '02' }, f.operator)
      assert.equal(result.impact.winners, entries.length)
    }
  })
})
test('tenant, account, feature, RG, suspension, amount and bid-percentage gates reject without movements', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx)
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant + '-foreign', f.input([f.entry()]), tx), /not found/)
    await tx.update(tables.users).set({ rgBlockedUntil: new Date('2099-01-01') }).where(eq(tables.users.id, f.player.id))
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry()]), tx), /responsible gambling/)
    await tx.update(tables.users).set({ rgBlockedUntil: null, matkaBetAllowed: false }).where(eq(tables.users.id, f.player.id))
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry()]), tx), /disabled/)
    await tx.update(tables.users).set({ matkaBetAllowed: true }).where(eq(tables.users.id, f.player.id))
    await tx.insert(tables.matkaBidRules).values({ tenant: f.tenant, matkaId: f.market.id, matkaType: 'worli', marketName: f.market.name, bidType: 'SINGLE', percentage: '10', includeAll: true })
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5'), f.entry('single', '6')]), tx), /percentage limit/)
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5', 0.001)]), tx), /decimal/)
    assert.equal(await f.balance(), 100000)
    assert.equal((await tx.select().from(tables.matkaBets).where(eq(tables.matkaBets.tenant, f.tenant))).length, 0)
  })
})
test('referral bonus and pinned Matka bonus balances settle and reverse in their original wallet', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx)
    const [campaign] = await tx.insert(tables.bonusCampaigns).values({ tenant: f.tenant, name: 'QA Matka bonus', domain: 'matka', type: 'direct_amount', status: 'active', currency: 'INR', distributionType: 'roll_over', rulesJson: {} }).returning()
    const [award] = await tx.insert(tables.bonusAwards).values({ userId: f.player.id, campaignId: campaign.id, domain: 'matka', type: 'direct_amount', status: 'active', amount: '10000', wageringReq: '100000', currentWagering: '0', distributionType: 'roll_over' }).returning()
    await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5', 100)], { walletType: 'BONUS' }), tx)
    await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5', 100)], { walletType: 'REFERRAL_BONUS' }), tx)
    const result = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: '2026-10-25', type: 'open', result: '267' }, f.operator)
    assert.equal(await f.balance('bonus'), 10800); assert.equal(await f.balance('referralBonus'), 10800); assert.equal(await f.balance(), 100000)
    assert.equal(moneyMinor((await tx.select().from(tables.bonusAwards).where(eq(tables.bonusAwards.id, award.id)))[0].currentWagering!), 10000n)
    await reverseMatkaResult(tx, { id: result.id, reason: 'qa' }, f.operator)
    assert.equal(await f.balance('bonus'), 9900); assert.equal(await f.balance('referralBonus'), 9900)
    assert.equal(Number((await tx.select().from(tables.bonusAwards).where(eq(tables.bonusAwards.id, award.id)))[0].currentWagering), 0)
  })
})
test('concurrent duplicate submissions debit once and concurrent different requests cannot overspend', async t => {
  freeze(t)
  const f = await db.transaction(async tx => {
    const fixture = await seed(tx); await tx.update(tables.wallets).set({ cash: '15' }).where(eq(tables.wallets.id, fixture.wallet.id)); return fixture
  })
  const input = f.input([f.entry()])
  const duplicate = await Promise.all([placeMatkaEntries(f.player.id, f.tenant, input), placeMatkaEntries(f.player.id, f.tenant, input)])
  assert.equal(duplicate[0].batchId, duplicate[1].batchId)
  const outcomes = await Promise.allSettled([placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '6')])), placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '7')]))])
  assert.ok(outcomes.every(outcome => outcome.status === 'rejected'))
  assert.equal(Number((await db.select().from(tables.wallets).where(and(eq(tables.wallets.userId, f.player.id), eq(tables.wallets.tenant, f.tenant))))[0].cash), 5)
})

test('stale payout quotes, account changes, session pauses and configured exposure limits reject atomically', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx)
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry()], { quoteVersion: 'stale' }), tx), /rates changed/)
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry()], { accountId: 'different' }), tx), /Account changed/)
    await tx.update(tables.matkas).set({ settings: { ...f.market.settings as object, openSuspended: true } }).where(eq(tables.matkas.id, f.market.id))
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry()]), tx), /closed/)
    await tx.update(tables.matkas).set({ settings: f.market.settings, limits: { minBet: 10, maxBet: 10000, exposureCap: 80 } }).where(eq(tables.matkas.id, f.market.id))
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry()]), tx), /liability/)
    await tx.update(tables.matkas).set({ limits: { minBet: 10, maxBet: 10000, exposureDaily: 80 } }).where(eq(tables.matkas.id, f.market.id))
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry()]), tx), /Daily market exposure/)
    assert.equal(await f.balance(), 100000)
  })
})

test('an AGENT_CREDIT player wins, loses and voids on its own chips; its agent and the agent gates are untouched', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx, 'worli', 'AGENT_CREDIT')
    const [agent] = await tx.insert(tables.agents).values({ tenantId: f.tenant, schemeType: 'CREDIT', allowedDomains: ['matka'], status: 'ACTIVE', creditLimit: '20000', chipBalance: '5000' }).returning()
    await tx.insert(tables.agentHierarchyClosure).values({ ancestorId: agent.id, descendantId: agent.id, depth: 0 })
    await tx.update(tables.users).set({ agentId: agent.id }).where(eq(tables.users.id, f.player.id))
    await tx.insert(tables.agentPlayerCredits).values({ agentId: agent.id, playerId: f.player.id, creditLimit: '10000' })
    await tx.update(tables.wallets).set({ cash: '1000', bonus: '0', referralBonus: '0' }).where(eq(tables.wallets.id, f.wallet.id))
    const read = async () => ({
      player: creditFigures((await tx.select().from(tables.users).where(eq(tables.users.id, f.player.id)))[0]),
      agent: creditFigures((await tx.select().from(tables.agents).where(eq(tables.agents.id, agent.id)))[0]),
      mirror: creditFigures((await tx.select().from(tables.agentPlayerCredits).where(eq(tables.agentPlayerCredits.playerId, f.player.id)))[0]),
      whitelabel: creditFigures((await tx.select().from(tables.whitelabels).where(eq(tables.whitelabels.id, f.tenant)))[0]),
    })
    const before = await read()
    const won = await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5', 100)]), tx)
    const lost = await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '4', 200)]), tx)
    const voided = await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '3', 50)]), tx)
    assert.equal(await f.balance(), 650)
    await voidAndRefundMatkaBet(tx, voided.bets[0].id, 'Isolated credit refund', f.operator)
    assert.equal(await f.balance(), 700)
    const result = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: '2026-10-25', type: 'open', result: '267' }, f.operator)
    assert.deepEqual(result.impact, { betsSettled: 2, winners: 1, totalPayout: 900 }); assert.equal(await f.balance(), 1600)
    const status = async (id: string) => (await tx.select().from(tables.matkaBets).where(eq(tables.matkaBets.id, id)))[0].status
    assert.equal(await status(won.bets[0].id), 'won'); assert.equal(await status(lost.bets[0].id), 'lost'); assert.equal(await status(voided.bets[0].id), 'void')
    // P/L stays on the player's chips: the agent's chips and settlement figures, its per-player
    // mirror, the whitelabel and the player's retired credit figures do not move.
    assert.deepEqual(await read(), before)
    await reverseMatkaResult(tx, { id: result.id, reason: 'Isolated credit correction' }, f.operator)
    assert.equal(await f.balance(), 700)
    assert.deepEqual(await read(), before)
    await cashLedgerReconciles(tx, f.tenant)
    // The agent betting gate and the agent's domains still apply to credit players.
    await tx.update(tables.agents).set({ allowedDomains: ['sports'] }).where(eq(tables.agents.id, agent.id))
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '2', 10)]), tx), /betting is not available for your account/)
    await tx.update(tables.agents).set({ allowedDomains: ['matka'], status: 'SUSPENDED' }).where(eq(tables.agents.id, agent.id))
    await assert.rejects(placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '2', 10)]), tx), /Betting is suspended/)
    assert.equal(await f.balance(), 700)
  })
})

test('a released bonus blocks rollback without partially reversing result, wallet or wagering', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx)
    const [campaign] = await tx.insert(tables.bonusCampaigns).values({ tenant: f.tenant, name: 'QA release guard', domain: 'matka', type: 'direct_amount', status: 'active', currency: 'INR', distributionType: 'roll_over', rulesJson: {} }).returning()
    const [award] = await tx.insert(tables.bonusAwards).values({ userId: f.player.id, campaignId: campaign.id, domain: 'matka', type: 'direct_amount', status: 'active', amount: '10000', wageringReq: '100000', currentWagering: '0', distributionType: 'roll_over' }).returning()
    await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry()], { walletType: 'BONUS' }), tx)
    const result = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: '2026-10-25', type: 'open', result: '267' }, f.operator)
    await tx.update(tables.bonusAwards).set({ status: 'completed', completedAt: new Date() }).where(eq(tables.bonusAwards.id, award.id))
    const before = await f.balance('bonus')
    await assert.rejects(reverseMatkaResult(tx, { id: result.id, reason: 'QA' }, f.operator), /Bonus funds were released/)
    assert.equal(await f.balance('bonus'), before)
    assert.equal((await tx.select().from(tables.matkaResults).where(eq(tables.matkaResults.id, result.id)))[0].rolledBackAt, null)
  })
})

test('Lock Now and Close Now stop new entries at once, also on sessions locked before the status was written', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx)
    await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5', 10, 'OPEN'), f.entry('single', '5', 10, 'CLOSE')]), tx)
    const session = async (side: 'OPEN' | 'CLOSE') => (await tx.select().from(tables.matkaWorliInstances).where(and(eq(tables.matkaWorliInstances.marketId, f.market.id), eq(tables.matkaWorliInstances.side, side))))[0]
    const stoppedAt = new Date(clock.getTime() - 1000), open = await session('OPEN'), close = await session('CLOSE')
    const place = (session: 'OPEN' | 'CLOSE') => placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '6', 10, session)]), tx)
    // What lockNowWorliInstance and closeNowWorliInstance write (admin-backend matka-worli mutations).
    await tx.update(tables.matkaWorliInstances).set({ status: 'LOCKED', actualLockAtUtc: stoppedAt }).where(eq(tables.matkaWorliInstances.id, open.id))
    await tx.update(tables.matkaWorliInstances).set({ status: 'CLOSED', actualLockAtUtc: stoppedAt, actualCloseAtUtc: stoppedAt }).where(eq(tables.matkaWorliInstances.id, close.id))
    await assert.rejects(place('OPEN'), /Open betting is closed/)
    await assert.rejects(place('CLOSE'), /Close betting is closed/)
    // Sessions stopped by the old Lock Now / Close Now kept status OPEN with only the stamp: the stamp alone blocks.
    await tx.update(tables.matkaWorliInstances).set({ status: 'OPEN' }).where(eq(tables.matkaWorliInstances.marketId, f.market.id))
    await assert.rejects(place('OPEN'), /Open betting is closed/)
    await assert.rejects(place('CLOSE'), /Close betting is closed/)
    // Pause still works the same way, and a cleared session takes entries again.
    await tx.update(tables.matkaWorliInstances).set({ status: 'PAUSED', actualLockAtUtc: null, actualCloseAtUtc: null }).where(eq(tables.matkaWorliInstances.id, open.id))
    await assert.rejects(place('OPEN'), /Open betting is closed/)
    await tx.update(tables.matkaWorliInstances).set({ status: 'OPEN' }).where(eq(tables.matkaWorliInstances.id, open.id))
    await place('OPEN')
    assert.equal(await f.balance(), 100000 - 30)
  })
})

// Owner, 2026-11-04: a session whose result was ever declared never takes entries again, as players may have seen the
// result. A rollback re-locks only a session row that exists (shared/src/matka/settlement.ts), a session gets its row only
// from an accepted entry or the admin start, and a result can be declared before the close: so an early result rolled
// back on a session without a row left the clock alone to decide, and entries were accepted again.
test('a session whose result was declared and rolled back refuses entries with or without its row, and the lobby agrees', async t => {
  freeze(t)
  await rollback(async tx => {
    const f = await seed(tx)
    // The lobby read (readService) goes through db: here it reads inside this transaction.
    t.mock.method(db, 'select', tx.select.bind(tx))
    const sides = async () => (await tx.select().from(tables.matkaWorliInstances).where(eq(tables.matkaWorliInstances.marketId, f.market.id))).map((row: any) => row.side).sort()
    const lobby = async () => (await playerMatkaMarket(f.tenant, f.market.id)).data!
    const place = (entry: any) => placeMatkaEntries(f.player.id, f.tenant, f.input([entry]), tx)
    // Open declared at 04:00, long before its 11:45 cutoff, then rolled back: no session row exists, so none was re-locked.
    const early = await declareAndSettleMatka(tx, { matkaId: f.market.id, date: '2026-10-25', type: 'open', result: '267' }, f.operator)
    await reverseMatkaResult(tx, { id: early.id, reason: 'Isolated early declaration' }, f.operator)
    assert.deepEqual(await sides(), [])
    // Open entries are refused, and Jodi and both Sangams too, whose entry deadline is the Open one.
    for (const entry of [f.entry('single', '5'), f.entry('single-patti', '267'), f.entry('jodi', '58', 10, 'CLOSE'), f.entry('half-sangam', '5-279', 10, 'CLOSE'), f.entry('full-sangam', '267-279', 10, 'CLOSE')]) {
      await assert.rejects(place(entry), /Open betting is closed/, entry.bidType)
    }
    // The lobby's flags say the same, and the rolled-back result is not shown.
    const shown = await lobby()
    assert.deepEqual(shown.sessions.map((session: any) => [session.side, session.accepting]), [['OPEN', false], ['CLOSE', true]])
    assert.deepEqual([shown.status, shown.result.openResult], ['Open', null])
    // The Close session, never declared, still takes entries; the entry creates its row only.
    await place(f.entry('single', '8', 10, 'CLOSE'))
    assert.deepEqual(await sides(), ['CLOSE']); assert.equal(await f.balance(), 100000 - 10)
    // An Open row created afterwards, OPEN by status (as an entry or the admin start creates it), changes nothing.
    await ensureMatkaInstance(tx, f.market, matkaSchedule(f.market, new Date()), 'open')
    assert.deepEqual(await sides(), ['CLOSE', 'OPEN'])
    await assert.rejects(place(f.entry('single', '5')), /Open betting is closed/)
    assert.equal((await lobby()).sessions[0].accepting, false)
    // Only this whitelabel's results count: another one's row for the same market, date and side does not shut Close.
    await tx.insert(tables.matkaResults).values({ tenant: f.tenant + '-foreign', matkaId: f.market.id, date: '2026-10-25', type: 'close', result: '279', declaredBy: 'qa', rolledBackAt: new Date(), rolledBackBy: 'qa', rollbackReason: 'qa' })
    await place(f.entry('single', '9', 10, 'CLOSE'))
    assert.equal((await lobby()).sessions[1].accepting, true); assert.equal(await f.balance(), 100000 - 20)
  })
})

test('a close-only session whose result was declared and rolled back refuses entries; a session with a row and no result takes them', async t => {
  freeze(t)
  await rollback(async tx => {
    // Jackpot declares Close only: its one session is shut the same way.
    const jackpot = await seed(tx, 'jackpot')
    const declared = await declareAndSettleMatka(tx, { matkaId: jackpot.market.id, date: '2026-10-25', type: 'close', result: '02' }, jackpot.operator)
    await reverseMatkaResult(tx, { id: declared.id, reason: 'Isolated early declaration' }, jackpot.operator)
    await assert.rejects(placeMatkaEntries(jackpot.player.id, jackpot.tenant, jackpot.input([jackpot.entry('jodi', '02', 10, 'CLOSE')]), tx), /Close betting is closed/)
    assert.equal(await jackpot.balance(), 100000)
    // A session whose row exists and that never had a result takes entries as before.
    const f = await seed(tx)
    await ensureMatkaInstance(tx, f.market, matkaSchedule(f.market, new Date()), 'open')
    await placeMatkaEntries(f.player.id, f.tenant, f.input([f.entry('single', '5')]), tx)
    assert.equal(await f.balance(), 100000 - 10)
  })
})
