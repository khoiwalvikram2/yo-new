/**
 * CRM user management from the admin panel.
 *
 * This surface exists because the CRM's own user management needs a working CRM
 * login to reach, which is no help to a whitelabel that hasn't got one. It
 * therefore hands a whitelabel administrator the ability to mint logins into a
 * system holding player personal data, and the properties worth testing are all
 * about the edges of that:
 *
 *   - a whitelabel administrator reaches their own whitelabel and no other,
 *     including when they name another one outright;
 *   - a Super Admin reaches any;
 *   - a CRM session reaches none of it — which is a property of the *names*,
 *     since `guardAdminSurface` exempts the `crm` prefix;
 *   - the seat limit holds here exactly as it does inside the CRM;
 *   - a user created here can actually sign in there.
 *
 * Requires DATABASE_URL. Uses its own tenants and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchema, graphql } from 'graphql'
import { randomUUID } from 'node:crypto'

const SUFFIX = randomUUID().slice(0, 8)
const TENANT_A = `wlcrm-a-${SUFFIX}`
const TENANT_B = `wlcrm-b-${SUFFIX}`

let schema: ReturnType<typeof buildSchema>
let rootValue: Record<string, unknown>

/** A Super Admin, who may act on any whitelabel. */
const superAdminCtx = {
  user: { sub: '1', name: 'Root', roles: ['Super Admin'] },
  tenant: 'default',
  whitelabel: { id: 'default' },
  permissions: [{ domain: 'all', actions: ['*'] }],
  request: { headers: {} },
}

/** Whitelabel administrators, one per tenant. */
const wlAdmin = (tenant: string) => ({
  user: { sub: '77', name: 'WL Admin', roles: ['Whitelabel Admin'] },
  tenant,
  whitelabel: { id: tenant },
  permissions: [{ domain: 'config', actions: ['read', 'write'] }],
  request: { headers: {} },
})

/** Someone with an admin login but no administrative role. */
const plainAdminCtx = {
  user: { sub: '88', name: 'Reports Only', roles: ['Reports Viewer'] },
  tenant: TENANT_A,
  whitelabel: { id: TENANT_A },
  permissions: [{ domain: 'reporting', actions: ['read'] }],
  request: { headers: {} },
}

const anonCtx = { tenant: TENANT_A, whitelabel: { id: TENANT_A }, request: { headers: {} } }

async function run(source: string, ctx: unknown, variableValues?: Record<string, unknown>) {
  const res = await graphql({ schema, source, rootValue, contextValue: ctx, variableValues })
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '))
  return res.data as Record<string, any>
}

