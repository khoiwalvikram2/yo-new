/**
 * The admin panel's own surface, audited the way the CRM's already is.
 *
 * `auditCrmSurface.ts` proves that every CRM operation names a permission, that
 * every grantable permission gates something, and that every by-id path decides
 * whether the caller may reach that row. Nothing has ever asked those questions
 * of the admin panel — which is more than four hundred operations across
 * twenty-four domains, and where the money lives.
 *
 * The admin side guards differently from the CRM, and that difference is the
 * whole reason this is worth checking. The CRM calls `requireCrmPermission`,
 * which throws. The admin side almost always calls `hasPermission`, which
 * returns a boolean — so every call site decides for itself what to do with the
 * answer, and a call site that computes it and ignores it looks identical to
 * one that enforces it.
 *
 * Four passes:
 *
 *   1. **Ungated operations** — a resolver that names no permission at all is
 *      reachable by every signed-in admin user, whatever their role.
 *   2. **Consulted but not enforced** — `hasPermission(...)` evaluated and its
 *      result never used to refuse. Reads as protection; is not.
 *   3. **Dead permissions** — grantable in the role editor, enforced nowhere.
 *      An administrator grants it, withholds it, and neither has any effect.
 *   4. **Subscriptions** — the map `guardAdminSurface` cannot reach, because it
 *      wraps Query and Mutation only and subscription resolvers are objects
 *      rather than functions.
 *
 * Reports rather than fails by default, because the admin surface predates this
 * check and a wall of pre-existing findings is not a useful gate. Pass
 * `--strict` to exit non-zero, once a domain is clean and worth defending.
 */
import 'dotenv/config'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { AGENT_NAMESPACES, namespaceFields } from './agentNamespaceFields.js'

const SRC = join(process.cwd(), 'src')
const DOMAINS = join(SRC, 'domains')
const STRICT = process.argv.includes('--strict')
const ONLY = process.argv.find((a) => a.startsWith('--domain='))?.split('=')[1] ?? null

/**
 * Operations that legitimately need no permission.
 *
 * Each is either the sign-in itself, the caller reading their own session, or a
 * surface gated by something other than the permission table.
 */
const UNGATED_BY_DESIGN = new Set([
  'login',
  'agentLogin',
  'crmLogin',
  'me',
  'crmMe',
  'myPermissions',
  'permissionCatalog',
  'crmPermissionCatalog',
  'refreshToken',
  'logout',
  'changeOwnPassword',
  'crmChangeOwnPassword',
  'currentWhitelabel',
  'publicWhitelabel',
  'health',
])

/** Anything that counts as this resolver refusing on a permission. */
const ENFORCEMENT = [
  'requirePermission(',
  // The read gate (common/auth.ts): no session, or no permission, throws. Reads gated by it were listed as
  // "naming no permission" (the referral and Promotions reads among them).
  'requireReadPermission(',
  // The deposit review reads' gate (deposits/resolvers/queries.ts): a commission agent, then a caller without
  // payments.deposits:view, is refused with a throw. adminDepositRequests and depositRequestProof go through it.
  'requireDepositRequestsRead(',
  // The payment method reads' gate (same file): no session, a commission agent, then a caller without
  // payments.methods:view, is refused with a throw. myDepositMethods and whitelabelPaymentMethods go through it.
  'requirePaymentMethodsRead(',
  'requireAnyPermission(',
  'requireSuperAdmin(',
  'assertPermission(',
  'requireCrmPermission(',
  'ensureAgentCanMutate(',
]

type Op = { name: string; domain: string; file: string; body: string; kind: 'Query' | 'Mutation' }

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

/** The field names the schema actually serves, so we audit the real surface. */
function schemaFields(file: string): Set<string> {
  const src = readFileSync(join(SRC, 'types', 'operations', file), 'utf8')
  const out = new Set<string>()
  for (const m of src.matchAll(/^\s{2}([a-zA-Z][A-Za-z0-9_]*)\s*[(:]/gm)) out.add(m[1])
  return out
}

/**
 * Splits a resolver file into one entry per top-level operation.
 *
 * Matches a two-space-indented key followed by a function, which is how every
 * resolver map in this codebase is written.
 */
function readOperations(file: string, names: Set<string>, kind: 'Query' | 'Mutation'): Op[] {
  const src = readFileSync(file, 'utf8')
  const rel = relative(SRC, file).replace(/\\/g, '/')
  const domain = rel.split('/')[1] ?? '?'
  const starts: Array<{ name: string; at: number }> = []
  for (const m of src.matchAll(/^\t? {0,2}([a-zA-Z][A-Za-z0-9_]*)\s*:\s*(async\s*)?(function\s*)?\(/gm)) {
    if (names.has(m[1])) starts.push({ name: m[1], at: m.index ?? 0 })
  }
  const out: Op[] = []
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].at : src.length
    out.push({ name: starts[i].name, domain, file: rel, body: src.slice(starts[i].at, end), kind })
  }
  return out
}

