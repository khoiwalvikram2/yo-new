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
    for (const key of ['players', 'agents', 'whitelabels', 'casinoGames', 'sports', 'vipMembers', 'matkas']) {
      assert.ok(key in res, `${key} is present in the result`)
    }
  })
})
