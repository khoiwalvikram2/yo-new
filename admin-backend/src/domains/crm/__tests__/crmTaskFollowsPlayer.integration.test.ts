/**
 * Open work follows the player.
 *
 * This is the test for a bug that shipped: `movePlayerTasksToBook` existed and
 * nothing called it, so reassigning a player left their outstanding tasks with
 * a desk that no longer held them — invisible to the desk that now did, and
 * still escalating to the wrong supervisors.
 *
 * Requires DATABASE_URL. Uses its own tenant and cleans up after itself.
 */
import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const TENANT = `crm-follow-${randomUUID().slice(0, 8)}`

let northId = ''
let southId = ''
let playerId = 0
let headCtx: Record<string, unknown>
let schema: ReturnType<typeof import('graphql').buildSchema>
let rootValue: Record<string, unknown>

const superAdminCtx = {
  user: { sub: '1', name: 'Root', roles: ['Super Admin'] },
  tenant: 'default',
  permissions: [{ domain: 'all', actions: ['*'] }],
}
const anonCtx = { tenant: TENANT, whitelabel: { id: TENANT }, request: { headers: {} } }

async function run(source: string, ctx: unknown, variableValues?: Record<string, unknown>) {
  const { graphql } = await import('graphql')
  const res = await graphql({ schema, source, rootValue, contextValue: ctx, variableValues })
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('; '))
  return res.data as Record<string, any>
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  const { buildSchema } = await import('graphql')
  const { typeDefs } = await import('@src/types/graphql.js')
  const { domainResolvers } = await import('@src/domains/index.js')
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const { buildCrmAuthContext } = await import('@src/domains/crm/services/CrmAuthService.js')

  schema = buildSchema(typeDefs)
  rootValue = Object.fromEntries(
    Object.entries({ ...domainResolvers.Query, ...(domainResolvers as any).Mutation }).map(
      ([n, fn]: [string, any]) => [n, (a: any, c: any, i: any) => fn(undefined, a, c, i)]
    )
  )

  const p = await db.execute(sql`
    INSERT INTO users (tenant, name, username, phone, password_hash)
    VALUES (${TENANT}, 'Moving Player', ${'moving' + randomUUID().slice(0, 6)},
            ${'9' + Math.floor(Math.random() * 1e9)}, 'x')
    RETURNING id`)
  playerId = Number((p.rows[0] as { id: number }).id)

  await run(
    `mutation($t:String!){ setCrmWhitelabelSettings(tenant:$t, enabled:true, seatLimit:5){ enabled } }`,
    superAdminCtx,
    { t: TENANT }
  )
  await run(
    `mutation($t:String!){ crmCreateFirstAdmin(tenant:$t, name:"Head", username:"followhead", password:"FirstPass2026"){ ok error } }`,
    superAdminCtx,
    { t: TENANT }
  )
  const login = await run(`mutation{ crmLogin(username:"followhead", password:"FirstPass2026"){ ok token } }`, anonCtx)
  headCtx = {
    ...(await buildCrmAuthContext(
      { headers: { authorization: `Bearer ${login.crmLogin.token}` } },
      TENANT
    )),
    tenant: TENANT,
    whitelabel: { id: TENANT },
    request: { headers: {} },
  }

  await run(`mutation{ crmCreateBook(name:"North"){ ok error } }`, headCtx)
  await run(`mutation{ crmCreateBook(name:"South"){ ok error } }`, headCtx)
  const books = await run(`{ crmBooks{ id name } }`, headCtx)
  northId = books.crmBooks.find((b: any) => b.name === 'North').id
  southId = books.crmBooks.find((b: any) => b.name === 'South').id

  await run(`mutation($p:[ID!]!,$b:ID!){ crmAssignPlayers(playerIds:$p, bookId:$b){ ok error } }`, headCtx, {
    p: [String(playerId)],
    b: northId,
  })
})

after(async () => {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  for (const stmt of [
    sql`DELETE FROM crm_task_events WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_notifications WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_tasks WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_contact_attempts WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_player_assignments WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_book_members WHERE book_id IN (SELECT id FROM crm_books WHERE tenant = ${TENANT})`,
    sql`DELETE FROM crm_books WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_login_attempts WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_users WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_roles WHERE tenant = ${TENANT}`,
    sql`DELETE FROM crm_whitelabel_settings WHERE tenant = ${TENANT}`,
    sql`DELETE FROM audit_logs WHERE tenant = ${TENANT}`,
    sql`DELETE FROM users WHERE tenant = ${TENANT}`,
  ]) {
    await db.execute(stmt)
  }
  const { closeRedisEmitter } = await import('@src/realtime/redisPubsub.js')
  await closeRedisEmitter()
  const { closeRedisClient } = await import('@src/config/redisClient.js')
  await closeRedisClient()
})

