/**
 * The CRM through its GraphQL surface, the way the two apps actually call it.
 *
 * The isolation test covers the repositories and the auth service. This covers
 * the layer above them: that each resolver states the permission it needs and
 * refuses without it. That check lives in the resolver, so it has to be tested
 * there — a repository that returns the right rows is no protection if the
 * field in front of it never asks who is calling.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchema, graphql } from 'graphql'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-gql-${randomUUID().slice(0, 8)}`

let schema: ReturnType<typeof buildSchema>
let rootValue: Record<string, unknown>
let playerInBook = 0
let playerOutOfBook = 0
let adminCtx: Record<string, unknown>
let agentCtx: Record<string, unknown>
let bookId = ''

const superAdminCtx = {
  user: { sub: '1', name: 'Root', roles: ['Super Admin'] },
  tenant: 'default',
  permissions: [{ domain: 'all', actions: ['*'] }],
}

const anonCtx = { tenant: TENANT, whitelabel: { id: TENANT }, request: { headers: {} } }

async function run(source: string, ctx: unknown, variableValues?: Record<string, unknown>) {
  const res = await graphql({ schema, source, rootValue, contextValue: ctx, variableValues })
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '))
  return res.data as Record<string, any>
}

/** Runs an operation expecting it to be refused, and returns the message. */
async function expectRefused(source: string, ctx: unknown): Promise<string> {
  try {
    await run(source, ctx)
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { typeDefs } = await import('@src/types/graphql.js')
  const { domainResolvers } = await import('@src/domains/index.js')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const { buildCrmAuthContext } = await import('@src/domains/crm/services/CrmAuthService.js')

  schema = buildSchema(typeDefs)
  // graphql-js calls a rootValue field as fn(args, context, info); this project's
  // resolvers take (parent, args, context). Adapt rather than reshape them, so
  // the test exercises the same functions the server registers.
  rootValue = Object.fromEntries(
    Object.entries({ ...domainResolvers.Query, ...(domainResolvers as any).Mutation }).map(
      ([name, fn]: [string, any]) => [name, (args: any, ctx: any, info: any) => fn(undefined, args, ctx, info)]
    )
  )

  for (const name of ['GQL In Book', 'GQL Out Of Book']) {
    const r = await db.execute(sql`
      INSERT INTO users (tenant, name, username, phone, password_hash)
      VALUES (${TENANT}, ${name}, ${name.replace(/\s/g, '').toLowerCase()},
              ${'9' + Math.floor(Math.random() * 1e9)}, 'x')
      RETURNING id`)
    const id = Number((r.rows[0] as { id: number }).id)
    if (!playerInBook) playerInBook = id
    else playerOutOfBook = id
  }

  // Build the desk: enable, bootstrap an administrator, give an agent one book
  // holding one of the two players.
  await run(
    `mutation($t:String!){ setCrmWhitelabelSettings(tenant:$t, enabled:true, seatLimit:5){ enabled } }`,
    superAdminCtx,
    { t: TENANT }
  )
  await run(
    `mutation($t:String!){ crmCreateFirstAdmin(tenant:$t, name:"Desk Head", username:"gqlhead", password:"FirstPass2026"){ ok error } }`,
    superAdminCtx,
    { t: TENANT }
  )
  const login = await run(
    `mutation{ crmLogin(username:"gqlhead", password:"FirstPass2026"){ ok token } }`,
    anonCtx
  )
  const mkCtx = async (token: string) => ({
    ...(await buildCrmAuthContext({ headers: { authorization: `Bearer ${token}` } }, TENANT)),
    tenant: TENANT,
    whitelabel: { id: TENANT },
    request: { headers: {} },
  })
  adminCtx = await mkCtx(login.crmLogin.token)

  await run(`mutation{ crmCreateBook(name:"North"){ ok } }`, adminCtx)
  bookId = (await run(`{ crmBooks{ id } }`, adminCtx)).crmBooks[0].id
  const roles = await run(`{ crmRoles{ id name } }`, adminCtx)
  const agentRole = roles.crmRoles.find((r: any) => r.name === 'Agent')
  await run(
    `mutation($r:[ID!]){ crmCreateUser(input:{name:"Agent A", username:"gqlagent", password:"AgentPass2026", roleIds:$r}){ ok error } }`,
    adminCtx,
    { r: [agentRole.id] }
  )
  const users = await run(`{ crmUsers{ id username } }`, adminCtx)
  const agent = users.crmUsers.find((u: any) => u.username === 'gqlagent')
  await run(`mutation($b:ID!,$u:[ID!]!){ crmSetBookMembers(bookId:$b, crmUserIds:$u){ ok } }`, adminCtx, {
    b: bookId,
    u: [agent.id],
  })
  await run(`mutation($p:[ID!]!,$b:ID!){ crmAssignPlayers(playerIds:$p, bookId:$b){ ok error } }`, adminCtx, {
    p: [String(playerInBook)],
    b: bookId,
  })

  const agentLogin = await run(`mutation{ crmLogin(username:"gqlagent", password:"AgentPass2026"){ ok token } }`, anonCtx)
  agentCtx = await mkCtx(agentLogin.crmLogin.token)
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const t of [
    sql`DELETE FROM crm_pii_access_log WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_login_attempts WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_player_assignments WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_books WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_users WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_roles WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${TENANT}`,
    sql`DELETE FROM audit_logs WHERE tenant = ${TENANT}`,
    sql`DELETE FROM users WHERE tenant = ${TENANT}`,
  ]) {
    await db.execute(t)
  }

  // CRM writes publish an audit event, which lazily opens the Redis pub/sub
  // connections. Without closing them this process never exits and node:test
  // reports the whole file as failed even though every assertion passed.
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
  const { closeRedisClient } = await import('@src/config/redisClient.js')
  await closeRedisClient()
})

