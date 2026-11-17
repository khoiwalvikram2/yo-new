/**
 * Reads the gating of the operations `probe:admin-authz` refuses to execute.
 *
 * The probe never calls an operation that reaches outside the database — an
 * SMS, a provider charge, a payout, an irreversible delete. That is the right
 * call, but it left a documented hole in the coverage story: "their gating has
 * to be read rather than executed, and has not been."
 *
 * This reads it. For every operation matching the probe's own
 * `EXTERNALLY_EFFECTFUL` patterns, it finds the resolver in the source and asks
 * whether anything in it refuses a caller.
 *
 * It reads source rather than the mounted resolver on purpose: `guardAdminSurface`
 * wraps every field, so `String(fn)` returns the wrapper and the real body is a
 * closure variable no inspection can reach.
 *
 * Static, so it produces leads rather than proof; the probe remains the
 * authority for everything it can reach. What this catches is the case the probe
 * structurally cannot — an unsafe-to-execute operation losing its gate.
 *
 * Exits non-zero when an operation is neither gated nor named below.
 */
import 'dotenv/config'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_NAMESPACES, OPEN_AGENT_MUTATIONS, namespaceFields } from './agentNamespaceFields.js'
import { extensionFields } from './schemaExtensionFields.js'

/** Copied from probeAdminAuthz.ts. Keep the two in step. */
const EXTERNALLY_EFFECTFUL = [
  /otp|sms|email|mail|notify|notification|webhook|push/i,
  /payout|withdraw|refund|settle|approve|reject|capture|charge|transfer/i,
  /provider|gateway|ingest|sync|import|seed|migrate|backfill|reconcile/i,
  /delete|purge|reset|truncate|rollback|void|cancel/i,
  /login|logout|password|token|impersonate/i,
]

/**
 * Operations that authenticate but deliberately hold no permission, with the
 * reason. Each is scoped to the caller's own record, so a permission would be
 * asking whether you may read your own notifications.
 */
const SELF_SCOPED: Record<string, string> = {
  login: 'admin sign-in: there is no session yet',
  logout: "ends the caller's own session",
  changeAdminPassword: "changes the caller's own password",
  crmLogin: 'CRM sign-in: there is no session yet',
  crmChangeOwnPassword: "requireCrmUser, and changes only the caller's own password",
  crmMarkNotificationsRead: "requireCrmUser, and marks only the caller's own notifications",
  crmMyNotifications: "requireCrmUser, and returns only the caller's own notifications",
  // Declared in notifications.graphql. Their bodies are assigned through a const, which the splitter below cannot
  // locate; notifications/resolvers/index.ts refuses a caller without a session before either runs.
  markNotificationRead: "a session (notifications/resolvers/index.ts), and marks only the caller's own inbox",
  markAllNotificationsRead: 'the same, for every notification of that inbox',
}

