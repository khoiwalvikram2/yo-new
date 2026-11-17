import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and } from 'drizzle-orm'
import { isolateDatabase, rollback, routeDbToTransaction, fixture, t, eq } from '../../../../../../tmp/domain-visibility-integration-fixtures.js'
const guard = isolateDatabase()
const { db, pool } = await import('../../../../db/client.js')
const { casinoResolvers } = await import('../index.js')
test.before(() => guard(pool))
test.after(async () => { await pool.end() })
test.afterEach(() => mock.restoreAll())

// Admin casino fixes of 2026-11-03, through the wrapped resolvers (map gate included) on the
// isolated QA database. Each test runs in a transaction that is rolled back.

const Query = casinoResolvers.Query as Record<string, (...a: any[]) => Promise<any>>
const Mutation = casinoResolvers.Mutation as Record<string, (...a: any[]) => Promise<any>>
/** A Whitelabel Admin holds the flat casino grants, which reach every nested casino.* permission they map to. */
const wlAdmin = (tenant: string) => ({ tenant, whitelabel: { id: tenant }, user: { sub: '1', roles: ['Whitelabel Admin'] }, permissions: [{ domain: 'casino', actions: ['read', 'write'] }] })
const superCore = () => ({ tenant: 'default', whitelabel: { id: 'default' }, user: { sub: '1', roles: ['Super Admin'] }, permissions: [{ domain: 'all', actions: ['*'] }], directorMode: 'core' })
const superIn = (tenant: string) => ({ tenant, whitelabel: { id: tenant }, user: { sub: '1', roles: ['Super Admin'] }, permissions: [{ domain: 'all', actions: ['*'] }], directorMode: 'whitelabel', directorWhitelabelId: tenant })

async function catalogue(tx: any) {
  const f = await fixture(tx)
  const others = ['casino-qa-b-' + randomUUID().slice(0, 8), 'casino-qa-c-' + randomUUID().slice(0, 8)]
  await tx.insert(t.whitelabels).values(others.map((id) => ({ id, name: 'Casino QA', domain: id + '.invalid' })))
  const [provider] = await tx.insert(t.casinoApiProviders).values({ key: 'qa-' + randomUUID(), name: 'Casino QA Provider' }).returning()
  const [vendor] = await tx.insert(t.casinoVendors).values({ name: 'Casino QA Vendor', slug: 'qa-' + randomUUID() }).returning()
  const games = await tx.insert(t.casinoGames).values(['Alpha', 'Bravo', 'Charlie'].map((name) => ({
    apiProviderId: provider.id, vendorId: vendor.id, mainCategory: 'slots' as const, externalId: randomUUID(), name: 'QA ' + name, slug: randomUUID(),
  }))).returning()
  routeDbToTransaction(mock, db, tx)
  return { f, tenants: [f.tenant, ...others], provider, vendor, games }
}

test('CAS-1: core mode lists each game once even when several whitelabels have settings rows', async () => {
  await rollback(db, async tx => {
    const c = await catalogue(tx)
    for (const tenantId of c.tenants) for (const game of c.games) {
      await tx.insert(t.whitelabelCasinoGameSettings).values({ tenantId, gameId: game.id, enabled: true, order: 1 })
    }
    const page = await Query.casinoGames(null, { input: { vendorId: String(c.vendor.id), category: 'SLOTS', page: 1, pageSize: 50 } }, superCore())
    assert.equal(page.total, 3)
    assert.deepEqual(page.items.map((g: any) => g.id).sort(), c.games.map((g: any) => g.id).sort(), 'three rows, one per game')
    assert.ok(page.items.every((g: any) => g.tenantEnabled == null && g.order == null), 'no single tenant value exists in core mode')
    // A whitelabel still sees its own settings.
    const own = await Query.casinoGames(null, { input: { vendorId: String(c.vendor.id), category: 'SLOTS' } }, wlAdmin(c.f.tenant))
    assert.equal(own.items.length, 3)
    assert.ok(own.items.every((g: any) => g.tenantEnabled === true && g.order === 1))
  })
})