describe("Super Admin's gate", () => {
  it('refuses a non-Super-Admin', async () => {
    const msg = await expectRefused(
      `mutation{ setCrmWhitelabelSettings(tenant:"${TENANT}", enabled:true, seatLimit:99){ enabled } }`,
      { user: { sub: '9', name: 'Staff', roles: ['Support'] }, tenant: TENANT }
    )
    assert.match(msg, /Super Admin/)
  })

  it('offers the first administrator only while the whitelabel has none', async () => {
    const res = await run(
      `mutation($t:String!){ crmCreateFirstAdmin(tenant:$t, name:"Second", username:"gqlsecond", password:"SecondPass2026"){ ok error } }`,
      superAdminCtx,
      { t: TENANT }
    )
    assert.equal(res.crmCreateFirstAdmin.ok, false)
    assert.match(res.crmCreateFirstAdmin.error, /already has an active CRM administrator/)
  })
})

describe('sign-in', () => {
  it('refuses a caller who keeps guessing', async () => {
    const { resetLoginRateLimiter, LOGIN_RATE_LIMITS } = await import(
      '@src/middleware/loginRateLimiter.js'
    )
    resetLoginRateLimiter()
    try {
      // The resolver reports a failed sign-in as ok:false rather than throwing.
      // Once the budget is spent the rate limiter throws instead, which is how
      // this asserts the wiring and not just the limiter.
      let threw = false
      for (let i = 0; i < LOGIN_RATE_LIMITS.maxPerIdentifier + 2; i++) {
        try {
          await run(`mutation{ crmLogin(username:"gqlhead", password:"nope"){ ok } }`, anonCtx)
        } catch (e) {
          threw = /Too many login attempts/.test(String(e))
          break
        }
      }
      assert.ok(threw, 'repeated guesses should hit the brute-force budget')
    } finally {
      resetLoginRateLimiter()
    }
  })

  it('says the same thing about every failure', async () => {
    const wrong = await run(`mutation{ crmLogin(username:"gqlhead", password:"nope"){ ok error } }`, anonCtx)
    const unknown = await run(`mutation{ crmLogin(username:"nobody", password:"nope"){ ok error } }`, anonCtx)
    assert.equal(wrong.crmLogin.ok, false)
    assert.equal(unknown.crmLogin.ok, false)
    assert.equal(wrong.crmLogin.error, 'Invalid username or password')
    assert.equal(unknown.crmLogin.error, wrong.crmLogin.error)
  })

  it('records the real reason where only staff can read it', async () => {
    const log = await run(`{ crmLoginAttempts(limit:50){ username success reason } }`, adminCtx)
    assert.ok(
      log.crmLoginAttempts.some((a: any) => !a.success && a.reason === 'bad_password'),
      'the audit trail should carry what the sign-in screen would not say'
    )
  })
})

describe('what an agent may reach', () => {
  it('lists only the players in their books', async () => {
    const res = await run(`{ crmPlayers(limit:50){ total items{ id } } }`, agentCtx)
    assert.equal(res.crmPlayers.total, 1)
    assert.equal(res.crmPlayers.items[0].id, String(playerInBook))
  })

  it('opens an assigned player', async () => {
    const res = await run(`query($id:ID!){ crmPlayer(id:$id){ id phone } }`, agentCtx, {
      id: String(playerInBook),
    })
    assert.equal(res.crmPlayer.id, String(playerInBook))
  })

  it('cannot open a player outside their books, and cannot tell why', async () => {
    const res = await run(`query($id:ID!){ crmPlayer(id:$id){ id } }`, agentCtx, {
      id: String(playerOutOfBook),
    })
    // Null, not an error: a player they may not see must be indistinguishable
    // from one that does not exist.
    assert.equal(res.crmPlayer, null)
  })

  it('gets nothing from the timeline of a player outside their books', async () => {
    const res = await run(`query($id:ID!){ crmPlayerTimeline(playerId:$id, limit:5){ entries{ key } } }`, agentCtx, {
      id: String(playerOutOfBook),
    })
    assert.deepEqual(res.crmPlayerTimeline.entries, [])
  })
})