/** Runs an operation expecting refusal, and returns the message. */
async function refusal(source: string, ctx: unknown, variableValues?: Record<string, unknown>) {
  const res = await graphql({ schema, source, rootValue, contextValue: ctx, variableValues })
  return res.errors?.map((e) => e.message).join('; ') ?? ''
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { typeDefs } = await import('@src/types/graphql.js')
  const { domainResolvers } = await import('@src/domains/index.js')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')

  schema = buildSchema(typeDefs)
  rootValue = Object.fromEntries(
    Object.entries({ ...domainResolvers.Query, ...(domainResolvers as any).Mutation }).map(
      ([n, fn]: [string, any]) => [n, (a: any, c: any, i: any) => fn(undefined, a, c, i)]
    )
  )

  // Both whitelabels have a CRM, so a refusal is never merely "not enabled".
  for (const t of [TENANT_A, TENANT_B]) {
    await db.execute(sql`
      INSERT INTO crm_whitelabel_settings (tenant, enabled, seat_limit)
      VALUES (${t}, true, 5)`)
  }
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  await db.execute(sql`DELETE FROM user_roles WHERE user_id = 4242`)
  await db.execute(sql`DELETE FROM users WHERE id = 4242`)
  for (const t of [TENANT_A, TENANT_B]) {
    await db.execute(sql`DELETE FROM roles WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_user_roles WHERE crm_user_id IN (SELECT id FROM crm_users WHERE tenant = ${t})`)
    await db.execute(sql`DELETE FROM crm_role_permissions WHERE role_id IN (SELECT id FROM crm_roles WHERE tenant = ${t})`)
    await db.execute(sql`DELETE FROM crm_users WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_roles WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${t}`)
    await db.execute(sql`DELETE FROM audit_logs WHERE tenant = ${t}`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
  const { closeRedisClient } = await import('@src/config/redisClient.js')
  await closeRedisClient()
})

const CREATE = `mutation($t:ID,$i:CrmCreateUserInput!){ whitelabelCrmCreateUser(tenant:$t, input:$i){ ok error } }`
const LIST = `query($t:ID){ whitelabelCrmUsers(tenant:$t){ tenant enabled seatLimit seatsUsed canChooseTenant users{ id name username status roleNames requirePasswordReset } } }`

describe('a whitelabel administrator manages their own CRM users', () => {
  it('creates one', async () => {
    const res = await run(CREATE, wlAdmin(TENANT_A), {
      t: null,
      i: { name: 'Desk One', username: `deskone-${SUFFIX}`, password: 'DeskPass2026', roleIds: [] },
    })
    assert.equal(res.whitelabelCrmCreateUser.ok, true, res.whitelabelCrmCreateUser.error ?? '')
  })

  it('lists them with the seat allowance, and cannot choose a whitelabel', async () => {
    const res = await run(LIST, wlAdmin(TENANT_A), { t: null })
    const page = res.whitelabelCrmUsers
    assert.equal(page.tenant, TENANT_A)
    assert.equal(page.enabled, true)
    assert.equal(page.seatLimit, 5)
    assert.equal(page.seatsUsed, 1)
    assert.equal(page.canChooseTenant, false, 'only a Super Admin picks the whitelabel')
    assert.equal(page.users.length, 1)
    assert.equal(page.users[0].name, 'Desk One')
  })

  it('resets a password and forces a change at next sign-in', async () => {
    const list = await run(LIST, wlAdmin(TENANT_A), { t: null })
    const id = list.whitelabelCrmUsers.users[0].id
    const res = await run(
      `mutation($id:ID!){ whitelabelCrmResetPassword(id:$id, newPassword:"BrandNewPass2026"){ ok error } }`,
      wlAdmin(TENANT_A),
      { id }
    )
    assert.equal(res.whitelabelCrmResetPassword.ok, true, res.whitelabelCrmResetPassword.error ?? '')

    const after = await run(LIST, wlAdmin(TENANT_A), { t: null })
    assert.equal(after.whitelabelCrmUsers.users[0].requirePasswordReset, true)
  })

  it('applies the same password policy the CRM does', async () => {
    // Both surfaces call `checkCrmPassword`; a policy copied into the second
    // one would drift from the first.
    const res = await run(CREATE, wlAdmin(TENANT_A), {
      t: null,
      i: { name: 'Too Short', username: `short-${SUFFIX}`, password: 'abc' },
    })
    assert.equal(res.whitelabelCrmCreateUser.ok, false)
    assert.match(res.whitelabelCrmCreateUser.error, /at least 10 characters/)
  })

  it('suspends without the CRM-side self-protection getting in the way', async () => {
    // The CRM refuses to let an administrator suspend themselves. An
    // admin-panel caller is not a CRM user, so there is no self to protect —
    // and this surface is the way back in afterwards.
    const list = await run(LIST, wlAdmin(TENANT_A), { t: null })
    const id = list.whitelabelCrmUsers.users[0].id
    const res = await run(
      `mutation($id:ID!){ whitelabelCrmSetUserStatus(id:$id, status:"SUSPENDED"){ ok error } }`,
      wlAdmin(TENANT_A),
      { id }
    )
    assert.equal(res.whitelabelCrmSetUserStatus.ok, true, res.whitelabelCrmSetUserStatus.error ?? '')

    const after = await run(LIST, wlAdmin(TENANT_A), { t: null })
    assert.equal(after.whitelabelCrmUsers.users[0].status, 'SUSPENDED')

    await run(
      `mutation($id:ID!){ whitelabelCrmSetUserStatus(id:$id, status:"ACTIVE"){ ok error } }`,
      wlAdmin(TENANT_A),
      { id }
    )
  })
})

describe('a whitelabel administrator reaches no other whitelabel', () => {
  it('cannot read another whitelabel by naming it', async () => {
    // B's tenant is passed explicitly. It must be overridden, not honoured —
    // and the response must describe A, not refuse in a way that confirms B.
    const res = await run(LIST, wlAdmin(TENANT_A), { t: TENANT_B })
    assert.equal(res.whitelabelCrmUsers.tenant, TENANT_A, 'the argument is overridden with their own')
  })

  it('cannot create into another whitelabel by naming it', async () => {
    const res = await run(CREATE, wlAdmin(TENANT_A), {
      t: TENANT_B,
      i: { name: 'Trespasser', username: `tres-${SUFFIX}`, password: 'TrespassPass2026' },
    })
    assert.equal(res.whitelabelCrmCreateUser.ok, true, 'it succeeds — into their own whitelabel')

    const b = await run(LIST, wlAdmin(TENANT_B), { t: null })
    assert.equal(
      b.whitelabelCrmUsers.users.some((u: any) => u.name === 'Trespasser'),
      false,
      'and nothing of theirs landed in the other whitelabel'
    )
  })

  it('cannot act on a user id belonging to another whitelabel', async () => {
    await run(CREATE, wlAdmin(TENANT_B), {
      t: null,
      i: { name: 'B Desk', username: `bdesk-${SUFFIX}`, password: 'BDeskPass2026' },
    })
    const b = await run(LIST, wlAdmin(TENANT_B), { t: null })
    const bId = b.whitelabelCrmUsers.users[0].id

    const res = await run(
      `mutation($id:ID!){ whitelabelCrmResetPassword(id:$id, newPassword:"StolenPass2026"){ ok error } }`,
      wlAdmin(TENANT_A),
      { id: bId }
    )
    assert.equal(res.whitelabelCrmResetPassword.ok, false)
    assert.equal(res.whitelabelCrmResetPassword.error, 'User not found', 'out of reach reads as missing')
  })
})

describe('the administrator role is recognised by what it is, not what it is called', () => {
  // `roles.name` is free text and `renameRole` will change it to anything, so a
  // check that reads the name loses access the moment somebody renames their
  // own role — through an action with no visible connection to the CRM. The
  // `is_whitelabel_admin` flag is what carries the identity instead.
  let roleId = 0
  const realAdminCtx = (roleNames: string[]) => ({
    user: { sub: '4242', name: 'Owner', roles: roleNames },
    tenant: TENANT_A,
    whitelabel: { id: TENANT_A },
    permissions: [{ domain: 'config', actions: ['read', 'write'] }],
    request: { headers: {} },
  })

  it('sets up a real admin user holding a flagged role', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const r = await db.execute(sql`
      INSERT INTO roles (tenant, name, is_whitelabel_admin)
      VALUES (${TENANT_A}, 'Whitelabel Admin', true) RETURNING id`)
    roleId = Number((r.rows[0] as { id: number }).id)
    await db.execute(sql`
      INSERT INTO users (id, tenant, name, email, password_hash)
      VALUES (4242, ${TENANT_A}, 'Owner', ${'owner-' + SUFFIX + '@example.test'}, 'x')
      ON CONFLICT (id) DO UPDATE SET tenant = ${TENANT_A}`)
    await db.execute(sql`
      INSERT INTO user_roles (tenant, user_id, role_id) VALUES (${TENANT_A}, 4242, ${roleId})`)

    const res = await run(LIST, realAdminCtx(['Whitelabel Admin']), { t: null })
    assert.equal(res.whitelabelCrmUsers.tenant, TENANT_A)
  })

  it('keeps working after the role is renamed to something unrecognisable', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`UPDATE roles SET name = 'Proprietor' WHERE id = ${roleId}`)

    // The token still carries the new name, and nothing in the check reads it.
    const res = await run(LIST, realAdminCtx(['Proprietor']), { t: null })
    assert.equal(
      res.whitelabelCrmUsers.tenant,
      TENANT_A,
      'renaming a role must not silently remove access to the CRM'
    )
  })

  it('still refuses a role that was never the administrator', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`UPDATE roles SET is_whitelabel_admin = false WHERE id = ${roleId}`)

    const msg = await refusal(LIST, realAdminCtx(['Proprietor']), { t: null })
    assert.match(msg, /Forbidden/, 'the flag is what grants it, so clearing it takes it away')

    await db.execute(sql`UPDATE roles SET is_whitelabel_admin = true WHERE id = ${roleId}`)
  })
})

