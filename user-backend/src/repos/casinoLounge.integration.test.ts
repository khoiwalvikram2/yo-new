import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import * as schema from '@shared/db/schema.js'
import { provisionCasinoLounge } from '../../../shared/scripts/provisionCasinoLounge.js'
import { CASINO_LOUNGE_DEFAULT_CATEGORIES, seedEmptyCasinoLounge } from '@shared/casino/defaultLounge.js'

// Opt in to an explicitly named test database. Every fixture is rolled back;
// this suite never reads or changes the application's configured database.
const testDatabaseUrl = process.env.CASINO_LOUNGE_TEST_DATABASE_URL
let database: typeof import('../db/client.js')
let repo: typeof import('./userAppRepo.js')

test.before(async () => {
  if (!testDatabaseUrl) return
  assert.match(new URL(testDatabaseUrl).pathname, /test/i, 'Casino Lounge integration tests require a test database')
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.JWT_SECRET ||= 'casino-lounge-integration-test-secret'
  database = await import('../db/client.js')
  repo = await import('./userAppRepo.js')
  const result = await database.pool.query("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid WHERE pg_type.typname = 'casino_category_type' AND enumlabel = 'lounge'")
  assert.equal(result.rowCount, 1, 'Apply the Casino Lounge enum migration to the test database first')
})
test.after(async () => { await database?.pool.end() })
test.afterEach(() => mock.restoreAll())

type Transaction = Parameters<Parameters<typeof database.db.transaction>[0]>[0]
class FixtureRollback extends Error {}

async function scenario(run: (fixture: Awaited<ReturnType<typeof seed>>, tx: Transaction) => Promise<void>) {
  try {
    await database.db.transaction(async tx => {
      const fixture = await seed(tx)
      mock.method(database.db, 'select', tx.select.bind(tx))
      try { await run(fixture, tx) } finally { mock.restoreAll() }
      throw new FixtureRollback()
    })
  } catch (error) { if (!(error instanceof FixtureRollback)) throw error }
}

async function seed(tx: Transaction) {
  const suffix = randomUUID()
  const tenant = 'lounge-test-' + suffix.slice(0, 12)
  const foreignTenant = 'lounge-other-' + suffix.slice(0, 12)
  await tx.insert(schema.whitelabels).values([tenant, foreignTenant].map(id => ({ id, name: 'Casino Lounge test', domain: id + '.invalid' })))
  const provider = async () => (await tx.insert(schema.casinoApiProviders).values({ key: randomUUID(), name: 'Lounge test provider' }).returning())[0]!
  const vendor = async () => (await tx.insert(schema.casinoVendors).values({ name: 'Lounge ' + randomUUID(), slug: randomUUID() }).returning())[0]!
  const defaultProvider = await provider(), defaultVendor = await vendor()
  const game = async (values: Partial<typeof schema.casinoGames.$inferInsert> = {}) => {
    const id = randomUUID()
    return (await tx.insert(schema.casinoGames).values({ apiProviderId: defaultProvider.id, vendorId: defaultVendor.id, mainCategory: 'live_casino', externalId: id, name: 'Lounge game ' + id, slug: id, ...values }).returning())[0]!
  }
  const category = async (values: Partial<typeof schema.casinoCategories.$inferInsert> = {}) => (await tx.insert(schema.casinoCategories)
    .values({ tenantId: tenant, mainCategory: 'live_casino', type: 'lounge', name: 'Casino lounge', slug: randomUUID(), ...values }).returning())[0]!
  const assign = async (categoryId: number, gameId: number, order = 0, imageData?: string | null) => { await tx.insert(schema.casinoCategoryGames).values({ categoryId, gameId, order, imageData }) }
  const read = (values: Partial<Parameters<typeof repo.getCasinoGamesList>[0]> = {}) => repo.getCasinoGamesList({ tenant, categoryType: 'LOUNGE', ...values })
  return { tenant, foreignTenant, provider, vendor, game, category, assign, read }
}

