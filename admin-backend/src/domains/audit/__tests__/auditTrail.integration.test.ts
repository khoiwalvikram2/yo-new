/**
 * The Audit Trail's reads (SYS-12, SYS-13, SYS-16).
 *
 * - SYS-12: AuditListFilter declared domain, action and resourceType as String while the page's multi-selects
 *   send lists, so picking any of them failed both panels ("String cannot represent a non string value") and,
 *   the filter being persisted, every later visit too. The stat cards also ignored actor, resource and search.
 * - SYS-13: the filter lists were constants that name almost nothing the trail records; auditFilterOptions
 *   serves what the tenant's trail holds.
 * - SYS-16: export job dates reached the String scalar as epoch milliseconds ("Invalid Date"), and every actor
 *   that could not be placed (a deleted admin, the Super Admin in a whitelabel's trail, a player) was an agent.
 *
 * Reads only: the schema half needs no database; the rest reads the busiest real tenant and compares with SQL.
 * Requires DATABASE_URL.
 */
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildSchema, graphql } from 'graphql'
import { sql } from 'drizzle-orm'
import { typeDefs } from '@src/types/graphql.js'

let db: (typeof import('@src/db/client.js'))['db']
let Query: Record<string, any>
let tenant = ''
const count = async (where: ReturnType<typeof sql>) =>
  Number(((await db.execute(sql`SELECT count(*)::int AS n FROM audit_logs WHERE tenant = ${tenant} AND ${where}`)).rows[0] as any).n)
const ctx = () => ({ user: { sub: '1', roles: [], type: 'admin' }, permissions: [{ domain: 'all', actions: ['*'] }], tenant, whitelabel: { id: tenant } })

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set')
  ;({ db } = await import('@src/db/client.js'))
  ;({ auditQueryResolvers: Query } = await import('@src/domains/audit/resolvers/queries.js'))
  const busiest = await db.execute(sql`SELECT tenant FROM audit_logs WHERE tenant <> 'default' AND tenant NOT LIKE 'vfy%'
    GROUP BY tenant ORDER BY count(*) DESC LIMIT 1`)
  tenant = String((busiest.rows[0] as any)?.tenant ?? '')
  assert.ok(tenant, 'no whitelabel tenant has audit rows to read')
})

after(async () => {
  const { pool } = await import('@src/db/client.js')
  await pool.end().catch(() => {})
})

describe('the filter input takes the lists the page sends (SYS-12)', () => {
  const schema = buildSchema(typeDefs)
  const source = 'query ($f: AuditListFilter) { auditEvents(filters: $f) { total } }'
  const run = async (f: unknown) => {
    let received: any
    const result = await graphql({ schema, source, variableValues: { f }, rootValue: { auditEvents: (args: any) => { received = args.filters; return { items: [], total: 0 } } } })
    return { errors: result.errors?.map((e) => e.message), received }
  }

  it('accepts lists for domain, action and resource type', async () => {
    const { errors, received } = await run({ domain: ['payments', 'deposits'], action: ['approve_deposit'], resourceType: ['user'] })
    assert.equal(errors, undefined)
    assert.deepEqual([...received.domain], ['payments', 'deposits'])
  })

  it('still accepts the single string older callers send', async () => {
    const { errors, received } = await run({ domain: 'payments' })
    assert.equal(errors, undefined)
    assert.deepEqual([...received.domain], ['payments'])
  })
})

describe('events and stats follow every filter (SYS-12)', () => {
  it('a domain list returns exactly the rows of those domains', async () => {
    const [a, b] = (await db.execute(sql`SELECT domain FROM audit_logs WHERE tenant = ${tenant} GROUP BY domain ORDER BY count(*) DESC LIMIT 2`)).rows.map((r: any) => String(r.domain))
    const page = await Query.auditEvents(undefined, { filters: { domain: [a, b], limit: 1 } }, ctx())
    assert.equal(page.total, await count(sql`domain IN (${a}, ${b})`))
    const stats = await Query.auditStats(undefined, { filters: { domain: [a] } }, ctx())
    assert.equal(stats.total, await count(sql`domain = ${a}`))
  })

  it('the stat cards honour actor, resource type and search', async () => {
    const top = (await db.execute(sql`SELECT actor_id, resource_type FROM audit_logs WHERE tenant = ${tenant}
      GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 1`)).rows[0] as any
    const byActor = await Query.auditStats(undefined, { filters: { actorId: top.actor_id, resourceType: [top.resource_type] } }, ctx())
    assert.equal(byActor.total, await count(sql`actor_id = ${top.actor_id} AND resource_type = ${top.resource_type}`))
    const bySearch = await Query.auditStats(undefined, { filters: { search: 'login' } }, ctx())
    assert.equal(bySearch.total, await count(sql`(actor_id ILIKE '%login%' OR domain ILIKE '%login%' OR action ILIKE '%login%' OR resource_type ILIKE '%login%' OR resource_id ILIKE '%login%')`))
  })
})

