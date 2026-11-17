/**
 * Who may create a whitelabel, and edit which one (SYS-01).
 *
 * Measured before: `config.whitelabels:create|update` map from flat `config:write`, which every Whitelabel Admin
 * holds for its own app settings, and nothing compared `input.id` with the caller's brand. grandwinn's admin ran
 * the UPDATE on kondareddi's row and the INSERT of a new brand; createWhitelabel on an existing id overwrote it
 * (and would then make a caller-chosen e-mail that brand's Whitelabel Admin); a failed write handed back the
 * driver's SQL with another brand's logo and favicon in it.
 *
 * Driven through the real guarded Mutation map. Two throwaway `vfyfix-` brands are created and removed (the
 * audit row of the one successful edit is left alone). Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const STAMP = randomUUID().slice(0, 8)
const A = `vfyfix-wlw-a-${STAMP}`
const B = `vfyfix-wlw-b-${STAMP}`
const NEW = `vfyfix-wlw-new-${STAMP}`
const LOGO_B = `data:image/png;base64,vfyfix-logo-b-${STAMP}`

let db: (typeof import('@src/db/client.js'))['db']
let Mutation: Record<string, any> = {}

const at = (fieldName: string) => ({ parentType: { name: 'Mutation' }, fieldName })
const run = (name: string, input: Record<string, unknown>, ctx: unknown) => Mutation[name](undefined, { input }, ctx, at(name))
const rowOf = async (id: string) =>
  (await db.execute(sql`SELECT id, name, domain, logo_url FROM whitelabels WHERE id = ${id}`)).rows[0] as any

/** A's Whitelabel Admin, with the live role's flat grants (config:write among them). */
const wlAdminOfA = () => ({
  user: { sub: '987654', name: 'vfyfix wl', roles: ['Whitelabel Admin'], type: 'admin' },
  permissions: [
    { domain: 'config', actions: ['read', 'write'] },
    { domain: 'agents', actions: ['view', 'manage', 'read', 'write'] },
    { domain: 'finance', actions: ['read', 'write'] },
  ],
  tenant: A,
  whitelabel: { id: A },
  request: { headers: {} },
})
const superAdmin = () => ({
  user: { sub: '987655', name: 'vfyfix platform', roles: ['Super Admin'], type: 'admin' },
  permissions: [{ domain: 'all', actions: ['*'] }],
  directorMode: 'core',
  tenant: 'default',
  whitelabel: { id: 'default' },
  request: { headers: {} },
})

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  const { domainResolvers } = await import('@src/domains/index.js')
  Mutation = (domainResolvers as any).Mutation
  await db.execute(sql`INSERT INTO whitelabels (id, name, domain, status) VALUES (${A}, 'vfyfix a', ${A + '.test'}, 'active')`)
  await db.execute(sql`INSERT INTO whitelabels (id, name, domain, logo_url, status) VALUES (${B}, 'vfyfix b', ${B + '.test'}, ${LOGO_B}, 'active')`)
})

after(async () => {
  if (db) await db.execute(sql`DELETE FROM whitelabels WHERE id IN (${A}, ${B}, ${NEW})`)
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
  await closeRedisEmitter().catch(() => {})
})

describe('createWhitelabel is a platform action', () => {
  it('refuses a Whitelabel Admin, for a new id and for an existing brand', async () => {
    await assert.rejects(async () => run('createWhitelabel', { id: NEW, name: 'vfyfix new', domain: NEW + '.test' }, wlAdminOfA()), /Forbidden: only a platform administrator can create a whitelabel/)
    await assert.rejects(async () => run('createWhitelabel', { id: B, name: 'taken over', domain: 'x.test' }, wlAdminOfA()), /Forbidden/)
    assert.equal(await rowOf(NEW), undefined, 'the INSERT ran')
    assert.equal((await rowOf(B)).name, 'vfyfix b')
  })

  it('never overwrites an existing brand, even for the platform', async () => {
    const out = await run('createWhitelabel', { id: B, name: 'overwritten', domain: B + '.test' }, superAdmin())
    assert.equal(out.success, false)
    assert.match(out.message, /already exists/)
    const b = await rowOf(B)
    assert.equal(b.name, 'vfyfix b')
    assert.equal(b.logo_url, LOGO_B, "the create wiped the brand's logo")
  })
})

describe('updateWhitelabel: a Whitelabel Admin edits only its own brand, and only its branding', () => {
  it("refuses another brand's row", async () => {
    await assert.rejects(async () => run('updateWhitelabel', { id: B, name: 'renamed by a' }, wlAdminOfA()), /Forbidden: you can only update your own whitelabel/)
    assert.equal((await rowOf(B)).name, 'vfyfix b')
  })

  it('refuses the platform sharing rates and the domain on its own row', async () => {
    await assert.rejects(
      async () => run('updateWhitelabel', { id: A, sharingRates: [{ domain: 'sports', shareRate: 0 }] }, wlAdminOfA()),
      /Forbidden: only a platform administrator can change sharing rates/
    )
    const out = await run('updateWhitelabel', { id: A, domain: `moved-${STAMP}.test` }, wlAdminOfA())
    assert.equal(out.success, false)
    assert.match(out.message, /only a platform administrator can change a whitelabel domain/)
    assert.equal((await rowOf(A)).domain, A + '.test')
  })

  it('saves its own name and logo, as App Configuration does', async () => {
    const out = await run('updateWhitelabel', { id: A, name: 'vfyfix a renamed', logoUrl: null, faviconUrl: null }, wlAdminOfA())
    assert.equal(out.success, true, out.message)
    assert.equal((await rowOf(A)).name, 'vfyfix a renamed')
  })
})

describe('a failed write does not hand back the SQL', () => {
  it('names a taken domain instead of echoing the driver error with the other brand\'s data', async () => {
    const out = await run('updateWhitelabel', { id: A, domain: B + '.test' }, superAdmin())
    assert.equal(out.success, false)
    assert.equal(out.message, 'That domain is already used by another whitelabel')
    assert.doesNotMatch(out.message, /Failed query|update "whitelabels"|base64/)
    assert.equal((await rowOf(A)).domain, A + '.test')
  })
})
