/**
 * Every CRM read path, executed for real.
 *
 * The other checks are static: they prove the schema, the resolvers and the
 * front-end documents agree, and that each operation names a permission. None
 * of them runs a resolver, so none would notice a query that type-checks and
 * throws the moment it touches the database — a column renamed under a raw SQL
 * fragment, a join that needs a table nobody created, a scope helper that
 * returns undefined for a user with no books.
 *
 * So this signs in as a real CRM user, with the permissions that user actually
 * holds, and issues the queries the CRM app issues. A resolver that throws is a
 * failure. A resolver that returns nothing is not — an empty desk is a valid
 * state, and asserting on row counts would only make the check brittle.
 *
 *   npm run smoke:crm            # first ACTIVE CRM user found
 *   npm run smoke:crm -- <tenant>
 */
import 'dotenv/config'
import { buildSchema, graphql } from 'graphql'
import { sql } from 'drizzle-orm'
import { db, pool } from '@src/db/client.js'

type Probe = { name: string; source: string; vars?: Record<string, unknown> }

async function main(): Promise<void> {
  const wanted = process.argv[2]

  // A real user, not a synthetic one: the permissions have to come from the
  // same place the login path reads them from, or the check proves nothing
  // about what a signed-in agent can actually do.
  // Prefer the user holding the most permissions. Picking the first by id once
  // landed on a single-permission E2E fixture, which "passed" by having every
  // interesting probe refused — a smoke that exercises nothing proves nothing.
  const pick = (tenantClause: ReturnType<typeof sql>) => sql`
    SELECT u.id, u.name, u.tenant, u.status,
           (SELECT count(*) FROM crm_user_roles ur
            JOIN crm_role_permissions rp ON rp.role_id = ur.role_id
            WHERE ur.crm_user_id = u.id) AS perm_count
    FROM crm_users u
    WHERE ${tenantClause} AND u.status = 'ACTIVE'
    ORDER BY perm_count DESC, u.id LIMIT 1`
  const found = await db.execute(
    wanted ? pick(sql`u.tenant = ${wanted}`) : pick(sql`true`)
  )
  const row = (found as any).rows?.[0]
  if (!row) throw new Error(wanted ? `no ACTIVE CRM user in ${wanted}` : 'no ACTIVE CRM user anywhere')

  const { getCrmUserPermissions } = await import('@src/repos/crm/CrmUsersRepo.js')
  const permissions = await getCrmUserPermissions(String(row.id))
  const held = permissions.flatMap((g: any) => (g.actions ?? []).map((a: string) => `${g.domain}:${a}`))

  const ctx = {
    crmUser: {
      id: String(row.id),
      name: String(row.name),
      tenant: String(row.tenant),
      status: String(row.status),
      requirePasswordReset: false,
    },
    permissions,
    request: { headers: {} },
  }
  console.log(`signed in as ${row.name} (${row.tenant}), ${held.length} permissions`)

  const { typeDefs } = await import('@src/types/graphql.js')
  const { domainResolvers } = await import('@src/domains/index.js')
  const schema = buildSchema(String(typeDefs))
  const rootValue = Object.fromEntries(
    Object.entries({ ...(domainResolvers as any).Query, ...(domainResolvers as any).Mutation }).map(
      ([n, fn]: [string, any]) => [n, (a: any, c: any, i: any) => fn(undefined, a, c, i)]
    )
  )

  const probes: Probe[] = [
    { name: 'crmMe', source: `{ crmMe { id name tenant permissions { domain actions } } }` },
    { name: 'crmPermissionCatalog', source: `{ crmPermissionCatalog { domain label actions { action label } } }` },
    { name: 'crmPlayers', source: `{ crmPlayers(limit: 5) { total items { id username } } }` },
    { name: 'crmTasks', source: `{ crmTasks { id title status dueAt bookId } }` },
    { name: 'crmBooks', source: `{ crmBooks { id name } }` },
    { name: 'crmTags', source: `{ crmTags(includeArchived: true) { id name colour isArchived playerCount } }` },
    { name: 'crmUsers', source: `{ crmUsers { id name status } }` },
    { name: 'crmRoles', source: `{ crmRoles { id name isSystem } }` },
    { name: 'crmMyNotifications', source: `{ crmMyNotifications { id kind readAt } }` },
    { name: 'crmDeskHealth', source: `{ crmDeskHealth { allClear reachedNobody { total } uncoveredBooks { total } ladderExhausted { total } breaching { total } unassigned { total } neverReached { total } } }` },
    { name: 'crmLoginAttempts', source: `{ crmLoginAttempts(limit: 5) { id username success reason } }` },
    { name: 'crmPiiAccessLog', source: `{ crmPiiAccessLog(limit: 5) { id resourceType action } }` },
    // Needs the id of a real CRM user, so it is asked about the caller.
    {
      name: 'crmIpAllowlist',
      source: `query($u: ID!) { crmIpAllowlist(crmUserId: $u) { id cidr label } }`,
      vars: { u: String(row.id) },
    },
    // The 2026-09 additions. Their repos are raw-SQL heavy, which is exactly
    // the breakage this script exists to catch: a probe list that stops at the
    // original surface quietly stops smoking the newest queries first.
    { name: 'crmSegments', source: `{ crmSegments { id name isShared isMine filter { search status tagIds } } }` },
    { name: 'crmDeskCalendar', source: `{ crmDeskCalendar { timezone openMinute closeMinute days isOpenNow } }` },
    {
      name: 'crmDeskReport',
      source: `query($f: String!, $t: String!) { crmDeskReport(from: $f, to: $t) {
        tasks { created completed breached openNow byDay { date created completed } }
        contacts { attempts connected byChannel { channel attempts connected } }
        agents { name tasksCompleted contactAttempts notesWritten }
        rg { flagsRaised flagsLifted blocksActiveNow }
      } }`,
      vars: {
        f: new Date(Date.now() - 7 * 86_400_000).toISOString(),
        t: new Date().toISOString(),
      },
    },
  ]

  let ok = 0
  const failures: string[] = []
  const skipped: string[] = []

  for (const p of probes) {
    const res = await graphql({ schema, source: p.source, rootValue, contextValue: ctx, variableValues: p.vars })
    if (res.errors?.length) {
      const msg = res.errors.map((e) => e.message).join('; ')
      // A permission this user does not hold is a correct refusal, not a fault.
      if (/Forbidden: insufficient permissions/.test(msg)) {
        skipped.push(`${p.name} — ${msg.replace(/^.*insufficient permissions for /, 'needs ')}`)
        continue
      }
      failures.push(`${p.name}: ${msg}`)
      continue
    }
    ok++
    const value = (res.data as any)?.[p.name]
    const shape =
      value == null ? 'null'
        : Array.isArray(value) ? `${value.length} row(s)`
        : typeof value === 'object' && 'total' in value ? `total=${(value as any).total}`
        : 'object'
    console.log(`  ok  ${p.name} -> ${shape}`)
  }

  if (skipped.length) {
    console.log(`\n${skipped.length} refused for lack of permission (correct behaviour):`)
    for (const s of skipped) console.log('  - ' + s)
  }

  console.log(`\n${ok}/${probes.length} CRM read paths executed against the live database`)
  if (failures.length) {
    console.error(`\n${failures.length} threw:`)
    for (const f of failures) console.error('  X ' + f)
    process.exitCode = 1
  } else if (ok === 0) {
    console.error('\nnothing ran — the check would be vacuous')
    process.exitCode = 1
  } else {
    console.log('OK every CRM read path a signed-in user can reach returned without throwing')
  }

  await pool.end()
}

main().catch(async (e) => {
  console.error('failed:', e instanceof Error ? e.message : e)
  try {
    await pool.end()
  } catch {
    /* already closed */
  }
  process.exit(1)
})
