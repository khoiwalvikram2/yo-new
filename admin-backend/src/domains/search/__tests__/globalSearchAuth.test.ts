/**
 * Global search reached seven categories — players, agents, whitelabels, casino games,
 * sports, VIP members, matkas — with no authentication check at all. It touched ctx.user
 * only to build a rate-limit key, so an unauthenticated caller fell through to
 * 'anonymous' and searched whichever whitelabel they named in a header.
 *
 * It stayed largely inert because VIP search was separately broken: listVipMembersDb was
 * called without a tenant, defaulted to the 'default' whitelabel and then had its results
 * filtered against the requested one, so it returned nothing for every real brand.
 * Repairing that bug turned a dormant hole into a live route to member names, emails and
 * tiers — which is why the fix belongs here and not only in the VIP repo.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { searchQueryResolvers } from '../resolvers/queries.js'
import { chainVisibleTo } from '@src/repos/search/globalSearchRepo.js'

const call = (ctx: any, args: any = { query: 'test' }) =>
  (searchQueryResolvers.globalSearch as any)(null, args, ctx)

describe('globalSearch authentication', () => {
  it('refuses an unauthenticated caller', async () => {
    await assert.rejects(() => call({ tenant: 'grandwinn-com' }), /Unauthorized/)
  })

  it('refuses one that only names a whitelabel in a header', async () => {
    await assert.rejects(() => call({ tenant: 'grandwinn-com', whitelabel: { id: 'grandwinn-com' } }), /Unauthorized/)
  })

  it('does not phrase the refusal in a way the admin client force-logs-out on', async () => {
    // admin/src/shared/core/api.ts ends the session on /unauthenticated|token invalid|
    // session invalid|user not authenticated/. "Unauthorized" is deliberately not that.
    await assert.rejects(
      () => call({}),
      (err: Error) => !/unauthenticated|token invalid|session invalid|user not authenticated/i.test(err.message)
    )
  })
})

describe('globalSearch category permissions', () => {
  const ctxWith = (permissions: any[]) => ({
    user: { id: '1' },
    tenant: 'grandwinn-com',
    permissions,
  })

  it('returns nothing at all for an authenticated caller with no permissions', async () => {
    const res = await call(ctxWith([]))
    for (const [key, value] of Object.entries(res)) {
      assert.deepEqual(value, [], `${key} should be empty`)
    }
  })

  it('does not search VIP members for someone who may not view them', async () => {
    // players.list:view maps from users:read, which nearly every role holds. Before this,
    // holding it was enough to search VIP members too.
    const res = await call(ctxWith([{ domain: 'users', actions: ['read'] }]))
    assert.deepEqual(res.vipMembers, [], 'VIP members need vip.members:view')
  })

  it('drops a category the caller cannot see rather than failing the whole search', async () => {
    const res = await call(
      ctxWith([{ domain: 'users', actions: ['read'] }]),
      { query: 'test', categories: ['players', 'vipMembers'] }
    )
    assert.ok(Array.isArray(res.players), 'the permitted category still ran')
    assert.deepEqual(res.vipMembers, [], 'the unpermitted one came back empty')
  })

  it('lets a super admin through every category', async () => {
    const res = await call(ctxWith([{ domain: 'all', actions: ['*'] }]))
    // Nothing matches the nonsense query; what matters is that no category was refused
    // and the shape came back whole.
    for (const key of ALL_CATEGORIES) {
      assert.ok(key in res, `${key} is present in the result`)
    }
  })
})

const ALL_CATEGORIES = ['players', 'agents', 'whitelabels', 'casinoGames', 'sports', 'vipMembers', 'matkas', 'referralCodes', 'bets', 'bonuses']

describe('globalSearch referral codes, bets and bonuses', () => {
  // The search panel offered these three, but the resolver had no permission entry for them, so every request
  // dropped them, and a request for one alone came back without the lists the schema requires (a GraphQL error).
  const ctxAs = (id: string, permissions: any[], user: Record<string, unknown> = {}) => ({
    user: { id, ...user },
    tenant: 'grandwinn-com',
    permissions,
  })

  it('answers a request for one of them alone with every result list', async () => {
    for (const category of ['referralCodes', 'bets', 'bonuses']) {
      const res = await call(ctxAs('search-none', []), { query: 'WEDNESDAY 10%', categories: [category] })
      assert.deepEqual(Object.keys(res).sort(), [...ALL_CATEGORIES].sort())
      for (const key of ALL_CATEGORIES) assert.deepEqual(res[key], [], `${key} is an empty list`)
    }
  })

  it('searches them for a caller who may open their pages', async () => {
    // bets needs no database: it is the shortcut into the Bet List with the search applied.
    const res = await call(ctxAs('search-bets', [{ domain: 'sports', actions: ['read'] }]), { query: 'BET-77', categories: ['bets'] })
    assert.deepEqual(res.bets.map((b: any) => [b.type, b.route]), [['bet', '/bets?search=BET-77']])
  })

  it('keeps an agent to the two categories narrowed to its own tree', async () => {
    // Agents hold bonuses:read as a base grant and sports.bets:view with the sports domain, and still search
    // nothing but their own players and agents.
    const agent = ctxAs('search-agent', [{ domain: 'bonuses', actions: ['read', 'view'] }, { domain: 'sports.bets', actions: ['view'] }],
      { type: 'agent', agentId: '33333333-3333-4333-8333-333333333333' })
    const res = await call(agent, { query: 'WEDNESDAY', categories: ['bonuses', 'bets', 'referralCodes'] })
    for (const key of ALL_CATEGORIES) assert.deepEqual(res[key], [], `${key} is empty for an agent`)
  })
})

describe('globalSearch parent chains', () => {
  // root -> parent -> self -> child: the chain of an entity under `child`, as getParentChainsBatch builds it.
  const item = (id: string) => ({ id, username: id, levelIndex: null, route: `/agents/${id}` })
  const chain = [item('root'), item('parent'), item('self'), item('child')]

  it('shows an admin the whole chain', () => {
    assert.deepEqual(chainVisibleTo(chain, undefined), chain)
    assert.equal(chainVisibleTo(undefined, undefined), null)
  })

  it("shows an agent itself and what sits below it, never its ancestors", () => {
    assert.deepEqual(chainVisibleTo(chain, 'self')?.map((c) => c.id), ['self', 'child'])
    // Its own row, and its own players, carry only its ancestors: nothing of the chain is its to open.
    assert.deepEqual(chainVisibleTo([item('root'), item('parent')], 'self'), [])
  })
})