test('Lounge unions assigned live/slot games, deduplicates membership and preserves admin ordering/pagination', { skip: !testDatabaseUrl }, async () => scenario(async f => {
  const first = await f.category({ order: 1 }), later = await f.category({ mainCategory: 'slots', order: 2 }), duplicate = await f.category({ order: 3 }), unordered = await f.category({ mainCategory: 'casino' })
  const anotherProvider = await f.provider()
  const live = await f.game(), slot = await f.game({ mainCategory: 'slots', apiProviderId: anotherProvider.id }), shared = await f.game(), last = await f.game({ mainCategory: 'casino' })
  await f.game({ name: 'Unassigned catalogue game' })
  await f.assign(first.id, live.id, 20)
  await f.assign(first.id, shared.id, 10)
  await f.assign(duplicate.id, shared.id, 0)
  await f.assign(later.id, slot.id, 1)
  await f.assign(unordered.id, last.id)
  const expected = [shared, live, slot, last].map(game => String(game.id))
  const all = await f.read()
  assert.deepEqual(all.map(game => game.id), expected)
  assert.equal(all.total, 4)
  assert.equal(all.hasMore, false)
  const firstPage = await f.read({ limit: 2 }), secondPage = await f.read({ limit: 2, page: 2 })
  assert.deepEqual(firstPage.map(game => game.id), expected.slice(0, 2))
  assert.deepEqual(secondPage.map(game => game.id), expected.slice(2))
  assert.equal(firstPage.total, 4)
  assert.equal(firstPage.hasMore, true)
  assert.equal(secondPage.total, 4)
  assert.equal(secondPage.hasMore, false)
  assert.deepEqual((await f.read({ categoryType: 'lounge', slots: true })).map(game => game.id), [String(slot.id)])
  assert.deepEqual((await f.read({ liveOnly: true })).map(game => game.id), [String(shared.id), String(live.id)])
  assert.deepEqual((await f.read({ search: slot.externalId })).map(game => game.id), [String(slot.id)])
}))

test('Missing, inactive, foreign and empty Lounge collections cannot fall back to other games', { skip: !testDatabaseUrl }, async () => scenario(async (f, tx) => {
  const unrelated = await f.game(), inactiveGame = await f.game(), foreignGame = await f.game()
  const featured = await f.category({ type: 'featured', name: 'Casino lounge' })
  const inactive = await f.category({ isActive: false })
  const foreign = await f.category({ tenantId: f.foreignTenant })
  await f.assign(featured.id, unrelated.id)
  await f.assign(inactive.id, inactiveGame.id)
  await f.assign(foreign.id, foreignGame.id)
  assert.equal((await f.read()).length, 0)
  const empty = await f.category()
  assert.equal((await f.read()).length, 0)
  assert.deepEqual(await f.read({ categoryType: 'unknown', category: 'live_casino' }), [])
  assert.deepEqual(await f.read({ categoryType: '', category: 'live_casino' }), [])
  await f.assign(empty.id, unrelated.id)
  assert.deepEqual((await f.read({ category: 'slots' })).map(game => game.id), [String(unrelated.id)])
  await tx.update(schema.casinoCategories).set({ isActive: false }).where(eq(schema.casinoCategories.id, empty.id))
  assert.equal((await f.read()).length, 0)
}))

