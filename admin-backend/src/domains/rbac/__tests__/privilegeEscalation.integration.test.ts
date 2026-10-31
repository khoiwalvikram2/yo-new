/**
 * Can a role editor write themselves a role bigger than their own?
 *
 * `ensureNoPrivilegeEscalation` guarded role *assignment* — it reads the target
 * role's stored permissions and refuses one the actor does not itself hold. It
 * was called on all three assignment paths and on **none** of the three
 * definition paths (`createRBACRole`, `updateRBACRole`,
 * `setRBACRolePermissions`), nor on the flat `upsertRole` beside them.
 *
 * That is the sharper edge, because the pairs arrive in the request and
 * `ensurePermissions()` INSERTs any pair it has not seen before. So
 * `{ domain: 'all', actions: ['*'] }` was accepted verbatim, the row created,
 * and the assignment check then passed against the role the caller had just
 * authored. Two calls from `security.roles:create` — which every Whitelabel
 * Admin holds, via flat `roles:write` — to `all:*`.
 *
 * `ensureActorMayGrantPermissions` bounds the definition by the author. These
 * tests assert both directions: the escalation is refused, and a role editor
 * granting what they *do* hold still works. The second half matters as much as
 * the first — a check that refuses everything would pass a one-sided test while
 * taking the role editor screen away from the people who use it.
 *
 * Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'

const TENANT = 'escalation-test-tenant'

type Ctx = Record<string, unknown>

let Mutation: Record<string, unknown> = {}
let db: (typeof import('@src/db/client.js'))['db']
let editorId = 0
let superId = 0
let victimRoleId = 0

/** The pairs the role editor actually holds. Nothing else. */
const EDITOR_PERMS = [{ domain: 'security.roles', actions: ['create', 'update', 'assign'] }]

const ctxOf = (sub: number, permissions: unknown): Ctx => ({
  user: { sub: String(sub), name: 'T', roles: [], type: 'admin' },
  permissions,
  tenant: TENANT,
  whitelabel: { id: TENANT },
  request: { headers: {} },
  loaders: {},
})

const editor = () => ctxOf(editorId, EDITOR_PERMS)
const superAdmin = () => ctxOf(superId, [{ domain: 'all', actions: ['*'] }])

