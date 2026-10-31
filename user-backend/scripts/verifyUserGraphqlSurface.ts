/**
 * The same surface check as admin-backend, for the player-facing pair.
 *
 * Two things made the user app invisible to the admin-side checker, and both
 * matter: it talks to *this* backend, whose schema is a different document
 * entirely, and it writes its operations as bare template literals handed to
 * `graphqlRequest(...)` rather than tagged with `gql`. A checker that only
 * looks for the tag sees none of them.
 *
 * Passes:
 *   1. every resolver has a schema field;
 *   2. every schema field has a resolver;
 *   3. every operation literal in user/ validates against this schema.
 */
import 'dotenv/config'
import { buildSchema, parse, validate, specifiedRules } from 'graphql'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { scanDocuments } from '../../admin-backend/scripts/graphqlDocScan.js'

const ROOT = join(process.cwd(), '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p)
  }
  return out
}

async function main(): Promise<void> {
  const { typeDefs } = await import('../src/types/graphql.js')
  const { domainResolvers } = await import('../src/domains/index.js')
  const schema = buildSchema(typeDefs)

  const problems: string[] = []
  const note = (s: string) => problems.push(s)

  for (const kind of ['Query', 'Mutation'] as const) {
    const type = kind === 'Query' ? schema.getQueryType() : schema.getMutationType()
    const schemaFields = new Set(Object.keys(type?.getFields() ?? {}))
    const resolverFields = new Set(
      Object.entries((domainResolvers as any)[kind] ?? {})
        .filter(([, v]) => typeof v === 'function')
        .map(([k]) => k)
    )
    for (const f of resolverFields) {
      if (!schemaFields.has(f)) note(`${kind}.${f}: resolver exists but no schema field — unreachable`)
    }
    for (const f of schemaFields) {
      if (!resolverFields.has(f)) note(`${kind}.${f}: schema field exists but no resolver — returns null`)
    }
    console.log(`${kind}: ${schemaFields.size} schema fields, ${resolverFields.size} resolvers`)
  }

  let docs = 0
  let skipped = 0
  const dir = join(ROOT, 'user', 'src')
  try {
    statSync(dir)
  } catch {
    console.log('no user/src to check')
    return
  }
  for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf8')
    if (!/`/.test(src)) continue
    for (const doc of scanDocuments(src)) {
      if (!doc.resolved) {
        note(`${relative(ROOT, file)}: an interpolation could not be resolved from this file`)
        skipped++
      }
      const body = doc.body
      docs++
      let ast
      try {
        ast = parse(body)
      } catch (e) {
        note(`${relative(ROOT, file)}: unparseable operation — ${(e as Error).message}`)
        continue
      }
      for (const err of validate(schema, ast, specifiedRules)) {
        note(`${relative(ROOT, file)}: ${err.message}`)
      }
    }
  }
  console.log(`user-app operations validated: ${docs} (${skipped} with unresolved interpolation)`)

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`)
    for (const p of problems) console.error('  ✖ ' + p)
    process.exitCode = 1
  } else {
    console.log('\n✅ user schema, resolvers and app operations all agree')
  }
}

main().catch((err) => {
  console.error('failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