test('CAS-2: a game disabled by Master Control stays listed in core mode, and the Status filter reads it', async () => {
  await rollback(db, async tx => {
    const c = await catalogue(tx)
    await Mutation.toggleCasinoGameMasterActive(null, { gameId: String(c.games[0].id), isActive: false }, superCore())
    const input = { vendorId: String(c.vendor.id), category: 'SLOTS' }
    const all = await Query.casinoGames(null, { input }, superCore())
    assert.equal(all.total, 3)
    assert.equal(all.items.find((g: any) => g.id === c.games[0].id)?.isActive, false)
    const inactive = await Query.casinoGames(null, { input: { ...input, enabled: false } }, superCore())
    assert.deepEqual(inactive.items.map((g: any) => g.id), [c.games[0].id])
    assert.equal(inactive.total, 1)
    const active = await Query.casinoGames(null, { input: { ...input, enabled: true } }, superCore())
    assert.equal(active.total, 2)
    // Whitelabels still never see a platform-disabled game.
    const tenantView = await Query.casinoGames(null, { input }, wlAdmin(c.f.tenant))
    assert.equal(tenantView.total, 2)
    assert.ok(!tenantView.items.some((g: any) => g.id === c.games[0].id))
  })
})

test('CAS-6: with no category the All view is paged on the server across the main categories', async () => {
  await rollback(db, async tx => {
    const c = await catalogue(tx)
    await tx.insert(t.casinoGames).values({ apiProviderId: c.provider.id, vendorId: c.vendor.id, mainCategory: 'live_casino', externalId: randomUUID(), name: 'QA Delta', slug: randomUUID() })
    const input = { vendorId: String(c.vendor.id), pageSize: 3 }
    const first = await Query.casinoGames(null, { input: { ...input, page: 1 } }, wlAdmin(c.f.tenant))
    const second = await Query.casinoGames(null, { input: { ...input, page: 2 } }, wlAdmin(c.f.tenant))
    assert.equal(first.total, 4)
    assert.equal(first.items.length, 3)
    assert.equal(second.items.length, 1)
    assert.deepEqual([...first.items, ...second.items].map((g: any) => g.name), ['QA Alpha', 'QA Bravo', 'QA Charlie', 'QA Delta'], 'name order across categories, no game twice')
    assert.equal(second.items[0].mainCategory, 'LIVE_CASINO')
  })
})

test('CAS-3: a Whitelabel Admin saves their own game settings and runs a bulk update', async () => {
  await rollback(db, async tx => {
    const c = await catalogue(tx)
    const ctx = wlAdmin(c.f.tenant)
    const single = await Mutation.updateCasinoGameSettings(null, { gameId: String(c.games[0].id), enabled: false, premiumOnly: true }, ctx)
    assert.equal(single.success, true)
    const bulk = await Mutation.bulkUpdateCasinoGameSettings(null, { gameIds: c.games.map((g: any) => String(g.id)), enabled: true }, ctx)
    assert.equal(bulk.message, 'Updated 3 games')
    const rows = await tx.select().from(t.whitelabelCasinoGameSettings).where(eq(t.whitelabelCasinoGameSettings.tenantId, c.f.tenant))
    assert.equal(rows.length, 3)
    assert.ok(rows.every((r: any) => r.enabled === true))
    assert.equal(rows.find((r: any) => r.gameId === c.games[0].id)?.premiumOnly, true)
    // Only the caller's whitelabel was written.
    const elsewhere = await tx.select().from(t.whitelabelCasinoGameSettings).where(eq(t.whitelabelCasinoGameSettings.gameId, c.games[0].id))
    assert.deepEqual(elsewhere.map((r: any) => r.tenantId), [c.f.tenant])
    // A role without casino write access is still refused (the map gate throws synchronously).
    const reader = { ...ctx, permissions: [{ domain: 'casino', actions: ['read'] }] }
    await assert.rejects(async () => Mutation.updateCasinoGameSettings(null, { gameId: String(c.games[0].id), enabled: true }, reader), /Forbidden: insufficient permissions for casino.management:update or casino.game-overrides:update/)
  })
})

