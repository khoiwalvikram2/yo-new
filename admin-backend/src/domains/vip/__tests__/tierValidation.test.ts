/**
 * The VIP tier ladder rules (MAR-12), as pure functions over one tenant's tiers.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { vipTierIdentityConflict, vipTierIssues, type ValidatedTier } from '../tierValidation.js'

const tier = (id: string, name: string, level: number, minMonthlyDeposit: number, status = 'active'): ValidatedTier =>
  ({ id, name, level, minMonthlyDeposit, status })

const LADDER = [tier('b', 'Bronze', 1, 0), tier('s', 'Silver', 2, 10_000), tier('g', 'Gold', 3, 50_000), tier('p', 'Platinum', 4, 100_000)]

describe('vipTierIssues', () => {
  it('finds nothing wrong with a sound ladder, in any order', () => {
    assert.deepEqual(vipTierIssues(LADDER), [])
    assert.deepEqual(vipTierIssues([...LADDER].reverse()), [])
    assert.deepEqual(vipTierIssues([]), [])
  })

  it('reports a second tier at a level, naming both', () => {
    assert.deepEqual(vipTierIssues([...LADDER, tier('x', 'vfyfix Tier', 4, 999_999_999)]), [
      { code: 'DUP_LEVEL', message: 'Duplicate level 4: Platinum and vfyfix Tier', tierId: 'x' },
    ])
  })

  it('reports a name used twice, ignoring case and spaces', () => {
    assert.deepEqual(vipTierIssues([...LADDER, tier('x', ' gold ', 5, 200_000)]), [
      { code: 'DUP_NAME', message: 'Duplicate name " gold ": also used by the level 3 tier', tierId: 'x' },
    ])
  })

  it('reports an active tier that asks less than an active tier below it', () => {
    const issues = vipTierIssues([...LADDER.slice(0, 3), tier('p', 'Platinum', 4, 20_000)])
    assert.deepEqual(issues.map(i => [i.code, i.tierId]), [['ASC_DEPOSIT', 'p']])
    assert.match(issues[0].message, /Platinum \(level 4\) asks 20000, less than Gold \(level 3\) at 50000/)
  })

  it('leaves inactive tiers out of the deposit ladder, but not out of the uniqueness rules', () => {
    assert.deepEqual(vipTierIssues([...LADDER, tier('o', 'Old', 5, 1, 'inactive')]), [])
    assert.deepEqual(vipTierIssues([...LADDER, tier('o', 'Old', 4, 1, 'inactive')]).map(i => i.code), ['DUP_LEVEL'])
  })
})

describe('vipTierIdentityConflict', () => {
  it('refuses a level or a name another tier already has', () => {
    assert.equal(
      vipTierIdentityConflict(LADDER, { name: 'Diamond', level: 4 }),
      "Level 4 is already used by the Platinum tier. Choose another level, or change Platinum's level first.",
    )
    assert.equal(vipTierIdentityConflict(LADDER, { name: '  SILVER', level: 5 }), 'A tier named "Silver" already exists. Choose another name.')
  })

  it('lets a tier keep its own level and name when it is left out of the others', () => {
    assert.equal(vipTierIdentityConflict(LADDER.filter(t => t.id !== 'p'), { name: 'Platinum', level: 4 }), null)
    assert.equal(vipTierIdentityConflict(LADDER, { name: 'Diamond', level: 5 }), null)
    assert.equal(vipTierIdentityConflict(LADDER, {}), null)
  })
})