test('Lounge artwork follows its winning active tenant membership and clearing it restores the master image', { skip: !testDatabaseUrl }, async () => scenario(async (f, tx) => {
  const first = await f.category({ order: 1 }), later = await f.category({ order: 2 })
  const inactive = await f.category({ order: 0, isActive: false }), foreign = await f.category({ order: 0, tenantId: f.foreignTenant })
  const master = 'https://catalog.invalid/original.webp'
  const selected = await f.game({ thumbnailUrl: master }), fallback = await f.game({ thumbnailUrl: master }), disabled = await f.game({ thumbnailUrl: master })
  const custom = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9sAAAAASUVORK5CYII='
  const other = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAA=='
  await f.assign(first.id, selected.id, 2, custom)
  await f.assign(later.id, selected.id, 0, other)
  await f.assign(inactive.id, selected.id, 0, other)
  await f.assign(foreign.id, selected.id, 0, other)
  await f.assign(first.id, fallback.id, 1)
  await f.assign(later.id, fallback.id, 0, custom)
  await f.assign(first.id, disabled.id, 3, custom)
  await tx.insert(schema.whitelabelCasinoGameSettings).values({ tenantId: f.tenant, gameId: disabled.id, enabled: false })
  const games = await f.read()
  assert.equal(games.total, 2)
  assert.deepEqual(games.map(game => game.id), [String(fallback.id), String(selected.id)])
  assert.equal(games[0].imageUrl, master, 'a later membership cannot replace a blank first image')
  assert.equal(games[1].imageUrl, custom)
  await tx.update(schema.casinoCategoryGames).set({ imageData: null }).where(eq(schema.casinoCategoryGames.categoryId, first.id))
  assert.equal((await f.read()).find(game => game.id === String(selected.id))?.imageUrl, master)
  assert.equal((await tx.select().from(schema.casinoGames).where(eq(schema.casinoGames.id, selected.id)))[0].thumbnailUrl, master)
}))

test('Lounge artwork never changes normal catalog, exact-category, Top or Featured images', { skip: !testDatabaseUrl }, async () => scenario(async f => {
  const master = 'https://catalog.invalid/unmodified.webp'
  const game = await f.game({ thumbnailUrl: master })
  const imageData = 'data:image/png;base64,iVBORw0KGgo='
  for (const type of ['lounge', 'general', 'top', 'featured'] as const) {
    const category = await f.category({ type })
    await f.assign(category.id, game.id, 0, imageData)
    const exact = await repo.getCasinoGamesList({ tenant: f.tenant, category: category.slug })
    assert.equal(exact.find(item => item.id === String(game.id))?.imageUrl, master)
    if (type !== 'lounge') assert.equal((await f.read({ categoryType: type }))[0].imageUrl, master)
  }
  assert.equal((await f.read())[0].imageUrl, imageData)
  assert.equal((await repo.getCasinoGamesList({ tenant: f.tenant })).find(item => item.id === String(game.id))?.imageUrl, master)
}))

test('Assigned Lounge games still obey tenant game/vendor/provider settings and Super Admin disables', { skip: !testDatabaseUrl }, async () => scenario(async (f, tx) => {
  const category = await f.category()
  const allowed = await f.game(), disabled = await f.game(), overridden = await f.game(), inactive = await f.game({ isActive: false })
  const disabledVendor = await f.vendor(), overriddenVendor = await f.vendor(), disabledProvider = await f.provider()
  const vendorGame = await f.game({ vendorId: disabledVendor.id }), vendorOverrideGame = await f.game({ vendorId: overriddenVendor.id }), providerGame = await f.game({ apiProviderId: disabledProvider.id })
  for (const game of [allowed, disabled, overridden, inactive, vendorGame, vendorOverrideGame, providerGame]) await f.assign(category.id, game.id)
  await tx.insert(schema.whitelabelCasinoGameSettings).values([{ tenantId: f.tenant, gameId: disabled.id, enabled: false }, { tenantId: f.foreignTenant, gameId: allowed.id, enabled: false }])
  await tx.insert(schema.whitelabelCasinoGameSuperAdminOverride).values({ tenantId: f.tenant, gameId: overridden.id, disabled: true })
  await tx.insert(schema.whitelabelCasinoVendorSettings).values({ tenantId: f.tenant, vendorId: disabledVendor.id, enabled: false })
  await tx.insert(schema.whitelabelCasinoVendorSuperAdminOverride).values({ tenantId: f.tenant, vendorId: overriddenVendor.id, disabled: true })
  await tx.insert(schema.whitelabelCasinoProviderSettings).values({ tenantId: f.tenant, providerId: disabledProvider.id, enabled: false })
  const result = await f.read()
  assert.deepEqual(result.map(game => game.id), [String(allowed.id)])
  assert.equal(result.total, 1)
  assert.equal((await f.read({ providers: [disabledVendor.name] })).length, 0)
}))