test('CAS-10: core mode refuses tenant-scoped writes instead of writing the "default" whitelabel', async () => {
  await rollback(db, async tx => {
    const c = await catalogue(tx)
    const vendorId = String(c.vendor.id)
    await assert.rejects(Mutation.toggleCasinoVendorEnabled(null, { vendorId, enabled: false }, superCore()), /Select a whitelabel first/)
    await assert.rejects(Mutation.toggleCasinoGameEnabled(null, { gameId: String(c.games[0].id), enabled: false }, superCore()), /Select a whitelabel first/)
    await assert.rejects(Mutation.updateCasinoGameSettings(null, { gameId: String(c.games[0].id), premiumOnly: true }, superCore()), /Select a whitelabel first/)
    await assert.rejects(Mutation.reorderVendorGames(null, { vendorId, category: 'SLOTS', gameIds: [String(c.games[0].id)] }, superCore()), /Select a whitelabel first/)
    const written = await tx.select().from(t.whitelabelCasinoVendorSettings).where(eq(t.whitelabelCasinoVendorSettings.vendorId, c.vendor.id))
    assert.equal(written.length, 0, 'nothing reached any whitelabel')
    // With a whitelabel picked, the write lands on it.
    await Mutation.toggleCasinoVendorEnabled(null, { vendorId, enabled: false }, superIn(c.tenants[1]))
    const [row] = await tx.select().from(t.whitelabelCasinoVendorSettings).where(eq(t.whitelabelCasinoVendorSettings.vendorId, c.vendor.id))
    assert.equal(row.tenantId, c.tenants[1])
    assert.equal(row.enabled, false)
  })
})

test('CAS-12: only the platform administrator writes the shared provider catalogue', async () => {
  await rollback(db, async tx => {
    const c = await catalogue(tx)
    const ctx = wlAdmin(c.f.tenant)
    await assert.rejects(Mutation.updateCasinoProvider(null, { id: String(c.provider.id), input: { name: 'Renamed by a tenant' } }, ctx), /platform administrator/)
    await assert.rejects(Mutation.createCasinoProvider(null, { input: { key: 'qa-' + randomUUID(), name: 'Tenant provider' } }, ctx), /platform administrator/)
    await assert.rejects(Mutation.deleteCasinoProvider(null, { id: String(c.provider.id) }, ctx), /platform administrator/)
    const [unchanged] = await tx.select().from(t.casinoApiProviders).where(eq(t.casinoApiProviders.id, c.provider.id))
    assert.equal(unchanged.name, 'Casino QA Provider')
    const renamed = await Mutation.updateCasinoProvider(null, { id: String(c.provider.id), input: { status: 'inactive' } }, superCore())
    assert.equal(renamed.status, 'inactive')
    // The tenant's own vendor share on the same page stays theirs to save.
    const share = await Mutation.upsertProviderVendorShare(null, { providerId: String(c.provider.id), vendorId: String(c.vendor.id), sharePercentage: 12.5 }, ctx)
    assert.equal(share.sharePercentage, 12.5)
  })
})

test('CAS-21: dragging games saves the requested order, not id order', async () => {
  await rollback(db, async tx => {
    const c = await catalogue(tx)
    const [a, b, g] = c.games
    const result = await Mutation.reorderVendorGames(null, { vendorId: String(c.vendor.id), category: 'SLOTS', gameIds: [g, a, b].map((x: any) => String(x.id)) }, wlAdmin(c.f.tenant))
    assert.equal(result.message, 'Updated 3 games')
    const rows = await tx.select().from(t.whitelabelCasinoGameSettings).where(eq(t.whitelabelCasinoGameSettings.tenantId, c.f.tenant))
    const order = new Map(rows.map((r: any) => [r.gameId, r.order]))
    assert.deepEqual([order.get(g.id), order.get(a.id), order.get(b.id)], [1, 2, 3])
    // The games had no settings row, which players see as enabled; the rows the drag created keep them so.
    assert.deepEqual(rows.map((r: any) => r.enabled), [true, true, true], 'a drag never hides a game')
    const listed = await Query.casinoGames(null, { input: { vendorId: String(c.vendor.id), category: 'SLOTS' } }, wlAdmin(c.f.tenant))
    assert.deepEqual(listed.items.map((x: any) => x.id), [g.id, a.id, b.id], 'the list reads back in the saved order')
    // A second drag renumbers the rows that now exist, keeping their other settings.
    await tx.update(t.whitelabelCasinoGameSettings).set({ enabled: false }).where(eq(t.whitelabelCasinoGameSettings.gameId, a.id))
    await Mutation.reorderVendorGames(null, { vendorId: String(c.vendor.id), category: 'SLOTS', gameIds: [a, b, g].map((x: any) => String(x.id)) }, wlAdmin(c.f.tenant))
    const again = await tx.select().from(t.whitelabelCasinoGameSettings).where(eq(t.whitelabelCasinoGameSettings.tenantId, c.f.tenant))
    const reordered = new Map(again.map((r: any) => [r.gameId, r.order]))
    assert.deepEqual([reordered.get(a.id), reordered.get(b.id), reordered.get(g.id)], [1, 2, 3])
    assert.equal(again.length, 3, 'no duplicate settings rows')
    assert.equal(again.find((r: any) => r.gameId === a.id)?.enabled, false, 'a game the admin disabled stays disabled')
  })
})

