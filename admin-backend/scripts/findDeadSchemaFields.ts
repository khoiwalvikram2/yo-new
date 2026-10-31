/**
 * Which resolver-less schema fields are actually invoked by a front end.
 *
 * A schema field with no resolver returns null. If nothing calls it, it is dead
 * schema and the fix is to delete it. If something calls it, it is a broken
 * page and the fix is a resolver — quite different work, so the two are
 * separated by evidence rather than by guessing from a name.
 */
import 'dotenv/config'
import { buildSchema, parse, visit } from 'graphql'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

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

function extractDocuments(src: string): string[] {
  const out: string[] = []
  const re = /\bgql`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let i = re.lastIndex
    let body = ''
    while (i < src.length) {
      const ch = src[i]
      if (ch === '\\') {
        body += src[i] + src[i + 1]
        i += 2
        continue
      }
      if (ch === '$' && src[i + 1] === '{') {
        i += 2
        let d = 1
        while (i < src.length && d > 0) {
          if (src[i] === '{') d++
          else if (src[i] === '}') d--
          i++
        }
        continue
      }
      if (ch === '`') break
      body += ch
      i++
    }
    out.push(body)
  }
  return out
}

async function main(): Promise<void> {
  const { typeDefs } = await import('@src/types/graphql.js')
  const { domainResolvers } = await import('@src/domains/index.js')
  const schema = buildSchema(typeDefs)

  const missing: Record<string, Set<string>> = { Query: new Set(), Mutation: new Set() }
  for (const kind of ['Query', 'Mutation'] as const) {
    const type = kind === 'Query' ? schema.getQueryType() : schema.getMutationType()
    const resolvers = new Set(
      Object.entries((domainResolvers as any)[kind] ?? {})
        .filter(([, v]) => typeof v === 'function')
        .map(([k]) => k)
    )
    for (const f of Object.keys(type?.getFields() ?? {})) {
      if (!resolvers.has(f)) missing[kind].add(f)
    }
  }

  /** field -> files that invoke it */
  const callers = new Map<string, Set<string>>()

  for (const app of ['admin', 'crm', 'user']) {
    const dir = join(ROOT, app, 'src')
    try {
      statSync(dir)
    } catch {
      continue
    }
    for (const file of walk(dir)) {
      const src = readFileSync(file, 'utf8')
      if (!src.includes('gql`')) continue
      for (const body of extractDocuments(src)) {
        if (!body.trim()) continue
        let ast
        try {
          ast = parse(body)
        } catch {
          continue
        }
        visit(ast, {
          OperationDefinition(node) {
            const kind = node.operation === 'query' ? 'Query' : node.operation === 'mutation' ? 'Mutation' : null
            if (!kind) return
            for (const sel of node.selectionSet.selections) {
              if (sel.kind !== 'Field') continue
              const name = sel.name.value
              if (missing[kind].has(name)) {
                if (!callers.has(name)) callers.set(name, new Set())
                callers.get(name)!.add(relative(ROOT, file))
              }
            }
          },
        })
      }
    }
  }

  for (const kind of ['Query', 'Mutation'] as const) {
    console.log(`\n--- ${kind} fields with no resolver ---`)
    for (const f of [...missing[kind]].sort()) {
      const who = callers.get(f)
      if (who?.size) {
        console.log(`  LIVE BREAKAGE  ${f}  ← called by ${[...who].join(', ')}`)
      } else {
        console.log(`  dead schema    ${f}`)
      }
    }
  }
}

main().catch((err) => {
  console.error('failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