describe('who may use this surface at all', () => {
  it('a Super Admin may name any whitelabel', async () => {
    const res = await run(LIST, superAdminCtx, { t: TENANT_B })
    assert.equal(res.whitelabelCrmUsers.tenant, TENANT_B)
    assert.equal(res.whitelabelCrmUsers.canChooseTenant, true)
  })

  it('an admin without an administrative role is refused', async () => {
    const msg = await refusal(LIST, plainAdminCtx, { t: null })
    assert.match(msg, /Forbidden/)
  })

  it('an unauthenticated caller is refused', async () => {
    const msg = await refusal(LIST, anonCtx, { t: null })
    assert.match(msg, /Unauthorized/)
  })
})

describe('a CRM session cannot reach the admin surface', () => {
  // The whole point of naming these fields outside the `crm` prefix:
  // `guardAdminSurface` exempts that prefix, so a `crm*` name here would have
  // opted them out of the blanket refusal and left the boundary resting on each
  // resolver's own check.
  const crmSessionCtx = {
    crmUser: { id: randomUUID(), name: 'Desk', tenant: TENANT_A, status: 'ACTIVE', requirePasswordReset: false },
    permissions: [{ domain: 'crm.users', actions: ['manage'] }],
    tenant: TENANT_A,
    whitelabel: { id: TENANT_A },
    request: { headers: {} },
  }

  const fields = [
    [LIST, { t: null }],
    [`query{ whitelabelCrmRoles{ id } }`, {}],
    [CREATE, { t: null, i: { name: 'X', username: 'x', password: 'PasswordPass2026' } }],
    [`mutation{ whitelabelCrmUpdateUser(input:{id:"${randomUUID()}", name:"X"}){ ok } }`, {}],
    [`mutation{ whitelabelCrmSetUserStatus(id:"${randomUUID()}", status:"ACTIVE"){ ok } }`, {}],
    [`mutation{ whitelabelCrmResetPassword(id:"${randomUUID()}", newPassword:"PasswordPass2026"){ ok } }`, {}],
    [`mutation{ whitelabelCrmSetUserRoles(id:"${randomUUID()}", roleIds:[]){ ok } }`, {}],
    [`mutation{ whitelabelCrmDeleteUser(id:"${randomUUID()}"){ ok } }`, {}],
  ] as const

  for (const [source, vars] of fields) {
    const name = source.match(/whitelabelCrm\w+/)?.[0] ?? source
    it(`refuses a CRM session on ${name}`, async () => {
      const msg = await refusal(source, crmSessionCtx, vars as Record<string, unknown>)
      assert.match(msg, /Forbidden/, `expected a refusal, got: ${msg || '(it succeeded)'}`)
      // Which layer refused matters. `guardAdminSurface` says "is an admin-panel
      // operation"; `assertCrmAdminSurface` says "manage their own users inside
      // the CRM". Asserting the guard's wording is what proves the name kept
      // these fields inside the blanket protection — rename one to crm* and
      // this is the assertion that breaks, while a bare /Forbidden/ would still
      // pass on the resolver's own check.
      assert.match(
        msg,
        /is an admin-panel operation/,
        'the blanket guard must be what refuses, not the resolver alone'
      )
    })
  }
})

