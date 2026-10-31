import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { vipTierInput, vipTierSchema, vipTierValues } from './vipTierEditorModel'
import type { VIPTier } from '@/modules/vip/types'
const DEPOSIT_POLICY = { enabled: true, methods: ['BANK_TRANSFER', 'UPI', 'GATEWAY'], min: null, max: null, daily: null, monthly: null }

describe('VIP tier form contracts', () => {
  test('create defaults keep unset required numbers and the supplied persisted swatch', () => {
    assert.deepEqual(vipTierValues(undefined, '#6B7280'), { depositPolicy: DEPOSIT_POLICY, name: '', level: null, minMonthlyDeposit: null, color: '#6B7280', benefits: [], perks: [] })
  })
  test('payload rounds/clamps numeric requirements and trims/filters benefits and perks', () => {
    assert.deepEqual(vipTierInput({ name: 'Gold', level: 1.6, minMonthlyDeposit: 2.4, color: '#ffffff',
      benefits: [' VIP support ', ' '], perks: [{ name: ' Bonus ', description: ' Weekly ', icon: 'gift' }, { name: '', description: 'Ignore' }] }), {
      depositPolicy: DEPOSIT_POLICY, name: 'Gold', level: 2, minMonthlyDeposit: 2, color: '#ffffff', benefits: ['VIP support'],
      perks: [{ name: 'Bonus', description: 'Weekly', icon: 'gift' }],
    })
  })
  test('basic details, populated benefit and perk fields validate with legacy messages', () => {
    assert.equal(vipTierSchema.safeParse(vipTierValues(undefined, '#6B7280')).success, false)
    assert.ok(vipTierSchema.safeParse({ name: 'Gold', level: 2, minMonthlyDeposit: 0, color: '#6B7280', benefits: [], perks: [] }).success)
  })
  test('edit hydration clones benefits/perks without modifying the source tier', () => {
    const tier = { name: 'Gold', level: 2, minMonthlyDeposit: 100, color: '#ffffff', benefits: ['Support'], perks: [{ name: 'Bonus', description: 'Weekly' }] } as VIPTier
    const values = vipTierValues(tier, '#6B7280'); values.benefits[0] = 'Changed'; values.perks[0].name = 'Changed'
    assert.equal(tier.benefits[0], 'Support'); assert.equal(tier.perks[0].name, 'Bonus')
  })
})