async function bookOf(taskId: string): Promise<string> {
  const { db } = await import('@src/db/client.js')
  const { sql } = await import('drizzle-orm')
  const r = await db.execute(sql`SELECT book_id FROM crm_tasks WHERE id = ${taskId}::uuid`)
  return String((r.rows[0] as { book_id: string }).book_id)
}

describe('reassigning a player', () => {
  it('moves their open tasks to the new book', async () => {
    const created = await run(
      `mutation($b:ID!,$p:ID!){ crmCreateTask(bookId:$b, playerId:$p, title:"Call about the deposit", slaMinutes:60){ ok error } }`,
      headCtx,
      { b: northId, p: String(playerId) }
    )
    assert.equal(created.crmCreateTask.ok, true, created.crmCreateTask.error ?? '')

    const before = await run(`{ crmTasks(filter:{}){ id bookName } }`, headCtx)
    const task = before.crmTasks.find((t: any) => t.bookName === 'North')
    assert.ok(task, 'the task should start in North')

    await run(`mutation($p:[ID!]!,$b:ID!){ crmAssignPlayers(playerIds:$p, bookId:$b){ ok error } }`, headCtx, {
      p: [String(playerId)],
      b: southId,
    })

    assert.equal(
      await bookOf(task.id),
      southId,
      'the task must follow the player, or it is invisible to the desk that now holds them'
    )
  })

  it('records the move on the task', async () => {
    const tasks = await run(`{ crmTasks(filter:{}){ id } }`, headCtx)
    const events = await run(`query($t:ID!){ crmTaskEvents(taskId:$t){ kind toValue } }`, headCtx, {
      t: tasks.crmTasks[0].id,
    })
    const moved = events.crmTaskEvents.find((e: any) => e.kind === 'book_moved')
    assert.ok(moved, 'a task changing hands is worth recording')
    assert.equal(moved.toValue, southId)
  })

  it('leaves a closed task where it was', async () => {
    // History belongs to the desk that did the work, not to whoever holds the
    // player now.
    const { db } = await import('@src/db/client.js')
    const { sql } = await import('drizzle-orm')
    const closed = await db.execute(sql`
      INSERT INTO crm_tasks (tenant, book_id, created_by, title, status, outcome, completed_at,
                             due_at, sla_minutes, breach_at, player_id)
      VALUES (${TENANT}, ${southId}::uuid, 'test', 'Old work', 'DONE', 'resolved', now(),
              now(), 60, now() + make_interval(mins => 60), ${playerId})
      RETURNING id`)
    const closedId = String((closed.rows[0] as { id: string }).id)

    await run(`mutation($p:[ID!]!,$b:ID!){ crmAssignPlayers(playerIds:$p, bookId:$b){ ok error } }`, headCtx, {
      p: [String(playerId)],
      b: northId,
    })
    assert.equal(await bookOf(closedId), southId, 'finished work stays with the desk that did it')
  })
})

describe('contact attempts', () => {
  it('records an attempt and shows it back', async () => {
    const res = await run(
      `mutation($p:ID!){ crmRecordContactAttempt(playerId:$p, channel:"CALL", outcome:"no_answer", notes:"Rang twice"){ ok error } }`,
      headCtx,
      { p: String(playerId) }
    )
    assert.equal(res.crmRecordContactAttempt.ok, true, res.crmRecordContactAttempt.error ?? '')

    const log = await run(`query($p:ID!){ crmContactAttempts(playerId:$p){ channel outcome byName notes } }`, headCtx, {
      p: String(playerId),
    })
    assert.equal(log.crmContactAttempts.length, 1)
    assert.equal(log.crmContactAttempts[0].outcome, 'no_answer')
    assert.equal(log.crmContactAttempts[0].byName, 'Head')
  })

  it('refuses an outcome that is not one of the recognised ones', async () => {
    const res = await run(
      `mutation($p:ID!){ crmRecordContactAttempt(playerId:$p, channel:"CALL", outcome:"maybe"){ ok error } }`,
      headCtx,
      { p: String(playerId) }
    )
    assert.equal(res.crmRecordContactAttempt.ok, false)
    assert.match(res.crmRecordContactAttempt.error, /outcome/i)
  })

  it('surfaces on the admin panel comm log, which was a stub', async () => {
    const adminCtx = {
      user: { sub: '99', name: 'Desk Admin', roles: ['Whitelabel Admin'] },
      tenant: TENANT,
      whitelabel: { id: TENANT },
      permissions: [{ domain: 'all', actions: ['*'] }],
      request: { headers: {} },
    }
    const res = await run(`query($p:ID!){ playerCommLog(playerId:$p){ channel status bounced deliveredAt } }`, adminCtx, {
      p: String(playerId),
    })
    assert.equal(res.playerCommLog.length, 1)
    assert.equal(res.playerCommLog[0].channel, 'CALL')
    assert.equal(res.playerCommLog[0].status, 'no_answer')
    // The delivery fields belong to sends, and this is an attempt. Null rather
    // than an invented false.
    assert.equal(res.playerCommLog[0].deliveredAt, null)
  })
})
