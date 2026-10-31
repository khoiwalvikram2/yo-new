/**
 * `Query.whitelabel(id)` is open before sign-in. Its money must not be.
 *
 * The login page needs the brand's name, logo and theme for the host being
 * addressed, so the operation is deliberately reachable with no session — it is
 * named in the probe's own open-by-design list as "branding, by id".
 *
 * That justification was accepted without reading the `Whitelabel` type, which
 * mixes branding with the brand's credit line and sharing configuration, and
 * whose field resolvers fetch those from the database on demand. Measured with
 * no session at all, `whitelabel("grandwinn-com")` returned creditLimit
 * 100,000,000, creditUsed 4,872,703.47, creditAvailable 95,127,296.53 and every
 * sharing rate — real figures, for a brand whose id is its own domain name.
 *
 * This is the shape a per-operation gate cannot see: the operation is correctly
 * open, and the leak is one level down in the type it returns.
 *
 * Requires DATABASE_URL. Writes nothing.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

const MONEY = ['creditLimit', 'creditUsed', 'creditAvailable', 'creditAlertThreshold'] as const

let Query: Record<string, any>
let Whitelabel: Record<string, any>
let brands: string[] = []

const ctxOf = (tenant: string, permissions: unknown, signedIn = true) => ({
  user: signedIn ? { sub: '1', type: 'admin', roles: [] } : undefined,
  permissions,
  tenant,
  whitelabel: { id: tenant },
  request: { headers: {} },
})

async function read(target: string, ctx: unknown) {
  const row = await Query.whitelabel(undefined, { id: target }, ctx, undefined)
  if (!row) return null
  const out: Record<string, unknown> = {}
  for (const f of MONEY) out[f] = await Whitelabel[f](row, {}, ctx, undefined)
  out.sharingRates = await Whitelabel.sharingRates(row, {}, ctx, undefined)
  return out
}

const leaked = (v: Record<string, unknown> | null) =>
  v ? Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k]) => k) : []

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { pool } = await import('@src/db/client.js')
  brands = (await pool.query(`SELECT id FROM whitelabels ORDER BY id`)).rows.map((r: any) => String(r.id))
  const { domainResolvers } = await import('@src/domains/index.js')
  Query = (domainResolvers as Record<string, any>).Query
  Whitelabel = (domainResolvers as Record<string, any>).Whitelabel
})

after(async () => {
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

describe('Whitelabel money is not branding', () => {
  it('gives an anonymous caller no figures for any brand', async () => {
    for (const b of brands) {
      const v = await read(b, ctxOf('default', [], false))
      assert.deepEqual(leaked(v), [], `an anonymous caller read ${leaked(v).join(', ')} for ${b}`)
    }
  })

  it('gives a signed-in caller holding nothing no figures either', async () => {
    for (const b of brands) {
      const v = await read(b, ctxOf(b, [{ domain: 'dashboard', actions: ['read'] }]))
      assert.deepEqual(leaked(v), [], `a caller holding nothing read ${leaked(v).join(', ')} for ${b}`)
    }
  })

  it('still leaves the branding fields readable before sign-in', async () => {
    // The whole point of leaving the operation open. If this breaks, the login
    // page cannot render the brand it is serving.
    const row = await Query.whitelabel(undefined, { id: brands[0] }, ctxOf('default', [], false), undefined)
    assert.ok(row, 'the branding query stopped returning anything')
    assert.ok(row.name, 'the brand name is gone')
  })

  it('shows an operator their own brand and nobody else’s', async () => {
    const { pool } = await import('@src/db/client.js')
    const r = await pool.query(
      `SELECT r.tenant, p.domain, p.action FROM roles r
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE p.domain IN ('credit.management','agents.credit') AND p.action = 'view'
       LIMIT 200`
    )
    if (!r.rows.length) return
    const tenant = String(r.rows[0].tenant)
    const m = new Map<string, string[]>()
    for (const x of r.rows as any[]) {
      if (String(x.tenant) !== tenant) continue
      if (!m.has(x.domain)) m.set(x.domain, [])
      m.get(x.domain)!.push(x.action)
    }
    const ctx = ctxOf(tenant, [...m].map(([domain, actions]) => ({ domain, actions })))

    const own = await read(tenant, ctx)
    assert.ok(
      MONEY.some((f) => own?.[f] !== null && own?.[f] !== undefined),
      'an operator lost sight of their own brand’s credit line'
    )
    for (const other of brands.filter((b) => b !== tenant)) {
      const v = await read(other, ctx)
      assert.deepEqual(leaked(v), [], `${tenant} read ${leaked(v).join(', ')} for ${other}`)
    }
  })

  it('shows a platform super admin every brand', async () => {
    const ctx = ctxOf('default', [{ domain: 'all', actions: ['*'] }])
    for (const b of brands) {
      const v = await read(b, ctx)
      assert.ok(v, `a super admin got nothing for ${b}`)
      assert.notEqual(v!.creditLimit, null, `a super admin lost creditLimit for ${b}`)
    }
  })
})