describe('the seat limit holds from the admin panel too', () => {
  it('refuses past the allowance, and says who can raise it', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    // One seat, already taken by 'B Desk'.
    await db.execute(sql`
      UPDATE crm_whitelabel_settings SET seat_limit = 1 WHERE tenant = ${TENANT_B}`)

    const res = await run(CREATE, wlAdmin(TENANT_B), {
      t: null,
      i: { name: 'One Too Many', username: `over-${SUFFIX}`, password: 'OverPass2026' },
    })
    assert.equal(res.whitelabelCrmCreateUser.ok, false)
    assert.match(res.whitelabelCrmCreateUser.error, /Seat limit reached \(1 of 1\)/)
    assert.match(res.whitelabelCrmCreateUser.error, /Super Admin/, 'and points at who can change it')
  })

  it('two simultaneous creates cannot pass through one free seat', async () => {
    const { db, pool } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`
      UPDATE crm_whitelabel_settings SET seat_limit = 2 WHERE tenant = ${TENANT_B}`)

    // Warm the pool, or the two transactions stagger and never contend.
    await Promise.all(Array.from({ length: 4 }, () => pool.query('SELECT pg_sleep(0.05)')))

    const results = await Promise.all(
      [1, 2].map((n) =>
        run(CREATE, wlAdmin(TENANT_B), {
          t: null,
          i: { name: `Racer ${n}`, username: `racer${n}-${SUFFIX}`, password: 'RacerPass2026' },
        })
      )
    )
    const won = results.filter((r) => r.whitelabelCrmCreateUser.ok).length
    assert.equal(won, 1, 'exactly one may take the last seat')

    const page = await run(LIST, wlAdmin(TENANT_B), { t: null })
    assert.equal(page.whitelabelCrmUsers.seatsUsed, 2, 'and the allowance is not exceeded')
  })
})

