/**
 * The players list (listUsersDb, getPlayersListStatsDb) and support admin creation, on the isolated QA database
 * (tmp/domain-visibility-integration-fixtures.ts), each test inside a transaction that is rolled back.
 *
 *   - "Regular players" lists REGULAR players only, on the All tab as on the Direct tab (players/PLA-13);
 *   - staff accounts (users holding a role in the tenant) are neither listed nor counted (system/SYS-07);
 *   - an all-digit query finds the player with that id (PLA-11), a 2-character query filters (PLA-12);
 *   - an unparseable registration date is an error, not an empty list (PLA-20);
 *   - a duplicate support admin e-mail gets a plain message, not the Postgres detail (system/SYS-10).
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/repos/users/__tests__/playersListFilters.integration.test.ts
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../db/client.js')
const { listUsersDb, getPlayersListStatsDb, createAdminUser } = await import('../usersRepo.js')
test.before(() => guard(pool))
test.after(async () => { await pool.end() })
test.afterEach(() => mock.restoreAll())

const ids = (rows: any[]) => rows.map((r) => Number(r.id)).sort((a, b) => a - b)

test('player type, staff accounts, id search, short queries and dates on the players list', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx)
    const sharingAgent = await f.agent('SHARING'), commissionAgent = await f.agent('COMMISSION'), creditAgent = await f.agent('CREDIT')
    const regular = await f.player('REGULAR'), wlCredit = await f.player('WHITELABEL_CREDIT')
    const sharing = await f.player('SHARING_AGENT_PLAYER', sharingAgent), commission = await f.player('COMMISSION_AGENT_PLAYER', commissionAgent), agentCredit = await f.player('AGENT_CREDIT', creditAgent)
    // A support admin on a role whose name does not contain "admin".
    const staff = await f.player('REGULAR')
    const [role] = await tx.insert(t.roles).values({ tenant: f.tenant, name: 'vfyfix Finance Manager' }).returning()
    await tx.insert(t.userRoles).values({ tenant: f.tenant, userId: staff.id, roleId: role.id })
    await f.flags(regular.id, { name: 'vfyfix Zebra Quill' })
    routeDbToTransaction(mock, db, tx)

    const all = await listUsersDb({}, f.tenant)
    assert.deepEqual(ids(all), ids([regular, wlCredit, sharing, commission, agentCredit]), 'every player, and not the staff account')
    assert.deepEqual(ids(await listUsersDb({ playerType: 'REGULAR' }, f.tenant)), [regular.id], '"Regular players" is REGULAR only')
    assert.deepEqual(ids(await listUsersDb({ playerType: 'REGULAR', parentType: 'DIRECT' }, f.tenant)), [regular.id])
    assert.deepEqual(ids(await listUsersDb({ playerType: 'WHITELABEL_CREDIT' }, f.tenant)), [wlCredit.id])

    const stats = await getPlayersListStatsDb({}, f.tenant)
    assert.equal(stats.totalPlayers, 5, 'the staff account is not counted')
    assert.equal((await getPlayersListStatsDb({ playerType: 'REGULAR' }, f.tenant)).totalPlayers, 1)
    const paged = await listUsersDb({}, f.tenant, { limit: 10, offset: 0, returnWithTotal: true })
    assert.equal(paged.total, 5)

    assert.deepEqual(ids(await listUsersDb({ query: String(commission.id) }, f.tenant)), [commission.id], 'an id finds its player')
    assert.deepEqual(ids(await listUsersDb({ query: 'zq' }, f.tenant)), [], 'a 2-character query that matches nobody returns nobody')
    assert.deepEqual(ids(await listUsersDb({ query: 'Zq' }, f.tenant)), [], 'case-insensitive, still nobody')
    assert.deepEqual(ids(await listUsersDb({ query: 'Ze' }, f.tenant)), [regular.id], 'a 2-character query filters')

    await assert.rejects(listUsersDb({ registeredFrom: 'not-a-date' }, f.tenant), { message: 'Invalid registeredFrom date: not-a-date' })
    await assert.rejects(listUsersDb({ registeredTo: '2026-13-45' }, f.tenant), { message: 'Invalid registeredTo date: 2026-13-45' })
    assert.equal((await listUsersDb({ registeredFrom: '2020-01-01' }, f.tenant)).length, 5)
    mock.restoreAll()
  })
})

test('a support admin with an e-mail that is already used gets a plain message', async () => {
  await rollback(db, async tx => {
    const f = await fixture(tx)
    routeDbToTransaction(mock, db, tx)
    await createAdminUser({ tenant: f.tenant, name: 'vfyfix Staff One', email: 'vfyfix.staff@example.test', password: 'vfyfix-Passw0rd' })
    await assert.rejects(
      createAdminUser({ tenant: f.tenant, name: 'vfyfix Staff Two', email: 'vfyfix.staff@example.test', password: 'vfyfix-Passw0rd' }),
      { message: 'An account with this e-mail already exists' },
    )
    mock.restoreAll()
  })
})
