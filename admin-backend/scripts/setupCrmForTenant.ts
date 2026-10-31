/**
 * Switches a whitelabel's CRM on and gives it a first administrator.
 *
 * Goes through the real GraphQL mutations rather than writing rows directly, so
 * running it exercises the same path the admin panel uses — a seat limit that
 * refuses, a password policy that rejects, a role that has to exist. A script
 * that inserted the rows itself could leave a CRM that looks set up and cannot
 * be signed into.
 *
 * Usage:
 *   npm run crm:setup -- <tenant> <username> <password> [seatLimit]
 *
 * Idempotent: re-running against a whitelabel that already has this username
 * reports it and changes nothing.
 */
import 'dotenv/config'
import { buildSchema, graphql } from 'graphql'
import { pool } from '@src/db/client.js'

const SUPER_ADMIN = {
  user: { sub: '1', name: 'Root', roles: ['Super Admin'] },
  tenant: 'default',
  whitelabel: { id: 'default' },
  permissions: [{ domain: 'all', actions: ['*'] }],
  request: { headers: {} },
}

async function main(): Promise<void> {
  const [tenant, username, password, seatArg] = process.argv.slice(2)
  const seatLimit = Number(seatArg ?? 10)
  if (!tenant || !username || !password) {
    throw new Error('usage: setupCrmForTenant.ts <tenant> <username> <password> [seatLimit]')
  }

  const { typeDefs } = await import('@src/types/graphql.js')
  const { domainResolvers } = await import('@src/domains/index.js')
  const schema = buildSchema(typeDefs)
  const rootValue = Object.fromEntries(
    Object.entries({ ...domainResolvers.Query, ...(domainResolvers as any).Mutation }).map(
      ([n, fn]: [string, any]) => [n, (a: any, c: any, i: any) => fn(undefined, a, c, i)]
    )
  )

  const run = async (source: string, ctx: unknown, variableValues?: Record<string, unknown>) => {
    const res = await graphql({ schema, source, rootValue, contextValue: ctx, variableValues })
    if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '))
    return res.data as Record<string, any>
  }

  // 1. The allowance. Super Admin's to give; nothing below works without it.
  const settings = await run(
    `mutation($t:String!,$n:Int!){ setCrmWhitelabelSettings(tenant:$t, enabled:true, seatLimit:$n){ tenant enabled seatLimit seatsUsed } }`,
    SUPER_ADMIN,
    { t: tenant, n: seatLimit }
  )
  console.log('CRM enabled:', JSON.stringify(settings.setCrmWhitelabelSettings))

  // 2. The administrator, through the admin-panel surface a whitelabel would
  //    use. Roles are seeded by the resolver, so no separate step for that.
  const roles = await run(
    `query($t:ID){ whitelabelCrmRoles(tenant:$t){ id name isSystem } }`,
    SUPER_ADMIN,
    { t: tenant }
  )
  const adminRole = roles.whitelabelCrmRoles.find((r: { isSystem: boolean }) => r.isSystem)
  if (!adminRole) throw new Error('the CRM Administrator role was not seeded')

  const created = await run(
    `mutation($t:ID,$i:CrmCreateUserInput!){ whitelabelCrmCreateUser(tenant:$t, input:$i){ ok error } }`,
    SUPER_ADMIN,
    {
      t: tenant,
      i: { name: 'CRM Administrator', username, password, roleIds: [adminRole.id] },
    }
  )
  if (!created.whitelabelCrmCreateUser.ok) {
    const err = String(created.whitelabelCrmCreateUser.error ?? '')
    if (/already taken/i.test(err)) {
      console.log(`user "${username}" already exists — nothing to do`)
    } else {
      throw new Error(err)
    }
  } else {
    console.log(`CRM administrator created: ${username} (role: ${adminRole.name})`)
  }

  // 3. Prove it can actually sign in, rather than assuming.
  const login = await run(
    `mutation($u:String!,$p:String!){ crmLogin(username:$u, password:$p){ ok error token me{ name requirePasswordReset permissions{ domain actions } } } }`,
    { tenant, whitelabel: { id: tenant }, request: { headers: {} } },
    { u: username, p: password }
  )
  if (!login.crmLogin.ok) throw new Error(`created, but cannot sign in: ${login.crmLogin.error}`)
  console.log(
    JSON.stringify(
      {
        signedIn: true,
        name: login.crmLogin.me.name,
        mustChangePassword: login.crmLogin.me.requirePasswordReset,
        permissionDomains: login.crmLogin.me.permissions.length,
      },
      null,
      2
    )
  )
}

async function teardown(): Promise<void> {
  await pool.end().catch(() => {})
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter().catch(() => {})
  const { closeRedisClient } = await import('@src/config/redisClient.js')
  await closeRedisClient().catch(() => {})
}

main()
  .then(async () => {
    await teardown()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('failed:', err instanceof Error ? err.message : err)
    await teardown()
    process.exit(1)
  })
