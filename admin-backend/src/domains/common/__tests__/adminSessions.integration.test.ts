/**
 * When does an admin's or an agent's session end?
 *
 * Measured before (SYS-08, SCO-09, DAS-AGENT-LOGOUT, SCO-08, SCO-10):
 *   - buildAuthContext never read users.status, users.token_version or require_password_reset for an admin, and
 *     the login token carried no version: Deactivate, Force Logout, Sign out and Reset Password changed nothing
 *     for a live token, a deactivated admin could still sign in, and a DELETED admin's token kept reading every
 *     commission payout of its whitelabel;
 *   - an agent's Sign out bumped nothing (Number(uuid) is NaN), so the token lived until it expired;
 *   - a refused token was answered with `{}`, indistinguishable from no token, and a whitelabel admin naming
 *     another tenant got a thrown error that the HTTP layer turned into a 500.
 *
 * The Support Admins actions are driven through their real resolvers (forceLogoutUser, setUserStatus,
 * setRequirePasswordReset, deleteSupportAdmin), so what is asserted is what the page's buttons do.
 *
 * Every row here is created in a throwaway `vfyfix-` tenant and removed afterwards (audit rows are left alone).
 * Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'

const STAMP = randomUUID().slice(0, 8)
const TENANT = `vfyfix-sess-${STAMP}`
const OTHER = `vfyfix-sess-other-${STAMP}`
const EMAIL = `vfyfix-sess-${STAMP}@example.invalid`
const PASSWORD = 'Vfyfix-Passw0rd!'

let db: (typeof import('@src/db/client.js'))['db']
let auth: typeof import('@src/domains/common/auth.js')
let usersMutations: any
let rbacMutations: any
let Query: any
let Mutation: any
let adminId = 0
let wlAdminId = 0
let agentId = ''
let roleId = 0
let wlRoleId = 0

const reqWith = (token: string | null, headers: Record<string, string> = {}) => ({
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  url: '/graphql',
})
const adminToken = (id: number, extra: Record<string, unknown> = {}) =>
  auth.signJwt({ sub: String(id), name: 'vfyfix', roles: ['vfyfix support'], ...extra } as never)
const versionOf = async (id: number) =>
  Number(((await db.execute(sql`SELECT token_version FROM users WHERE id = ${id}`)).rows[0] as any).token_version)
/** A token as the login mutation now mints it: carrying the admin's current version. */
const currentToken = async (id: number) => adminToken(id, { v: await versionOf(id) })
const contextFor = async (token: string | null, tenant = TENANT) => auth.buildAuthContext(reqWith(token), tenant)
const at = (root: 'Query' | 'Mutation', fieldName: string) => ({ parentType: { name: root }, fieldName })

/** The whitelabel admin working the Support Admins page. */
const operator = () => ({
  user: { sub: String(wlAdminId), name: 'vfyfix wl', roles: ['vfyfix whitelabel admin'], type: 'admin' },
  permissions: [
    { domain: 'players.profile', actions: ['update'] },
    { domain: 'players.sessions', actions: ['delete'] },
    { domain: 'security.support-admins', actions: ['delete'] },
  ],
  tenant: TENANT,
  whitelabel: { id: TENANT },
  request: { headers: {} },
})

async function newAdmin(label: string): Promise<number> {
  const hash = await auth.hashPassword(PASSWORD)
  const id = Number(((await db.execute(sql`
    INSERT INTO users (tenant, name, email, status, password_hash)
    VALUES (${TENANT}, ${'vfyfix ' + label}, ${label + '-' + EMAIL}, 'active', ${hash}) RETURNING id`)).rows[0] as any).id)
  await db.execute(sql`INSERT INTO user_roles (tenant, user_id, role_id) VALUES (${TENANT}, ${id}, ${roleId})`)
  return id
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  auth = await import('@src/domains/common/auth.js')
  ;({ usersMutationResolvers: usersMutations } = await import('@src/domains/users/resolvers/mutations.js'))
  ;({ rbacMutationResolvers: rbacMutations } = await import('@src/domains/rbac/resolvers/mutations.js'))
  const { domainResolvers } = await import('@src/domains/index.js')
  ;({ Query, Mutation } = domainResolvers as any)

  for (const id of [TENANT, OTHER]) {
    await db.execute(sql`INSERT INTO whitelabels (id, name, domain, status) VALUES (${id}, 'vfyfix sessions', ${id + '.test'}, 'active') ON CONFLICT (id) DO NOTHING`)
  }
  const hash = await auth.hashPassword(PASSWORD)
  adminId = Number(((await db.execute(sql`
    INSERT INTO users (tenant, name, email, status, password_hash) VALUES (${TENANT}, 'vfyfix support', ${EMAIL}, 'active', ${hash}) RETURNING id`)).rows[0] as any).id)
  wlAdminId = Number(((await db.execute(sql`
    INSERT INTO users (tenant, name, email, status, password_hash) VALUES (${TENANT}, 'vfyfix wl', ${'wl-' + EMAIL}, 'active', ${hash}) RETURNING id`)).rows[0] as any).id)
  roleId = Number(((await db.execute(sql`INSERT INTO roles (tenant, name) VALUES (${TENANT}, 'vfyfix support') RETURNING id`)).rows[0] as any).id)
  wlRoleId = Number(((await db.execute(sql`INSERT INTO roles (tenant, name) VALUES (${TENANT}, 'vfyfix whitelabel admin') RETURNING id`)).rows[0] as any).id)
  await db.execute(sql`INSERT INTO user_roles (tenant, user_id, role_id) VALUES (${TENANT}, ${adminId}, ${roleId}), (${TENANT}, ${wlAdminId}, ${wlRoleId})`)
  agentId = String(((await db.execute(sql`
    INSERT INTO agents (tenant_id, scheme_type, allowed_domains, status) VALUES (${TENANT}, 'SHARING', ARRAY['sports']::text[], 'ACTIVE') RETURNING id`)).rows[0] as any).id)
})