describe("the filter lists are what this tenant's trail holds (SYS-13)", () => {
  it('auditFilterOptions answers the distinct domains, actions and resource types, sorted', async () => {
    const options = await Query.auditFilterOptions(undefined, {}, ctx())
    const distinct = async (column: string) =>
      (await db.execute(sql`SELECT DISTINCT ${sql.raw(column)} AS v FROM audit_logs WHERE tenant = ${tenant}`)).rows.map((r: any) => String(r.v)).sort((a, b) => a.localeCompare(b))
    assert.deepEqual(options.domains, await distinct('domain'))
    assert.deepEqual(options.actions, await distinct('action'))
    assert.deepEqual(options.resourceTypes, await distinct('resource_type'))
  })

  it('refuses a caller without audit access', async () => {
    await assert.rejects(Query.auditFilterOptions(undefined, {}, { user: { sub: '9', roles: [], type: 'admin' }, permissions: [], tenant: 'default' }), /Forbidden/)
  })
})

describe('export jobs and actors read as what they are (SYS-16)', () => {
  it('export job dates are ISO strings', async () => {
    const { exportJobForApi } = await import('@src/domains/audit/resolvers/queries.js')
    const job = exportJobForApi({ id: 'j', tenant: 't', whitelabelId: 't', createdBy: 1, filtersJson: {}, exportFormat: 'CSV', status: 'failed', fileUrl: null, errorMessage: 'x', scheduledAt: null, completedAt: new Date('2026-11-02T18:45:12.000Z'), createdAt: new Date('2026-11-02T18:45:11.717Z') })
    assert.equal(job.createdAt, '2026-11-02T18:45:11.717Z')
    assert.equal(job.completedAt, '2026-11-02T18:45:12.000Z')
    assert.equal(job.scheduledAt, null)
  })

  it('names deleted users, admins of any tenant, players, agents and the system', async () => {
    const { resolveAuditActor } = await import('@src/repos/audit/auditActorRepo.js')
    const one = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows[0] as any
    const admin = await one(sql`SELECT ur.user_id AS id FROM user_roles ur JOIN users u ON u.id = ur.user_id AND u.tenant = ur.tenant WHERE ur.tenant <> 'default' LIMIT 1`)
    const platform = await one(sql`SELECT ur.user_id AS id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.tenant = 'default' AND r.name = 'Super Admin' LIMIT 1`)
    const player = await one(sql`SELECT u.id FROM users u WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id) LIMIT 1`)
    const missing = Number((await one(sql`SELECT COALESCE(max(id), 0) + 100000 AS id FROM users`)).id)
    const agent = await one(sql`SELECT agent_id AS id, username FROM agent_credentials LIMIT 1`)

    assert.equal((await resolveAuditActor(String(missing))).type, 'deleted')
    assert.equal((await resolveAuditActor(String(missing))).name, `Deleted user ${missing}`)
    if (admin) assert.equal((await resolveAuditActor(String(admin.id))).type, 'admin')
    if (platform) assert.equal((await resolveAuditActor(String(platform.id))).type, 'admin', 'the Super Admin is an admin in any trail')
    if (player) assert.equal((await resolveAuditActor(String(player.id))).type, 'player')
    if (agent) assert.deepEqual(await resolveAuditActor(String(agent.id)), { id: String(agent.id), name: agent.username, email: null, type: 'agent', role: null })
    assert.equal((await resolveAuditActor('system')).type, 'system')
    assert.equal((await resolveAuditActor('unknown')).type, 'unknown')
  })
})
