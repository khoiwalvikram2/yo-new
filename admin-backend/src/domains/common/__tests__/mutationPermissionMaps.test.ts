/**
 * Every wrapped mutation map names a real permission for every field.
 *
 * Six domains gated their mutations with a single `canMutateX(ctx)` that ORed
 * every write permission the domain had. Holding any one opened all of them: a
 * caller entitled only to void a sports bet could declare a result and delete
 * automation rules; `casino.bet-settings:create` reached provider creation and
 * vendor overrides; `reporting.pnl:view` — a *read* — authorised every reporting
 * write, snapshot rebuilds included. Permissions an administrator can grant and
 * withhold separately behaved as one.
 *
 * They are now per-field tables. The failure this file guards is the next one: a
 * mutation added without deciding what it costs. The wrappers refuse an unmapped
 * field at runtime, and these tests turn that into a failing build instead — and
 * catch its mirror image, an entry left behind after a mutation is renamed,
 * which would otherwise sit there looking like protection.
 *
 * `vipMutationPermissions.test.ts` does the same for VIP, which had the shape
 * right before any of this.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NESTED_PERMISSIONS } from '@src/config/nestedPermissions.js'
import {
  SUBSCRIPTION_PERMISSIONS,
  OPEN_SUBSCRIPTIONS,
} from '@src/domains/common/guardSubscriptions.js'

type Pairs = readonly (readonly [string, string])[]

const CATALOGUE = new Set(NESTED_PERMISSIONS.map((p) => `${p.domain}:${p.action}`))

/**
 * Fields that are gated but not by the map: they carry a stricter check of their
 * own, or must stay reachable before a session exists.
 */
const NOT_FROM_THE_MAP: Record<string, string> = {
  agentLogin: 'agent sign-in: there is no session yet, so the map cannot apply',
}

/** Normalises the two shapes in use: a single pair, or a list of alternatives. */
function pairsOf(value: Pairs | readonly [string, string]): Pairs {
  return Array.isArray(value[0]) ? (value as Pairs) : ([value] as unknown as Pairs)
}

async function load(): Promise<
  Array<{ domain: string; map: Record<string, Pairs | readonly [string, string]>; names: string[] }>
> {
  const casino = await import('@src/domains/casino/resolvers/index.js')
  const marketing = await import('@src/domains/marketing/resolvers/index.js')
  const referrals = await import('@src/domains/referrals/resolvers/index.js')
  const reporting = await import('@src/domains/reporting/resolvers/index.js')
  const sports = await import('@src/domains/sports/resolvers/index.js')
  const agents = await import('@src/domains/agents/resolvers/guardAgentMutations.js')

  const keys = (m: Record<string, unknown>) =>
    Object.keys(m).filter((k) => typeof m[k] === 'function')

  return [
    {
      domain: 'casino',
      map: casino.CASINO_MUTATION_PERMISSIONS,
      names: keys(
        (await import('@src/domains/casino/resolvers/mutations.js')).casinoMutationResolvers as never
      ),
    },
    {
      domain: 'marketing',
      map: marketing.MARKETING_MUTATION_PERMISSIONS,
      names: keys(
        (await import('@src/domains/marketing/resolvers/mutations.js'))
          .marketingMutationResolvers as never
      ),
    },
    {
      domain: 'referrals',
      map: referrals.REFERRALS_MUTATION_PERMISSIONS,
      names: keys(
        (await import('@src/domains/referrals/resolvers/mutations.js'))
          .referralsMutationResolvers as never
      ),
    },
    {
      domain: 'reporting',
      map: reporting.REPORTING_MUTATION_PERMISSIONS,
      names: keys(
        (await import('@src/domains/reporting/resolvers/mutations.js'))
          .reportingMutationResolvers as never
      ),
    },
    {
      domain: 'reporting snapshot health',
      map: reporting.SNAPSHOT_HEALTH_PERMISSIONS,
      names: keys(
        (await import('@src/domains/reporting/resolvers/snapshotHealthMutations.js'))
          .snapshotHealthMutationResolvers as never
      ),
    },
    {
      domain: 'sports',
      map: sports.SPORTS_MUTATION_PERMISSIONS,
      names: keys(
        (await import('@src/domains/sports/resolvers/mutations.js'))
          .sportsMutationResolvers as never
      ),
    },
    {
      domain: 'agents',
      map: agents.AGENT_MUTATION_PERMISSIONS,
      names: keys(
        (await import('@src/domains/agents/resolvers/mutations.js')).buildAgentsMutationResolvers() as never
      ),
    },
  ]
}