after(async () => {
  if (db) {
    await db.execute(sql`DELETE FROM agent_hierarchy_closure WHERE ancestor_id IN (SELECT id FROM agents WHERE tenant_id = ${TENANT}) OR descendant_id IN (SELECT id FROM agents WHERE tenant_id = ${TENANT})`)
    await db.execute(sql`DELETE FROM agents WHERE tenant_id = ${TENANT}`)
    await db.execute(sql`DELETE FROM user_roles WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM roles WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM users WHERE tenant = ${TENANT}`)
    await db.execute(sql`DELETE FROM whitelabels WHERE id IN (${TENANT}, ${OTHER})`)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
})

describe('an admin session ends when the admin is signed out, forced out, deactivated or deleted', () => {
  it('honours a token carrying the current version, and Sign out ends it on every device', async () => {
    const token = await currentToken(adminId)
    const live = await contextFor(token)
    assert.equal(live.user?.sub, String(adminId), 'a current token was refused')
    assert.equal(live.authRejected, undefined)

    // ctx.tenant deliberately elsewhere: a Super Admin's row is not in the tenant it works in.
    const out = await usersMutations.logout(undefined, {}, { user: { sub: String(adminId), roles: [] }, tenant: OTHER })
    assert.equal(out.message, 'Logged out')
    const ended = await contextFor(token)
    assert.equal(ended.user, undefined, 'the signed-out token still names a user')
    assert.equal(ended.authRejected?.reason, 'session_ended')
  })

  it("a password change ends the admin's other sessions even while it works inside another tenant", async () => {
    const token = await currentToken(adminId)
    assert.equal((await contextFor(token)).user?.sub, String(adminId))
    // Director mode: ctx.tenant is the brand being worked in, not the tenant of the admin's own row. The bump was
    // scoped to ctx.tenant, matched no row, and the other sessions survived the change.
    const working = { user: { sub: String(adminId), roles: [] }, tenant: OTHER, whitelabel: { id: OTHER }, request: { headers: {} } }
    try {
      const out = await usersMutations.changeAdminPassword(undefined, { currentPassword: PASSWORD, newPassword: PASSWORD + 'y' }, working)
      assert.equal(out?.success, true)
      assert.equal((await contextFor(token)).authRejected?.reason, 'session_ended', 'a session survived the password change')
    } finally {
      await db.execute(sql`UPDATE users SET password_hash = ${await auth.hashPassword(PASSWORD)} WHERE id = ${adminId}`)
    }
  })

  it('Force Logout ends a live token', async () => {
    const token = await currentToken(adminId)
    assert.equal((await contextFor(token)).user?.sub, String(adminId))
    const out = await usersMutations.forceLogoutUser(undefined, { id: String(adminId) }, operator())
    assert.equal(out.message, 'User sessions logged out')
    assert.equal((await contextFor(token)).authRejected?.reason, 'session_ended')
  })

  it('Deactivate ends the session and refuses sign-in with the right password', async () => {
    const token = await currentToken(adminId)
    await usersMutations.setUserStatus(undefined, { id: String(adminId), status: 'INACTIVE' }, operator())
    try {
      const ctx = await contextFor(token)
      assert.equal(ctx.user, undefined, 'a deactivated admin kept its session')
      assert.equal(ctx.authRejected?.reason, 'session_ended')
      await assert.rejects(
        usersMutations.login(undefined, { input: { email: EMAIL, password: PASSWORD } }, { tenant: TENANT, whitelabel: { id: TENANT }, request: { headers: {} } }),
        /not active/
      )
    } finally {
      await usersMutations.setUserStatus(undefined, { id: String(adminId), status: 'ACTIVE' }, operator())
    }
  })

  it("refuses a deleted admin's token", async () => {
    const goneId = await newAdmin('gone')
    const token = await currentToken(goneId)
    assert.equal((await contextFor(token)).user?.sub, String(goneId))
    const out = await rbacMutations.deleteSupportAdmin(undefined, { id: String(goneId) }, operator())
    assert.equal(out.success, true, out.message)
    const ctx = await contextFor(token)
    assert.equal(ctx.user, undefined, "a deleted admin's token still names a user")
    assert.equal(ctx.authRejected?.reason, 'session_ended')
  })

  it('counts a token minted before tokens carried a version as version 0', async () => {
    const legacyId = await newAdmin('legacy')
    const legacy = adminToken(legacyId)
    assert.equal((await contextFor(legacy)).user?.sub, String(legacyId), 'an admin who never signed out lost its session')
    await usersMutations.forceLogoutUser(undefined, { id: String(legacyId) }, operator())
    assert.equal((await contextFor(legacy)).authRejected?.reason, 'session_ended', 'Force Logout left a pre-version token working')
  })

  it('answers an unverifiable token as a session that has ended, and no token as anonymous', async () => {
    assert.equal((await contextFor('not-a-jwt')).authRejected?.reason, 'session_ended')
    assert.deepEqual(await contextFor(null), {})
  })

  it('the guarded surface ends the session on the first request, in words the panel treats as "Session ended"', async () => {
    const token = await currentToken(adminId)
    await usersMutations.forceLogoutUser(undefined, { id: String(adminId) }, operator())
    const ctx = { ...(await contextFor(token)), tenant: TENANT, whitelabel: { id: TENANT } }
    await assert.rejects(async () => Query.usersPage(undefined, { page: 1, limit: 1 }, ctx, at('Query', 'usersPage')), /session invalid/)
  })
})

describe('sign-in versions the token it issues and reports a pending password reset', () => {
  const loginCtx = () => ({ tenant: TENANT, whitelabel: { id: TENANT }, request: { headers: {} } })

  it('signs the current token version into the token', async () => {
    const out: any = await usersMutations.login(undefined, { input: { email: EMAIL, password: PASSWORD } }, loginCtx())
    assert.equal(auth.verifyJwt(out.token)?.v, await versionOf(adminId))
    assert.equal(out.requirePasswordReset, false)
    assert.equal((await contextFor(out.token)).user?.sub, String(adminId), 'the token login just issued was refused')
  })

  it('reports Reset Password to the sign-in page', async () => {
    await usersMutations.setRequirePasswordReset(undefined, { id: String(adminId), require: true }, operator())
    try {
      const out: any = await usersMutations.login(undefined, { input: { email: EMAIL, password: PASSWORD } }, loginCtx())
      assert.equal(out.requirePasswordReset, true)
    } finally {
      await db.execute(sql`UPDATE users SET require_password_reset = false WHERE id = ${adminId}`)
    }
  })

  it('carries the flag through the schema, where AuthPayload used to drop it', async () => {
    const { buildSchema, graphql } = await import('graphql')
    const { typeDefs } = await import('@src/types/graphql.js')
    const signIn = async () => {
      const res = await graphql({
        schema: buildSchema(typeDefs),
        source: 'mutation SignIn($input: LoginInput!) { login(input: $input) { token requirePasswordReset } }',
        variableValues: { input: { email: EMAIL, password: PASSWORD } },
        rootValue: { login: (args: unknown, ctx: unknown) => usersMutations.login(undefined, args, ctx) },
        contextValue: loginCtx(),
      })
      assert.equal(res.errors, undefined, String(res.errors))
      return (res.data as any).login.requirePasswordReset
    }
    assert.equal(await signIn(), false)
    await usersMutations.setRequirePasswordReset(undefined, { id: String(adminId), require: true }, operator())
    try {
      assert.equal(await signIn(), true)
    } finally {
      await db.execute(sql`UPDATE users SET require_password_reset = false WHERE id = ${adminId}`)
    }
  })
})

describe('Reset Password: the session may only choose a new password, and doing so completes the reset', () => {
  it('carries no permissions and the restriction while the flag is set', async () => {
    await usersMutations.setRequirePasswordReset(undefined, { id: String(adminId), require: true }, operator())
    try {
      const ctx = await contextFor(await currentToken(adminId))
      assert.equal(ctx.user?.sub, String(adminId))
      assert.equal(ctx.passwordChangeRequired, true)
      assert.deepEqual(ctx.permissions, [])
    } finally {
      await db.execute(sql`UPDATE users SET require_password_reset = false WHERE id = ${adminId}`)
    }
  })

  it('clears the flag once the admin changes its own password through the surface', async () => {
    await usersMutations.setRequirePasswordReset(undefined, { id: String(adminId), require: true }, operator())
    const token = await currentToken(adminId)
    const ctx = { ...(await contextFor(token)), tenant: TENANT, whitelabel: { id: TENANT } }
    assert.equal(ctx.passwordChangeRequired, true)
    await assert.rejects(async () => Query.usersPage(undefined, { page: 1, limit: 1 }, ctx, at('Query', 'usersPage')), /Password change required/)

    const out = await Mutation.changeAdminPassword(undefined, { currentPassword: PASSWORD, newPassword: PASSWORD + 'x' }, ctx, at('Mutation', 'changeAdminPassword'))
    assert.equal(out?.success, true)
    const row = (await db.execute(sql`SELECT require_password_reset FROM users WHERE id = ${adminId}`)).rows[0] as any
    assert.equal(row.require_password_reset, false, 'the reset stayed pending after the password was changed')
    // The change also ended the session it was made from; signing in again is a normal sign-in.
    assert.equal((await contextFor(token)).authRejected?.reason, 'session_ended')
    // Put the known password back for the other cases.
    await db.execute(sql`UPDATE users SET password_hash = ${await auth.hashPassword(PASSWORD)} WHERE id = ${adminId}`)
  })
})

describe('a whitelabel admin naming another tenant is refused in words, not with a 500', () => {
  it('returns the refusal instead of throwing it', async () => {
    const wlToken = auth.signJwt({ sub: String(wlAdminId), name: 'vfyfix wl', roles: ['vfyfix whitelabel admin'], v: await versionOf(wlAdminId) } as never)
    const ctx = await contextFor(wlToken, OTHER)
    assert.equal(ctx.user, undefined)
    assert.equal(ctx.authRejected?.reason, 'access_denied')
    assert.match(String(ctx.authRejected?.message), /Whitelabel Admins can only access their own tenant/)

    const switching = await auth.buildAuthContext(reqWith(wlToken, { 'x-tenant': OTHER }), TENANT)
    assert.match(String(switching.authRejected?.message), /cannot switch tenants/)

    const own = await contextFor(wlToken)
    assert.equal(own.user?.sub, String(wlAdminId), 'the admin lost its own tenant')

    // On the surface: every field answers with the reason, which is not one the panel ends the session on.
    await assert.rejects(
      async () => Query.usersPage(undefined, { page: 1, limit: 1 }, { ...ctx, tenant: OTHER }, at('Query', 'usersPage')),
      /Access denied: Whitelabel Admins can only access their own tenant/
    )
  })
})

describe('an agent session ends when the agent signs out or is suspended', () => {
  const agentToken = (v: number) =>
    auth.signJwt({ sub: agentId, agentId, type: 'agent', name: 'vfyfix agent', roles: [], v } as never)
  const agentVersion = async () =>
    Number(((await db.execute(sql`SELECT token_version FROM agents WHERE id = ${agentId}`)).rows[0] as any).token_version)

  it('Sign out moves agents.token_version on, and the old token answers "session ended"', async () => {
    const token = agentToken(await agentVersion())
    assert.equal((await contextFor(token)).user?.agentId, agentId)
    const out = await usersMutations.logout(undefined, {}, { user: { sub: agentId, agentId, type: 'agent' }, tenant: TENANT })
    assert.equal(out.message, 'Logged out')
    const ctx = await contextFor(token)
    assert.equal(ctx.user, undefined, 'the signed-out agent token still works')
    assert.equal(ctx.authRejected?.reason, 'session_ended')
  })

  it('a suspended agent is told its session ended, so its open panel signs out on the next request', async () => {
    const token = agentToken(await agentVersion())
    await db.execute(sql`UPDATE agents SET status = 'SUSPENDED' WHERE id = ${agentId}`)
    try {
      const ctx = { ...(await contextFor(token)), tenant: TENANT, whitelabel: { id: TENANT } }
      assert.equal(ctx.authRejected?.reason, 'session_ended')
      // SCO-08: the agents screen answered "Forbidden: insufficient permissions to access agents", which the panel
      // drops silently, so the tab kept navigating. It now gets the answer the panel signs out on.
      await assert.rejects(async () => Query.agents(undefined, {}, ctx, at('Query', 'agents')), /session invalid/)
    } finally {
      await db.execute(sql`UPDATE agents SET status = 'ACTIVE' WHERE id = ${agentId}`)
    }
  })
})