test('CAS-22: VIP tier game access is scoped to the caller\'s whitelabel', async () => {
  await rollback(db, async tx => {
    const c = await catalogue(tx)
    const [own] = await tx.insert(t.vipTiersTable).values({ tenant: c.f.tenant, name: 'Own Gold', level: 2, minMonthlyDeposit: 0, color: '#ddaa00' }).returning()
    const [foreign] = await tx.insert(t.vipTiersTable).values({ tenant: c.tenants[1], name: 'Foreign Gold', level: 2, minMonthlyDeposit: 0, color: '#000000' }).returning()
    const game = c.games[0]
    await tx.insert(t.vipTierCasinoGames).values([{ tierId: own.id, gameId: game.id, enabled: true }, { tierId: foreign.id, gameId: game.id, enabled: true }])
    const ctx = wlAdmin(c.f.tenant)
    const tiers = await Query.gameVipTiers(null, { gameId: String(game.id) }, ctx)
    assert.deepEqual(tiers.map((x: any) => [x.tierId, x.tierName]), [[own.id, 'Own Gold']])
    await assert.rejects(Query.vipTierGames(null, { tierId: foreign.id }, ctx), /VIP tier not found/)
    await assert.rejects(Mutation.toggleVipTierGameEnabled(null, { tierId: foreign.id, gameId: String(game.id), enabled: false }, ctx), /VIP tier not found/)
    await assert.rejects(Mutation.bulkUpdateVipTierGames(null, { tierId: foreign.id, gameIds: [], enabled: true }, ctx), /VIP tier not found/)
    await assert.rejects(Mutation.toggleVipTierGameEnabled(null, { tierId: 'not-a-uuid', gameId: String(game.id), enabled: true }, ctx), /VIP tier not found/)
    const [foreignRow] = await tx.select().from(t.vipTierCasinoGames).where(and(eq(t.vipTierCasinoGames.tierId, foreign.id), eq(t.vipTierCasinoGames.gameId, game.id)))
    assert.equal(foreignRow.enabled, true, 'the other whitelabel\'s row is untouched')
    // The own tier still works, and the games filter ignores a foreign tier id.
    assert.equal((await Mutation.toggleVipTierGameEnabled(null, { tierId: own.id, gameId: String(game.id), enabled: false }, ctx)).success, true)
    const filtered = await Query.casinoGames(null, { input: { vendorId: String(c.vendor.id), category: 'SLOTS', vipTierId: foreign.id } }, ctx)
    assert.equal(filtered.total, 0)
    // Core mode reads every whitelabel's tiers.
    assert.equal((await Query.gameVipTiers(null, { gameId: String(game.id) }, superCore())).length, 2)
  })
})