async function call(
  name: string,
  args: unknown,
  ctx: Ctx
): Promise<{ ok: boolean; message: string }> {
  const fn = Mutation[name]
  assert.equal(typeof fn, 'function', `${name} has no resolver — has it been renamed?`)
  try {
    const out = (await (fn as (p: unknown, a: unknown, c: unknown, i: unknown) => unknown)(
      undefined,
      args,
      ctx,
      undefined
    )) as { success?: boolean; message?: string } | null
    // Two shapes live here: the nested RBAC API returns a payload, the flat one
    // throws. Both count as refusal, neither as silent success.
    if (out && typeof out === 'object' && out.success === false) {
      return { ok: false, message: String(out.message ?? '') }
    }
    return { ok: true, message: '' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Grants a role a permission pair, creating the permission row if absent.
 *
 * `permissions`, `role_permissions` and `user_roles` each carry their own
 * `tenant` column, and `getUserPermissions` filters on all three. Omitting any
 * of them leaves the actor holding nothing, which reads exactly like a working
 * gate — so every insert here names the tenant explicitly.
 *
 * `permissions` also carries no unique constraint on `(tenant, domain, action)`,
 * so this checks before inserting rather than relying on ON CONFLICT.
 */
async function grant(roleId: number, domain: string, action: string): Promise<void> {
  const found = await db.execute(
    sql`SELECT id FROM permissions
        WHERE tenant = ${TENANT} AND domain = ${domain} AND action = ${action} LIMIT 1`
  )
  const permId = found.rows.length
    ? Number((found.rows[0] as { id: number }).id)
    : Number(
        (
          (
            await db.execute(
              sql`INSERT INTO permissions (tenant, domain, action)
                  VALUES (${TENANT}, ${domain}, ${action}) RETURNING id`
            )
          ).rows[0] as { id: number }
        ).id
      )
  await db.execute(
    sql`INSERT INTO role_permissions (tenant, role_id, permission_id)
        VALUES (${TENANT}, ${roleId}, ${permId})
        ON CONFLICT DO NOTHING`
  )
}

async function mkUser(name: string, roleName: string): Promise<{ userId: number; roleId: number }> {
  const u = await db.execute(sql`
    INSERT INTO users (tenant, name, username, status, password_hash)
    VALUES (${TENANT}, ${name}, ${name + '-' + Date.now()}, 'active', 'x') RETURNING id`)
  const userId = Number((u.rows[0] as { id: number }).id)
  const r = await db.execute(sql`
    INSERT INTO roles (tenant, name) VALUES (${TENANT}, ${roleName}) RETURNING id`)
  const roleId = Number((r.rows[0] as { id: number }).id)
  await db.execute(
    sql`INSERT INTO user_roles (tenant, user_id, role_id) VALUES (${TENANT}, ${userId}, ${roleId})`
  )
  return { userId, roleId }
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  const { domainResolvers } = await import('@src/domains/index.js')
  Mutation = (domainResolvers as Record<string, Record<string, unknown>>).Mutation

  await db.execute(sql`
    INSERT INTO whitelabels (id, name, domain, status)
    VALUES (${TENANT}, 'Escalation Test', ${TENANT + '.test'}, 'active')
    ON CONFLICT (id) DO NOTHING`)

  const ed = await mkUser('Editor', 'Role Editor')
  editorId = ed.userId
  for (const a of ['create', 'update', 'assign']) await grant(ed.roleId, 'security.roles', a)

  const su = await mkUser('Super', 'Platform Super')
  superId = su.userId
  await grant(su.roleId, 'all', '*')

  const v = await db.execute(sql`
    INSERT INTO roles (tenant, name) VALUES (${TENANT}, 'Victim') RETURNING id`)
  victimRoleId = Number((v.rows[0] as { id: number }).id)
})

after(async () => {
  if (db) {
    await db.execute(
      sql`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE tenant = ${TENANT})`
    )
    await db.execute(sql`DELETE FROM permissions WHERE tenant = ${TENANT}`)
    await db.execute(
      sql`DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE tenant = ${TENANT})`
    )
    await db.execute(sql`DELETE FROM roles WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM users WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM whitelabels WHERE id = ${TENANT}`)
  }
  // recordAuditDb reaches the Redis emitter, whose sockets otherwise keep the
  // process alive until the runner's timeout.
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

const ALL_STAR = [{ domain: 'all', actions: ['*'] }]
const NOT_HELD = [{ domain: 'players.profile', actions: ['update'] }]

describe('a role editor cannot define a role larger than their own', () => {
  it('refuses upsertRole granting all:*', async () => {
    const r = await call('upsertRole', { input: { name: 'Escalated', permissions: ALL_STAR } }, editor())
    assert.equal(r.ok, false, 'upsertRole created an all:* role — the escalation is open')
    assert.match(r.message, /escalation|all:\*|do not hold/i, `refused, but not on escalation: ${r.message}`)
  })

  it('refuses createRBACRole granting all:*', async () => {
    const r = await call('createRBACRole', { input: { name: 'Escalated2', permissions: ALL_STAR } }, editor())
    assert.equal(r.ok, false, 'createRBACRole created an all:* role')
    assert.match(r.message, /escalation|all:\*|do not hold/i, `refused, but not on escalation: ${r.message}`)
  })

  it('refuses setRBACRolePermissions granting all:*', async () => {
    const r = await call(
      'setRBACRolePermissions',
      { roleId: String(victimRoleId), permissions: ALL_STAR },
      editor()
    )
    assert.equal(r.ok, false, 'setRBACRolePermissions widened a role to all:*')
    assert.match(r.message, /escalation|all:\*|do not hold/i, `refused, but not on escalation: ${r.message}`)
  })

  it('refuses updateRBACRole granting all:*', async () => {
    const r = await call(
      'updateRBACRole',
      { input: { id: String(victimRoleId), permissions: ALL_STAR } },
      editor()
    )
    assert.equal(r.ok, false, 'updateRBACRole widened a role to all:*')
    assert.match(
      r.message,
      /escalation|all:\*|do not hold|not found/i,
      `refused, but not on escalation: ${r.message}`
    )
  })

  it('refuses a single permission the editor does not hold', async () => {
    const r = await call('upsertRole', { input: { name: 'Sneaky', permissions: NOT_HELD } }, editor())
    assert.equal(r.ok, false, 'a role editor granted players.profile:update, which they do not hold')
    assert.match(r.message, /escalation|do not hold/i, `refused, but not on escalation: ${r.message}`)
  })

  it('leaves nothing behind when it refuses', async () => {
    const rows = await db.execute(sql`
      SELECT name FROM roles
      WHERE tenant = ${TENANT} AND name IN ('Escalated', 'Escalated2', 'Sneaky')`)
    assert.equal(rows.rows.length, 0, `refused roles were still created: ${JSON.stringify(rows.rows)}`)
  })
})

describe('a role editor cannot mint a name that confers platform standing', () => {
  // `buildAuthContext` decides Super Admin from role names, and a Super Admin
  // may name any tenant in X-Whitelabel-ID. So a role called "Supervisor Admin"
  // holding *nothing* still switched its holder's tenant, passing every
  // permission check on the way — the subset check cannot see a name.
  const HELD = [{ domain: 'security.roles', actions: ['create'] }]

  for (const name of ['Super Admin', 'super_admin', 'Supervisor Admin', 'super duper admin']) {
    it(`refuses upsertRole naming a role ${JSON.stringify(name)}`, async () => {
      const r = await call('upsertRole', { input: { name, permissions: HELD } }, editor())
      assert.equal(r.ok, false, `a role editor created a role named ${name}`)
      assert.match(r.message, /role name|platform administrator/i, r.message)
    })
  }

  it('refuses renaming an existing role into the pattern', async () => {
    const r = await call(
      'updateRBACRole',
      { input: { id: String(victimRoleId), name: 'Super Admin Deputy' } },
      editor()
    )
    assert.equal(r.ok, false, 'a role editor renamed a role into the platform pattern')
    assert.match(r.message, /role name|platform administrator/i, r.message)
  })

  it('allows an ordinary name', async () => {
    const r = await call('upsertRole', { input: { name: 'Desk Supervisor', permissions: HELD } }, editor())
    assert.equal(r.ok, true, `an ordinary role name was refused: ${r.message}`)
  })

  it('allows a platform super admin to use the name', async () => {
    const r = await call('upsertRole', { input: { name: 'Super Admin Backup', permissions: HELD } }, superAdmin())
    assert.equal(r.ok, true, `a super admin was refused their own naming: ${r.message}`)
  })
})

describe('the check does not take away legitimate use', () => {
  it('allows a role editor to grant exactly what they hold', async () => {
    const r = await call(
      'upsertRole',
      { input: { name: 'Deputy Editor', permissions: [{ domain: 'security.roles', actions: ['create'] }] } },
      editor()
    )
    assert.equal(r.ok, true, `a role editor was refused their own permission: ${r.message}`)
  })

  it('allows a platform super admin to define an all:* role', async () => {
    const r = await call('upsertRole', { input: { name: 'Another Super', permissions: ALL_STAR } }, superAdmin())
    assert.equal(r.ok, true, `a super admin was refused: ${r.message}`)
  })
})
