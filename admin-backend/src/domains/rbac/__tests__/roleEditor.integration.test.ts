/**
 * The role editor as a Whitelabel Admin uses it (SYS-04, SYS-06, SYS-09, SCO-11).
 *
 * - SYS-04: the escalation check compared the proposed nested pairs with the literal pairs stored on the
 *   author's roles. A Whitelabel Admin holds flat grants (`audit:read`, `players:view`, `config:read`), which
 *   authorize it everywhere through the nested->flat mapping, so every nested pair the editor offers was
 *   refused as "privilege escalation" while that same admin used the screens behind them.
 * - SYS-06: updateRBACRole renamed the role before the permission check, so a refused save was half applied.
 * - SYS-09: creating, changing and deleting a role left no audit row.
 * - SCO-11: updateRBACRole wrote role_permissions under another tenant's role id before answering "Role not
 *   found".
 *
 * Driven through the real guarded Mutation map. Two throwaway `vfyfix-` tenants with their users, roles and
 * permissions are created and removed; audit rows are left alone. Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const STAMP = randomUUID().slice(0, 8)
const T = `vfyfix-roles-${STAMP}`
const U = `vfyfix-roles-u-${STAMP}`

let db: (typeof import('@src/db/client.js'))['db']
let Mutation: Record<string, any> = {}
const ids = { author: 0, assigner: 0, member: 0, foreignRole: 0 }

/** The flat grants a Whitelabel Admin's role holds (a subset of the seeded one). */
const AUTHOR_FLAT: Array<[string, string]> = [
  ['roles', 'read'], ['roles', 'write'], ['roles', 'delete'], ['roles', 'assign'],
  ['audit', 'read'], ['players', 'view'], ['config', 'read'],
]

const aggregate = (pairs: Array<[string, string]>) => {
  const byDomain = new Map<string, string[]>()
  for (const [domain, action] of pairs) byDomain.set(domain, [...(byDomain.get(domain) ?? []), action])
  return [...byDomain].map(([domain, actions]) => ({ domain, actions }))
}

const at = (fieldName: string) => ({ parentType: { name: 'Mutation' }, fieldName })
const ctxFor = (userId: number, permissions: Array<[string, string]>) => ({
  user: { sub: String(userId), name: 'vfyfix', roles: ['Whitelabel Admin'], type: 'admin' },
  permissions: aggregate(permissions),
  tenant: T,
  whitelabel: { id: T },
  request: { headers: {} },
})
const author = () => ctxFor(ids.author, AUTHOR_FLAT)
const call = (name: string, args: unknown, ctx = author()) => Mutation[name](undefined, args, ctx, at(name))

const insertUser = async (tenant: string, label: string) =>
  Number(((await db.execute(sql`INSERT INTO users (tenant, name, password_hash) VALUES (${tenant}, ${'vfyfix ' + label}, 'x') RETURNING id`)).rows[0] as any).id)
const insertRole = async (tenant: string, name: string) =>
  Number(((await db.execute(sql`INSERT INTO roles (tenant, name) VALUES (${tenant}, ${name}) RETURNING id`)).rows[0] as any).id)

/** Grants a role a pair in its tenant (each of the three tables carries the tenant; getUserPermissions filters on all). */
async function grant(tenant: string, roleId: number, domain: string, action: string) {
  const found = await db.execute(sql`SELECT id FROM permissions WHERE tenant = ${tenant} AND domain = ${domain} AND action = ${action} LIMIT 1`)
  const permId = found.rows.length
    ? Number((found.rows[0] as any).id)
    : Number(((await db.execute(sql`INSERT INTO permissions (tenant, domain, action) VALUES (${tenant}, ${domain}, ${action}) RETURNING id`)).rows[0] as any).id)
  await db.execute(sql`INSERT INTO role_permissions (tenant, role_id, permission_id) VALUES (${tenant}, ${roleId}, ${permId})`)
}

