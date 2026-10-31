/**
 * Which CRM operations does a test actually execute?
 *
 * "The suite passes" and "the surface is tested" are different claims, and the
 * gap between them is invisible from a green run. This maps every CRM operation
 * the schema exposes onto the tests that name it, so the untested half can be
 * stated rather than assumed.
 *
 * Naming an operation is weaker evidence than executing it, so the two are
 * reported apart: a name inside a GraphQL document string is a real exercise,
 * while a name in a comment is not. The check errs towards generous — anything
 * it calls untested is untested for certain.
 */
import 'dotenv/config'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'

const ROOT = join(process.cwd(), '..')
const RESOLVER_DIR = join(process.cwd(), 'src', 'domains', 'crm', 'resolvers')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (['node_modules', 'dist'].includes(e.name) || e.name.startsWith('.')) continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

async function main(): Promise<void> {
  // ---- the surface ---------------------------------------------------------
  const ops: Array<{ name: string; file: string }> = []
  for (const f of readdirSync(RESOLVER_DIR)) {
    if (!f.endsWith('.ts') || f === 'index.ts') continue
    const src = readFileSync(join(RESOLVER_DIR, f), 'utf8')
    for (const m of src.matchAll(
      /^ {2}(crm[A-Za-z0-9]*|whitelabelCrm[A-Za-z0-9]*|setCrmWhitelabelSettings):\s*async/gm
    )) {
      ops.push({ name: m[1], file: basename(f) })
    }
  }
  if (ops.length === 0) throw new Error('found no CRM operations — the check would be vacuous')

  // ---- the tests -----------------------------------------------------------
  const testFiles: string[] = []
  for (const dir of [join(process.cwd(), 'src'), join(ROOT, 'crm', 'src'), join(ROOT, 'shared', 'src')]) {
    try {
      statSync(dir)
      for (const f of walk(dir)) if (/\.test\.tsx?$/.test(f)) testFiles.push(f)
    } catch {
      /* not present */
    }
  }
  const tests = testFiles.map((f) => ({ file: relative(ROOT, f), src: readFileSync(f, 'utf8') }))
  if (tests.length === 0) throw new Error('found no test files — the check would be vacuous')

  // ---- who exercises what --------------------------------------------------
  const executed: string[] = []
  const mentionedOnly: string[] = []
  const untested: string[] = []

  for (const op of ops) {
    const re = new RegExp(`\\b${op.name}\\b`)
    const hits = tests.filter((t) => re.test(t.src))
    if (hits.length === 0) {
      untested.push(`${op.name} (${op.file})`)
      continue
    }
    // Executed if the name appears inside something that looks like a GraphQL
    // document or a direct resolver call, rather than only in prose.
    const reallyRuns = hits.some((t) => {
      const lines = t.src.split('\n').filter((l) => re.test(l))
      return lines.some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    })
    if (reallyRuns) executed.push(op.name)
    else mentionedOnly.push(`${op.name} (${op.file})`)
  }

  const pct = (n: number) => `${Math.round((n / ops.length) * 100)}%`

  console.log(`CRM operations: ${ops.length}`)
  console.log(`test files scanned: ${tests.length}`)
  console.log()
  console.log(`  exercised by a test : ${executed.length} (${pct(executed.length)})`)
  console.log(`  named only in prose : ${mentionedOnly.length}`)
  console.log(`  never named at all  : ${untested.length} (${pct(untested.length)})`)

  if (mentionedOnly.length) {
    console.log(`\nnamed only in a comment — not evidence of a test:`)
    for (const m of mentionedOnly) console.log('  ~ ' + m)
  }
  if (untested.length) {
    console.log(`\nno test names these at all:`)
    for (const u of untested) console.log('  · ' + u)
  }

  // ---- what the untested operations rest on --------------------------------
  //
  // An operation with no resolver-level test may still have its SQL covered by
  // a repo-level one. That is worth knowing and worth not overstating: the repo
  // test proves the query, while the permission gate, the INACTIVE gate, the
  // scope predicate and the input validation all live in the resolver and go
  // unexercised either way.
  const opBodies = new Map<string, string>()
  for (const f of readdirSync(RESOLVER_DIR)) {
    if (!f.endsWith('.ts') || f === 'index.ts') continue
    const src = readFileSync(join(RESOLVER_DIR, f), 'utf8')
    const re = /^ {2}(crm[A-Za-z0-9]*|whitelabelCrm[A-Za-z0-9]*|setCrmWhitelabelSettings):\s*async/gm
    const starts: Array<{ name: string; at: number }> = []
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index })
    for (let i = 0; i < starts.length; i++) {
      const stop = i + 1 < starts.length ? starts[i + 1].at : src.length
      opBodies.set(starts[i].name, src.slice(starts[i].at, stop))
    }
  }

  // Every function the CRM repos export, and whether a test names it.
  const repoFns = new Map<string, boolean>()
  for (const f of walk(join(process.cwd(), 'src', 'repos', 'crm'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(
      /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm
    )) {
      const name = m[1]
      const re = new RegExp(`\\b${name}\\b`)
      repoFns.set(name, tests.some((t) => re.test(t.src)))
    }
  }

  const sqlCovered: string[] = []
  const noCoverAnywhere: string[] = []
  for (const entry of untested) {
    const name = entry.split(' ')[0]
    const body = opBodies.get(name) ?? ''
    const called = [...repoFns.keys()].filter((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(body))
    const covered = called.filter((fn) => repoFns.get(fn))
    if (covered.length > 0) sqlCovered.push(`${name} — repo tested: ${covered.join(', ')}`)
    else noCoverAnywhere.push(entry)
  }

  console.log(`\nof the ${untested.length} with no resolver test:`)
  console.log(`  SQL covered by a repo-level test : ${sqlCovered.length}`)
  console.log(`  no test at any layer             : ${noCoverAnywhere.length}`)
  if (sqlCovered.length) {
    console.log(`\n  query tested, gate untested:`)
    for (const s of sqlCovered) console.log('    ~ ' + s)
  }
  if (noCoverAnywhere.length) {
    console.log(`\n  nothing tests these at all:`)
    for (const s of noCoverAnywhere) console.log('    X ' + s)
  }

  // ---- front-end modules ---------------------------------------------------
  const uiFiles = walk(join(ROOT, 'crm', 'src')).filter((f) => !/\.test\.tsx?$/.test(f))
  const uiTested = new Set<string>()
  for (const t of tests) {
    for (const m of t.src.matchAll(/from\s+'@\/([^']+)'/g)) uiTested.add(m[1])
  }
  console.log(`\ncrm/src modules: ${uiFiles.length}, imported by a test: ${uiTested.size}`)
  for (const m of [...uiTested].sort()) console.log('  covered: @/' + m)
}

main().catch((e) => {
  console.error('failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
