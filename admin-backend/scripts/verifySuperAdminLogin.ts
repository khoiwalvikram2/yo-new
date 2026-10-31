/**
 * Signs in as the Super Admin through the real GraphQL login mutation.
 *
 * Verifying the bcrypt hash directly only proves bcrypt works. This proves the
 * path an actual sign-in takes — tenant resolution, role lookup, token signing —
 * which is the thing that has to work tomorrow morning.
 */
import 'dotenv/config'
import { buildSchema, graphql } from 'graphql'
import { pool } from '@src/db/client.js'

async function main(): Promise<void> {
  const [email, password] = process.argv.slice(2)
  if (!email || !password) throw new Error('usage: verifySuperAdminLogin.ts <email> <password>')

  const { typeDefs } = await import('@src/types/graphql.js')
  const { domainResolvers } = await import('@src/domains/index.js')
  const schema = buildSchema(typeDefs)
  const rootValue = Object.fromEntries(
    Object.entries({ ...domainResolvers.Query, ...(domainResolvers as any).Mutation }).map(
      ([n, fn]: [string, any]) => [n, (a: any, c: any, i: any) => fn(undefined, a, c, i)]
    )
  )
  const ctx = { tenant: 'default', whitelabel: { id: 'default' }, request: { headers: {}, ip: '127.0.0.1' } }

  const res = await graphql({
    schema,
    source: `mutation($i: LoginInput!){ login(input: $i){ token user{ id name tenant } } }`,
    rootValue,
    contextValue: ctx,
    variableValues: { i: { email, password } },
  })

  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '))
  const data = res.data as any
  console.log(
    JSON.stringify(
      {
        signedIn: !!data.login?.token,
        tokenLength: data.login?.token?.length ?? 0,
        user: data.login?.user,
      },
      null,
      2
    )
  )

  // And the old temporary password must now be refused.
  const old = await graphql({
    schema,
    source: `mutation($i: LoginInput!){ login(input: $i){ token } }`,
    rootValue,
    contextValue: ctx,
    variableValues: { i: { email, password: 'GwAdmin@2026' } },
  })
  console.log('old password refused:', !!old.errors?.length || !(old.data as any)?.login?.token)
}

/**
 * Importing the resolver map brings up the Redis emitter and client, whose open
 * sockets hold the event loop open long after this script is done. Closed
 * explicitly, the same way the integration tests close them.
 */
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