/** How a refusal can be spelled anywhere in this codebase. */
const GATES = [
  /requirePermission\(/,
  /requireReadPermission\(/,
  /requireDiagnosticAccess\(/,
  // Domain helpers that throw "Forbidden" before anything else: payments.pgsettings, and the settle permission
  // (executeSettleAgent calls requireSettleAgentPermission first; settleAgent's whole body is that call).
  /requirePgPermission\(/,
  /requireSettleAgentPermission\(/,
  /executeSettleAgent\(/,
  // The whitelabel's own pool, sharing and settlement reads (common/resolvers/queries.ts): a session, never an agent,
  // and the standing named at the call. myWhitelabelSettlements has gone through it since SCO-09 (2026-11-03).
  /requireWhitelabelPoolReader\(/,
  // A Super Admin check by role name that throws. Only the platform can mint such a name (ensureMayUseRoleName).
  /throw new Error\('Unauthorized: Only Super Admin/,
  /requireAny\(/,
  /requireCrmPermission\(/,
  /requireCrmWrite\(/,
  /ensureNoPrivilegeEscalation\(/,
  /ensureActorMayGrantPermissions\(/,
  // hasPermission consulted and actually refused on, rather than computed and
  // discarded — the distinction this whole audit exists to make.
  /hasPermission\([\s\S]{0,220}?(throw new Error|success\s*:\s*false|return \[\])/,
  /Forbidden: insufficient/,
  // The admin-side CRM management fields resolve their scope through this, which
  // refuses a caller who may not administer the target tenant's CRM.
  /assertCrmAdminSurface\(/,
  // Self-scoped reads that hold no permission but must still have a caller.
  /Unauthorized: authentication required/,
  // The AI assistant's own entry points, which resolve the acting admin before
  // doing anything and refuse a caller who is not one.
  /requireAdmin\(/,
]

/**
 * Maps whose every field is gated by a wrapper rather than in the body.
 *
 * Seven maps hold a per-field permission table in their domain's `index.ts` and
 * refuse an unlisted field, so a body inside them needs no gate of its own. The
 * tables are asserted for coverage; what this list must stay honest about is
 * which files are actually wrapped.
 */
const WRAPPED_FILES = [
  /agents\/resolvers\/mutations\.ts$/,
  /sports\/resolvers\/(mutations|queries)\.ts$/,
  /casino\/resolvers\/(mutations|queries)\.ts$/,
  /reporting\/resolvers\/(mutations|queries|snapshotHealthMutations|snapshotHealthQueries)\.ts$/,
  /marketing\/resolvers\/mutations\.ts$/,
  /referrals\/resolvers\/mutations\.ts$/,
  /vip\/resolvers\/mutations\.ts$/,
]

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue
      walk(p, out)
    } else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

function fieldsOf(file: string, type: string): string[] {
  const src = readFileSync(join('src', 'types', 'operations', file), 'utf8')
  const start = src.indexOf(`type ${type}`)
  if (start < 0) return []
  const body = src.slice(start, src.indexOf('\n}', start))
  return [...body.matchAll(/^\s{2}(\w+)\s*[(:]/gm)].map((m) => m[1])
}

/**
 * Every resolver body in the codebase, by operation name.
 *
 * Splits the resolver files the same way `auditAdminSurface` does — a
 * two-space-indented key followed by a function, which is how every resolver map
 * here is written.
 */
function resolverBodies(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>()
  for (const file of walk(join('src', 'domains'))) {
    const src = readFileSync(file, 'utf8')
    const starts: Array<{ name: string; at: number }> = []
    // Two spellings live side by side: `name: async (...) => {` and the method
    // shorthand `async name(...) {`. Missing the second reported five settlement
    // operations as having no resolver at all.
    const patterns = [
      /^\t? {0,4}([a-zA-Z][A-Za-z0-9_]*)\s*:\s*(async\s*)?(function\s*)?\(/gm,
      /^\t? {0,4}(?:async\s+)([a-zA-Z][A-Za-z0-9_]*)\s*\(/gm,
    ]
    for (const pattern of patterns) {
      for (const m of src.matchAll(pattern)) starts.push({ name: m[1], at: m.index ?? 0 })
    }
    starts.sort((a, b) => a.at - b.at)
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1].at : src.length
      const body = src.slice(starts[i].at, end)
      const prev = out.get(starts[i].name)
      // Keep the longest definition seen: a name may appear both as a real
      // resolver and as a one-line re-export in an index file.
      if (!prev || body.length > prev.body.length) {
        out.set(starts[i].name, { file: file.split('\\').join('/'), body })
      }
    }
  }
  return out
}

/**
 * The per-field tables guardMutationMap wraps, by domain. A resolver can live outside its map's own mutations.ts and
 * still be wrapped: a domain may spread another file's mutations into its map (marketing did so with promotions.ts
 * until Promotions was retired on 2026-11-04), and such a field is gated by its table rather than in its body.
 * mutationPermissionMaps.test.ts keeps every entry pointing at a real resolver of that map, so a name a table carries,
 * found in that table's domain, is a wrapped field.
 */
const WRAPPED_TABLES: ReadonlyArray<readonly [domain: string, table: string]> = [
  ['casino', 'CASINO_MUTATION_PERMISSIONS'],
  ['marketing', 'MARKETING_MUTATION_PERMISSIONS'],
  ['referrals', 'REFERRALS_MUTATION_PERMISSIONS'],
  ['reporting', 'REPORTING_MUTATION_PERMISSIONS'],
  ['sports', 'SPORTS_MUTATION_PERMISSIONS'],
]

/** Each name the WRAPPED_TABLES carry, with its domain, read from the tables' source like the agents table below. */
function wrappedTableNames(): Map<string, string> {
  const out = new Map<string, string>()
  for (const [domain, table] of WRAPPED_TABLES) {
    const src = readFileSync(join('src', 'domains', domain, 'resolvers', 'index.ts'), 'utf8')
    const declared = src.indexOf(`${table}:`)
    if (declared < 0) continue
    const open = src.indexOf('{', src.indexOf('=', declared))
    const close = src.indexOf('\n}', open)
    for (const m of src.slice(open + 1, close).matchAll(/^\s+([a-zA-Z][A-Za-z0-9_]*)\s*:/gm)) out.set(m[1], domain)
  }
  return out
}

/** The mutations AGENT_MUTATION_PERMISSIONS names, read from the guard's source like every other check here. */
function agentMutationPermissionNames(): Set<string> {
  const src = readFileSync(join('src', 'domains', 'agents', 'resolvers', 'guardAgentMutations.ts'), 'utf8')
  const open = src.indexOf('{', src.indexOf('AGENT_MUTATION_PERMISSIONS'))
  const close = src.indexOf('\n}', open)
  return new Set([...src.slice(open + 1, close).matchAll(/^\s+([a-zA-Z][A-Za-z0-9_]*)\s*:/gm)].map((m) => m[1]))
}

async function main(): Promise<void> {
  const names = [
    ...fieldsOf('mutations.graphql', 'Mutation'),
    ...fieldsOf('queries.graphql', 'Query'),
    // The `extend type Mutation` fields of the domain files, which probe:admin-authz now enumerates too: the ones it
    // declines to execute (payouts, settlements, voids, password resets) are read here like every other. Their Query
    // fields are not added: the probe executes every Query it can build arguments for.
    ...extensionFields('Mutation').map((f) => f.name),
  ]
  const unprobed = names.filter((n) => EXTERNALLY_EFFECTFUL.some((r) => r.test(n)))
  const bodies = resolverBodies()
  const tableNames = wrappedTableNames()
  const inWrappedTable = (name: string, file: string) => {
    const domain = tableNames.get(name)
    return domain !== undefined && file.includes(`/domains/${domain}/`)
  }

  const gated: string[] = []
  const wrapped: string[] = []
  const selfScoped: string[] = []
  const ungated: Array<{ name: string; file: string }> = []
  const missing: string[] = []

  for (const name of unprobed) {
    const found = bodies.get(name)
    if (!found) {
      // A documented self-scoped operation whose body the splitter cannot locate is still documented.
      if (SELF_SCOPED[name]) selfScoped.push(name)
      else missing.push(name)
      continue
    }
    if (GATES.some((g) => g.test(found.body))) gated.push(name)
    else if (WRAPPED_FILES.some((r) => r.test(found.file)) || inWrappedTable(name, found.file)) wrapped.push(name)
    else if (SELF_SCOPED[name]) selfScoped.push(name)
    else ungated.push({ name, file: found.file })
  }

  // The agents namespace (agents.graphql): its fields are not in types/operations, and every one of them is
  // gated before its body runs: AgentsQuery by Query.agents, AgentsMutation by guardAgentMutations, apart from
  // the sign-in it deliberately leaves open. The probe executes the rest of them through the namespace.
  const byNamespace: string[] = []
  const mappedAgentMutations = agentMutationPermissionNames()
  let namespacedRead = 0
  for (const ns of AGENT_NAMESPACES) {
    for (const f of namespaceFields(ns.type)) {
      if (!EXTERNALLY_EFFECTFUL.some((r) => r.test(f.name))) continue
      namespacedRead++
      const label = `${ns.field}.${f.name}`
      if (ns.type === 'AgentsMutation' && OPEN_AGENT_MUTATIONS[f.name]) {
        selfScoped.push(label)
        SELF_SCOPED[label] = OPEN_AGENT_MUTATIONS[f.name]
      } else if (ns.type === 'AgentsMutation' && !mappedAgentMutations.has(f.name)) {
        // The guard refuses an unmapped field at runtime, but an unmapped field is still a decision nobody made.
        ungated.push({ name: label, file: 'src/domains/agents/resolvers/guardAgentMutations.ts (no entry)' })
      } else {
        byNamespace.push(label)
      }
    }
  }

  console.log(`read ${unprobed.length + namespacedRead} operation(s) the probe will not execute`)
  console.log('')
  console.log(`  gated in the resolver body : ${gated.length}`)
  console.log(`  gated by a wrapper map     : ${wrapped.length}`)
  console.log(`  gated by its namespace     : ${byNamespace.length}`)
  for (const ns of AGENT_NAMESPACES) console.log(`      - ${ns.type}: ${ns.gate}`)
  console.log(`  authenticated, self-scoped : ${selfScoped.length}`)
  for (const n of selfScoped) console.log(`      - ${n} — ${SELF_SCOPED[n]}`)
  if (missing.length) {
    console.log(`  no resolver body found     : ${missing.length}`)
    for (const n of missing) console.log(`      - ${n}`)
  }
  console.log(`  UNGATED                    : ${ungated.length}`)
  for (const u of ungated) console.log(`      - ${u.name}   (${u.file})`)

  if (ungated.length || missing.length) {
    console.log('')
    console.log('FAIL: an operation the probe cannot execute names no permission and is not')
    console.log('listed as self-scoped. Give it a gate, or add it to SELF_SCOPED with a reason.')
    process.exit(1)
  }
  console.log('')
  console.log('OK every unprobed operation is gated or documented as self-scoped.')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
