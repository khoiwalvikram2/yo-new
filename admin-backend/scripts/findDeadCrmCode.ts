/**
 * Exported CRM functions nobody calls.
 *
 * Dead code in a permission-sensitive module is not merely untidy: a helper
 * that looks like a guard, is tested, and is wired to nothing reads as
 * protection that does not exist. Two of those turned up in this codebase
 * already — `canContact` and `listSuppressed` are deliberate and documented,
 * everything else should have a caller.
 */
import 'dotenv/config'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(process.cwd(), '..')

/** Written, tested, and deliberately not wired — with the reason. */
const INTENTIONALLY_UNCALLED: Record<string, string> = {
  canContact: 'consent machinery for an outreach path that does not exist yet',
  listSuppressed: 'the same; both ship with tests and no caller on purpose',
}

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

function main(): void {
  // Everything the CRM repos and services export.
  const sourceDirs = [
    join(process.cwd(), 'src', 'repos', 'crm'),
    join(process.cwd(), 'src', 'domains', 'crm'),
  ]
  const crmFiles: string[] = []
  for (const d of sourceDirs) {
    try {
      statSync(d)
      walk(d, crmFiles)
    } catch {
      /* not present */
    }
  }

  const exports: Array<{ name: string; file: string }> = []
  for (const f of crmFiles) {
    if (/__tests__/.test(f)) continue
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)) {
      exports.push({ name: m[1], file: relative(ROOT, f) })
    }
  }

  // Everywhere a call could come from: the whole backend, plus both front ends
  // in case a name is referenced there.
  const searchDirs = [
    join(process.cwd(), 'src'),
    join(process.cwd(), 'scripts'),
    join(ROOT, 'crm', 'src'),
    join(ROOT, 'admin', 'src'),
    join(ROOT, 'shared', 'src'),
  ]
  const haystack: Array<{ file: string; src: string }> = []
  for (const d of searchDirs) {
    try {
      statSync(d)
      for (const f of walk(d)) haystack.push({ file: relative(ROOT, f), src: readFileSync(f, 'utf8') })
    } catch {
      /* not present */
    }
  }

  const dead: string[] = []
  const testOnly: string[] = []
  const overExported: string[] = []
  for (const e of exports) {
    if (e.name in INTENTIONALLY_UNCALLED) continue
    const re = new RegExp(`\\b${e.name}\\b`, 'g')
    const outside = haystack.filter((h) => h.file !== e.file && re.test(h.src))
    // A helper used by its own module is not dead — it is merely exported for
    // no reason, which is a different and far smaller problem. Counting the
    // declaring file's own uses is what separates the two; without it every
    // internal helper reads as dead code and the real ones get lost in noise.
    const own = haystack.find((h) => h.file === e.file)
    const usesInOwnFile = own ? (own.src.match(re) ?? []).length > 1 : false

    if (outside.length === 0 && !usesInOwnFile) {
      dead.push(`${e.name} — declared in ${e.file}, called nowhere at all`)
    } else if (outside.length === 0) {
      overExported.push(`${e.name} — ${e.file}, used only inside its own module`)
    } else if (outside.every((h) => /__tests__|\.test\./.test(h.file)) && !usesInOwnFile) {
      // "Only tests use it" is only interesting when production code does not.
      // A helper its own module calls and a test also covers is well-tested,
      // not orphaned.
      testOnly.push(`${e.name} — declared in ${e.file}, called only by tests`)
    }
  }

  console.log(`CRM exported functions: ${exports.length}`)
  for (const [name, why] of Object.entries(INTENTIONALLY_UNCALLED)) {
    console.log(`  (allowed) ${name}: ${why}`)
  }

  if (overExported.length) {
    console.log(`\n${overExported.length} exported but only used internally (harmless, not dead):`)
    for (const o of overExported) console.log('  · ' + o)
  }

  if (dead.length === 0 && testOnly.length === 0) {
    console.log('\n✅ every exported CRM function has a real caller')
    return
  }
  if (dead.length) {
    console.error(`\n${dead.length} with no caller at all:`)
    for (const d of dead) console.error('  ✖ ' + d)
  }
  if (testOnly.length) {
    console.error(`\n${testOnly.length} called only by tests:`)
    for (const t of testOnly) console.error('  ! ' + t)
  }
  process.exitCode = 1
}

main()
