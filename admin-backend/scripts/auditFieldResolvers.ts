/**
 * Finds type-level field resolvers that read the database without a context.
 *
 * Field resolvers on object types run AFTER the top-level gate, and nothing
 * audits them: `guardAdminSurface` wraps Query and Mutation, `probeAdminAuthz`
 * invokes Query and Mutation, and `auditUnprobedOperations` reads Query and
 * Mutation. A resolver like `AgentAccount.parentAgent` sits outside all three.
 *
 * That one was found by hand: it took no `ctx` — arity 1, so it could not have
 * been authorising anything — and returned an agent's upline with its whole
 * credit position, walking UP a hierarchy that only authorises DOWN.
 *
 * This reports the general shape. A field resolver that fetches is only as
 * scoped as the object that produced its parent, so one that ALSO ignores `ctx`
 * has no scope of its own at all. Not every hit is a bug — a resolver that reads
 * a value straight off `parent` is fine, and one that fetches by `parent.id`
 * inherits the parent's scoping — but every hit is worth a decision.
 *
 * Read-only, static.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = 'src'

/** Reviewed and accepted, with the reason. */
const ACCEPTED: Record<string, string> = {
  'AgentAccount.settlementBalanceByDomain':
    'fetches by parent.id only, so it inherits the parent object’s scoping',
  'AgentAccount.commissionRates': 'fetches by parent.id only',
  'AgentAccount.sharingRates': 'fetches by parent.id only',
  'User.vipTierName':
    'fetches by user.vipTierId scoped to user.tenant, both taken from the parent row',
  'User.parentAgent':
    'returns id, username and schemeType only — no credit or settlement figures',
}

// `AgentAccount.parentAgent` and the `Whitelabel.credit*`/`sharingRates` fields are
// absent on purpose: they now take a `ctx` and authorise, so the scan no longer
// flags them. Their reasoning lives with the code, in `mayReadWhitelabelMoney`
// and in parentAgentScope / whitelabelFieldScope integration tests.
/** Anything that reaches storage. */
const FETCHES = /\b(db|tx|pool)\s*\.\s*(select|execute|query|insert|update|delete|transaction)\b|Repo\.\w+\(|Db\(|await\s+get[A-Z]\w*\(|await\s+list[A-Z]\w*\(|await\s+find[A-Z]\w*\(/

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue
      walk(p, out)
    } else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}

type Hit = { type: string; field: string; file: string; line: number; arity: number }

/**
 * Splits a resolver file into type blocks, then finds the field resolvers under
 * each. Only types that are NOT Query/Mutation/Subscription are of interest —
 * those three are audited elsewhere.
 */
function scan(file: string): Hit[] {
  const src = readFileSync(file, 'utf8')
  const rel = relative(SRC, file).replace(/\\/g, '/')
  const hits: Hit[] = []

  // Type blocks look like `  TypeName: {` at two or one levels of indent.
  const typeStarts = [...src.matchAll(/^\t? {0,2}([A-Z][A-Za-z0-9_]*):\s*\{/gm)]
  for (let i = 0; i < typeStarts.length; i++) {
    const type = typeStarts[i][1]
    if (['Query', 'Mutation', 'Subscription'].includes(type)) continue
    const from = typeStarts[i].index ?? 0
    const to = i + 1 < typeStarts.length ? (typeStarts[i + 1].index ?? src.length) : src.length
    const block = src.slice(from, to)

    // Field resolvers inside: `    name: (a, b, c) => {` or `    name: async (…)`.
    const fieldRe = /^\t{0,3} {0,6}([a-z][A-Za-z0-9_]*):\s*(async\s*)?\(([^)]*)\)\s*(:[^=]*)?=>/gm
    const fields = [...block.matchAll(fieldRe)]
    for (let k = 0; k < fields.length; k++) {
      const m = fields[k]
      const field = m[1]
      const params = m[3].trim()
      const arity = params === '' ? 0 : params.split(',').length
      const at = m.index ?? 0
      // Bound the body at the NEXT field, not a fixed window. A fixed window
      // read into the following resolvers and reported nine pure `Number(...)`
      // converters as though they queried the database.
      const bodyEnd = k + 1 < fields.length ? (fields[k + 1].index ?? block.length) : block.length
      const body = block.slice(at, bodyEnd)
      if (!FETCHES.test(body)) continue
      if (arity >= 3) continue // has ctx
      hits.push({
        type,
        field,
        file: rel,
        line: src.slice(0, at + from).split('\n').length,
        arity,
      })
    }
  }
  return hits
}

function main(): void {
  const files = walk(join(SRC, 'domains'))
  const hits = files.flatMap(scan)

  const unreviewed = hits.filter((h) => !ACCEPTED[`${h.type}.${h.field}`])

  console.log(`scanned ${files.length} resolver file(s)`)
  console.log('')
  console.log(`  field resolvers that fetch without a ctx : ${hits.length}`)
  const acceptedHits = hits.filter((h) => ACCEPTED[`${h.type}.${h.field}`])
  console.log(`  reviewed and accepted                    : ${acceptedHits.length}`)
  for (const h of acceptedHits) {
    console.log(`      - ${h.type}.${h.field} — ${ACCEPTED[`${h.type}.${h.field}`]}`)
  }
  // An accepted entry that no longer matches anything is a rename hiding a
  // decision, the same hygiene the mutation permission tables get.
  const stale = Object.keys(ACCEPTED).filter(
    (k) => !hits.some((h) => `${h.type}.${h.field}` === k)
  )
  if (stale.length) {
    console.log(`  accepted but no longer matching          : ${stale.length}`)
    for (const k of stale) console.log(`      - ${k}`)
  }
  console.log(`  UNREVIEWED                               : ${unreviewed.length}`)
  for (const h of unreviewed) {
    console.log(`      - ${h.type}.${h.field}  (${h.file}:${h.line}, arity ${h.arity})`)
  }

  if (unreviewed.length) {
    console.log('')
    console.log('FAIL: a field resolver reads storage with no context, so it has no scope of its')
    console.log('own. Give it a ctx and scope it, or add it to ACCEPTED with the reason it is safe.')
    process.exit(1)
  }
  console.log('')
  console.log('OK every fetching field resolver is scoped or reviewed.')
  process.exit(0)
}

main()