test('CAS-7: bet settings refuse a minimum above the maximum and negative amounts', async () => {
  await rollback(db, async tx => {
    const c = await catalogue(tx)
    const ctx = wlAdmin(c.f.tenant)
    const save = (settings: Record<string, unknown>) => Mutation.upsertCasinoGameBetSettings(null, { gameId: String(c.games[0].id), settings: { betEnabled: true, ...settings } }, ctx)
    await assert.rejects(save({ minStake: 100, maxStake: 10, maxWin: 50 }), /Minimum stake \(100\) cannot be above the maximum stake \(10\)/)
    await assert.rejects(save({ minStake: -5, maxStake: -1 }), /cannot be negative/)
    assert.equal((await tx.select().from(t.casinoGameBetSettings).where(eq(t.casinoGameBetSettings.tenantId, c.f.tenant))).length, 0)
    const saved = await save({ minStake: 10, maxStake: 100, maxWin: 500 })
    assert.deepEqual([saved.minStake, saved.maxStake, saved.maxWin], [10, 100, 500])
  })
})

test('CAS-11: vendor analytics carry the settled stake, so an average bet is stake / bets', async () => {
  await rollback(db, async tx => {
    const c = await catalogue(tx)
    const player = await c.f.player()
    const bet = (stake: string, payout: string, status: 'won' | 'lost') => ({
      tenant: c.f.tenant, whitelabelId: c.f.tenant, userId: player.id, gameId: c.games[0].id, providerId: c.provider.id,
      vendorId: c.vendor.id, vendorName: 'Casino QA Vendor', stake, payout, winAmount: payout, status,
    })
    await tx.insert(t.casinoBets).values([bet('100', '0', 'lost'), bet('200', '300', 'won')])
    const range = { start: new Date(Date.now() - 3600_000).toISOString(), end: new Date(Date.now() + 3600_000).toISOString() }
    const vendor = await Query.vendorAnalytics(null, { providerId: String(c.provider.id), vendorId: String(c.vendor.id), ...range }, wlAdmin(c.f.tenant))
    assert.deepEqual([vendor.ggr, vendor.transactionCount, vendor.totalStake], [0, 2, 300])
    const provider = await Query.providerAnalytics(null, { providerId: String(c.provider.id), ...range }, wlAdmin(c.f.tenant))
    assert.equal(provider.vendorBreakdown[0].totalStake, 300)
  })
})

test('CAS-15: a category\'s subtitle and icon can be cleared', async () => {
  await rollback(db, async tx => {
    const c = await catalogue(tx)
    const ctx = wlAdmin(c.f.tenant)
    const icon = 'data:image/png;base64,iVBORw0KGgo='
    const created = await Mutation.createCasinoCategory(null, { input: { mainCategory: 'LIVE_CASINO', name: 'QA Cat', slug: 'qa-' + randomUUID(), subtitle: 'QA sub', iconData: icon } }, ctx)
    assert.equal(created.subtitle, 'QA sub')
    const renamedOnly = await Mutation.updateCasinoCategory(null, { id: created.id, input: { name: 'QA Cat 2' } }, ctx)
    assert.equal(renamedOnly.subtitle, 'QA sub', 'a missing key leaves the subtitle alone')
    const cleared = await Mutation.updateCasinoCategory(null, { id: created.id, input: { name: 'QA Cat 3', subtitle: null, iconData: null } }, ctx)
    assert.equal(cleared.subtitle, null)
    assert.equal(cleared.iconData, null)
    const [row] = await tx.select().from(t.casinoCategories).where(eq(t.casinoCategories.id, Number(created.id)))
    assert.deepEqual([row.name, row.subtitle, row.iconData], ['QA Cat 3', null, null])
  })
})

// Last in its own transaction: the unique violation aborts the transaction it happens in.
test('CAS-14: a duplicate category slug reports the reason, not the SQL statement', async () => {
  await rollback(db, async tx => {
    const c = await catalogue(tx)
    const ctx = wlAdmin(c.f.tenant)
    const input = { mainCategory: 'LIVE_CASINO', name: 'QA Alpha', slug: 'qa-alpha-' + randomUUID().slice(0, 6) }
    await Mutation.createCasinoCategory(null, { input }, ctx)
    await assert.rejects(Mutation.createCasinoCategory(null, { input }, ctx), (error: Error) => {
      assert.equal(error.message, `A category with slug "${input.slug}" already exists in Live Casino`)
      return true
    })
  })
})
