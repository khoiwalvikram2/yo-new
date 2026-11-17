/**
 * SCO-07, API half: an agent reads a domain's report only when that domain is one of its
 * allowed domains (owner rule: an agent sees only its allowed domains).
 *
 * The flat reporting:read grant gives every agent reporting.sports / casino / matka view, so the
 * permission check alone answered a casino-only agent's sports and matka reports. The refusals
 * come before any database read; the one answered case is a read-only query for an agent and a
 * tenant that do not exist, so it finds nothing.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/reportingAgentDomains.test.ts
 */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { reportingQueryResolvers, requireAgentDomain } from '@src/domains/reporting/resolvers/queries.js'

type Domain = 'sports' | 'casino' | 'matka'
const RESOLVERS: Record<Domain, string[]> = {
  sports: ['sportsKPIs', 'sportsTrends', 'sportsBreakdown', 'topSportsEvents', 'sportsLeagueBreakdown', 'sportsEventBreakdown',
    'sportsMarketBreakdown', 'sportsAgentBreakdown', 'sportsPlayerBreakdown'],
  casino: ['casinoKPIs', 'casinoTrends', 'casinoProviderBreakdown', 'casinoVendorBreakdown', 'casinoGameBreakdown', 'casinoAgentBreakdown',
    'casinoPlayerBreakdown'],
  matka: ['matkaKPIs', 'matkaTrends', 'matkaTypeBreakdown', 'matkaMarketBreakdown', 'matkaSessionBreakdown', 'matkaAgentBreakdown',
    'matkaPlayerBreakdown'],
}
const resolvers = reportingQueryResolvers as Record<string, (root: unknown, args: unknown, ctx: unknown) => Promise<unknown>>
// What deriveAgentPermissions gives every agent through the flat reporting:read grant.
const VIEW_ALL = ['reporting.sports', 'reporting.casino', 'reporting.matka'].map((domain) => ({ domain, actions: ['view'] }))
const TENANT = 'vfyho-no-such-tenant'
const agent = (agentAllowedDomains: unknown) => ({
  tenant: TENANT,
  whitelabel: { id: TENANT },
  user: { type: 'agent', agentId: randomUUID(), sub: 'vfyho', roles: [], agentSchemeType: 'COMMISSION', agentAllowedDomains },
  permissions: VIEW_ALL,
})
const ARGS = { filter: { dateFrom: '2026-01-01', dateTo: '2026-01-31' }, dimension: 'sport', limit: 5 }
const REFUSED = /Forbidden: insufficient permissions: the (sports|casino|matka) domain is not enabled for this agent/
// The admin UI's permission-refusal test (shared/core/api.ts isPermissionError, pnlPageModel PERMISSION_REFUSAL).
const UI_PERMISSION_REFUSAL = /insufficient permissions|permission denied|not allowed|forbidden.*permissions/i

after(async () => {
  const { pool } = await import('@src/db/client.js')
  await pool.end().catch(() => {})
})

describe('an agent reads only the reports of its allowed domains', () => {
  it('the resolver map has every domain report this test names', () => {
    for (const name of Object.values(RESOLVERS).flat()) assert.equal(typeof resolvers[name], 'function', name)
  })

  it('a casino-only agent is refused every sports and matka report', async () => {
    for (const name of [...RESOLVERS.sports, ...RESOLVERS.matka]) {
      await assert.rejects(resolvers[name](null, ARGS, agent(['casino'])), REFUSED, name)
    }
  })

  it('names the domain, and reads as a permission refusal to the admin UI (no error toast, a P&L "not included" notice)', async () => {
    const error = await resolvers.matkaKPIs(null, ARGS, agent(['casino', 'sports'])).then(() => null, (failure: Error) => failure)
    assert.ok(error, 'refused')
    assert.match(error.message, /the matka domain/)
    assert.match(error.message, UI_PERMISSION_REFUSAL)
  })

  it('a sports and matka agent is refused every casino report', async () => {
    for (const name of RESOLVERS.casino) {
      await assert.rejects(resolvers[name](null, ARGS, agent(['sports', 'matka'])), REFUSED, name)
    }
  })

  it('an agent with no domains, or no list at all, is refused every domain report', async () => {
    for (const domains of [[], undefined, null, 'casino']) {
      for (const name of Object.values(RESOLVERS).flat()) {
        await assert.rejects(resolvers[name](null, ARGS, agent(domains)), REFUSED, `${name} with ${JSON.stringify(domains)}`)
      }
    }
  })

  it('a casino-only agent is answered by casinoKPIs', async () => {
    const kpis = (await resolvers.casinoKPIs(null, ARGS, agent(['casino']))) as Record<string, number>
    assert.equal(kpis.totalStakes, 0)
    assert.equal(kpis.betCount, 0)
  })
})

describe('requireAgentDomain', () => {
  it('matches the stored domain names whatever their case', () => {
    assert.doesNotThrow(() => requireAgentDomain(agent(['CASINO', 'Sports']), 'casino'))
    assert.doesNotThrow(() => requireAgentDomain(agent(['CASINO', 'Sports']), 'sports'))
    assert.throws(() => requireAgentDomain(agent(['CASINO', 'Sports']), 'matka'), REFUSED)
  })

  it('leaves admins to their permissions', async () => {
    const admin = { user: { sub: '1', type: 'admin', roles: [] }, permissions: VIEW_ALL }
    for (const domain of ['sports', 'casino', 'matka'] as Domain[]) assert.doesNotThrow(() => requireAgentDomain(admin, domain))
    // No whitelabel on the context: the resolver answers zeros without reading anything.
    const kpis = (await resolvers.sportsKPIs(null, { filter: {} }, admin)) as Record<string, number>
    assert.equal(kpis.betCount, 0)
  })
})
