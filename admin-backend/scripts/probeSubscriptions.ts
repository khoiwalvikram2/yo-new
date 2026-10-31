/**
 * Executes every GraphQL subscription's `subscribe` and reports who reaches it.
 *
 * Subscriptions are `{subscribe, resolve}` objects rather than functions, so
 * `guardAdminSurface` — which wraps `Query` and `Mutation` — cannot touch them,
 * and neither `auditAdminSurface` nor `probeAdminAuthz` walks the map. That has
 * always been a blind spot, and a subscription leak is worse than a query leak:
 * it streams for as long as the socket stays open.
 *
 * This calls each `subscribe` with four principals and reports which of them
 * reach the body. Nothing is written: `subscribe` sets up a stream, and the fake
 * pubsub below hands back an iterator that is immediately closed.
 *
 * `Forbidden`/`Unauthorized` means gated. Anything else means the caller reached
 * the code — which for a subscription means they are now on the topic.
 *
 * Requires DATABASE_URL. Read-only.
 */
import 'dotenv/config'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deriveAgentPermissions } from '@src/domains/agents/services/AgentPermissionsService.js'

const SRC = 'src'

/**
 * Taken from the guard itself rather than restated here, so the probe and the
 * thing it probes cannot drift: an entry added to `OPEN_SUBSCRIPTIONS` is
 * exempted here automatically, and nowhere else.
 */
import { OPEN_SUBSCRIPTIONS as OPEN_BY_DESIGN } from '@src/domains/common/guardSubscriptions.js'

type Principal = { name: string; ctx: Record<string, unknown> }

/** An iterator that yields nothing and closes, so no stream is left running. */
const emptyIterator = () => ({
  next: async () => ({ done: true, value: undefined }),
  return: async () => ({ done: true, value: undefined }),
  throw: async () => ({ done: true, value: undefined }),
  [Symbol.asyncIterator]() {
    return this
  },
})

const pubsub = {
  subscribe: async () => emptyIterator(),
  publish: () => undefined,
  asyncIterator: () => emptyIterator(),
}

function subscriptionFields(): string[] {
  const out = new Set<string>()
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.graphql')) files.push(p)
    }
  }
  walk(join(SRC, 'types'))
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    let i = src.indexOf('type Subscription')
    while (i >= 0) {
      const body = src.slice(i, src.indexOf('\n}', i))
      for (const m of body.matchAll(/^\s{2}([a-zA-Z][A-Za-z0-9_]*)\s*[(:]/gm)) out.add(m[1])
      i = src.indexOf('type Subscription', i + 1)
    }
  }
  return [...out].sort()
}

function classify(e: unknown): 'gated' | 'reached' {
  const m = String((e as Error)?.message ?? e)
  return /Forbidden|Unauthorized|insufficient permission|authentication required/i.test(m)
    ? 'gated'
    : 'reached'
}

async function main(): Promise<void> {
  const names = subscriptionFields()
  const { domainResolvers } = await import('@src/domains/index.js')
  const map = (domainResolvers as Record<string, Record<string, any>>).Subscription ?? {}

  const base = {
    tenant: 'default',
    whitelabel: { id: 'default' },
    request: { headers: {} },
    loaders: {},
    pubsub,
  }
  const principals: Principal[] = [
    { name: 'NO SESSION', ctx: { ...base, user: undefined, permissions: [] } },
    {
      name: 'admin, nothing',
      ctx: {
        ...base,
        user: { sub: '1', name: 'Nobody', roles: [], type: 'admin' },
        permissions: [{ domain: 'dashboard', actions: ['read'] }],
      },
    },
    {
      name: 'agent',
      ctx: {
        ...base,
        user: { sub: '1', agentId: '1', type: 'agent', isReadOnly: false },
        // The permissions a real agent actually carries, not a hand-written
        // guess: an agent's set is derived from its allowed domains at sign-in.
        permissions: deriveAgentPermissions(['sports', 'casino', 'matka'] as never),
      },
    },
  ]

  // Cross-tenant probe: a caller in one tenant naming another in the arguments.
  const crossArgs = { scope: { tenant: 'grandwinn-com', whitelabelId: 'grandwinn-com' }, tenant: 'grandwinn-com' }

  const rows: Array<{ name: string; results: string[]; missing: boolean }> = []
  for (const field of names) {
    const entry = map[field]
    const subscribe = typeof entry === 'function' ? entry : entry?.subscribe
    if (typeof subscribe !== 'function') {
      rows.push({ name: field, results: principals.map(() => 'NO RESOLVER'), missing: true })
      continue
    }
    const results: string[] = []
    for (const p of principals) {
      try {
        const it = await subscribe.call({ pubsub }, undefined, crossArgs, p.ctx, undefined)
        try {
          await (it as any)?.return?.()
        } catch {
          /* the stream may not support early return */
        }
        results.push('reached')
      } catch (e) {
        results.push(classify(e))
      }
    }
    rows.push({ name: field, results, missing: false })
  }

  const w = 26
  console.log(`probed ${names.length} subscription field(s)\n`)
  console.log('field'.padEnd(w) + principals.map((p) => p.name.padEnd(18)).join(''))
  console.log('-'.repeat(w + principals.length * 18))
  for (const r of rows) {
    console.log(r.name.padEnd(w) + r.results.map((x) => x.padEnd(18)).join(''))
  }

  const leaks = rows.filter(
    (r) => !r.missing && !OPEN_BY_DESIGN[r.name] && r.results[0] === 'reached'
  )
  const noPerm = rows.filter(
    (r) => !r.missing && !OPEN_BY_DESIGN[r.name] && r.results[1] === 'reached'
  )
  const missing = rows.filter((r) => r.missing)

  console.log('')
  console.log(`  reached with NO SESSION        : ${leaks.length}`)
  for (const r of leaks) console.log(`      - ${r.name}`)
  console.log(`  reached by an admin holding none: ${noPerm.length}`)
  for (const r of noPerm) console.log(`      - ${r.name}`)
  if (missing.length) {
    console.log(`  declared in schema, no resolver : ${missing.length}`)
    for (const r of missing) console.log(`      - ${r.name}`)
  }
  const bad = leaks.length + noPerm.length + missing.length
  if (bad > 0) {
    console.log('')
    console.log('FAIL: a subscription is reachable by a caller who should not have it, or is')
    console.log('declared in the schema with no resolver. Give it an entry in')
    console.log('SUBSCRIPTION_PERMISSIONS, or in OPEN_SUBSCRIPTIONS with the reason.')
    process.exit(1)
  }
  console.log('')
  console.log('OK every subscription is gated or open by design.')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
