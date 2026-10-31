/**
 * Read-only probe for the public player GraphQL resolver surface.
 *
 * Only an explicit, reviewed-pure Query allowlist is invoked with no session and
 * with a synthetic signed-in context. GraphQL's Query operation type and a resolver
 * name are not proof of safety: some otherwise read-looking resolvers lazily create
 * wallets or referral links, or launch a provider session. Mutations and every
 * unreviewed Query are listed but never invoked.
 *
 * The signed-in diagnostic supplies player-B-shaped arguments while authenticated
 * as player A, but a DATA result is not an IDOR verdict. It may be public data or
 * player A's own session-scoped data. Confirming ownership requires a purpose-built
 * assertion for that resolver; this generic probe deliberately does not guess.
 *
 * Requires DATABASE_URL. The default probe performs no GraphQL mutations.
 */
import 'dotenv/config'
import { selectVerifiedPureQueryResolvers } from '../src/services/publicSurfaceProbePolicy.js'

/** Reachable without a session on purpose, with the reason. */
const OPEN_BY_DESIGN: Record<string, string> = {
  appSettings: 'app configuration the login page renders before anyone signs in',
  allAppSettings: 'the same, all keys',
  cashoutConfig: 'a boolean feature flag',
  welivepayConfig: 'whether a payment method is offered; a flag, not a credential',
  sportsList: 'the public sports catalogue',
  sportsExtraUrls: 'public links shown alongside it',
  checkPhoneAvailable: 'sign-up availability check',
}

type Row = { name: string; anon: string; signedIn: string }

/** Summarise returned content without printing player data. */
function describe(out: unknown): string {
  if (out === null || out === undefined) return 'null'
  if (Array.isArray(out)) return out.length === 0 ? 'empty[]' : `DATA[${out.length}]`
  if (typeof out === 'object') {
    const value = out as Record<string, unknown>
    const meta = value.meta as { code?: number } | undefined
    if (meta && typeof meta.code === 'number' && meta.code >= 400) return `refused(${meta.code})`
    if (value.success === false) return 'refused'

    const meaningful = Object.entries(value).filter(
      ([, entry]) => entry !== null && entry !== undefined && !(Array.isArray(entry) && entry.length === 0)
    )
    if (meaningful.length === 0) return 'empty{}'
    for (const key of ['items', 'rows', 'data', 'results', 'edges']) {
      const entry = value[key]
      if (Array.isArray(entry)) return entry.length === 0 ? 'empty{}' : `DATA{${key}:${entry.length}}`
    }
    return `DATA{${meaningful.slice(0, 3).map(([key]) => key).join(',')}}`
  }
  return `DATA(${String(out).slice(0, 20)})`
}

function classify(error: unknown): string {
  const message = String((error as Error)?.message ?? error)
  if (/Unauthorized|not authenticated|authentication required|Not logged in/i.test(message)) return 'no-auth'
  if (/Forbidden|insufficient permission|not allowed/i.test(message)) return 'forbidden'
  return 'reached'
}

async function main(): Promise<void> {
  const { domainResolvers } = await import('../src/domains/index.js')
  const resolvers = domainResolvers as Record<string, Record<string, unknown>>
  const { pool } = await import('../src/db/client.js')

  const players = (
    await pool.query(`SELECT id, tenant FROM users WHERE status = 'active' ORDER BY id LIMIT 2`)
  ).rows as Array<{ id: number; tenant: string }>

  if (players.length < 2) {
    console.log('need two players in the database for signed-in query diagnostics; found', players.length)
    await pool.end()
    return
  }

  const [playerA, playerB] = players
  console.log(
    `read-only probe: signed in as player ${playerA.id} (tenant ${playerA.tenant}); ` +
      `using player ${playerB.id} in generic arguments\n`
  )

  const anonymousContext = { auth: {}, request: { headers: {} } }
  const signedInContext = {
    auth: {
      userId: playerA.id,
      tenant: playerA.tenant,
      user: { id: playerA.id, sub: String(playerA.id) },
    },
    request: { headers: {} },
  }

  const diagnosticArgs: Record<string, unknown> = {
    id: String(playerB.id),
    userId: String(playerB.id),
    playerId: String(playerB.id),
    accountId: String(playerB.id),
    limit: 1,
    page: 1,
    offset: 0,
  }

  const rows: Row[] = []
  const skipped = Object.keys(resolvers.Mutation ?? {}).map(
    (name) => `Mutation.${name} (state-changing operation)`
  )
  const selected = selectVerifiedPureQueryResolvers(resolvers.Query ?? {})
  skipped.push(...selected.skipped)

  for (const [name, resolver] of selected.probeable) {
    const call = async (context: unknown) => {
      try {
        const output = await resolver(undefined, diagnosticArgs, context, undefined)
        return describe(output)
      } catch (error) {
        return classify(error)
      }
    }

    rows.push({
      name,
      anon: await call(anonymousContext),
      signedIn: await call(signedInContext),
    })
  }

  rows.sort((left, right) => left.name.localeCompare(right.name))
  skipped.sort()

  const width = 34
  console.log('operation'.padEnd(width) + 'NO SESSION'.padEnd(14) + 'SIGNED-IN DIAGNOSTIC')
  console.log('-'.repeat(width + 40))
  for (const row of rows) {
    console.log(`${(`Q ${row.name}`).padEnd(width)}${row.anon.padEnd(14)}${row.signedIn}`)
  }

  const unexpectedAnonymousData = rows.filter(
    (row) => row.anon.startsWith('DATA') && !OPEN_BY_DESIGN[row.name]
  )
  const signedInData = rows.filter((row) => row.signedIn.startsWith('DATA'))

  console.log('')
  console.log(`  read-only queries probed          : ${rows.length}`)
  console.log(`  unexpected anonymous DATA         : ${unexpectedAnonymousData.length}`)
  for (const row of unexpectedAnonymousData) {
    console.log(`      - Query.${row.name} -> ${row.anon}`)
  }
  console.log(
    `  signed-in calls returning DATA    : ${signedInData.length} ` +
      '(informational; not an IDOR verdict)'
  )

  if (unexpectedAnonymousData.length > 0) {
    console.log('')
    console.log('FAIL: a Query returned data without a session and is not listed as public.')
    console.log('Add an auth check, or document it in OPEN_BY_DESIGN with the reason.')
  }

  console.log(`  never invoked (mutating/effectful): ${skipped.length}`)
  for (const entry of skipped) console.log(`      - ${entry}`)

  await pool.end()
  process.exit(unexpectedAnonymousData.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
