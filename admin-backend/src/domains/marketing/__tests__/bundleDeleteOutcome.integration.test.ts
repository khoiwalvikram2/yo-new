/**
 * deleteCasinoGameBundle says "deleted" only when it deleted something (MAR-08).
 *
 * Measured before: kondareddi's admin deleting grandwinn's bundle, anyone deleting id 999999, and a
 * second delete of a bundle already gone all answered success:true "Bundle deleted successfully",
 * while tenant isolation kept the other whitelabel's row. The repository already returned false.
 *
 * Driven through the real guarded marketing mutations with two throwaway `vfyfix-` tenants, whose
 * casino_game_bundles rows are removed afterwards. Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const STAMP = randomUUID().replace(/-/g, '').slice(0, 6)
const T = `vfyfix-bnd-${STAMP}`
const U = `vfyfix-bnd-u-${STAMP}`

let db: (typeof import('@src/db/client.js'))['db']
let Mutation: Record<string, any> = {}

const admin = (tenant: string) => ({
  user: { sub: '987652', name: 'vfyfix bundles', roles: ['Whitelabel Admin'], type: 'admin' },
  permissions: [{ domain: 'bonuses.bundles', actions: ['create', 'delete'] }],
  tenant,
  whitelabel: { id: tenant },
  request: { headers: {} },
})
const m = async (field: string, args: Record<string, unknown>, tenant: string) => Mutation[field](undefined, args, admin(tenant), {})

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  const { marketingResolvers } = await import('@src/domains/marketing/resolvers/index.js')
  Mutation = marketingResolvers.Mutation as any
})

after(async () => {
  if (db) await db.execute(sql`DELETE FROM casino_game_bundles WHERE tenant IN (${T}, ${U})`)
})

describe('deleteCasinoGameBundle', () => {
  it('reports what it did: not found for another tenant, a missing id or a second delete', async () => {
    const created = await m('createCasinoGameBundle', { input: { name: 'vfyfix Bundle', domain: 'casino', gameIds: ['1', '2'] } }, T)
    assert.equal(created.success, true, created.message)
    const id = created.bundle.id

    assert.deepEqual(await m('deleteCasinoGameBundle', { id }, U), { success: false, message: 'Bundle not found' })
    const kept = (await db.execute(sql`SELECT count(*)::int AS n FROM casino_game_bundles WHERE id = ${Number(id)} AND tenant = ${T}`)).rows as any[]
    assert.equal(kept[0].n, 1, 'the other tenant did not delete it')

    assert.deepEqual(await m('deleteCasinoGameBundle', { id: '999999999' }, T), { success: false, message: 'Bundle not found' })
    assert.deepEqual(await m('deleteCasinoGameBundle', { id }, T), { success: true, message: 'Bundle deleted successfully' })
    assert.deepEqual(await m('deleteCasinoGameBundle', { id }, T), { success: false, message: 'Bundle not found' })
  })
})
