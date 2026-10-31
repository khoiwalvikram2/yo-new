/**
 * Can an INACTIVE CRM user still write?
 *
 * `requireCrmWrite` is the only thing standing between a deactivated agent and
 * the whole CRM. A mutation that forgets it does not fail loudly — it works,
 * for exactly the person who was supposed to lose access. So the gate is
 * checked against the real Mutation type rather than against a hand-kept list.
 */
import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RESOLVER_DIR = join(process.cwd(), 'src', 'domains', 'crm', 'resolvers')

/** Mutations an INACTIVE user may still run, each with the reason. */
const INACTIVE_MAY_RUN: Record<string, string> = {
  crmLogin: 'signing in stays open; it is the writes that stop',
  crmChangeOwnPassword: 'a deactivated user must still be able to rotate their own password',
  crmMarkNotificationsRead: 'their own inbox, not a write to anyone else',
  crmSetMyAvailability: 'their own availability flag',
  crmCreateFirstAdmin: 'admin-panel surface; no CRM session exists yet',
  setCrmWhitelabelSettings: 'admin-panel surface, gated by admin permissions',
}

async function main(): Promise<void> {
  const { typeDefs } = await import('@src/types/graphql.js')
  const sdl = String(typeDefs)

  // Every field of the Mutation type, however many blocks declare it.
  const mutationNames = new Set<string>()
  for (const block of sdl.matchAll(/(?:extend\s+)?type\s+Mutation\s*\{([\s\S]*?)\n\s*\}/g)) {
    for (const f of block[1].matchAll(/^\s*([a-zA-Z][A-Za-z0-9]*)\s*[(:]/gm)) mutationNames.add(f[1])
  }
  if (mutationNames.size === 0) throw new Error('found no Mutation fields — the check would be vacuous')

  const bodies = new Map<string, { file: string; body: string }>()
  for (const f of readdirSync(RESOLVER_DIR)) {
    if (!f.endsWith('.ts') || f === 'index.ts') continue
    const src = readFileSync(join(RESOLVER_DIR, f), 'utf8')
    const starts: Array<{ name: string; at: number }> = []
    let m: RegExpExecArray | null
    const re = /^ {2}([a-zA-Z][A-Za-z0-9]*):\s*async/gm
    while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index })
    for (let i = 0; i < starts.length; i++) {
      const stop = i + 1 < starts.length ? starts[i + 1].at : src.length
      bodies.set(starts[i].name, { file: f, body: src.slice(starts[i].at, stop) })
    }
  }

  const missing: string[] = []
  let checked = 0
  for (const [name, { file, body }] of bodies) {
    if (!mutationNames.has(name)) continue // queries are not writes
    if (name in INACTIVE_MAY_RUN) continue
    if (name.startsWith('whitelabelCrm')) continue // admin principal, no CRM session
    checked++
    if (!body.includes('requireCrmWrite')) missing.push(`${file} ${name}`)
  }

  console.log(`Mutation fields in the schema: ${mutationNames.size}`)
  console.log(`CRM mutations checked for the INACTIVE gate: ${checked}`)
  for (const [n, why] of Object.entries(INACTIVE_MAY_RUN)) console.log(`  (allowed) ${n}: ${why}`)

  if (checked === 0) throw new Error('matched no CRM mutations — the check would be vacuous')

  if (missing.length) {
    console.error(`\n${missing.length} mutation(s) an INACTIVE user could still run:`)
    for (const x of missing) console.error('  X ' + x)
    process.exitCode = 1
  } else {
    console.log('\nOK every CRM mutation blocks an INACTIVE user')
  }
}

main().catch((e) => {
  console.error('failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