async function main(): Promise<void> {
  const queries = schemaFields('queries.graphql')
  const mutations = schemaFields('mutations.graphql')
  const files = walk(DOMAINS).filter((f) => /resolvers/.test(f))

  const seen = new Map<string, Op>()
  for (const f of files) {
    for (const op of [
      ...readOperations(f, queries, 'Query'),
      ...readOperations(f, mutations, 'Mutation'),
    ]) {
      // A field can appear in an index re-export and in its own file; keep the
      // longest body, which is the real implementation.
      const prior = seen.get(op.name)
      if (!prior || op.body.length > prior.body.length) seen.set(op.name, op)
    }
  }
  const ops = [...seen.values()].filter((o) => !ONLY || o.domain === ONLY)

  console.log(`schema fields: ${queries.size} queries, ${mutations.size} mutations`)
  console.log(`resolver bodies located: ${ops.length}${ONLY ? ` (domain ${ONLY})` : ''}\n`)

  const ungated: Op[] = []
  const consultedNotEnforced: Op[] = []
  const declared = new Set<string>()

  for (const op of ops) {
    if (UNGATED_BY_DESIGN.has(op.name)) continue

    for (const m of op.body.matchAll(/['"]([a-z][a-z0-9.\-]*)['"]\s*,\s*['"]([a-z_*]+)['"]/gi)) {
      declared.add(`${m[1]}:${m[2]}`)
    }

    const enforces = ENFORCEMENT.some((e) => op.body.includes(e))
    const consults = /hasPermission\(|hasAnyPermission\(/.test(op.body)
    // `hasPermission` used inside a condition that throws or returns an error
    // is enforcement; used to widen a query or pick a branch is not.
    const actsOnIt =
      consults &&
      /(if\s*\(\s*!?\s*(await\s*)?has(Any)?Permission[\s\S]{0,400}?(throw|return\s*\{[^}]*(ok|error)|Forbidden))/.test(
        op.body
      )

    if (!enforces && !consults) ungated.push(op)
    else if (!enforces && consults && !actsOnIt) consultedNotEnforced.push(op)
  }

  const byDomain = (list: Op[]) => {
    const m: Record<string, string[]> = {}
    for (const o of list) (m[o.domain] ||= []).push(`${o.kind[0]}:${o.name}`)
    return m
  }

  console.log(`--- 1. operations naming no permission at all: ${ungated.length} ---`)
  for (const [d, names] of Object.entries(byDomain(ungated)).sort()) {
    console.log(`  ${d} (${names.length}): ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` …+${names.length - 8}` : ''}`)
  }

  console.log(`\n--- 2. permission consulted but never refused on: ${consultedNotEnforced.length} ---`)
  for (const [d, names] of Object.entries(byDomain(consultedNotEnforced)).sort()) {
    console.log(`  ${d} (${names.length}): ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` …+${names.length - 8}` : ''}`)
  }

  // ---- the agents namespace ----------------------------------------------------
  // Its operations (the chips API among them) are declared in agents.graphql, not in types/operations, and each
  // is gated before its body runs: AgentsQuery by Query.agents, AgentsMutation by guardAgentMutations' per-field
  // table. probe:admin-authz executes them through the namespace; here they are counted, and the permissions the
  // namespace gates name count as declared for pass 3.
  const namespaced = AGENT_NAMESPACES.map((ns) => ({ ns, fields: namespaceFields(ns.type) }))
  console.log(
    `\n--- agents namespace: ${namespaced.reduce((n, x) => n + x.fields.length, 0)} operation(s) gated before their bodies run ---`
  )
  for (const { ns, fields } of namespaced) console.log(`  ${ns.type} (${fields.length}): ${ns.gate}`)
  for (const file of ['guardAgentMutations.ts', 'index.ts']) {
    const src = readFileSync(join(DOMAINS, 'agents', 'resolvers', file), 'utf8')
    for (const m of src.matchAll(/['"]([a-z][a-z0-9.\-]*)['"]\s*,\s*['"]([a-z_*]+)['"]/gi)) {
      declared.add(`${m[1]}:${m[2]}`)
    }
  }

  // ---- 3. dead permissions -------------------------------------------------
  const { pool } = await import('@src/db/client.js')
  const granted = await pool.query(`SELECT DISTINCT domain, action FROM permissions ORDER BY domain, action`)
  const allSource = ops.map((o) => o.body).join('\n')
  const dead = (granted.rows as Array<{ domain: string; action: string }>).filter(
    (p) => !declared.has(`${p.domain}:${p.action}`) && !allSource.includes(`'${p.domain}'`)
  )
  console.log(`\n--- 3. grantable permissions that gate nothing: ${dead.length} of ${granted.rows.length} ---`)
  const deadByDomain: Record<string, number> = {}
  for (const p of dead) deadByDomain[p.domain] = (deadByDomain[p.domain] ?? 0) + 1
  const worst = Object.entries(deadByDomain).sort((a, b) => b[1] - a[1]).slice(0, 12)
  for (const [d, n] of worst) console.log(`  ${d}: ${n}`)

  // ---- 4. subscriptions ----------------------------------------------------
  const subFiles = files.filter((f) => /subscriptions?\.ts$/.test(f))
  const subSrc = subFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
  const subFields = [...subSrc.matchAll(/^\s{2}([a-zA-Z][A-Za-z0-9_]*)\s*:\s*\{/gm)].map((m) => m[1])
  const argTenant = [...subSrc.matchAll(/args\??\.\s*tenant/g)].length
  console.log(`\n--- 4. subscriptions: ${subFields.length} across ${subFiles.length} file(s) ---`)
  console.log(`  guardAdminSurface cannot reach these: it wraps Query and Mutation, and these are`)
  console.log(`  {subscribe, resolve} objects rather than functions. Authentication is enforced at`)
  console.log(`  the socket instead (subscription.onConnect in src/index.ts).`)
  console.log(`  resolvers still reading a tenant from their arguments: ${argTenant}`)

  await pool.end()

  const total = ungated.length + consultedNotEnforced.length
  console.log(
    `\n${total} operation(s) with no enforced permission, ${dead.length} permission(s) gating nothing.`
  )
  if (STRICT && total > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