describe('every resolver states the permission it needs', () => {
  const forbidden = [
    ['crm.users:manage', `mutation{ crmCreateUser(input:{name:"X", username:"x1", password:"Password2026"}){ ok } }`],
    ['crm.users:view', `{ crmUsers{ id } }`],
    ['crm.books:manage', `mutation{ crmCreateBook(name:"Sneaky"){ ok } }`],
    ['crm.roles:manage', `mutation{ crmCreateRole(name:"Boss", permissions:[]){ ok } }`],
    ['crm.roles:view', `{ crmRoles{ id } }`],
    ['crm.security:view', `{ crmLoginAttempts(limit:5){ id } }`],
    ['crm.security:view', `{ crmPiiAccessLog(limit:5){ id } }`],
  ] as const

  for (const [permission, op] of forbidden) {
    it(`refuses an agent: ${permission}`, async () => {
      const msg = await expectRefused(op, agentCtx)
      assert.match(msg, /Forbidden/, `expected a refusal, got: ${msg || '(it succeeded)'}`)
    })
  }

  it('refuses an unauthenticated caller outright', async () => {
    const msg = await expectRefused(`{ crmPlayers(limit:5){ total } }`, anonCtx)
    assert.match(msg, /Unauthorized/)
  })
})

describe('reads of personal data are recorded', () => {
  it('records who opened which player', async () => {
    await run(`query($id:ID!){ crmPlayer(id:$id){ id } }`, agentCtx, { id: String(playerInBook) })
    // The write is deliberately not awaited by the read path, so give it a moment.
    await new Promise((r) => setTimeout(r, 400))
    const log = await run(`{ crmPiiAccessLog(limit:50){ userName resourceType resourceId action } }`, adminCtx)
    assert.ok(
      log.crmPiiAccessLog.some(
        (e: any) => e.resourceType === 'player' && e.resourceId === String(playerInBook) && e.userName === 'Agent A'
      ),
      'opening a player should appear in the read log'
    )
  })

  it('records a search as a read too', async () => {
    await run(`{ crmPlayers(filter:{search:"GQL In"}, limit:5){ total } }`, agentCtx)
    await new Promise((r) => setTimeout(r, 400))
    const log = await run(`{ crmPiiAccessLog(limit:50){ resourceType action } }`, adminCtx)
    assert.ok(log.crmPiiAccessLog.some((e: any) => e.resourceType === 'player_search' && e.action === 'search'))
  })

  it('records the default, un-searched list page too — not only a search', async () => {
    // Finding #13: `crmPlayers` carries phone and email on every row
    // unconditionally, but the access log write was nested inside `if
    // (filter?.search)`. The shipped frontend's default landing page — and
    // every page step after it — calls this with no search term at all, so
    // that was the read that went unrecorded, not an edge case.
    await run(`{ crmPlayers(limit:5, offset:0){ items{ id } total } }`, agentCtx)
    await new Promise((r) => setTimeout(r, 400))
    const log = await run(`{ crmPiiAccessLog(limit:50){ userName resourceType action } }`, adminCtx)
    assert.ok(
      log.crmPiiAccessLog.some(
        (e: any) => e.resourceType === 'player_list' && e.action === 'view' && e.userName === 'Agent A'
      ),
      'browsing the default list must be recorded even with no search term'
    )
  })
})

describe('exporting the player list', () => {
  // `crm.players:export` sat in the catalogue since the CRM shipped, described
  // as "Download player lists. Every export is recorded against this user",
  // granted to the Supervisor role — and gated nothing, because the export was
  // never built. These are the two halves of that description.

  it('is refused to an agent, who can read the list but not take it away', async () => {
    // The seeded Agent role holds crm.players:view and not :export. Reading a
    // page on screen and walking out with the book are different acts.
    const msg = await expectRefused(
      `{ crmExportPlayers { rowCount } }`,
      agentCtx
    )
    assert.match(msg, /Forbidden/, `expected a refusal, got: ${msg || '(it succeeded)'}`)
  })

  it('gives a permitted caller a CSV of what they can already see', async () => {
    const res = await run(
      `{ crmExportPlayers { filename csv rowCount total truncated } }`,
      adminCtx
    )
    const out = res.crmExportPlayers
    assert.match(out.filename, /^players-\d{4}-\d{2}-\d{2}\.csv$/)
    assert.ok(out.rowCount >= 1)
    assert.equal(out.truncated, false, 'a small desk fits in one file')

    const lines = out.csv.split('\n')
    assert.match(lines[0], /^id,name,username,phone,email,status/, 'a header row')
    assert.equal(lines.length, out.rowCount + 1, 'one line per player, plus the header')
  })

  it('records the download as an export, not as a view', async () => {
    // "Who took a copy of this" is a different question from "who looked at
    // it", and only the first is answerable afterwards if it is recorded
    // differently.
    await run(`{ crmExportPlayers { rowCount } }`, adminCtx)
    await new Promise((r) => setTimeout(r, 400))
    const log = await run(`{ crmPiiAccessLog(limit:50){ resourceType action } }`, adminCtx)
    assert.ok(
      log.crmPiiAccessLog.some(
        (e: any) => e.resourceType === 'player_export' && e.action === 'export'
      ),
      'the catalogue promises every export is recorded'
    )
  })
})
