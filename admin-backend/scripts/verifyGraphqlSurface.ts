/**
 * Checks the GraphQL surface end to end, in the directions tests do not.
 *
 * The integration tests call resolvers they already know the names of, so they
 * cannot catch a resolver whose schema field is missing (it is simply never
 * reachable) or a schema field with no resolver (it silently returns null). Nor
 * do they look at the front ends at all: a query the admin panel sends is only
 * checked when a human opens that page.
 *
 * Three passes:
 *   1. every resolver has a schema field;
 *   2. every schema field has a resolver;
 *   3. every operation literal in admin/ and crm/ validates against the schema.
 *
 * The player app is checked by `user-backend/scripts/verifyUserGraphqlSurface.ts`
 * instead — it talks to a different backend, whose schema is a different
 * document.
 */
import 'dotenv/config'
import { buildSchema, parse, validate, specifiedRules } from 'graphql'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { scanDocuments } from './graphqlDocScan.js'

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
  const { typeDefs } = await import('@src/types/graphql.js')
  const { domainResolvers } = await import('@src/domains/index.js')
  const schema = buildSchema(typeDefs)

  const problems: string[] = []
  const note = (s: string) => problems.push(s)

  // ---- 1 & 2: resolver / schema parity -----------------------------------
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

  // ---- 3: front-end operations against the real schema --------------------
  let docs = 0
  let skipped = 0
  for (const app of ['admin', 'crm']) {
    const dir = join(ROOT, app, 'src')
    try {
      statSync(dir)
    } catch {
      continue
    }
    for (const file of walk(dir)) {
      // Tests define their own throwaway documents — a probe query, or one that
      // is deliberately malformed to prove a failure path. Validating those
      // against the live schema checks nothing about the application and turns
      // a legitimate test fixture into a build failure.
      if (/\.test\.tsx?$|__tests__/.test(file)) continue
      const src = readFileSync(file, 'utf8')
      if (!src.includes('`')) continue
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
  }
  console.log(`front-end operations validated: ${docs} (${skipped} with unresolved interpolation)`)

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`)
    for (const p of problems) console.error('  ✖ ' + p)
    process.exitCode = 1
  } else {
    console.log('\n✅ schema, resolvers and front-end operations all agree')
  }
}

main().catch((err) => {
  console.error('failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