test('Lounge collections stay out of normal casino category navigation', { skip: !testDatabaseUrl }, async () => scenario(async f => {
  await f.category()
  await f.category({ mainCategory: 'slots' })
  const featured = await f.category({ type: 'featured', name: 'Featured' })
  const categories = await repo.getCasinoCategoriesList({ tenant: f.tenant })
  assert.deepEqual(categories.map(category => category.name), [featured.name])
  assert.deepEqual(await repo.getCasinoCategoriesList({ tenant: f.tenant, slotsOnly: true }), [])
  // A homepage-only collection must not unlock an otherwise unconfigured lobby.
  assert.deepEqual(await repo.getCasinoGamesList({ tenant: f.tenant, slots: true }), [])
}))

test('Migration provisioning creates three empty Lounge defaults idempotently and preserves existing category assignments', { skip: !testDatabaseUrl }, async () => scenario(async (f, tx) => {
  const original = await f.category({ type: 'featured', name: 'Existing tenant selection', order: 4, isActive: false })
  const game = await f.game()
  await f.assign(original.id, game.id, 7)
  const beforeAssignments = await tx.select().from(schema.casinoCategoryGames).where(eq(schema.casinoCategoryGames.categoryId, original.id))
  // The helper must use the same connection as this rollback-only transaction.
  const client = (tx as unknown as { session: { client: import('pg').PoolClient } }).session.client
  assert.ok(await provisionCasinoLounge(client) >= 3)
  assert.equal(await provisionCasinoLounge(client), 0)
  const categories = await tx.select().from(schema.casinoCategories).where(eq(schema.casinoCategories.tenantId, f.tenant))
  const lounge = categories.filter(category => category.type === 'lounge')
  assert.equal(lounge.length, 3)
  assert.deepEqual(lounge.map(category => category.mainCategory).sort(), ['casino', 'live_casino', 'slots'])
  assert.ok(lounge.every(category => category.name === 'Casino lounge' && category.slug === 'casino-lounge' && category.isActive))
  const memberships = await tx.select().from(schema.casinoCategoryGames).where(inArray(schema.casinoCategoryGames.categoryId, lounge.map(category => category.id)))
  assert.equal(memberships.length, 0)
  assert.deepEqual(categories.find(category => category.id === original.id), original)
  assert.deepEqual(await tx.select().from(schema.casinoCategoryGames).where(eq(schema.casinoCategoryGames.categoryId, original.id)), beforeAssignments)
}))

test('New-tenant shared seeding creates only three empty Lounge defaults and is safe to repeat', { skip: !testDatabaseUrl }, async () => scenario(async (f, tx) => {
  await f.game()
  await seedEmptyCasinoLounge(tx, f.tenant)
  const first = await tx.select().from(schema.casinoCategories).where(eq(schema.casinoCategories.tenantId, f.tenant))
  await seedEmptyCasinoLounge(tx, f.tenant)
  const second = await tx.select().from(schema.casinoCategories).where(eq(schema.casinoCategories.tenantId, f.tenant))
  assert.equal(first.length, 3)
  assert.deepEqual(second, first)
  assert.equal(CASINO_LOUNGE_DEFAULT_CATEGORIES.length, 3)
  assert.deepEqual(second.map(category => category.mainCategory).sort(), ['casino', 'live_casino', 'slots'])
  assert.ok(second.every(category => category.type === 'lounge' && category.name === 'Casino lounge' && category.slug === 'casino-lounge' && category.order === 90 && category.isActive))
  assert.equal((await tx.select().from(schema.casinoCategoryGames).where(inArray(schema.casinoCategoryGames.categoryId, second.map(category => category.id)))).length, 0)
  assert.equal((await tx.select().from(schema.casinoCategories).where(eq(schema.casinoCategories.tenantId, f.foreignTenant))).length, 0)
  assert.equal((await f.read()).length, 0)
}))