describe('wrapped mutation permission maps', async () => {
  const suites = await load()

  for (const { domain, map, names } of suites) {
    it(`${domain}: every mutation names a permission`, () => {
      const unmapped = names.filter((n) => !map[n] && !NOT_FROM_THE_MAP[n])
      assert.deepEqual(
        unmapped,
        [],
        `these would be refused at runtime because nobody decided what they cost: ${unmapped.join(', ')}`
      )
    })

    it(`${domain}: has no entry for a mutation that no longer exists`, () => {
      const stale = Object.keys(map).filter((n) => !names.includes(n))
      assert.deepEqual(
        stale,
        [],
        `these entries protect nothing and hide a rename: ${stale.join(', ')}`
      )
    })

    it(`${domain}: every permission it names is in the catalogue`, () => {
      const unknown = [
        ...new Set(
          Object.values(map)
            .flatMap((v) => pairsOf(v as Pairs))
            .map(([d, a]) => `${d}:${a}`)
        ),
      ].filter((p) => !CATALOGUE.has(p))
      assert.deepEqual(
        unknown,
        [],
        `an administrator cannot grant these, so the mutation is unreachable: ${unknown.join(', ')}`
      )
    })
  }
})

/**
 * The Subscription map is the one surface `guardAdminSurface` structurally
 * cannot reach — subscriptions are `{subscribe, resolve}` objects, not
 * functions — and no audit script walked it. Measured before it was gated: a
 * signed-in admin holding one unrelated permission reached 30 of the 32,
 * `walletUpdated`, `whitelabelCreditUpdated`, `depositRequestUpdated` and every
 * live dashboard among them, and a subscription streams for the life of the
 * socket rather than answering once.
 *
 * `npm run probe:subscriptions` executes them. This asserts the table stays
 * complete, which is what the probe relies on.
 */
function schemaSubscriptionFields(): string[] {
  const out = new Set<string>()
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.graphql')) files.push(p)
    }
  }
  walk(join('src', 'types'))
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

describe('subscription permission map', () => {
  const fields = schemaSubscriptionFields()

  it('found the subscription fields at all', () => {
    assert.ok(fields.length >= 30, `only found ${fields.length} — has the schema layout moved?`)
  })

  it('every subscription in the schema names a permission or is open by design', () => {
    const undeclared = fields.filter((f) => !SUBSCRIPTION_PERMISSIONS[f] && !OPEN_SUBSCRIPTIONS[f])
    assert.deepEqual(
      undeclared,
      [],
      `these would be refused at runtime because nobody decided who may watch them: ${undeclared.join(', ')}`
    )
  })

  it('has no entry for a subscription that no longer exists', () => {
    const stale = [...Object.keys(SUBSCRIPTION_PERMISSIONS), ...Object.keys(OPEN_SUBSCRIPTIONS)].filter(
      (f) => !fields.includes(f)
    )
    assert.deepEqual(stale, [], `these entries protect nothing and hide a rename: ${stale.join(', ')}`)
  })

  it('names no permission an administrator cannot grant', () => {
    const unknown = [
      ...new Set(
        Object.values(SUBSCRIPTION_PERMISSIONS)
          .flat()
          .map(([d, a]) => `${d}:${a}`)
      ),
    ].filter((p) => !CATALOGUE.has(p))
    assert.deepEqual(unknown, [], `not in the catalogue, so unreachable: ${unknown.join(', ')}`)
  })

  it('leaves open only what is genuinely self-scoped', () => {
    // Both carry nothing a permission could sensibly govern, and both still
    // require a session. Anything added here needs the same justification.
    assert.deepEqual(Object.keys(OPEN_SUBSCRIPTIONS).sort(), ['heartbeat', 'notificationReceived'])
  })
})
