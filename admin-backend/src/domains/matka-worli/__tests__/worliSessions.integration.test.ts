/**
 * Worli session controls and reads against the isolated Matka QA database, each test inside a transaction
 * that is rolled back. Lock Now / Close Now must stop betting (the status players are gated on), the reads
 * must show the status players get (clock, suspend override, operator stamps), agents and a Super Admin in
 * core mode are refused, and the worst outcome is worked out from the open book.
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
import { matkaSchedule, worliSessionStatus } from '@shared/matka/schedule.js'
import { deriveAgentPermissions } from '@/domains/agents/services/AgentPermissionsService.js'
import { UNLOCK_CLOSE_PASSED, UNLOCK_NOT_STOPPED, UNLOCK_RESULT_DECLARED, UNLOCK_RESULT_WAS_DECLARED, UNLOCK_SESSION_CHANGED } from '../services/sessionUnlock.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { worliQueryResolvers, SELECT_WHITELABEL_FOR_WORLI, WORLI_DATE_INVALID, WORLI_USER_ID_INVALID } = await import('../resolvers/queries.js')
const { worliMutationResolvers } = await import('../resolvers/mutations.js')
const { worliSubscriptionResolvers } = await import('../resolvers/subscriptions.js')
const { worliStatusSql } = await import('../../../repos/matka-worli/worliInstancesRepo.js')
const { listBetsByInstanceWithFilters } = await import('../../../repos/matka/matkaBetsRepo.js')
const { createMatkaResult, rollbackMatkaResult } = await import('../../../repos/matka/matkaResultsRepo.js')
const { publishWorliSessionView } = await import('../services/sessionView.js')
const { matkaMutationResolvers } = await import('../../matka/resolvers/mutations.js')
test.before(() => guard(pool)); test.afterEach(() => mock.restoreAll())
// Unlock's audit row opens the Redis emitter (recordAuditDb), which would keep the file running.
test.after(async () => {
  const { closeRedisEmitter } = await import('../../../realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
  await pool.end()
})

const HOUR = 3600000
const at = (offsetMs: number) => new Date(Date.now() + offsetMs)
async function seed(tx: any) {
  const f = await fixture(tx)
  const market = async (extra: any = {}) => (await tx.insert(t.matkas).values({ tenant: f.tenant, name: 'KALYAN QA ' + randomUUID().slice(0, 6), code: 'kalyan-qa-' + randomUUID().slice(0, 8), timezone: 'Asia/Kolkata', status: 'active',
    schedule: { openTime: '10:00', closeTime: '23:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }, settings: { matkaType: 'worli' }, limits: { minBet: 10, maxBet: 10000 }, visibility: {}, ...extra }).returning())[0]
  const session = async (marketRow: any, extra: any = {}) => (await tx.insert(t.matkaWorliInstances).values({ marketId: marketRow.id, runDate: '2026-11-03', side: 'OPEN', status: 'OPEN',
    scheduledOpenAtUtc: at(-3 * HOUR), scheduledLockAtUtc: at(HOUR), scheduledCloseAtUtc: at(2 * HOUR), totalStakeMinor: 0n, exposureTotalMinor: 0n, betCount: 0, ...extra }).returning())[0]
  const published: any[] = []
  const ctx: any = { tenant: f.tenant, user: { sub: '7', type: 'admin', roles: ['Whitelabel Admin'] }, permissions: [{ domain: 'matka.worli', actions: ['view', 'update'] }],
    pubsub: { publish: (message: any) => published.push(message), subscribe: async () => ({}) } }
  return { ...f, market, session, ctx, published }
}
const row = async (tx: any, id: string) => (await tx.select().from(t.matkaWorliInstances).where(eq(t.matkaWorliInstances.id, id)))[0]

test('Lock Now and Close Now write the status players are gated on, keep their stamps, and refuse to undo each other', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market(), session = await f.session(market)
    const lock = await worliMutationResolvers.lockNowWorliInstance(null, { id: session.id, reason: 'qa lock' }, f.ctx)
    assert.deepEqual(lock, { success: true, message: 'Locked' })
    const locked = await row(tx, session.id)
    assert.equal(locked.status, 'LOCKED'); assert.ok(locked.actualLockAtUtc)
    assert.equal((await worliQueryResolvers.worliInstance(null, { id: session.id }, f.ctx)).status, 'LOCKED')
    assert.equal(f.published.at(-1).payload.worliInstanceUpdated.status, 'LOCKED')
    assert.deepEqual(await worliMutationResolvers.lockNowWorliInstance(null, { id: session.id, reason: 'again' }, f.ctx), { success: true, message: 'Already locked' })
    // Pausing a locked session would let Resume reopen it.
    assert.equal((await worliMutationResolvers.pauseWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx)).success, false)
    assert.equal((await row(tx, session.id)).status, 'LOCKED')
    assert.deepEqual(await worliMutationResolvers.closeNowWorliInstance(null, { id: session.id, reason: 'qa close' }, f.ctx), { success: true, message: 'Closed' })
    const closed = await row(tx, session.id)
    assert.equal(closed.status, 'CLOSED'); assert.ok(closed.actualCloseAtUtc); assert.equal(closed.actualLockAtUtc.getTime(), locked.actualLockAtUtc.getTime())
    assert.deepEqual(await worliMutationResolvers.closeNowWorliInstance(null, { id: session.id, reason: 'again' }, f.ctx), { success: true, message: 'Already closed' })
    assert.deepEqual(await worliMutationResolvers.lockNowWorliInstance(null, { id: session.id, reason: 'late' }, f.ctx), { success: false, message: 'Session is already closed' })
    assert.equal((await worliMutationResolvers.resumeWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx)).message, 'Not paused')
    // Close Now on an open session locks it at the same moment.
    const other = await f.session(market, { side: 'CLOSE' })
    await worliMutationResolvers.closeNowWorliInstance(null, { id: other.id, reason: 'qa' }, f.ctx)
    const both = await row(tx, other.id)
    assert.equal(both.status, 'CLOSED'); assert.equal(both.actualLockAtUtc.getTime(), both.actualCloseAtUtc.getTime())
    const actions = (await tx.select().from(t.matkaActivityLogs).where(eq(t.matkaActivityLogs.instanceId, session.id))).map((log: any) => log.action)
    assert.deepEqual(actions.sort(), ['CLOSE_NOW', 'LOCK_NOW'])
  })
})

// G501 (owner, 2026-11-04): Unlock undoes Lock Now / Close Now before the result and the scheduled close. The bet path
// gates on matkaSchedule over the stored session (user-backend betService.ts), so the check runs it on the row as stored.
test('Unlock reopens a session Lock Now or Close Now stopped: its status back, both stamps cleared, betting accepted again', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market(), session = await f.session(market, { side: 'CLOSE' })
    // Noon tomorrow in the market's zone: inside the Close session's betting window (lock 22:50), and after the stamps.
    const noon = new Date(new Date().toISOString().slice(0, 10) + 'T06:30:00.000Z')
    noon.setUTCDate(noon.getUTCDate() + 1)
    const accepting = async () => matkaSchedule(market, noon, [await row(tx, session.id)]).close.accepting
    assert.equal(await accepting(), true)
    assert.equal((await worliQueryResolvers.worliInstance(null, { id: session.id }, f.ctx)).canUnlock, false)
    assert.deepEqual(await worliMutationResolvers.unlockWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx), { success: false, message: UNLOCK_NOT_STOPPED })

    await worliMutationResolvers.lockNowWorliInstance(null, { id: session.id, reason: 'qa lock' }, f.ctx)
    assert.equal(await accepting(), false, 'Lock Now stops betting')
    assert.equal((await worliQueryResolvers.worliInstance(null, { id: session.id }, f.ctx)).canUnlock, true)
    // A reason is required, as the page's prompt requires one.
    for (const reason of ['', '   ', null]) assert.deepEqual(await worliMutationResolvers.unlockWorliInstance(null, { id: session.id, reason }, f.ctx), { success: false, message: 'A reason is required to unlock a session' })
    assert.deepEqual(await worliMutationResolvers.unlockWorliInstance(null, { id: session.id, reason: 'locked by mistake' }, f.ctx), { success: true, message: 'Unlocked' })
    const unlocked = await row(tx, session.id)
    assert.deepEqual([unlocked.status, unlocked.actualLockAtUtc, unlocked.actualCloseAtUtc], ['OPEN', null, null])
    assert.equal(await accepting(), true, 'betting is accepted again')
    const view = await worliQueryResolvers.worliInstance(null, { id: session.id }, f.ctx)
    assert.deepEqual([view.status, view.canUnlock], ['OPEN', false])
    assert.deepEqual([f.published.at(-1).payload.worliInstanceUpdated.status, f.published.at(-1).payload.worliInstanceUpdated.canUnlock], ['OPEN', false])
    // The audit row is filed under the session's whitelabel, and the activity log names the unlock.
    const audit = await tx.select().from(t.auditLogs).where(eq(t.auditLogs.resourceId, session.id))
    assert.deepEqual(audit.map((entry: any) => [entry.tenant, entry.domain, entry.action, entry.resourceType, entry.actorId]), [[f.tenant, 'matka.worli', 'unlock', 'worli_instance', '7']])
    const activity = await tx.select().from(t.matkaActivityLogs).where(eq(t.matkaActivityLogs.instanceId, session.id))
    const unlock = activity.find((log: any) => log.action === 'UNLOCK')
    assert.equal(unlock.reason, 'locked by mistake'); assert.equal(JSON.parse(unlock.metaJson).restoredStatus, 'OPEN')
    assert.deepEqual(await worliMutationResolvers.unlockWorliInstance(null, { id: session.id, reason: 'again' }, f.ctx), { success: false, message: UNLOCK_NOT_STOPPED })

    // Close Now (on its own, or after Lock Now) is undone the same way, and a session paused before the stop stays paused.
    await worliMutationResolvers.lockNowWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx)
    await worliMutationResolvers.closeNowWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx)
    assert.equal((await worliMutationResolvers.unlockWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx)).success, true)
    assert.deepEqual([(await row(tx, session.id)).status, await accepting()], ['OPEN', true])
    await worliMutationResolvers.pauseWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx)
    await worliMutationResolvers.closeNowWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx)
    assert.equal((await worliMutationResolvers.unlockWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx)).success, true)
    assert.deepEqual([(await row(tx, session.id)).status, await accepting()], ['PAUSED', false])
    await worliMutationResolvers.resumeWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx)
    assert.equal(await accepting(), true)

    // A result rollback leaves the session LOCKED with no stamp (shared/src/matka/settlement.ts). Close Now on it, then
    // Unlock, undoes only the Close Now: it stays LOCKED and betting stays closed (reviewer, G501). Here the session is
    // LOCKED with no result row behind it; after a real rollback Unlock is refused outright (H401, tested below).
    await tx.update(t.matkaWorliInstances).set({ status: 'LOCKED' }).where(eq(t.matkaWorliInstances.id, session.id))
    assert.equal(await accepting(), false)
    assert.deepEqual(await worliMutationResolvers.closeNowWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx), { success: true, message: 'Closed' })
    assert.equal((await worliMutationResolvers.unlockWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx)).success, true)
    const relocked = await row(tx, session.id)
    assert.deepEqual([relocked.status, relocked.actualLockAtUtc, relocked.actualCloseAtUtc, await accepting()], ['LOCKED', null, null, false])
  })
})

test('Unlock is refused after the result is declared or the scheduled close, and changes nothing then', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market()
    const stopped = { status: 'LOCKED', actualLockAtUtc: at(-60000) }
    const declared = await f.session(market, { ...stopped, resultPublishedAtUtc: at(-1000) })
    const settled = await f.session(market, { ...stopped, side: 'CLOSE', status: 'SETTLED' })
    const pastClose = await f.session(market, { ...stopped, runDate: '2026-11-02', status: 'CLOSED', actualCloseAtUtc: at(-2 * HOUR), scheduledLockAtUtc: at(-2 * HOUR), scheduledCloseAtUtc: at(-HOUR) })
    for (const [session, message] of [[declared, UNLOCK_RESULT_DECLARED], [settled, UNLOCK_RESULT_DECLARED], [pastClose, UNLOCK_CLOSE_PASSED]] as const) {
      assert.deepEqual(await worliMutationResolvers.unlockWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx), { success: false, message })
      const after = await row(tx, session.id)
      assert.deepEqual([after.status, after.actualLockAtUtc?.getTime()], [session.status, session.actualLockAtUtc.getTime()])
    }
    assert.equal((await worliQueryResolvers.worliInstance(null, { id: pastClose.id }, f.ctx)).canUnlock, false)
    // Without matka.worli update it is refused before anything is read.
    assert.deepEqual(await worliMutationResolvers.unlockWorliInstance(null, { id: declared.id, reason: 'qa' }, { ...f.ctx, permissions: [{ domain: 'matka.worli', actions: ['view'] }] }), { success: false, message: 'Forbidden' })
    assert.equal((await tx.select().from(t.auditLogs).where(eq(t.auditLogs.tenant, f.tenant))).length, 0)
  })
})

// H401 (owner, 2026-11-04): Lock Now, then a result declared before the scheduled close, then that result rolled back, leaves
// the session LOCKED with the Lock Now's stamp and no published result, and Unlock reopened betting after players may have
// seen the result. A result declared for the session even once now refuses Unlock, and canUnlock says so on every read and
// push. Only that market, date and side count: the Close session and another day of the market still unlock.
test('Unlock is refused once a result was declared for the session, even after its rollback, and canUnlock agrees', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market()
    const session = await f.session(market), closeSide = await f.session(market, { side: 'CLOSE' }), otherDay = await f.session(market, { runDate: '2026-11-02' })
    const unlock = (id: string) => worliMutationResolvers.unlockWorliInstance(null, { id, reason: 'qa unlock' }, f.ctx)
    const canUnlock = async (id: string) => (await worliQueryResolvers.worliInstance(null, { id }, f.ctx)).canUnlock
    // 09:00 tomorrow in the market's zone: inside the Open session's betting window (lock 09:45), and after the stamps.
    const nineAm = new Date(new Date().toISOString().slice(0, 10) + 'T03:30:00.000Z')
    nineAm.setUTCDate(nineAm.getUTCDate() + 1)
    const accepting = async (id: string) => matkaSchedule(market, nineAm, [await row(tx, id)]).open.accepting
    for (const { id } of [session, closeSide, otherDay]) await worliMutationResolvers.lockNowWorliInstance(null, { id, reason: 'qa lock' }, f.ctx)
    assert.deepEqual([await canUnlock(session.id), await canUnlock(closeSide.id), await canUnlock(otherDay.id)], [true, true, true])

    const operator = { tenant: f.tenant, actorId: '7' }
    const declared = await createMatkaResult({ matkaId: market.id, date: '2026-11-03', type: 'open', result: '123' }, operator)
    assert.deepEqual(await unlock(session.id), { success: false, message: UNLOCK_RESULT_DECLARED })
    await rollbackMatkaResult({ id: declared.id, reason: 'qa correction' }, operator)
    const rolledBack = await row(tx, session.id)
    assert.deepEqual([rolledBack.status, rolledBack.resultPublishedAtUtc, !!rolledBack.actualLockAtUtc], ['LOCKED', null, true])
    assert.equal(await accepting(session.id), false)

    assert.deepEqual(await unlock(session.id), { success: false, message: UNLOCK_RESULT_WAS_DECLARED })
    const after = await row(tx, session.id)
    assert.deepEqual([after.status, after.actualLockAtUtc?.getTime(), await accepting(session.id)], ['LOCKED', rolledBack.actualLockAtUtc.getTime(), false])
    // canUnlock is false on the session page's read, in the running list and in a pushed update (Close Now is still
    // allowed on it, and pushes one), so the page does not offer the button.
    assert.equal(await canUnlock(session.id), false)
    const listed = Object.fromEntries((await worliQueryResolvers.worliRunningInstances(null, { marketId: market.id }, f.ctx)).items.map((item: any) => [item.id, item.canUnlock]))
    assert.deepEqual([listed[session.id], listed[closeSide.id], listed[otherDay.id]], [false, true, true])
    assert.deepEqual(await worliMutationResolvers.closeNowWorliInstance(null, { id: session.id, reason: 'qa close' }, f.ctx), { success: true, message: 'Closed' })
    const pushed = f.published.at(-1).payload.worliInstanceUpdated
    assert.deepEqual([pushed.id, pushed.status, pushed.canUnlock], [session.id, 'CLOSED', false])
    assert.deepEqual(await unlock(session.id), { success: false, message: UNLOCK_RESULT_WAS_DECLARED })
    // Nothing was unlocked: no UNLOCK in its log, and no audit row for it.
    const actions = (await tx.select().from(t.matkaActivityLogs).where(eq(t.matkaActivityLogs.instanceId, session.id))).map((log: any) => log.action)
    assert.deepEqual(actions.sort(), ['CLOSE_NOW', 'LOCK_NOW'])
    assert.equal((await tx.select().from(t.auditLogs).where(eq(t.auditLogs.resourceId, session.id))).length, 0)

    // Never declared: the Close session of that day and the Open session of another day unlock, and take bets again.
    assert.deepEqual(await unlock(closeSide.id), { success: true, message: 'Unlocked' })
    assert.deepEqual(await unlock(otherDay.id), { success: true, message: 'Unlocked' })
    assert.deepEqual([(await row(tx, otherDay.id)).status, await accepting(otherDay.id)], ['OPEN', true])
  })
})

// A result declared or rolled back from the results page (admin-backend matka resolvers) pushes the session's open page its
// view: SETTLED on the declaration, its stored LOCKED after the rollback, and canUnlock false both times (owner, 2026-11-04).
// The rollback resolver also rebuilds reports through its own Redis client, so its push is checked on the helper it calls.
test('declaring a result and rolling it back push the session its view, with canUnlock false', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market(), session = await f.session(market)
    const view = () => f.published.filter((message: any) => message.topic === `WORLI_INSTANCE_${session.id}`).at(-1).payload.worliInstanceUpdated
    await worliMutationResolvers.lockNowWorliInstance(null, { id: session.id, reason: 'qa lock' }, f.ctx)
    assert.equal(view().canUnlock, true)
    const ctx = { ...f.ctx, permissions: [...f.ctx.permissions, { domain: 'matka.results', actions: ['create'] }] }
    const declared = await matkaMutationResolvers.createMatkaResult(null, { input: { matkaId: market.id, date: '2026-11-03', type: 'open', result: '123' } }, ctx)
    assert.equal(declared.success, true, declared.message)
    assert.deepEqual([view().status, view().canUnlock], ['SETTLED', false])
    await rollbackMatkaResult({ id: declared.result.id, reason: 'qa correction' }, { tenant: f.tenant, actorId: '7' })
    await publishWorliSessionView(f.ctx.pubsub, market.id, '2026-11-03', 'open')
    assert.deepEqual([view().status, view().canUnlock], ['LOCKED', false])
    // A market day with no session row has no page to push to: nothing is sent, and nothing fails.
    const sent = f.published.length
    await publishWorliSessionView(f.ctx.pubsub, market.id, '2026-11-02', 'open')
    assert.equal(f.published.length, sent)
  })
})

// H402: Unlock writes only while the session is still as it read it (the status, no published result, the stamps it
// clears, and no result ever declared). A change landing between its read and its write (run here just before the write)
// leaves no row to update: Unlock refuses, and writes, logs, audits and pushes nothing.
test('Unlock refuses and writes nothing when the session changed between its read and its write', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market(), instances = t.matkaWorliInstances
    // The resolver's only update is the guarded write: this runs the change first, then that write as it was built.
    const meanwhile = (change: () => Promise<unknown>) => (db.update as any).mock.mockImplementationOnce((table: any) => ({
      set: (values: any) => ({ where: (where: any) => ({ returning: async () => { await change(); return tx.update(table).set(values).where(where).returning() } }) }),
    }))
    const changes: Array<[string, (session: any, lockedAt: Date) => any, string]> = [
      ['a result declared', session => tx.update(instances).set({ status: 'SETTLED', resultValue: '123', resultPublishedAtUtc: new Date() }).where(eq(instances.id, session.id)), 'SETTLED'],
      ['Close Now by another operator', session => tx.update(instances).set({ status: 'CLOSED', actualCloseAtUtc: new Date() }).where(eq(instances.id, session.id)), 'CLOSED'],
      // Unlocked and locked again by another operator: the same status, a later stamp.
      ['another Unlock and Lock Now', (session, lockedAt) => tx.update(instances).set({ actualLockAtUtc: new Date(lockedAt.getTime() + 1000) }).where(eq(instances.id, session.id)), 'LOCKED'],
      // Declared and rolled back: the session row is back as it was, and the result row stays behind.
      ['a result declared and rolled back', session => tx.insert(t.matkaResults).values({ tenant: f.tenant, matkaId: market.id, date: session.runDate, type: 'open', result: '123',
        declaredBy: '7', rolledBackAt: new Date(), rolledBackBy: '7', rollbackReason: 'qa' }), 'LOCKED'],
    ]
    for (const [index, [label, change, status]] of changes.entries()) {
      const session = await f.session(market, { runDate: `2026-10-1${index}` })
      await worliMutationResolvers.lockNowWorliInstance(null, { id: session.id, reason: 'qa lock' }, f.ctx)
      const locked = await row(tx, session.id), pushed = f.published.length
      meanwhile(() => change(session, locked.actualLockAtUtc))
      assert.deepEqual(await worliMutationResolvers.unlockWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx), { success: false, message: UNLOCK_SESSION_CHANGED }, label)
      const after = await row(tx, session.id)
      assert.equal(after.status, status, label)
      assert.ok(after.actualLockAtUtc, `${label}: the stamp is kept`)
      const actions = (await tx.select().from(t.matkaActivityLogs).where(eq(t.matkaActivityLogs.instanceId, session.id))).map((log: any) => log.action)
      assert.deepEqual(actions, ['LOCK_NOW'], label)
      assert.equal((await tx.select().from(t.auditLogs).where(eq(t.auditLogs.resourceId, session.id))).length, 0, label)
      assert.equal(f.published.length, pushed, `${label}: nothing pushed`)
    }
    // With nothing in between, the same write unlocks, a stamp Postgres holds to the microsecond included (a Date holds
    // milliseconds, so the stamps are compared at that precision).
    const session = await f.session(market, { runDate: '2026-10-20' })
    await worliMutationResolvers.lockNowWorliInstance(null, { id: session.id, reason: 'qa lock' }, f.ctx)
    await tx.execute(sql`UPDATE matka_worli_instances SET actual_lock_at_utc = actual_lock_at_utc + interval '456 microseconds' WHERE id = ${session.id}`)
    assert.deepEqual(await worliMutationResolvers.unlockWorliInstance(null, { id: session.id, reason: 'qa' }, f.ctx), { success: true, message: 'Unlocked' })
    const unlocked = await row(tx, session.id)
    assert.deepEqual([unlocked.status, unlocked.actualLockAtUtc, unlocked.actualCloseAtUtc], ['OPEN', null, null])
  })
})

test('the reads show the status players get: past the lock LOCKED, past the close CLOSED, and the stamp of an old Lock Now', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market()
    const live = await f.session(market)
    const pastLock = await f.session(market, { runDate: '2026-11-02', scheduledLockAtUtc: at(-HOUR), scheduledCloseAtUtc: at(HOUR) })
    const pastClose = await f.session(market, { runDate: '2026-10-27', scheduledOpenAtUtc: at(-200 * HOUR), scheduledLockAtUtc: at(-150 * HOUR), scheduledCloseAtUtc: at(-149 * HOUR) })
    const oldLockNow = await f.session(market, { runDate: '2026-11-01', actualLockAtUtc: at(-60000) })
    const list = await worliQueryResolvers.worliRunningInstances(null, {}, f.ctx)
    const status = Object.fromEntries(list.items.map((item: any) => [item.id, item.status]))
    assert.deepEqual([status[live.id], status[pastLock.id], status[pastClose.id], status[oldLockNow.id]], ['OPEN', 'LOCKED', 'CLOSED', 'LOCKED'])
    // The status filter (the page's Live view asks for OPEN) uses the same rule.
    const open = await worliQueryResolvers.worliRunningInstances(null, { status: ['OPEN'] }, f.ctx)
    assert.deepEqual(open.items.map((item: any) => item.id), [live.id]); assert.equal(open.total, 1)
    assert.equal((await worliQueryResolvers.worliRunningInstances(null, { status: ['LOCKED'] }, f.ctx)).total, 2)
    assert.equal((await worliQueryResolvers.worliInstance(null, { id: pastClose.id }, f.ctx)).status, 'CLOSED')
  })
})

test('the SQL status used for filtering is the same rule as worliSessionStatus, case by case', async () => {
  await rollback(db, async tx => {
    const f = await seed(tx), market = await f.market(), now = new Date()
    const times = [
      { scheduledOpenAtUtc: at(HOUR), scheduledLockAtUtc: at(2 * HOUR), scheduledCloseAtUtc: at(3 * HOUR) },
      { scheduledOpenAtUtc: at(-HOUR), scheduledLockAtUtc: at(HOUR), scheduledCloseAtUtc: at(2 * HOUR) },
      { scheduledOpenAtUtc: at(-3 * HOUR), scheduledLockAtUtc: at(-HOUR), scheduledCloseAtUtc: at(HOUR) },
      { scheduledOpenAtUtc: at(-5 * HOUR), scheduledLockAtUtc: at(-3 * HOUR), scheduledCloseAtUtc: at(-HOUR) },
      // The suspend override moves the lock before now although the stored lock is still ahead.
      { scheduledOpenAtUtc: at(-HOUR), scheduledLockAtUtc: at(30 * 60000), scheduledCloseAtUtc: at(40 * 60000), suspendMinutesOverride: 60 },
    ]
    const stamps = [{}, { actualLockAtUtc: at(-60000) }, { actualCloseAtUtc: at(-60000) }, { actualLockAtUtc: at(HOUR) }]
    let day = 0
    for (const status of ['SCHEDULED', 'OPENING_SOON', 'OPEN', 'LOCKED', 'CLOSED', 'PAUSED', 'SETTLED', 'VOIDED']) for (const time of times) for (const stamp of stamps) {
      const runDate = new Date(Date.UTC(2001, 0, 1 + day++)).toISOString().slice(0, 10)
      await f.session(market, { runDate, status, ...time, ...stamp })
    }
    const rows = await tx.select({ inst: t.matkaWorliInstances, status: worliStatusSql(now) }).from(t.matkaWorliInstances).where(eq(t.matkaWorliInstances.marketId, market.id))
    assert.equal(rows.length, 8 * times.length * stamps.length)
    const describe = (inst: any) => JSON.stringify({ status: inst.status, open: inst.scheduledOpenAtUtc, lock: inst.scheduledLockAtUtc, close: inst.scheduledCloseAtUtc,
      override: inst.suspendMinutesOverride, lockedAt: inst.actualLockAtUtc, closedAt: inst.actualCloseAtUtc })
    for (const { inst, status } of rows) assert.equal(status, worliSessionStatus(inst, now), describe(inst))
  })
})

test('Adjust Suspend Minutes moves the stored lock with the players lock, counted from the close', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market(), session = await f.session(market)
    assert.equal((await worliMutationResolvers.adjustWorliSuspendMinutes(null, { id: session.id, minutes: 20, reason: 'qa' }, f.ctx)).success, true)
    await worliMutationResolvers.adjustWorliSuspendMinutes(null, { id: session.id, minutes: 20, reason: 'twice' }, f.ctx)
    const adjusted = await row(tx, session.id), lockAt = session.scheduledCloseAtUtc.getTime() - 20 * 60000
    assert.equal(adjusted.scheduledLockAtUtc.getTime(), lockAt)
    assert.equal(new Date((await worliQueryResolvers.worliInstance(null, { id: session.id }, f.ctx)).scheduledLockAt).getTime(), lockAt)
    // A session adjusted before this fix kept its stale stored lock; the read counts back from the close anyway.
    const stale = await f.session(market, { side: 'CLOSE', suspendMinutesOverride: 30 })
    assert.equal(new Date((await worliQueryResolvers.worliInstance(null, { id: stale.id }, f.ctx)).scheduledLockAt).getTime(), stale.scheduledCloseAtUtc.getTime() - 30 * 60000)
  })
})

test('agents and a Super Admin in core mode are refused on every Worli read, subscription and control', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market(), session = await f.session(market)
    const agent = await f.agent('SHARING')
    // An agent's flat matka:read reaches matka.worli:view through the nested mapping; that alone must not open Worli.
    const agentCtx: any = { ...f.ctx, user: { sub: agent.id, type: 'agent', agentId: agent.id }, permissions: deriveAgentPermissions(['matka'], 'SHARING') }
    const coreCtx: any = { ...f.ctx, tenant: 'default', user: { sub: '1', roles: ['Super Admin'] }, directorMode: 'core', permissions: [{ domain: 'all', actions: ['*'] }] }
    const reads = (ctx: any) => [
      worliQueryResolvers.worliRunningInstances(null, {}, ctx),
      ...(['worliInstance', 'worliBook', 'worliBets', 'worliActivity'] as const).map(name => (worliQueryResolvers[name] as any)(null, { id: session.id, instanceId: session.id, side: 'OPEN' }, ctx)),
      worliSubscriptionResolvers.worliInstanceUpdated.subscribe(null, { id: session.id }, ctx),
      worliSubscriptionResolvers.worliBetCreated.subscribe(null, { instanceId: session.id }, ctx),
    ]
    for (const read of reads(agentCtx)) await assert.rejects(read, /^Error: Forbidden$/)
    for (const read of reads(coreCtx)) await assert.rejects(read, new RegExp(SELECT_WHITELABEL_FOR_WORLI))
    for (const name of ['pauseWorliInstance', 'lockNowWorliInstance', 'closeNowWorliInstance', 'unlockWorliInstance'] as const) {
      assert.deepEqual(await worliMutationResolvers[name](null, { id: session.id, reason: 'qa' }, coreCtx), { success: false, message: SELECT_WHITELABEL_FOR_WORLI })
      assert.deepEqual(await worliMutationResolvers[name](null, { id: session.id, reason: 'qa' }, agentCtx), { success: false, message: 'Forbidden' })
    }
    assert.equal((await row(tx, session.id)).status, 'OPEN')
    // The whitelabel admin still reads it, and a Super Admin who selected the whitelabel too.
    assert.equal((await worliQueryResolvers.worliRunningInstances(null, {}, f.ctx)).total, 1)
    assert.equal((await worliQueryResolvers.worliRunningInstances(null, {}, { ...coreCtx, directorMode: 'whitelabel', directorWhitelabelId: f.tenant })).total, 1)
  })
})

test('the running list drops deleted markets and searches name or code case-insensitively', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), kept = await f.market({ name: 'KALYAN MORNING QA', code: 'kalyan-morning-qa' }), gone = await f.market({ name: 'KALYAN NIGHT QA', deletedAt: new Date() })
    await f.session(kept); await f.session(gone)
    const list = await worliQueryResolvers.worliRunningInstances(null, {}, f.ctx)
    assert.deepEqual(list.items.map((item: any) => item.marketId), [kept.id]); assert.equal(list.total, 1)
    for (const search of ['kalyan', 'KALYAN', 'Kalyan Morning', 'morning-qa']) assert.equal((await worliQueryResolvers.worliRunningInstances(null, { search }, f.ctx)).total, 1, search)
  })
})

test('the session page works out the worst outcome from the open book, and voiding answers for what it did', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market(), session = await f.session(market), player = await f.player()
    const bet = async (betNumbers: string, status = 'active') => (await tx.insert(t.matkaBets).values({ tenant: f.tenant, whitelabelId: f.tenant, userId: player.id, matkaId: market.id, matkaType: 'worli', marketName: market.name,
      marketSession: 'open', bidType: 'SINGLE', betNumbers, betAmount: '10', payoutMultiplier: '10', potentialWin: '100', status, currency: 'INR', instanceId: session.id, side: 'OPEN', selectionKey: betNumbers, runDate: '2026-11-03' }).returning())[0]
    for (const digit of ['4', '6', '1', '2']) await bet(digit)
    // 40 staked, 100 paid on whichever digit comes: -60.
    const counters = (await worliQueryResolvers.worliInstance(null, { id: session.id }, f.ctx)).counters
    assert.deepEqual([counters.worstOutcomeKey, counters.worstOutcomePlMinor], ['1', -6000])
    const won = await bet('7', 'won'), voided = await bet('8', 'void')
    assert.deepEqual(await worliMutationResolvers.voidMatkaBet(null, { id: voided.id, reason: 'qa' }, f.ctx), { success: true, message: 'Bet is already void' })
    assert.deepEqual(await worliMutationResolvers.voidMatkaBet(null, { id: won.id, reason: 'qa' }, f.ctx), { success: false, message: 'Rollback the settled result before voiding this bet' })
    const open = (await tx.select().from(t.matkaBets).where(eq(t.matkaBets.instanceId, session.id))).find((row: any) => row.betNumbers === '1')
    assert.deepEqual(await worliMutationResolvers.voidMatkaBet(null, { id: open.id, reason: 'qa' }, f.ctx), { success: true, message: 'Bet voided' })
    const after = (await worliQueryResolvers.worliInstance(null, { id: session.id }, f.ctx)).counters
    assert.deepEqual([after.worstOutcomeKey, after.worstOutcomePlMinor], ['2', 3000 - 10000])
  })
})

// C102: an id that is not a uuid reached Postgres, which refused it, so worliInstance, worliBets (and every other
// Worli read, subscription and control) answered INTERNAL_SERVER_ERROR. Such an id names no session, so it is not
// found before any lookup, as a uuid of no session is (matka(id) does the same); the refusals still come first.
test('an id that is not a uuid is not found on every Worli read, subscription and control, after the same refusals', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market(), session = await f.session(market)
    const reads = (id: string, ctx: any) => [
      ...(['worliInstance', 'worliBook', 'worliBets', 'worliActivity'] as const).map(name => (worliQueryResolvers[name] as any)(null, { id, instanceId: id, side: 'OPEN' }, ctx)),
      worliSubscriptionResolvers.worliInstanceUpdated.subscribe(null, { id }, ctx),
      worliSubscriptionResolvers.worliBetCreated.subscribe(null, { instanceId: id }, ctx),
    ]
    const controls = (id: string, ctx: any) => Promise.all([
      ...(['pauseWorliInstance', 'resumeWorliInstance', 'lockNowWorliInstance', 'closeNowWorliInstance', 'unlockWorliInstance'] as const).map(name => worliMutationResolvers[name](null, { id, reason: 'qa' }, ctx)),
      worliMutationResolvers.setWorliMarketMessage(null, { id, message: 'qa' }, ctx),
      worliMutationResolvers.adjustWorliSuspendMinutes(null, { id, minutes: 5, reason: 'qa' }, ctx),
    ])
    const notFound = Array(7).fill({ success: false, message: 'Not found' })
    for (const id of ['not-a-uuid', '*', 'bulk', '', '42', `${session.id}x`, ` ${session.id}`, "' OR '1'='1", randomUUID()]) {
      const label = JSON.stringify(id)
      for (const read of reads(id, f.ctx)) await assert.rejects(read, /^Error: Market session not found$/, label)
      assert.deepEqual(await controls(id, f.ctx), notFound, label)
      assert.deepEqual(await worliMutationResolvers.voidMatkaBet(null, { id, reason: 'qa' }, f.ctx), { success: false, message: 'Bet not found' }, label)
      // A market filter that names no market lists nothing (an empty one is no filter, as it always was).
      if (id !== '') assert.deepEqual(await worliQueryResolvers.worliRunningInstances(null, { marketId: id }, f.ctx), { items: [], total: 0 }, label)
    }
    assert.equal((await worliQueryResolvers.worliRunningInstances(null, { marketId: '' }, f.ctx)).total, 1)
    // An agent is still forbidden, and a Super Admin in core mode still asked to pick a whitelabel, whatever the id.
    const agent = await f.agent('SHARING')
    const agentCtx: any = { ...f.ctx, user: { sub: agent.id, type: 'agent', agentId: agent.id }, permissions: deriveAgentPermissions(['matka'], 'SHARING') }
    const coreCtx: any = { ...f.ctx, tenant: 'default', user: { sub: '1', roles: ['Super Admin'] }, directorMode: 'core', permissions: [{ domain: 'all', actions: ['*'] }] }
    for (const read of [...reads('not-a-uuid', agentCtx), worliQueryResolvers.worliRunningInstances(null, { marketId: 'x' }, agentCtx)]) await assert.rejects(read, /^Error: Forbidden$/)
    for (const read of [...reads('not-a-uuid', coreCtx), worliQueryResolvers.worliRunningInstances(null, { marketId: 'x' }, coreCtx)]) await assert.rejects(read, new RegExp(SELECT_WHITELABEL_FOR_WORLI))
    assert.deepEqual(await controls('not-a-uuid', agentCtx), Array(7).fill({ success: false, message: 'Forbidden' }))
    assert.deepEqual(await controls('not-a-uuid', coreCtx), Array(7).fill({ success: false, message: SELECT_WHITELABEL_FOR_WORLI }))
    // A real session is still found (an upper-case uuid too) and filtered by its market; another whitelabel's is not.
    assert.equal((await worliQueryResolvers.worliInstance(null, { id: session.id.toUpperCase() }, f.ctx)).id, session.id)
    assert.deepEqual((await worliQueryResolvers.worliRunningInstances(null, { marketId: market.id }, f.ctx)).items.map((item: any) => item.id), [session.id])
    const other = await fixture(tx), foreign = await f.session(await f.market({ tenant: other.tenant }))
    await assert.rejects(worliQueryResolvers.worliInstance(null, { id: foreign.id }, f.ctx), /^Error: Market session not found$/)
    assert.deepEqual(await worliMutationResolvers.pauseWorliInstance(null, { id: foreign.id, reason: 'qa' }, f.ctx), { success: false, message: 'Not found' })
    assert.equal((await row(tx, session.id)).status, 'OPEN'); assert.equal((await row(tx, foreign.id)).status, 'OPEN')
  })
})

// D101: worliRunningInstances handed its date to Postgres as it came, so a date the page never sends ("abc", a day no
// calendar has, year 0000) answered INTERNAL_SERVER_ERROR, and Postgres's own spellings ('today', 20261103) filtered.
// Only the page's yyyy-MM-dd of a real day filters; any other date is refused by name, after the permission, agent and
// core-mode refusals and before the market filter's empty answer. No date (absent, null or empty) is still no filter.
test('the running list filters only by a yyyy-MM-dd calendar date and refuses any other date by name, after the same refusals', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market({ name: 'vfyho D101 ' + randomUUID().slice(0, 6) }), session = await f.session(market)
    const list = (args: any, ctx: any = f.ctx) => worliQueryResolvers.worliRunningInstances(null, args, ctx)
    const refused = { name: 'Error', message: WORLI_DATE_INVALID }
    for (const date of ['abc', '2026-02-30', '2026-02-29', '1900-02-29', '2026-11-31', '2026-13-01', '2026-00-10', '2026-11-00', '0000-01-01', '2026-11-3', '26-11-03',
      '20261103', 'today', ' 2026-11-03', '2026-11-03 ', '2026-11-03T00:00:00Z', '2026/11/03', "2026-11-03' OR '1'='1", '２０２６-11-03']) {
      await assert.rejects(list({ date }), refused, JSON.stringify(date))
      await assert.rejects(list({ date, marketId: 'not-a-uuid' }), refused, JSON.stringify(date))
    }
    // The page's dates: the session's own day lists it; other real days (leap days, the calendar's ends) list nothing.
    assert.deepEqual((await list({ date: '2026-11-03' })).items.map((item: any) => item.id), [session.id])
    for (const date of ['2026-11-04', '2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) assert.deepEqual(await list({ date }), { items: [], total: 0 }, date)
    for (const args of [{}, { date: undefined }, { date: null }, { date: '' }]) assert.equal((await list(args)).total, 1, JSON.stringify(args))
    // Without the permission, as an agent, or as a Super Admin in core mode, the refusal is the one a real date gets.
    const agent = await f.agent('SHARING')
    const agentCtx: any = { ...f.ctx, user: { sub: agent.id, type: 'agent', agentId: agent.id }, permissions: deriveAgentPermissions(['matka'], 'SHARING') }
    const coreCtx: any = { ...f.ctx, tenant: 'default', user: { sub: '1', roles: ['Super Admin'] }, directorMode: 'core', permissions: [{ domain: 'all', actions: ['*'] }] }
    for (const date of ['abc', '2026-11-03']) {
      await assert.rejects(list({ date }, { ...f.ctx, permissions: [] }), /^Error: Forbidden$/, date)
      await assert.rejects(list({ date }, agentCtx), /^Error: Forbidden$/, date)
      await assert.rejects(list({ date }, coreCtx), new RegExp(SELECT_WHITELABEL_FOR_WORLI), date)
    }
    // Another whitelabel's session of the same day stays out.
    const other = await fixture(tx)
    await f.session(await f.market({ tenant: other.tenant, name: 'vfyho D101 other ' + randomUUID().slice(0, 6) }))
    assert.deepEqual((await list({ date: '2026-11-03' })).items.map((item: any) => item.id), [session.id])
  })
})

// D102: worliBets turned timeFrom / timeTo into dates unchecked, so "abc" answered the raw JS error "Invalid time value",
// and a time whose year Postgres cannot store (the lenient Date parser reads "99999" as year 99998) a server error. Such
// a bound is refused by name before any query, after the session's permission, agent, core-mode and not-found
// refusals; a real bound still filters, and a blank one is still no bound.
test('the bets list refuses a time bound that is not a date and time before any query, after the same refusals, and still filters', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market({ name: 'vfyho D102 ' + randomUUID().slice(0, 6) }), session = await f.session(market), player = await f.player()
    const [bet] = await tx.insert(t.matkaBets).values({ tenant: f.tenant, whitelabelId: f.tenant, userId: player.id, matkaId: market.id, matkaType: 'worli', marketName: market.name,
      marketSession: 'open', bidType: 'SINGLE', betNumbers: '4', betAmount: '10', payoutMultiplier: '10', potentialWin: '100', status: 'active', currency: 'INR', instanceId: session.id, side: 'OPEN',
      selectionKey: '4', runDate: '2026-11-03', createdAt: new Date('2026-11-03T10:00:00Z') }).returning()
    const bets = (filters: any, ctx: any = f.ctx, instanceId: string = session.id) => worliQueryResolvers.worliBets(null, { instanceId, filters }, ctx)
    const ids = async (filters: any) => (await bets(filters)).items.map((item: any) => item.id)
    for (const value of ['abc', 'not a time', '2026-13-01', '2026-11-03T25:00:00Z', '+010000-01-01T00:00:00Z', '0000-01-01T00:00:00Z', '-000001-01-01T00:00:00Z', '99999']) {
      for (const bound of ['timeFrom', 'timeTo']) {
        const label = `${bound} ${JSON.stringify(value)}`, refused = { name: 'Error', message: `${bound} is not a valid date and time` }
        await assert.rejects(bets({ [bound]: value }), refused, label)
        // The repo refuses it itself, before it queries: no select runs.
        const selects = (db.select as any).mock.callCount()
        await assert.rejects(listBetsByInstanceWithFilters(session.id, { [bound]: value }), refused, label)
        assert.equal((db.select as any).mock.callCount(), selects, `${label} queried`)
      }
    }
    // A real bound filters as before (the bet was placed at 10:00 UTC, 15:30 IST); a blank one is no bound.
    assert.deepEqual(await ids({ timeFrom: '2026-11-03T10:00:00Z', timeTo: '2026-11-03T10:00:00.000Z' }), [bet.id])
    assert.deepEqual(await ids({ timeFrom: '2026-11-03T15:29:59+05:30' }), [bet.id])
    assert.deepEqual(await ids({ timeFrom: '2026-11-03T10:00:01Z' }), [])
    assert.deepEqual(await ids({ timeTo: '2026-11-03T09:59:59Z' }), [])
    assert.deepEqual(await ids({ timeFrom: '2026-11-03', timeTo: '2026-11-04' }), [bet.id])
    assert.deepEqual(await ids({ timeFrom: ' 2026-11-03T10:00:00Z ' }), [bet.id])
    for (const blank of [undefined, null, '', '   ']) assert.deepEqual(await ids({ timeFrom: blank, timeTo: blank }), [bet.id], JSON.stringify(blank))
    // The refusals still come first, whatever the bound: no permission or an agent is forbidden, a Super Admin in core
    // mode is asked to pick a whitelabel, and an id of no session of this whitelabel is not found.
    const agent = await f.agent('SHARING')
    const agentCtx: any = { ...f.ctx, user: { sub: agent.id, type: 'agent', agentId: agent.id }, permissions: deriveAgentPermissions(['matka'], 'SHARING') }
    const coreCtx: any = { ...f.ctx, tenant: 'default', user: { sub: '1', roles: ['Super Admin'] }, directorMode: 'core', permissions: [{ domain: 'all', actions: ['*'] }] }
    const other = await fixture(tx), foreign = await f.session(await f.market({ tenant: other.tenant, name: 'vfyho D102 other ' + randomUUID().slice(0, 6) }))
    await assert.rejects(bets({ timeFrom: 'abc' }, { ...f.ctx, permissions: [] }), /^Error: Forbidden$/)
    await assert.rejects(bets({ timeFrom: 'abc' }, agentCtx), /^Error: Forbidden$/)
    await assert.rejects(bets({ timeTo: 'abc' }, coreCtx), new RegExp(SELECT_WHITELABEL_FOR_WORLI))
    for (const id of ['not-a-uuid', randomUUID(), foreign.id]) await assert.rejects(bets({ timeFrom: 'abc' }, f.ctx, id), /^Error: Market session not found$/, id)
  })
})

// E101: worliBets Number()ed its userId filter unchecked: "abc" became NaN, which the list read as no filter (every bet of
// the session came back), and "1.5" or "99999999999" reached Postgres, which refused them (INTERNAL_SERVER_ERROR). A
// filter that is not a whole number from 1 to 2147483647 is refused by name before the list is read, after the session's
// permission, agent, core-mode and not-found refusals; a real id still filters, and a blank one is still no filter.
test('the bets list refuses a player filter that is not a player id before reading, after the same refusals, and still filters', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await seed(tx), market = await f.market({ name: 'vfyho E101 ' + randomUUID().slice(0, 6) }), session = await f.session(market)
    const mine = await f.player(), theirs = await f.player()
    const place = async (player: any, betNumbers: string) => (await tx.insert(t.matkaBets).values({ tenant: f.tenant, whitelabelId: f.tenant, userId: player.id, matkaId: market.id,
      matkaType: 'worli', marketName: market.name, marketSession: 'open', bidType: 'SINGLE', betNumbers, betAmount: '10', payoutMultiplier: '10', potentialWin: '100', status: 'active',
      currency: 'INR', instanceId: session.id, side: 'OPEN', selectionKey: betNumbers, runDate: '2026-11-03' }).returning())[0]
    const a = await place(mine, '4'), b = await place(theirs, '6')
    const bets = (filters: any, ctx: any = f.ctx, instanceId: string = session.id) => worliQueryResolvers.worliBets(null, { instanceId, filters }, ctx)
    const ids = async (filters: any) => (await bets(filters)).items.map((item: any) => item.id).sort()
    const selects = async (run: () => Promise<unknown>) => {
      const before = (db.select as any).mock.callCount()
      await run().catch(() => {})
      return (db.select as any).mock.callCount() - before
    }
    const refused = { name: 'Error', message: WORLI_USER_ID_INVALID }
    for (const userId of ['abc', '1.5', '99999999999', '2147483648', '0', '00', '-1', '+1', '1e3', '0x10', '12abc', `${mine.id} OR 1=1`, 'NaN', 'Infinity',
      '١٢', '１２', '9'.repeat(400)]) {
      await assert.rejects(bets({ userId }), refused, JSON.stringify(userId))
    }
    // Refused before the list is read: the page and its count (two reads) never run, only the session lookup.
    assert.equal(await selects(() => bets({ userId: String(mine.id) })) - await selects(() => bets({ userId: 'abc' })), 2)
    // A real id filters (the ID type hands the resolver a string; spaces around it are allowed), and the largest id is a
    // filter like any other: nobody has it, so nothing is listed. A blank filter is no filter.
    assert.deepEqual(await ids({ userId: String(mine.id) }), [a.id])
    assert.deepEqual(await ids({ userId: ` ${theirs.id} ` }), [b.id])
    assert.deepEqual(await ids({ userId: '2147483647' }), [])
    for (const blank of [undefined, null, '', '   ']) assert.deepEqual(await ids({ userId: blank }), [a.id, b.id].sort(), JSON.stringify(blank))
    // The refusals still come first, whatever the filter: no permission or an agent is forbidden, a Super Admin in core
    // mode is asked to pick a whitelabel, and an id of no session of this whitelabel is not found.
    const agent = await f.agent('SHARING')
    const agentCtx: any = { ...f.ctx, user: { sub: agent.id, type: 'agent', agentId: agent.id }, permissions: deriveAgentPermissions(['matka'], 'SHARING') }
    const coreCtx: any = { ...f.ctx, tenant: 'default', user: { sub: '1', roles: ['Super Admin'] }, directorMode: 'core', permissions: [{ domain: 'all', actions: ['*'] }] }
    const other = await fixture(tx), foreign = await f.session(await f.market({ tenant: other.tenant, name: 'vfyho E101 other ' + randomUUID().slice(0, 6) }))
    await assert.rejects(bets({ userId: 'abc' }, { ...f.ctx, permissions: [] }), /^Error: Forbidden$/)
    await assert.rejects(bets({ userId: 'abc' }, agentCtx), /^Error: Forbidden$/)
    await assert.rejects(bets({ userId: '1.5' }, coreCtx), new RegExp(SELECT_WHITELABEL_FOR_WORLI))
    for (const id of ['not-a-uuid', randomUUID(), foreign.id]) await assert.rejects(bets({ userId: 'abc' }, f.ctx, id), /^Error: Market session not found$/, id)
  })
})