const roleRow = async (roleId: number) =>
  (await db.execute(sql`SELECT name FROM roles WHERE id = ${roleId}`)).rows[0] as { name: string } | undefined
const rolePairs = async (roleId: number, tenant: string) =>
  (await db.execute(sql`SELECT p.domain || ':' || p.action AS pair FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ${roleId} AND rp.tenant = ${tenant} ORDER BY 1`)).rows.map((r: any) => String(r.pair))

/** recordAuditDb is fire-and-forget in these resolvers, so the row may land just after the answer. */
async function auditRows(roleId: number, expected: number) {
  let rows: any[] = []
  for (let i = 0; i < 40; i++) {
    rows = (await db.execute(sql`SELECT action, actor_id, before, after FROM audit_logs
      WHERE tenant = ${T} AND domain = 'rbac' AND resource_type = 'role' AND resource_id = ${String(roleId)} ORDER BY id`)).rows
    if (rows.length >= expected) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return rows
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  const { domainResolvers } = await import('@src/domains/index.js')
  Mutation = (domainResolvers as any).Mutation

  ids.author = await insertUser(T, 'wl author')
  const authorRole = await insertRole(T, 'vfyfix wl admin')
  await db.execute(sql`INSERT INTO user_roles (tenant, user_id, role_id) VALUES (${T}, ${ids.author}, ${authorRole})`)
  for (const [domain, action] of AUTHOR_FLAT) await grant(T, authorRole, domain, action)

  // A support admin who may assign roles (nested) and read the audit trail (flat), and nothing more: the
  // assignment path's subset check, without support-admin delegation.
  ids.assigner = await insertUser(T, 'assigner')
  const assignerRole = await insertRole(T, 'vfyfix assigner')
  await db.execute(sql`INSERT INTO user_roles (tenant, user_id, role_id) VALUES (${T}, ${ids.assigner}, ${assignerRole})`)
  await grant(T, assignerRole, 'security.roles', 'assign')
  await grant(T, assignerRole, 'audit', 'read')
  ids.member = await insertUser(T, 'member')

  ids.foreignRole = await insertRole(U, 'vfyfix foreign manager')
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM role_permissions WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM permissions WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM user_roles WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM roles WHERE tenant IN (${T}, ${U})`)
    await db.execute(sql`DELETE FROM users WHERE tenant IN (${T}, ${U})`)
  }
  // recordAuditDb reaches the Redis emitter, whose socket otherwise keeps the process alive.
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
})

describe('the author may grant what it can do, through flat grants included (SYS-04)', () => {
  it('creates a role with nested pairs its flat grants cover', async () => {
    const out = await call('createRBACRole', { input: { name: 'vfyfix auditors', permissions: [
      { domain: 'audit.events', actions: ['view'] },
      { domain: 'players.list', actions: ['view'] },
      { domain: 'config.app', actions: ['view'] },
      { domain: 'security.roles', actions: ['view'] },
    ] } })
    assert.equal(out.success, true, out.message)
    assert.deepEqual(await rolePairs(Number(out.role.id), T), ['audit.events:view', 'config.app:view', 'players.list:view', 'security.roles:view'])
  })

  it('still refuses a nested pair no grant of the author covers', async () => {
    const out = await call('createRBACRole', { input: { name: 'vfyfix casino', permissions: [{ domain: 'casino.management', actions: ['update'] }] } })
    assert.equal(out.success, false)
    assert.match(out.message, /do not hold/)
    assert.equal((await db.execute(sql`SELECT 1 FROM roles WHERE tenant = ${T} AND name = 'vfyfix casino'`)).rows.length, 0)
  })

  it('still refuses all:*', async () => {
    const out = await call('createRBACRole', { input: { name: 'vfyfix everything', permissions: [{ domain: 'all', actions: ['*'] }] } })
    assert.equal(out.success, false)
    assert.match(out.message, /all:\*/)
  })

  it('assigns a role whose nested pairs the assigner reaches through a flat grant, and no more', async () => {
    const assigner = ctxFor(ids.assigner, [['security.roles', 'assign'], ['audit', 'read']])
    const readers = await insertRole(T, 'vfyfix readers')
    await grant(T, readers, 'audit.events', 'view')
    const ok = await call('assignRoleToAdmin', { input: { userId: String(ids.member), roleId: String(readers) } }, assigner)
    assert.equal(ok.success, true, ok.message)

    const wider = await insertRole(T, 'vfyfix wider')
    await grant(T, wider, 'casino.management', 'update')
    const refused = await call('assignRoleToAdmin', { input: { userId: String(ids.member), roleId: String(wider) } }, assigner)
    assert.equal(refused.success, false)
    assert.match(refused.message, /lacks permission "casino.management:update"/)
  })
})

describe('a role change is all or nothing, and on the record (SYS-06, SYS-09)', () => {
  it('a refused update leaves the name and the permissions as they were', async () => {
    const created = await call('createRBACRole', { input: { name: 'vfyfix desk', permissions: [{ domain: 'audit.events', actions: ['view'] }] } })
    assert.equal(created.success, true, created.message)
    const roleId = Number(created.role.id)

    const out = await call('updateRBACRole', { input: { id: String(roleId), name: 'vfyfix desk renamed', permissions: [{ domain: 'casino.management', actions: ['update'] }] } })
    assert.equal(out.success, false)
    assert.equal((await roleRow(roleId))?.name, 'vfyfix desk', 'the refused save renamed the role')
    assert.deepEqual(await rolePairs(roleId, T), ['audit.events:view'])
  })

  it('create, update, set permissions and delete each leave an audit row with before and after', async () => {
    const created = await call('createRBACRole', { input: { name: 'vfyfix audited', permissions: [{ domain: 'audit.events', actions: ['view'] }] } })
    assert.equal(created.success, true, created.message)
    const roleId = Number(created.role.id)
    assert.equal((await call('updateRBACRole', { input: { id: String(roleId), name: 'vfyfix audited 2' } })).success, true)
    assert.equal((await call('setRBACRolePermissions', { roleId: String(roleId), permissions: [{ domain: 'players.list', actions: ['view'] }] })).success, true)
    assert.equal((await call('deleteRBACRole', { id: String(roleId) })).success, true)

    const rows = await auditRows(roleId, 4)
    assert.deepEqual(rows.map((row) => row.action), ['create_role', 'update_role', 'set_role_permissions', 'delete_role'])
    assert.ok(rows.every((row) => row.actor_id === String(ids.author)))
    assert.equal(rows[1].before.name, 'vfyfix audited'); assert.equal(rows[1].after.name, 'vfyfix audited 2')
    assert.deepEqual(rows[2].before.permissions, [{ domain: 'audit.events', actions: ['view'] }])
    assert.deepEqual(rows[2].after.permissions, [{ domain: 'players.list', actions: ['view'] }])
    assert.equal(rows[3].before.name, 'vfyfix audited 2')
  })
})

describe("another tenant's role is not found before anything is written (SCO-11)", () => {
  it('updateRBACRole refuses it and writes no permission rows under it', async () => {
    const out = await call('updateRBACRole', { input: { id: String(ids.foreignRole), name: 'vfyfix hijacked', permissions: [{ domain: 'audit.events', actions: ['view'] }] } })
    assert.equal(out.success, false)
    assert.equal(out.message, 'Role not found')
    assert.equal((await roleRow(ids.foreignRole))?.name, 'vfyfix foreign manager')
    assert.deepEqual(await rolePairs(ids.foreignRole, T), [], 'role_permissions rows were written under the foreign role id')
  })

  it('setRBACRolePermissions refuses it the same way', async () => {
    const out = await call('setRBACRolePermissions', { roleId: String(ids.foreignRole), permissions: [{ domain: 'audit.events', actions: ['view'] }] })
    assert.equal(out.success, false)
    assert.equal(out.message, 'Role not found')
    assert.deepEqual(await rolePairs(ids.foreignRole, T), [])
  })
})
