import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_LOUNGE_IMAGE_BYTES, loungeNumericId, normalizeLoungeSave, validateLoungeImage } from './loungeImages.js'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='

test('Lounge artwork accepts bounded raster data and explicit restore-to-original', () => {
  assert.equal(validateLoungeImage(png), png)
  assert.equal(validateLoungeImage(null), null)
  const normalized = normalizeLoungeSave('12', ['1','2','1'], [{gameId:'2',imageData:png}])
  assert.deepEqual(normalized, { categoryId:12, gameIds:[1,2], images:[{gameId:2,imageData:png}] })
})

test('Lounge artwork rejects URL, SVG, noncanonical Base64, spoofed type, and oversized data', () => {
  const tooLarge = Buffer.alloc(MAX_LOUNGE_IMAGE_BYTES + 1)
  for (const image of ['https://example.invalid/game.webp', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,AAAA=',
    png.replace('image/png','image/jpeg'), 'data:image/png;base64,'+tooLarge.toString('base64'), undefined, 'data:image/png;base64,YWJjZA==']) {
    assert.throws(() => validateLoungeImage(image))
  }
})

test('Lounge saves reject invalid IDs, duplicate artwork and artwork for unselected games', () => {
  for (const id of ['0','-1','2.5','1e2',' 1',NaN,2147483648,undefined]) assert.throws(() => loungeNumericId(id))
  assert.throws(() => normalizeLoungeSave('1',['2'],[{gameId:'3',imageData:png}]), /selected/)
  assert.throws(() => normalizeLoungeSave('1',['2'],[{gameId:'2',imageData:png},{gameId:'2',imageData:null}]), /Duplicate/)
})

test('Lounge saves bound combined Base64 changes below the GraphQL request limit', () => {
  const bytes = Buffer.alloc(MAX_LOUNGE_IMAGE_BYTES)
  Buffer.from(png.split(',')[1], 'base64').copy(bytes)
  const imageData = 'data:image/png;base64,' + bytes.toString('base64')
  const gameIds = Array.from({ length:20 }, (_, index) => String(index+1))
  assert.throws(() => normalizeLoungeSave('1',gameIds,gameIds.map(gameId => ({ gameId,imageData }))), /6 MB/)
})

test('Lounge image operations carry explicit category permissions and tenant scope', () => {
  const index = readFileSync(new URL('./resolvers/index.ts', import.meta.url),'utf8')
  assert.match(index, /saveCasinoLoungeGames: \[\['casino\.categories', 'update'\]\]/)
  const queries = readFileSync(new URL('./resolvers/queries.ts', import.meta.url),'utf8')
  assert.match(queries, /casinoLoungeGameImages:[\s\S]*?hasPermission\(ctx\?\.permissions \?\? \[\], 'casino\.categories', 'view'\)/)
})