describe('a login made here works there', () => {
  it('signs in through the real CRM login mutation', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await db.execute(sql`
      UPDATE crm_whitelabel_settings SET seat_limit = 10 WHERE tenant = ${TENANT_A}`)

    const username = `endtoend-${SUFFIX}`
    const created = await run(CREATE, wlAdmin(TENANT_A), {
      t: null,
      i: { name: 'End To End', username, password: 'EndToEndPass2026' },
    })
    assert.equal(created.whitelabelCrmCreateUser.ok, true, created.whitelabelCrmCreateUser.error ?? '')

    const login = await run(
      `mutation($u:String!,$p:String!){ crmLogin(username:$u, password:$p){ ok error token me{ id name requirePasswordReset } } }`,
      { tenant: TENANT_A, whitelabel: { id: TENANT_A }, request: { headers: {} } },
      { u: username, p: 'EndToEndPass2026' }
    )
    assert.equal(login.crmLogin.ok, true, login.crmLogin.error ?? '')
    assert.ok(login.crmLogin.token, 'a real CRM session comes back')
    assert.equal(login.crmLogin.me.name, 'End To End')
    assert.equal(
      login.crmLogin.me.requirePasswordReset,
      true,
      'a password an administrator typed must be changed by the person using it'
    )
  })
})

describe('the change is attributable to the admin who made it', () => {
  it('records the admin actor, not a CRM one', async () => {
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    await new Promise((r) => setTimeout(r, 300))
    const rows = await db.execute(sql`
      SELECT actor_id, action FROM audit_logs
      WHERE tenant = ${TENANT_A} AND domain = 'crm.users' AND action = 'create_user'
      ORDER BY created_at DESC LIMIT 1`)
    const row = rows.rows[0] as { actor_id: string; action: string } | undefined
    assert.ok(row, 'creating a CRM login is recorded')
    assert.match(String(row!.actor_id), /^admin:/, 'the person who did it has no CRM account')
  })
})
