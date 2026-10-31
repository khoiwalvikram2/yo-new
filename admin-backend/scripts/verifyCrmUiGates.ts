/**
 * Permission gates in the CRM app, checked against the real catalogue.
 *
 * A gate that names a permission nobody can hold fails silently and in the
 * worst direction: `can(me, 'crm.tags', 'aply')` is false for everybody, so the
 * nav entry never appears and the route redirects away. Nothing throws, nothing
 * logs, and the screen simply does not exist — for the administrator too, which
 * is why it can survive a full manual test.
 *
 * The same applies in reverse to routes: a nav entry pointing at a path with no
 * route lands on the catch-all, so the user clicks "Books" and arrives at
 * Players with no explanation.
 *
 * Three checks:
 *   1. every domain:action named by the CRM app exists in CRM_PERMISSIONS
 *   2. every nav key resolves to a declared route
 *   3. a nav entry and its route agree about the permission they demand
 *
 * Check 3 is also what keeps `landingPath` from looping. A refused route
 * redirects to the first nav entry the user passes the *nav* gate for; that
 * lands them on a route whose gate is proven identical, so it admits them.
 * Were the two allowed to disagree, the redirect could bounce straight back
 * into another refusal.
 */
import 'dotenv/config'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(process.cwd(), '..')
const CRM_SRC = join(ROOT, 'crm', 'src')

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
  const problems: string[] = []
  const note = (s: string) => problems.push(s)

  const { CRM_PERMISSIONS } = await import('@src/domains/crm/permissions.js')
  const catalogue = new Set<string>(
    CRM_PERMISSIONS.flatMap((g: any) => g.actions.map((a: any) => `${a.domain}:${a.action}`))
  )
  if (catalogue.size === 0) throw new Error('the catalogue came back empty — the check would be vacuous')

  // ---- 1. every permission the UI names must be grantable -------------------
  // Tests name permissions that deliberately do not exist, to prove `can`
  // refuses them. Scanning them would report those fixtures as defects.
  const files = walk(CRM_SRC).filter((f) => !/\.test\.tsx?$|__tests__/.test(f))
  let gatesSeen = 0
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    const rel = relative(ROOT, f)

    // can(me, 'domain', 'action')  — the nav and in-page gates
    for (const m of src.matchAll(/\bcan\(\s*[A-Za-z0-9_.?]+\s*,\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
      gatesSeen++
      const key = `${m[1]}:${m[2]}`
      if (!catalogue.has(key)) note(`unknown permission ${key} — ${rel}`)
    }
    // <Guarded domain="..." action="..."> — the route gates
    for (const m of src.matchAll(/domain="([^"]+)"\s+action="([^"]+)"/g)) {
      gatesSeen++
      const key = `${m[1]}:${m[2]}`
      if (!catalogue.has(key)) note(`unknown permission ${key} — ${rel}`)
    }
    // { domain: '...', action: '...' } — the shared navigation list
    for (const m of src.matchAll(/domain:\s*'([^']+)'\s*,\s*action:\s*'([^']+)'/g)) {
      gatesSeen++
      const key = `${m[1]}:${m[2]}`
      if (!catalogue.has(key)) note(`unknown permission ${key} — ${rel}`)
    }
  }
  if (gatesSeen === 0) throw new Error('found no permission gates in the CRM app — the check would be vacuous')

  // ---- 2 & 3. nav entries against routes ------------------------------------
  const routerSrc = readFileSync(join(CRM_SRC, 'app', 'router.tsx'), 'utf8')
  const navSrc = readFileSync(join(CRM_SRC, 'app', 'navigation.ts'), 'utf8')

  // Declared routes, and the permission each demands (if any).
  const routeGate = new Map<string, string | null>()
  for (const m of routerSrc.matchAll(
    /<Route\s+path="([^"]+)"([\s\S]*?)(?:\/>|<\/Route>)/g
  )) {
    const path = m[1]
    const guard = /domain="([^"]+)"\s+action="([^"]+)"/.exec(m[2])
    routeGate.set(path, guard ? `${guard[1]}:${guard[2]}` : null)
  }
  if (routeGate.size === 0) throw new Error('parsed no routes — the check would be vacuous')

  // Nav entries: path plus the permission the sidebar demands to show it.
  const navEntries: Array<{ key: string; gate: string | null }> = []
  for (const m of navSrc.matchAll(
    /\{\s*path:\s*'([^']+)'\s*,\s*label:\s*'[^']*'\s*,\s*domain:\s*'([^']+)'\s*,\s*action:\s*'([^']+)'\s*\}/g
  )) {
    navEntries.push({ key: m[1], gate: `${m[2]}:${m[3]}` })
  }
  if (navEntries.length === 0) throw new Error('parsed no nav entries — the check would be vacuous')

  for (const n of navEntries) {
    if (!routeGate.has(n.key)) {
      note(`nav entry ${n.key} has no route — clicking it lands on the catch-all`)
      continue
    }
    const rg = routeGate.get(n.key) ?? null
    if (rg !== n.gate) {
      // A nav entry shown to someone the route turns away is a dead click.
      note(`nav ${n.key} demands ${n.gate ?? 'nothing'} but its route demands ${rg ?? 'nothing'}`)
    }
  }

  console.log(`catalogue permissions: ${catalogue.size}`)
  console.log(`permission gates in the CRM app: ${gatesSeen}`)
  console.log(`routes: ${routeGate.size}, nav entries: ${navEntries.length}`)

  if (problems.length) {
    console.error(`\n${problems.length} finding(s):`)
    for (const p of problems) console.error('  X ' + p)
    process.exitCode = 1
  } else {
    console.log('\nOK every UI gate names a real permission, and every nav entry agrees with its route')
  }
}

main().catch((e) => {
  console.error('failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
