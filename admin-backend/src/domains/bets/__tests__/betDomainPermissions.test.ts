/**
 * The bets list reads each bet table only with that table's own permission (W4).
 *
 * The gate was `sports.bets OR casino.bets OR matka.bets`, after which all
 * three tables were read — one bet permission opened all three. An agent is
 * additionally limited to its allowedDomains.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/bets/__tests__/betDomainPermissions.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { allowedBetDomains } from '@src/domains/bets/resolvers/queries.js'
import { deriveAgentPermissions } from '@src/domains/agents/services/AgentPermissionsService.js'

const p = (...pairs: Array<[string, string[]]>) => pairs.map(([domain, actions]) => ({ domain, actions }))

describe('allowedBetDomains', () => {
  it('one bet permission opens one table, not three', () => {
    assert.deepEqual(allowedBetDomains({ user: { sub: '1' }, permissions: p(['sports.bets', ['view']]) }), {
      sports: true,
      casino: false,
      matka: false,
    })
    assert.deepEqual(allowedBetDomains({ user: { sub: '1' }, permissions: p(['casino.bets', ['view']]) }), {
      sports: false,
      casino: true,
      matka: false,
    })
  })

  it('honours the flat permission that grants a nested one (casino:read → casino.bets:view)', () => {
    assert.deepEqual(allowedBetDomains({ user: { sub: '1' }, permissions: p(['casino', ['read']]) }), {
      sports: false,
      casino: true,
      matka: false,
    })
  })

  it('a platform admin reads all three', () => {
    assert.deepEqual(allowedBetDomains({ user: { sub: '1' }, permissions: p(['all', ['*']]) }), {
      sports: true,
      casino: true,
      matka: true,
    })
  })

  it('an agent reads the tables of its allowed domains only', () => {
    const permissions = deriveAgentPermissions(['sports', 'matka'] as any)
    assert.deepEqual(
      allowedBetDomains({ user: { type: 'agent', agentId: 'a1', agentAllowedDomains: ['sports', 'matka'] }, permissions }),
      { sports: true, casino: false, matka: true },
    )
  })

  it('an agent whose permissions drifted from its domains is held to its domains', () => {
    const permissions = deriveAgentPermissions(['sports', 'casino', 'matka'] as any)
    assert.deepEqual(
      allowedBetDomains({ user: { type: 'agent', agentId: 'a1', agentAllowedDomains: ['casino'] }, permissions }),
      { sports: false, casino: true, matka: false },
    )
  })

  it('nothing at all without a bet permission', () => {
    assert.deepEqual(allowedBetDomains({ user: { sub: '1' }, permissions: p(['players.bets', ['view']]) }), {
      sports: false,
      casino: false,
      matka: false,
    })
  })
})

describe('betsPage', () => {
  it('a caller with casino bets only gets nothing from the sports table', async () => {
    const { betsQueryResolvers } = await import('@src/domains/bets/resolvers/queries.js')
    const ctx = {
      tenant: 'w4-test-no-such-tenant',
      whitelabel: { id: 'w4-test-no-such-tenant' },
      user: { sub: '1', roles: [] },
      permissions: p(['players.bets', ['view']], ['casino.bets', ['view']]),
    }
    const res = await betsQueryResolvers.betsPage(undefined, { domain: 'SPORTS' }, ctx)
    assert.deepEqual(res, { items: [], total: 0 })
  })
})

describe('the bet reads need a whitelabel (SPO-BETS-CORE-EMPTY)', () => {
  // A tenant with no rows: the reads that are allowed still run, and find nothing.
  const NO_SUCH = 'w4-test-no-such-tenant'
  const superAdmin = (directorMode: 'core' | 'whitelabel', directorWhitelabelId: string | null) => ({
    tenant: 'default',
    whitelabel: { id: 'default' },
    user: { sub: '1', roles: ['Super Admin'] },
    permissions: p(['all', ['*']]),
    directorMode,
    directorWhitelabelId,
  })
  const reads = async () => {
    const { betsQueryResolvers } = await import('@src/domains/bets/resolvers/queries.js')
    return {
      betsPage: (ctx: any) => betsQueryResolvers.betsPage(undefined, { domain: 'ALL' }, ctx),
      betsPageTotals: (ctx: any) => betsQueryResolvers.betsPageTotals(undefined, {}, ctx),
      betsFilterOptions: (ctx: any) => betsQueryResolvers.betsFilterOptions(undefined, { domain: 'ALL' }, ctx),
    }
  }
  const nothing = {
    betsPage: { items: [], total: 0 },
    betsPageTotals: { totalAll: 0, totalSports: 0, totalCasino: 0, totalMatka: 0, totalStake: 0, totalStakeSports: 0, totalStakeCasino: 0, totalStakeMatka: 0 },
    betsFilterOptions: { vendorNames: [], gameNames: [], matkaNames: [], marketNames: [], bidTypes: [] },
  }

  it('refuse a Super Admin in core mode, or in whitelabel mode with no site, instead of reading the platform tenant', async () => {
    for (const [name, read] of Object.entries(await reads())) {
      await assert.rejects(read(superAdmin('core', null)), { message: 'Select a whitelabel to view bets' }, name)
      await assert.rejects(read(superAdmin('whitelabel', null)), { message: 'Select a whitelabel to view bets' }, name)
    }
  })

  it('still answer a Super Admin with a site selected, a whitelabel admin and an agent as before', async () => {
    const wlAdmin = {
      tenant: NO_SUCH,
      whitelabel: { id: NO_SUCH },
      user: { sub: '2', roles: ['Whitelabel Admin'] },
      permissions: p(['players.bets', ['view']], ['sports.bets', ['view']], ['casino.bets', ['view']], ['matka.bets', ['view']]),
    }
    const agent = {
      tenant: NO_SUCH,
      whitelabel: { id: NO_SUCH },
      user: { type: 'agent', agentId: randomUUID(), agentAllowedDomains: ['casino'], roles: [] },
      permissions: deriveAgentPermissions(['casino'] as any),
    }
    for (const [name, read] of Object.entries(await reads())) {
      for (const [who, ctx] of [['super admin with a site', superAdmin('whitelabel', NO_SUCH)], ['whitelabel admin', wlAdmin], ['agent', agent]] as const) {
        assert.deepEqual(await read(ctx), nothing[name as keyof typeof nothing], `${name} for the ${who}`)
      }
    }
  })
})
