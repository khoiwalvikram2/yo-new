/**
 * Whose referral link a caller may read, and whose it may create (SCO-03, SCO-06).
 *
 * Measured before:
 *   - Query.referralLink answered a request with no session at all with any player's or agent's link, and mapped
 *     a code back to its owner's user id; every agent read links outside its subtree (player 461's, outside all
 *     four test agents' downlines);
 *   - generateReferralLink(userId) wrote the link under the caller's tenant for any id: kondareddi's admin created
 *     a live kondareddi code owned by grandwinn player 2050, which the player site then honours at sign-up. Once
 *     that was refused, a same-tenant support admin (staff share the users table) still got a code of its own.
 *
 * Driven through the real guarded resolver maps. Two throwaway `vfyfix-` tenants with their agents, players and
 * links are created and removed. Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const STAMP = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
const T = `vfyfix-ref-${STAMP.toLowerCase()}`
const U = `vfyfix-ref-u-${STAMP.toLowerCase()}`
const code = (n: number) => `VF${STAMP}${n}`

let db: (typeof import('@src/db/client.js'))['db']
let Query: Record<string, any> = {}
let Mutation: Record<string, any> = {}
const ids = { a1: '', a2: '', au: '', p1: 0, p2: 0, p3: 0, q: 0, staff: 0, exStaff: 0 }

const at = (root: 'Query' | 'Mutation', fieldName: string) => ({ parentType: { name: root }, fieldName })
const read = (args: Record<string, unknown>, ctx: unknown) => Query.referralLink(undefined, args, ctx, at('Query', 'referralLink'))
const generate = (args: Record<string, unknown>, ctx: unknown) => Mutation.generateReferralLink(undefined, args, ctx, at('Mutation', 'generateReferralLink'))

const anonymous = () => ({ tenant: T, whitelabel: { id: T }, request: { headers: {} } })
const admin = (permissions: Array<{ domain: string; actions: string[] }>) => ({
  user: { sub: '987657', name: 'vfyfix wl', roles: ['Whitelabel Admin'], type: 'admin' },
  permissions,
  tenant: T,
  whitelabel: { id: T },
  request: { headers: {} },
})
const agentA1 = () => ({
  user: { sub: ids.a1, agentId: ids.a1, type: 'agent', roles: [] },
  permissions: [{ domain: 'agents', actions: ['view', 'manage', 'read'] }, { domain: 'players', actions: ['view', 'manage'] }],
  tenant: T,
  whitelabel: { id: T },
  request: { headers: {} },
})

async function insertAgent(tenant: string): Promise<string> {
  return String(((await db.execute(sql`
    INSERT INTO agents (tenant_id, scheme_type, allowed_domains, status) VALUES (${tenant}, 'SHARING', ARRAY['sports']::text[], 'ACTIVE') RETURNING id`)).rows[0] as any).id)
}
/** A player: like every real one, it has a wallet (staff are created without one). */
async function insertPlayer(tenant: string, label: string, agentId: string | null): Promise<number> {
  const id = Number(((await db.execute(sql`
    INSERT INTO users (tenant, name, password_hash, agent_id) VALUES (${tenant}, ${'vfyfix ' + label}, 'x', ${agentId}) RETURNING id`)).rows[0] as any).id)
  await db.execute(sql`INSERT INTO wallets (tenant, user_id, currency) VALUES (${tenant}, ${id}, 'INR')`)
  return id
}
/** A staff account of the tenant: no wallet, and a role there unless `withRole` is false (all its roles revoked). */
async function insertStaff(tenant: string, label: string, withRole: boolean): Promise<number> {
  const id = Number(((await db.execute(sql`
    INSERT INTO users (tenant, name, password_hash) VALUES (${tenant}, ${'vfyfix ' + label}, 'x') RETURNING id`)).rows[0] as any).id)
  if (withRole) {
    const roleId = Number(((await db.execute(sql`
      INSERT INTO roles (tenant, name) VALUES (${tenant}, 'vfyfix Support') RETURNING id`)).rows[0] as any).id)
    await db.execute(sql`INSERT INTO user_roles (tenant, user_id, role_id) VALUES (${tenant}, ${id}, ${roleId})`)
  }
  return id
}
async function insertLink(tenant: string, owner: { userId?: number; agentId?: string }, c: string) {
  await db.execute(sql`INSERT INTO referral_links (tenant, user_id, agent_id, code) VALUES (${tenant}, ${owner.userId ?? null}, ${owner.agentId ?? null}, ${c})`)
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  const { domainResolvers } = await import('@src/domains/index.js')
  ;({ Query, Mutation } = domainResolvers as any)

  ids.a1 = await insertAgent(T)
  ids.a2 = await insertAgent(T)
  ids.au = await insertAgent(U)
  ids.p1 = await insertPlayer(T, 'p1 of a1', ids.a1)
  ids.p2 = await insertPlayer(T, 'p2 no agent', null)
  ids.p3 = await insertPlayer(T, 'p3 no link', null)
  ids.q = await insertPlayer(U, 'q other tenant', null)
  ids.staff = await insertStaff(T, 'support admin', true)
  ids.exStaff = await insertStaff(T, 'admin with every role revoked', false)
  await insertLink(T, { userId: ids.p1 }, code(1))
  await insertLink(T, { userId: ids.p2 }, code(2))
  await insertLink(T, { agentId: ids.a1 }, code(3))
  await insertLink(T, { agentId: ids.a2 }, code(4))
  await insertLink(U, { userId: ids.q }, code(5))
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM referral_links WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM user_roles WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM roles WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM wallets WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM users WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM agents WHERE tenant_id IN (${T}, ${U})`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js').catch(() => ({ closeRedisEmitter: async () => {} }))
  await closeRedisEmitter().catch(() => {})
})

describe('referralLink needs a session and a reason to see the link', () => {
  it('refuses a request with no session, by id, by code and by agent', async () => {
    for (const args of [{ userId: String(ids.p1) }, { code: code(1) }, { agentId: ids.a1 }]) {
      await assert.rejects(async () => read(args, anonymous()), /Unauthorized: authentication required/)
    }
  })

  it('refuses an admin without referrals.overview:view', async () => {
    await assert.rejects(async () => read({ userId: String(ids.p1) }, admin([{ domain: 'jackpots', actions: ['read'] }])), /Forbidden/)
  })

  it("answers an admin holding it, within its own tenant only", async () => {
    const reader = admin([{ domain: 'referrals', actions: ['read'] }])
    assert.equal((await read({ userId: String(ids.p1) }, reader))?.code, code(1))
    assert.equal((await read({ code: code(2) }, reader))?.userId, ids.p2)
    assert.equal((await read({ agentId: ids.a2 }, reader))?.code, code(4))
    assert.equal(await read({ code: code(5) }, reader), null, "another tenant's code was mapped to its owner")
  })
})

describe("an agent reads only its own subtree's links", () => {
  it("its player's link and its own link", async () => {
    assert.equal((await read({ userId: String(ids.p1) }, agentA1()))?.code, code(1))
    assert.equal((await read({ code: code(1) }, agentA1()))?.userId, ids.p1)
    assert.equal((await read({ agentId: ids.a1 }, agentA1()))?.code, code(3))
  })

  it("nothing of a player or agent outside it, by id or by code", async () => {
    assert.equal(await read({ userId: String(ids.p2) }, agentA1()), null)
    assert.equal(await read({ code: code(2) }, agentA1()), null)
    assert.equal(await read({ agentId: ids.a2 }, agentA1()), null)
    assert.equal(await read({ code: code(4) }, agentA1()), null)
  })
})

describe('generateReferralLink writes only for its own tenant', () => {
  const linksOf = async (userId: number) =>
    Number(((await db.execute(sql`SELECT count(*)::int AS n FROM referral_links WHERE user_id = ${userId}`)).rows[0] as any).n)

  it("refuses another tenant's player and writes nothing", async () => {
    const before = await linksOf(ids.q)
    const out = await generate({ userId: String(ids.q) }, admin([{ domain: 'referrals', actions: ['read', 'write'] }]))
    assert.equal(out.success, false)
    assert.match(out.message, /User not found/)
    assert.equal(await linksOf(ids.q), before, "a link was written for another tenant's player")
  })

  it("refuses another tenant's agent (the repository already checked this one)", async () => {
    const out = await generate({ agentId: ids.au }, admin([{ domain: 'referrals', actions: ['read', 'write'] }]))
    assert.equal(out.success, false)
    assert.match(out.message, /different tenant/)
  })

  it('refuses a support admin of its own tenant and writes nothing: referral links belong to players', async () => {
    const out = await generate({ userId: String(ids.staff) }, admin([{ domain: 'referrals', actions: ['read', 'write'] }]))
    assert.equal(out.success, false)
    assert.match(out.message, /User not found/)
    assert.equal(await linksOf(ids.staff), 0, 'a staff account got a referral code')
  })

  it('refuses a staff account whose roles were all revoked (no role, no wallet)', async () => {
    const out = await generate({ userId: String(ids.exStaff) }, admin([{ domain: 'referrals', actions: ['read', 'write'] }]))
    assert.equal(out.success, false)
    assert.match(out.message, /User not found/)
    assert.equal(await linksOf(ids.exStaff), 0)
  })

  it('still creates a link for its own player', async () => {
    const out = await generate({ userId: String(ids.p3) }, admin([{ domain: 'referrals', actions: ['read', 'write'] }]))
    assert.equal(out.success, true, out.message)
    assert.equal(out.link?.tenant, T)
    assert.equal(await linksOf(ids.p3), 1)
  })
})
