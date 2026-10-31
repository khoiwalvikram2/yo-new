import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import * as schema from '@shared/db/schema.js'

const url = process.env.CASINO_LOUNGE_TEST_DATABASE_URL
let database: typeof import('../../db/client.js')
let repo: typeof import('./loungeImagesRepo.js')
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='

test.before(async () => {
  if (!url) return
  assert.match(new URL(url).pathname, /test/i, 'Lounge image tests require an explicitly named test database')
  process.env.DATABASE_URL = url
  database = await import('../../db/client.js')
  repo = await import('./loungeImagesRepo.js')
})
test.after(async () => { await database?.pool.end() })
type Transaction = Parameters<Parameters<typeof database.db.transaction>[0]>[0]
class FixtureRollback extends Error {}
async function fixture(run: (tx:Transaction, f:Awaited<ReturnType<typeof seed>>) => Promise<void>) {
  try {
    await database.db.transaction(async tx => {
      await run(tx, await seed(tx))
      throw new FixtureRollback()
    })
  } catch (error) { if (!(error instanceof FixtureRollback)) throw error }
}
async function seed(tx:Transaction) {
  const tenant='lounge-image-'+randomUUID().slice(0,12), other='lounge-other-'+randomUUID().slice(0,12)
  await tx.insert(schema.whitelabels).values([tenant,other].map(id => ({ id,name:'Lounge image test',domain:id+'.invalid' })))
  const [provider]=await tx.insert(schema.casinoApiProviders).values({ key:randomUUID(),name:'Image test provider' }).returning()
  const [vendor]=await tx.insert(schema.casinoVendors).values({ slug:randomUUID(),name:'Image test vendor' }).returning()
  const games=await tx.insert(schema.casinoGames).values(['one','two','three'].map(name => ({
    apiProviderId:provider.id,vendorId:vendor.id,mainCategory:'slots' as const,externalId:randomUUID(),name,slug:randomUUID(),thumbnailUrl:'https://example.invalid/original.png',
  }))).returning()
  const [lounge]=await tx.insert(schema.casinoCategories).values({ tenantId:tenant,mainCategory:'slots',type:'lounge',name:'Casino lounge',slug:randomUUID() }).returning()
  const [general]=await tx.insert(schema.casinoCategories).values({ tenantId:tenant,mainCategory:'slots',type:'general',name:'General',slug:randomUUID() }).returning()
  return { tenant,other,games,lounge,general }
}

test('Lounge image saves atomically add, preserve, replace, clear and remove only membership artwork', {skip:!url}, async () => fixture(async (tx,f) => {
  const ids=f.games.map(game => game.id)
  await repo.saveCasinoLoungeGamesDb(f.tenant,f.lounge.id,[ids[0],ids[1]],[{gameId:ids[0],imageData:png}],tx)
  assert.deepEqual(await repo.getCasinoLoungeGameImagesDb(f.tenant,f.lounge.id,tx),[{gameId:String(ids[0]),imageData:png},{gameId:String(ids[1]),imageData:null}])
  await repo.saveCasinoLoungeGamesDb(f.tenant,f.lounge.id,[ids[0],ids[2]],[],tx)
  assert.deepEqual(await repo.getCasinoLoungeGameImagesDb(f.tenant,f.lounge.id,tx),[{gameId:String(ids[0]),imageData:png},{gameId:String(ids[2]),imageData:null}])
  await repo.saveCasinoLoungeGamesDb(f.tenant,f.lounge.id,[ids[0],ids[2]],[{gameId:ids[0],imageData:null},{gameId:ids[2],imageData:png}],tx)
  assert.deepEqual(await repo.getCasinoLoungeGameImagesDb(f.tenant,f.lounge.id,tx),[{gameId:String(ids[0]),imageData:null},{gameId:String(ids[2]),imageData:png}])
  const originals=await tx.select({image:schema.casinoGames.thumbnailUrl}).from(schema.casinoGames).where(eq(schema.casinoGames.vendorId,f.games[0].vendorId))
  assert.ok(originals.every(game => game.image==='https://example.invalid/original.png'))
  await repo.saveCasinoLoungeGamesDb(f.tenant,f.lounge.id,[],[],tx)
  assert.deepEqual(await repo.getCasinoLoungeGameImagesDb(f.tenant,f.lounge.id,tx),[])
}))

test('Lounge image writes and reads refuse other tenants, other category types and invalid selections', {skip:!url}, async () => fixture(async (tx,f) => {
  await assert.rejects(repo.saveCasinoLoungeGamesDb(f.other,f.lounge.id,[f.games[0].id],[],tx),/not found/)
  await assert.rejects(repo.getCasinoLoungeGameImagesDb(f.other,f.lounge.id,tx),/not found/)
  await assert.rejects(repo.saveCasinoLoungeGamesDb(f.tenant,f.general.id,[f.games[0].id],[],tx),/only available/)
  await assert.rejects(repo.getCasinoLoungeGameImagesDb(f.tenant,f.general.id,tx),/only available/)
  await assert.rejects(repo.saveCasinoLoungeGamesDb(f.tenant,f.lounge.id,[2147483647],[],tx),/must exist/)
  const [wrongMain]=await tx.insert(schema.casinoGames).values({ apiProviderId:f.games[0].apiProviderId,vendorId:f.games[0].vendorId,mainCategory:'live_casino',externalId:randomUUID(),name:'Wrong main',slug:randomUUID() }).returning()
  await assert.rejects(repo.saveCasinoLoungeGamesDb(f.tenant,f.lounge.id,[wrongMain.id],[],tx),/must exist/)
  assert.deepEqual(await repo.getCasinoLoungeGameImagesDb(f.tenant,f.lounge.id,tx),[])
}))

test('A database error while saving artwork rolls membership changes back with the image changes', {skip:!url}, async () => fixture(async (tx,f) => {
  await repo.saveCasinoLoungeGamesDb(f.tenant,f.lounge.id,[f.games[0].id],[],tx)
  const failUpdateDatabase = { transaction: (run:Parameters<typeof tx.transaction>[0]) => tx.transaction(async inner => {
    const stub=mock.method(inner,'update',() => { throw new Error('Fixture image write failure') })
    try { return await run(inner) } finally { stub.mock.restore() }
  }) }
  await assert.rejects(repo.saveCasinoLoungeGamesDb(f.tenant,f.lounge.id,[f.games[1].id],[{gameId:f.games[1].id,imageData:png}],failUpdateDatabase as Pick<typeof database.db,'transaction'>),/Fixture image write failure/)
  const members=await tx.select({gameId:schema.casinoCategoryGames.gameId}).from(schema.casinoCategoryGames)
    .where(eq(schema.casinoCategoryGames.categoryId,f.lounge.id))
  assert.deepEqual(members,[{gameId:f.games[0].id}])
}))
