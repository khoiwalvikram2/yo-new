/**
 * Matka management fixes against the isolated Matka QA database, each test inside a transaction that is
 * rolled back: bid rules accept the nulls the settings page sends, a duplicate name or code is named (never
 * the SQL and its parameters), a clone picks a free name, a drag in a filtered list keeps every other market
 * in place, and the live KPIs report what the open bets would pay.
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../../db/client.js')
const { matkaMutationResolvers } = await import('../mutations.js')
const { matkaQueryResolvers } = await import('../queries.js')
const { createMatkaDb, updateMatkaDb, cloneMatkaDb, reorderMatkasDb, softDeleteMatkaDb } = await import('../../../../repos/matka/matkaRepo.js')
const { getMatkaLiveDashboard } = await import('../../../../repos/matka/matkaAnalyticsRepo.js')
const { closeRedisEmitter } = await import('../../../../realtime/redisPubsub.js')
// An audit write publishes through the Redis emitter, whose socket would otherwise keep the process alive.
test.before(() => guard(pool)); test.after(async () => { await closeRedisEmitter().catch(() => {}); await pool.end() }); test.afterEach(() => mock.restoreAll())

const config = (name: string, extra: Record<string, unknown> = {}) => ({
  name, code: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), timezone: 'Asia/Kolkata', status: 'active' as const,
  schedule: { openTime: '10:00', closeTime: '23:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }, settings: { matkaType: 'worli' }, limits: { minBet: 10, maxBet: 10000 }, visibility: {}, ...extra,
})
const unique = () => randomUUID().slice(0, 8)
const noSql = (message: string) => assert.doesNotMatch(message, /Failed query|params:|insert into|update "matkas"/i)

test('bid rules take the nulls the settings page sends for an empty session and notes', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx), market = await createMatkaDb(config('Bid QA ' + unique()), f.tenant)
    const ctx = { tenant: f.tenant, user: { sub: '7' }, permissions: [{ domain: 'matka.management', actions: ['view', 'update'] }] }
    // What bidRuleInput (admin matkaManagementModel) sends: every empty optional field as null.
    const input = { matkaId: market.id, matkaType: 'worli', marketName: market.name, marketSession: null, bidType: 'SINGLE', percentage: 50, includeAll: true,
      includedPlayers: { playerIds: [] }, minStake: null, maxStake: null, exposureCap: null, status: 'active', notes: null }
    const created = await matkaMutationResolvers.createMatkaBidRule(null, { input }, ctx)
    assert.equal(created.matkaId, market.id); assert.equal(created.marketSession, null); assert.equal(created.notes, null)
    const updated = await matkaMutationResolvers.updateMatkaBidRule(null, { id: created.id, patch: { status: 'inactive', marketSession: null, notes: null } }, ctx)
    assert.equal(updated.status, 'inactive')
    // A real refusal still says why.
    await assert.rejects(matkaMutationResolvers.createMatkaBidRule(null, { input: { ...input, percentage: 150 } }, ctx), /between 0 and 100/)
  })
})

test('a duplicate name or code is named, also when a deleted matka holds it, and never echoes the SQL', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx), id = unique()
    const market = await createMatkaDb(config('Dup QA ' + id), f.tenant)
    const refusal = async (attempt: Promise<unknown>, expected: string) => {
      const error = await attempt.then(() => null, (failure: Error) => failure)
      assert.ok(error, 'refused'); assert.equal(error.message, expected); noSql(error.message)
    }
    await refusal(createMatkaDb(config('Other QA ' + id, { code: market.code }), f.tenant), 'A matka with this code already exists')
    await refusal(createMatkaDb(config(market.name, { code: 'other-qa-' + id }), f.tenant), 'A matka with this name already exists')
    await softDeleteMatkaDb(market.id, 'qa', f.tenant)
    await refusal(createMatkaDb(config('Third QA ' + id, { code: market.code }), f.tenant), 'A matka with this code already exists (a deleted matka still holds it)')
    // A rename onto another matka's name reaches the unique index itself (updateMatkaDb runs in a savepoint here).
    const a = await createMatkaDb(config('Rename A ' + id), f.tenant), b = await createMatkaDb(config('Rename B ' + id), f.tenant)
    await refusal(updateMatkaDb({ id: b.id, name: a.name }, f.tenant), 'A matka with this name already exists')
    // A message thrown on purpose still passes through.
    await assert.rejects(updateMatkaDb({ id: b.id, limits: { minBet: 100, maxBet: 10 } }, f.tenant), /Maximum stake/)
  })
})

test('cloning again, or after the clone was deleted, picks the next free name and code', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx), source = await createMatkaDb(config('Clone QA ' + unique()), f.tenant)
    const asked = { name: `${source.name} Copy`, code: `${source.code}-copy` }
    const first = await cloneMatkaDb(source.id, asked, f.tenant)
    assert.deepEqual([first.name, first.code], [asked.name, asked.code])
    const second = await cloneMatkaDb(source.id, asked, f.tenant)
    assert.deepEqual([second.name, second.code], [`${asked.name} 2`, `${asked.code}-2`])
    await softDeleteMatkaDb(second.id, 'qa', f.tenant)
    const third = await cloneMatkaDb(source.id, asked, f.tenant)
    assert.deepEqual([third.name, third.code], [`${asked.name} 3`, `${asked.code}-3`])
  })
})

test('a drag in a searched or paged list keeps every other market in place and leaves no shared priority', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx), id = unique()
    const make = (name: string, priority: number) => createMatkaDb(config(`${name} ${id}`, { priority }), f.tenant)
    const p = await make('vfy P', 0), k = await make('KALYAN', 1), q = await make('vfy Q', 1), m = await make('MILAN', 2), s = await make('SRIDEVI', 3)
    const other = await fixture(tx), foreign = await createMatkaDb(config('Foreign ' + id), other.tenant)
    const order = async () => (await tx.select({ id: t.matkas.id, priority: t.matkas.priority }).from(t.matkas).where(eq(t.matkas.tenant, f.tenant)))
      .sort((left: any, right: any) => left.priority - right.priority)
    const name = new Map([[p.id, 'P'], [k.id, 'K'], [q.id, 'Q'], [m.id, 'M'], [s.id, 'S']])
    // Searching "vfy" shows P then Q; Q is dragged above P and the page numbers its two rows 1..2.
    await reorderMatkasDb([{ id: q.id, priority: 1 }, { id: p.id, priority: 2 }, { id: foreign.id, priority: 3 }], f.tenant)
    let rows = await order()
    assert.deepEqual(rows.map((row: any) => name.get(row.id)), ['Q', 'K', 'P', 'M', 'S'], 'Q and P swap the places they held; KALYAN keeps its own')
    assert.deepEqual(rows.map((row: any) => row.priority), [1, 2, 3, 4, 5])
    // A later page (M, S) swapped: only those two trade places.
    await reorderMatkasDb([{ id: s.id, priority: 1 }, { id: m.id, priority: 2 }], f.tenant)
    rows = await order()
    assert.deepEqual(rows.map((row: any) => name.get(row.id)), ['Q', 'K', 'P', 'S', 'M'])
    assert.equal((await tx.select().from(t.matkas).where(eq(t.matkas.id, foreign.id)))[0].priority, 0, 'another whitelabel is untouched')
  })
})

test('the live KPIs report what the open bets would pay; payouts stay on settled wins', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx), player = await f.player(), market = await createMatkaDb(config('Live QA ' + unique()), f.tenant)
    const bet = (extra: Record<string, unknown>) => tx.insert(t.matkaBets).values({ tenant: f.tenant, whitelabelId: f.tenant, userId: player.id, matkaId: market.id, matkaType: 'worli', marketName: market.name,
      marketSession: 'open', bidType: 'SINGLE', betNumbers: '5', betAmount: '10', payoutMultiplier: '9', potentialWin: '90', status: 'active', currency: 'INR', runDate: '2026-11-03', ...extra })
    await bet({}); await bet({ betAmount: '100', potentialWin: '900', status: 'pending' })
    await bet({ potentialWin: null, betAmount: '20' }) // a legacy bet without a stored potential win pays stake x rate
    await bet({ status: 'won', actualWin: '90' }); await bet({ status: 'void' })
    const { kpis } = await getMatkaLiveDashboard({ tenant: f.tenant, whitelabelId: f.tenant })
    assert.equal(kpis.wagered, 130); assert.equal(kpis.payouts, 0)
    assert.equal(kpis.potentialPayouts, 90 + 900 + 180)
  })
})

// MAT-13 follow-up: the byMatka and bySession breakdowns had no potential payouts, so their Exposure equalled Wagered.
test('the byMatka and bySession breakdowns report what their open bets would pay, and add up to the KPI tile', async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx), player = await f.player()
    const a = await createMatkaDb(config('Live A ' + unique()), f.tenant), b = await createMatkaDb(config('Live B ' + unique()), f.tenant)
    const bet = (market: any, extra: Record<string, unknown>) => tx.insert(t.matkaBets).values({ tenant: f.tenant, whitelabelId: f.tenant, userId: player.id, matkaId: market.id, matkaType: 'worli', marketName: market.name,
      marketSession: 'open', bidType: 'SINGLE', betNumbers: '5', betAmount: '10', payoutMultiplier: '9', potentialWin: '90', status: 'active', currency: 'INR', runDate: '2026-11-03', ...extra })
    await bet(a, {}); await bet(a, { betAmount: '100', potentialWin: '900', status: 'pending', marketSession: 'close' })
    await bet(a, { potentialWin: null, betAmount: '20' }) // a legacy bet without a stored potential win pays stake x rate
    await bet(b, { betAmount: '50', potentialWin: '450', marketSession: 'close' })
    await bet(a, { status: 'won', actualWin: '90' }); await bet(b, { status: 'void', potentialWin: '9000' }) // not open bets
    const { kpis, breakdown } = await getMatkaLiveDashboard({ tenant: f.tenant, whitelabelId: f.tenant })
    assert.deepEqual(Object.fromEntries(breakdown.byMatka.map(row => [row.matkaId, row.potentialPayouts])), { [a.id]: 90 + 900 + 180, [b.id]: 450 })
    assert.deepEqual(Object.fromEntries(breakdown.bySession.map(row => [row.marketSession, row.potentialPayouts])), { open: 90 + 180, close: 900 + 450 })
    const sum = (rows: Array<{ potentialPayouts?: number }>) => rows.reduce((total, row) => total + (row.potentialPayouts ?? 0), 0)
    assert.equal(kpis.potentialPayouts, 90 + 900 + 180 + 450)
    assert.equal(sum(breakdown.byMatka), kpis.potentialPayouts); assert.equal(sum(breakdown.bySession), kpis.potentialPayouts)
    // payouts and ggr stay on settled wins, so they are unchanged on open bets.
    for (const row of [...breakdown.byMatka, ...breakdown.bySession]) { assert.equal(row.payouts, 0); assert.equal(row.ggr, row.wagered) }
  })
})

// SYS-14 follow-up: matka(id) with an id that is not a uuid ('*' and 'bulk' reach it from the audit trail) threw
// INTERNAL_SERVER_ERROR, and the Matka Details page showed "Failed to load". It is now not found, as a missing uuid is.
test("matka(id) answers null for an id that cannot exist, and stays inside the caller's whitelabel", async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx), other = await fixture(tx), market = await createMatkaDb(config('Detail QA ' + unique()), f.tenant)
    const ctx = (tenant: string, permissions = [{ domain: 'matka.management', actions: ['view'] }]) =>
      ({ tenant, whitelabel: { id: tenant }, user: { sub: '7', roles: ['Whitelabel Admin'] }, permissions })
    const read = (id: string, tenant = f.tenant) => matkaQueryResolvers.matka(null, { id }, ctx(tenant))
    for (const id of ['*', 'bulk', '', '42', `${market.id}x`, ` ${market.id}`, "' OR '1'='1"]) assert.equal(await read(id), null, `matka(${JSON.stringify(id)})`)
    assert.equal(await read(randomUUID()), null, 'a well-formed uuid of no matka')
    assert.equal((await read(market.id))?.id, market.id)
    assert.equal((await read(market.id.toUpperCase()))?.id, market.id, 'an upper-case uuid still finds it')
    assert.equal(await read(market.id, other.tenant), null, "another whitelabel's matka is not found")
    // The permission check still comes first.
    await assert.rejects(matkaQueryResolvers.matka(null, { id: '*' }, ctx(f.tenant, [])), /Forbidden/)
  })
})

// The same for matkasByIds: getMatkasByIdsDb ran inArray on the uuid column, so one id that is not a uuid failed the
// whole list. Those ids are now left out before the read; the uuids still answer, in the caller's whitelabel only.
test("matkasByIds leaves out ids that are not uuids, and stays inside the caller's whitelabel", async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx), other = await fixture(tx)
    const market = await createMatkaDb(config('Ids QA ' + unique()), f.tenant), foreign = await createMatkaDb(config('Ids QA ' + unique()), other.tenant)
    const ctx = (tenant: string, permissions = [{ domain: 'matka.management', actions: ['view'] }]) =>
      ({ tenant, whitelabel: { id: tenant }, user: { sub: '7', roles: ['Whitelabel Admin'] }, permissions })
    const ids = async (matkaIds: string[], tenant = f.tenant) =>
      (await matkaQueryResolvers.matkasByIds(null, { matkaIds }, ctx(tenant))).map((m: any) => m.id).sort()
    assert.deepEqual(await ids(['*', 'bulk', '', '42', `${market.id}x`, ` ${market.id}`, "' OR '1'='1"]), [], 'only malformed ids: none, no error')
    assert.deepEqual(await ids(['bulk', market.id, '*', randomUUID()]), [market.id], 'the uuid among them still answers')
    assert.deepEqual(await ids([market.id.toUpperCase()]), [market.id], 'an upper-case uuid still finds it')
    assert.deepEqual(await ids([market.id, foreign.id]), [market.id], "another whitelabel's matka is not listed")
    assert.deepEqual(await ids([market.id, foreign.id], other.tenant), [foreign.id])
    // The permission check still comes first.
    await assert.rejects(matkaQueryResolvers.matkasByIds(null, { matkaIds: ['*'] }, ctx(f.tenant, [])), /Forbidden/)
  })
})

// SYS-22: recordAuditDb filed every matka audit row under 'default', so a whitelabel's own Audit Trail never showed them.
test("a whitelabel admin's matka changes are audited under its own tenant and user id", async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx)
    const ctx = { tenant: f.tenant, whitelabel: { id: f.tenant }, user: { sub: '7', roles: ['Whitelabel Admin'] },
      permissions: [{ domain: 'matka.management', actions: ['view', 'create', 'update'] }, { domain: 'matka.results', actions: ['create'] }] }
    const audited = async (resourceId: string, count: number) => {
      // The approval mutations audit after a fire-and-forget write, so wait for their rows.
      for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await tx.select().from(t.auditLogs).where(eq(t.auditLogs.resourceId, resourceId))
        if (rows.length >= count || attempt === 39) return rows.map((row: any) => [row.action, row.tenant, row.actorId]).sort()
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      return []
    }
    const { matka } = await matkaMutationResolvers.createMatka(null, { input: config('vfyho Audit ' + unique()) }, ctx)
    await matkaMutationResolvers.setMatkaStatus(null, { id: matka.id, toStatus: 'INACTIVE', reason: 'qa' }, ctx)
    assert.deepEqual(await audited(matka.id, 2), [['create', f.tenant, '7'], ['status', f.tenant, '7']])
    // It also used the literal actor 'admin' here (and 'approver' for approve and reject), whoever acted.
    const submitted = await matkaMutationResolvers.submitResultForApproval(null, { drawId: 'vfyho-draw-' + unique(), value: '123' }, ctx)
    assert.deepEqual(await audited(String(submitted.id), 1), [['submit', f.tenant, '7']])
  })
})

// E003: matkaBets never filled userName, so the /matka/live Players tab and Player Analytics listed every player as
// "User #746" instead of rakesh001. Each bet now names its player as the bets page does (name, else username), from one
// read for the whole page in the caller's whitelabel; a player not found there keeps userName null ("User #<id>").
test("matkaBets names each bet's player from one read for the page, in the caller's whitelabel only", async () => {
  await rollback(db, async tx => {
    routeDbToTransaction(mock, db, tx)
    const f = await fixture(tx), other = await fixture(tx), market = await createMatkaDb(config('Names QA ' + unique()), f.tenant)
    const named = await f.player(), usernameOnly = await f.player(), foreign = await other.player()
    await f.flags(named.id, { name: 'vfyho Rakesh', username: 'vfyho_rakesh001_' + unique() })
    await f.flags(usernameOnly.id, { name: '', username: 'vfyho_asha_' + unique() })
    const [{ username: ashaUsername }] = await tx.select().from(t.users).where(eq(t.users.id, usernameOnly.id))
    const bet = (userId: number, extra: Record<string, unknown> = {}) => tx.insert(t.matkaBets).values({ tenant: f.tenant, whitelabelId: f.tenant, userId, matkaId: market.id,
      matkaType: 'worli', marketName: market.name, marketSession: 'open', bidType: 'SINGLE', betNumbers: '5', betAmount: '10', payoutMultiplier: '9', potentialWin: '90',
      status: 'active', currency: 'INR', runDate: '2026-11-03', ...extra })
    await bet(named.id); await bet(named.id, { status: 'pending' }); await bet(usernameOnly.id)
    // A bet row of this whitelabel naming another whitelabel's player (the foreign key does not check the tenant): that
    // player's name is never read here.
    await bet(foreign.id)
    const ctx = { tenant: f.tenant, whitelabel: { id: f.tenant }, user: { sub: '7', roles: ['Whitelabel Admin'] }, permissions: [{ domain: 'matka.bets', actions: ['view'] }] }
    const list = async () => {
      const before = (db.select as any).mock.callCount()
      const rows = await matkaQueryResolvers.matkaBets(null, { query: { statuses: ['pending', 'active'], limit: 5000 } }, ctx)
      const names = new Map<number, Set<string | null>>()
      for (const row of rows) names.set(row.userId, (names.get(row.userId) ?? new Set()).add(row.userName))
      return { rows, names, reads: (db.select as any).mock.callCount() - before }
    }
    const first = await list()
    assert.equal(first.rows.length, 4)
    assert.deepEqual([...first.names.get(named.id)!], ['vfyho Rakesh'], 'the name, as the bets page shows it')
    assert.deepEqual([...first.names.get(usernameOnly.id)!], [ashaUsername], 'the username when there is no name')
    assert.deepEqual([...first.names.get(foreign.id)!], [null], "another whitelabel's player is not named")
    assert.equal(first.reads, 2, 'the bets, and one read of their players')
    for (let i = 0; i < 6; i++) await bet(named.id)
    const more = await list()
    assert.equal(more.rows.length, 10); assert.equal(more.reads, 2, 'still one read of the players, however many bets')
  })
})
