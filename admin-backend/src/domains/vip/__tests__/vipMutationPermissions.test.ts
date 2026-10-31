/**
 * VIP mutations are gated per action, and the gate fails closed.
 *
 * Before this, one blanket check opened every VIP mutation to anyone holding any one of
 * four permissions: a role granted "create tiers" could delete them and move members
 * between them. The permissions existed and were seeded; nothing read them apart.
 *
 * The failure mode this file is really guarding is the next one — a mutation added
 * without deciding what it costs. The wrapper refuses an unmapped mutation at runtime,
 * and the first test turns that refusal into a failing build instead.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { VIP_MUTATION_PERMISSIONS, vipResolvers } from '../resolvers/index.js'
import { NESTED_PERMISSIONS } from '@src/config/nestedPermissions.js'
import { hasPermission } from '@src/domains/common/auth.js'

const mutationNames = Object.keys(vipResolvers.Mutation)

describe('VIP mutation permission map', () => {
  it('covers every VIP mutation', () => {
    const unmapped = mutationNames.filter(name => !VIP_MUTATION_PERMISSIONS[name])
    assert.deepEqual(
      unmapped,
      [],
      `these mutations would be refused at runtime because nobody decided what they cost: ${unmapped.join(', ')}`
    )
  })

  it('has no entries for mutations that no longer exist', () => {
    const orphans = Object.keys(VIP_MUTATION_PERMISSIONS).filter(name => !mutationNames.includes(name))
    assert.deepEqual(orphans, [], `stale entries: ${orphans.join(', ')}`)
  })

  it('only names permissions that are actually seeded', () => {
    const seeded = new Set(NESTED_PERMISSIONS.map(p => `${p.domain}:${p.action}`))
    const missing = Object.values(VIP_MUTATION_PERMISSIONS)
      .map(p => `${p.domain}:${p.action}`)
      .filter(k => !seeded.has(k))
    assert.deepEqual(missing, [], `not in NESTED_PERMISSIONS, so no role can ever hold them: ${missing.join(', ')}`)
  })

  it('separates the four tier actions instead of treating them as one', () => {
    assert.equal(VIP_MUTATION_PERMISSIONS.createVIPTier.action, 'create')
    assert.equal(VIP_MUTATION_PERMISSIONS.updateVIPTier.action, 'update')
    assert.equal(VIP_MUTATION_PERMISSIONS.deleteVIPTier.action, 'delete')
    // importVIPTiers clears the tier set before writing, so it costs delete, not create.
    assert.equal(VIP_MUTATION_PERMISSIONS.importVIPTiers.action, 'delete')
  })

  it('keeps member mutations off the tier permissions', () => {
    for (const name of ['createVIPMember', 'updateVIPMember', 'addVIPPoints', 'removeVIPPoints']) {
      assert.equal(VIP_MUTATION_PERMISSIONS[name].domain, 'vip.members', name)
    }
  })
})

describe('VIP permissions still reach the roles that hold them', () => {
  it('lets a whitelabel admin holding flat vip:write do everything it could before', () => {
    // Verified against the live database before the gate was tightened: every role that
    // can mutate VIP holds either flat vip:write or all six nested permissions.
    const whitelabelAdmin = [{ domain: 'vip', actions: ['read', 'write'] }]
    for (const [name, required] of Object.entries(VIP_MUTATION_PERMISSIONS)) {
      assert.equal(
        hasPermission(whitelabelAdmin, required.domain, required.action),
        true,
        `${name} would now be denied to a whitelabel admin`
      )
    }
  })

  it('does not let a view-only role mutate anything', () => {
    const viewer = [{ domain: 'vip.tiers', actions: ['view'] }, { domain: 'vip.members', actions: ['view'] }]
    const writes = Object.entries(VIP_MUTATION_PERMISSIONS).filter(([, r]) => r.action !== 'view')
    for (const [name, required] of writes) {
      assert.equal(hasPermission(viewer, required.domain, required.action), false, `${name} must stay denied`)
    }
  })

  it('no longer lets create-only reach delete', () => {
    // The point of the change: this used to pass.
    const creator = [{ domain: 'vip.tiers', actions: ['create'] }]
    assert.equal(hasPermission(creator, 'vip.tiers', 'create'), true)
    assert.equal(hasPermission(creator, 'vip.tiers', 'delete'), false)
    assert.equal(hasPermission(creator, 'vip.members', 'update'), false)
  })
})
