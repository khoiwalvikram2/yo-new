/**
 * The live dashboard's byMatka breakdown against the isolated Matka QA database, each test inside a transaction that
 * is rolled back. The /matka/live "Matka Analytics" card named markets by id ("Matka #4ac1da93") because matkaName
 * was always null (C101). Each row now names its market, the name is read only from the caller's own whitelabel,
 * and every figure (potentialPayouts included) is the one the row had before. The bySelection and byDigit
 * breakdowns (E004) come from the same open bets.
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { getMatkaLiveDashboard } = await import('../matkaAnalyticsRepo.js')
test.before(() => guard(pool)); test.after(() => pool.end()); test.afterEach(() => mock.restoreAll())

async function seed(tx: any) {
  const f = await fixture(tx), other = await fixture(tx), id = randomUUID().slice(0, 8)
  const market = async (tenant: string, name: string, extra: Record<string, unknown> = {}) => (await tx.insert(t.matkas).values({ tenant, name: `vfyho ${name} ${id}`,
    code: `vfyho-${name.toLowerCase()}-${id}`, timezone: 'Asia/Kolkata', status: 'active', schedule: { openTime: '10:00', closeTime: '23:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
    settings: { matkaType: 'worli' }, limits: { minBet: 10, maxBet: 10000 }, visibility: {}, ...extra }).returning())[0]
  const player = await f.player()
  const bet = (m: any, extra: Record<string, unknown> = {}) => tx.insert(t.matkaBets).values({ tenant: f.tenant, whitelabelId: f.tenant, userId: player.id, matkaId: m.id, matkaType: 'worli',
    marketName: m.name, marketSession: 'open', bidType: 'SINGLE', betNumbers: '5', betAmount: '10', payoutMultiplier: '9', potentialWin: '90', status: 'active', currency: 'INR', runDate: '2026-11-03', ...extra })
  return { ...f, other, market, bet }
}

test("byMatka names each market from the caller's whitelabel and keeps every figure, potentialPayouts included", async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx)
    const kalyan = await f.market(f.tenant, 'Kalyan'), milan = await f.market(f.tenant, 'Milan')
    // A deleted market's open bets still count in the tiles, so its row is still named.
    const gone = await f.market(f.tenant, 'Gone', { deletedAt: new Date() })
    // A bet row naming another whitelabel's market (the foreign key does not check the tenant): its figures count,
    // but that whitelabel's market name is never read.
    const foreign = await f.market(f.other.tenant, 'Foreign')
    await f.bet(kalyan); await f.bet(kalyan, { betAmount: '100', potentialWin: '900', status: 'pending', marketSession: 'close' })
    await f.bet(kalyan, { potentialWin: null, betAmount: '20' }) // a legacy bet without a stored potential win pays stake x rate
    await f.bet(milan, { betAmount: '50', potentialWin: '450', marketSession: 'close' })
    await f.bet(gone, { betAmount: '30', potentialWin: '270' })
    await f.bet(foreign, { betAmount: '40', potentialWin: '360' })
    await f.bet(kalyan, { status: 'won', actualWin: '90' }); await f.bet(milan, { status: 'void', potentialWin: '9000' }) // not open bets
    const { kpis, breakdown } = await getMatkaLiveDashboard({ tenant: f.tenant, whitelabelId: f.tenant })
    assert.deepEqual(breakdown.byMatka, [
      { matkaId: kalyan.id, matkaName: kalyan.name, wagered: 130, payouts: 0, ggr: 130, potentialPayouts: 90 + 900 + 180, bets: 3 },
      { matkaId: milan.id, matkaName: milan.name, wagered: 50, payouts: 0, ggr: 50, potentialPayouts: 450, bets: 1 },
      { matkaId: foreign.id, matkaName: null, wagered: 40, payouts: 0, ggr: 40, potentialPayouts: 360, bets: 1 },
      { matkaId: gone.id, matkaName: gone.name, wagered: 30, payouts: 0, ggr: 30, potentialPayouts: 270, bets: 1 },
    ])
    // Still one row per market, adding up to the KPI tiles.
    assert.equal(kpis.wagered, 250); assert.equal(kpis.potentialPayouts, 1170 + 450 + 360 + 270)
    assert.equal(breakdown.byMatka.reduce((total, row) => total + (row.potentialPayouts ?? 0), 0), kpis.potentialPayouts)
    assert.equal(breakdown.byMatka.reduce((total, row) => total + row.bets, 0), 8 - 2, 'every open bet, none of the settled or void ones')
  })
})

test("an agent's live view names the markets of its own players' bets", async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), kalyan = await f.market(f.tenant, 'Kalyan'), milan = await f.market(f.tenant, 'Milan')
    const agent = await f.agent('CREDIT'), own = await f.player('AGENT_CREDIT', agent)
    await f.bet(kalyan, { userId: own.id, betAmount: '60', potentialWin: '540' })
    await f.bet(milan) // the whitelabel's own player: not in the agent's view
    const { breakdown } = await getMatkaLiveDashboard({ tenant: f.tenant, whitelabelId: f.tenant, agentId: agent.id })
    assert.deepEqual(breakdown.byMatka, [{ matkaId: kalyan.id, matkaName: kalyan.name, wagered: 60, payouts: 0, ggr: 60, potentialPayouts: 540, bets: 1 }])
  })
})

// E004 (matka/MAT-13 follow-up): byDigit and bySelection were hard-coded empty, so Digit Analytics, the Digit Heatmap,
// Digit Frequency and the Selection Risk card could never show data. Both now come from the open bets the tiles read.
test('bySelection and byDigit come from the open bets: exposure is the payout above the stake, floored at 0', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx)
    const kalyan = await f.market(f.tenant, 'Kalyan'), milan = await f.market(f.tenant, 'Milan')
    const satta = await f.market(f.tenant, 'Satta', { settings: { matkaType: 'sattaMatka' } }), foreign = await f.market(f.other.tenant, 'Foreign')
    const open = (m: any, bidType: string, betNumbers: string, betAmount: string, potentialWin: string | null, extra: Record<string, unknown> = {}) =>
      f.bet(m, { bidType, betNumbers, betAmount, potentialWin, ...extra })
    await open(kalyan, 'SINGLE', '5', '10', '90'); await open(kalyan, 'SINGLE', '5', '10', '90', { status: 'pending' })
    await open(kalyan, 'SINGLE', '5', '100', '900', { marketSession: 'close' }) // the same digit in another session is its own selection
    await open(kalyan, 'SINGLE', '7', '20', null) // a legacy bet without a stored potential win pays stake x rate (9)
    await open(kalyan, 'Single Digit', ' 7 ', '10', '95') // an older spelling of the same bid, placed on digit 7
    await open(kalyan, 'SINGLE', '12', '10', '90') // not one digit: a selection, but on no digit
    await open(kalyan, 'JODI', '57', '10', '900', { marketSession: 'close' })
    await open(kalyan, 'SINGLE_PANNA', '123', '10', '1500')
    await open(kalyan, 'HALF_SANGAM', '5-259', '10', '1000', { marketSession: 'close' })
    await open(milan, 'SINGLE', '5', '30', '270')
    await open(milan, 'SINGLE', '3', '10', '5') // pays less than its stake: no exposure, never a negative one
    await open(satta, 'A', '4', '10', '90', { matkaType: 'sattaMatka', marketSession: 'close' })
    await open(satta, 'B', '4', '20', '180', { matkaType: 'sattaMatka', marketSession: 'close' })
    await open(foreign, 'SINGLE', '9', '40', '360') // this whitelabel's bet on a market row of another: counted, name not read
    // Not open bets, and not this whitelabel's: none of them count.
    await open(kalyan, 'SINGLE', '5', '10', '90', { status: 'won', actualWin: '90' }); await open(kalyan, 'SINGLE', '5', '10', '9000', { status: 'void' })
    await tx.insert(t.matkaBets).values({ tenant: f.other.tenant, whitelabelId: f.other.tenant, userId: (await f.other.player()).id, matkaId: foreign.id, matkaType: 'worli',
      marketName: foreign.name, marketSession: 'open', bidType: 'SINGLE', betNumbers: '5', betAmount: '500', payoutMultiplier: '9', potentialWin: '4500', status: 'active', currency: 'INR', runDate: '2026-11-03' })

    const { kpis, breakdown } = await getMatkaLiveDashboard({ tenant: f.tenant, whitelabelId: f.tenant })
    const row = (m: any, session: string, bidType: string, selection: string, wagered: number, exposure: number, bets = 1) =>
      ({ selection, matkaId: m.id, matkaName: m === foreign ? null : m.name, marketName: m.name, marketSession: session, bidType, wagered, payouts: 0, exposure, bets })
    // Riskiest first; ties by stake, then bets, then market, session, bid and selection.
    assert.deepEqual(breakdown.bySelection, [
      row(kalyan, 'open', 'SINGLE_PANNA', '123', 10, 1490),
      row(kalyan, 'close', 'HALF_SANGAM', '5-259', 10, 990),
      row(kalyan, 'close', 'JODI', '57', 10, 890),
      row(kalyan, 'close', 'SINGLE', '5', 100, 800),
      row(foreign, 'open', 'SINGLE', '9', 40, 320),
      row(milan, 'open', 'SINGLE', '5', 30, 240),
      row(kalyan, 'open', 'SINGLE', '5', 20, 160, 2),
      row(kalyan, 'open', 'SINGLE', '7', 20, 160),
      row(satta, 'close', 'B', '4', 20, 160),
      row(kalyan, 'open', 'Single Digit', ' 7 ', 10, 85),
      row(kalyan, 'open', 'SINGLE', '12', 10, 80),
      row(satta, 'close', 'A', '4', 10, 80),
      row(milan, 'open', 'SINGLE', '3', 10, 0),
    ])
    // Every digit of the bets placed on one digit (Single Digit, A and B), over all markets and sessions. A Jodi, Pana,
    // Sangam or a Single on "12" is on no single digit, so none of them is split across digits.
    assert.deepEqual(breakdown.byDigit, [
      { digit: '3', wagered: 10, payouts: 0, exposure: 0, bets: 1 },
      { digit: '4', wagered: 30, payouts: 0, exposure: 240, bets: 2 },
      { digit: '5', wagered: 150, payouts: 0, exposure: 1350 - 150, bets: 4 },
      { digit: '7', wagered: 30, payouts: 0, exposure: 180 + 95 - 30, bets: 2 },
      { digit: '9', wagered: 40, payouts: 0, exposure: 320, bets: 1 },
    ])
    // The same open bets the tiles count: the selections add up to the KPI tile, and byMatka / bySession are untouched.
    const sum = (rows: Array<{ wagered: number; bets: number }>, key: 'wagered' | 'bets') => rows.reduce((total, r) => total + r[key], 0)
    assert.equal(sum(breakdown.bySelection, 'wagered'), kpis.wagered); assert.equal(sum(breakdown.bySelection, 'bets'), 14)
    assert.equal(sum(breakdown.bySelection, 'wagered'), sum(breakdown.byMatka, 'wagered'))
    assert.equal(breakdown.byMatka.reduce((total, r) => total + (r.potentialPayouts ?? 0), 0), kpis.potentialPayouts)
    // G502: under 200 selections the totals are the rows' own sums.
    assert.deepEqual(breakdown.selectionTotals, { selections: 13, wagered: kpis.wagered, payouts: 0, exposure: 1490 + 990 + 890 + 800 + 320 + 240 + 160 * 3 + 85 + 80 * 2, bets: 14 })
  })
})

test("an agent's selections and digits are its own players' open bets only", async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), kalyan = await f.market(f.tenant, 'Kalyan')
    const agent = await f.agent('CREDIT'), own = await f.player('AGENT_CREDIT', agent)
    await f.bet(kalyan, { userId: own.id, betNumbers: '2', betAmount: '60', potentialWin: '540' })
    await f.bet(kalyan, { betNumbers: '2', betAmount: '10', potentialWin: '90' }) // the whitelabel's own player: not the agent's
    await f.bet(kalyan, { betNumbers: '8' })
    const { breakdown } = await getMatkaLiveDashboard({ tenant: f.tenant, whitelabelId: f.tenant, agentId: agent.id })
    assert.deepEqual(breakdown.bySelection, [{ selection: '2', matkaId: kalyan.id, matkaName: kalyan.name, marketName: kalyan.name, marketSession: 'open', bidType: 'SINGLE',
      wagered: 60, payouts: 0, exposure: 480, bets: 1 }])
    assert.deepEqual(breakdown.byDigit, [{ digit: '2', wagered: 60, payouts: 0, exposure: 480, bets: 1 }])
    assert.deepEqual(breakdown.selectionTotals, { selections: 1, wagered: 60, payouts: 0, exposure: 480, bets: 1 })
  })
})

test('bySelection keeps the 200 riskiest selections; byDigit still counts every digit bet beyond them', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), kalyan = await f.market(f.tenant, 'Kalyan'), player = await f.player()
    const base = { tenant: f.tenant, whitelabelId: f.tenant, userId: player.id, matkaId: kalyan.id, matkaType: 'worli' as const, marketName: kalyan.name, marketSession: 'open',
      payoutMultiplier: '9', status: 'active' as const, currency: 'INR', runDate: '2026-11-03' }
    // 205 Pana selections that each pay 1000 on 10, then ten digit bets that are less risky than any of them.
    await tx.insert(t.matkaBets).values(Array.from({ length: 205 }, (_, i) => ({ ...base, bidType: 'SINGLE_PANNA', betNumbers: `p${i}`, betAmount: '10', potentialWin: '1000' })))
    await tx.insert(t.matkaBets).values(Array.from({ length: 10 }, (_, digit) => ({ ...base, bidType: 'SINGLE', betNumbers: String(digit), betAmount: '10', potentialWin: '90' })))
    const { kpis, breakdown } = await getMatkaLiveDashboard({ tenant: f.tenant, whitelabelId: f.tenant })
    assert.equal(breakdown.bySelection.length, 200)
    assert.ok(breakdown.bySelection.every((s) => s.bidType === 'SINGLE_PANNA' && s.exposure === 990), 'the riskiest are kept')
    assert.deepEqual(breakdown.byDigit.map((d) => [d.digit, d.bets, d.exposure]), Array.from({ length: 10 }, (_, digit) => [String(digit), 1, 80]))
    assert.equal(kpis.wagered, 2150, 'the tiles still count every open bet')
    // G502: the Selection Risk card's totals count all 215 selections, not the 200 rows sent (which held 198,000 of exposure).
    assert.deepEqual(breakdown.selectionTotals, { selections: 215, wagered: 2150, payouts: 0, exposure: 205 * 990 + 10 * 80, bets: 215 })
    assert.equal(breakdown.bySelection.reduce((total, s) => total + s.exposure, 0), 200 * 990)
  })
})
