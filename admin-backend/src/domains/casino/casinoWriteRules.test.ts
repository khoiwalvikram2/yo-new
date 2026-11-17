import test from 'node:test'
import assert from 'node:assert/strict'
import { betSettingsProblem, duplicateCategorySlugMessage } from './casinoWriteRules.js'

test('bet settings: a minimum above the maximum is refused with both figures', () => {
  assert.equal(
    betSettingsProblem({ minStake: 100, maxStake: 10, maxWin: 50 }),
    'Minimum stake (100) cannot be above the maximum stake (10)',
  )
})

test('bet settings: negative amounts are refused, field by field', () => {
  assert.equal(betSettingsProblem({ minStake: -5 }), 'Minimum stake cannot be negative')
  assert.equal(betSettingsProblem({ maxStake: -1 }), 'Maximum stake cannot be negative')
  assert.equal(betSettingsProblem({ maxWin: -0.01 }), 'Max win cannot be negative')
})

test('bet settings: valid, partial and empty rows are accepted', () => {
  assert.equal(betSettingsProblem({ minStake: 10, maxStake: 100, maxWin: 5000 }), null)
  assert.equal(betSettingsProblem({ minStake: 10, maxStake: 10 }), null, 'equal min and max is one allowed stake')
  assert.equal(betSettingsProblem({ minStake: 500 }), null, 'only a minimum')
  assert.equal(betSettingsProblem({ maxStake: 0 }), null)
  assert.equal(betSettingsProblem({}), null)
  assert.equal(betSettingsProblem(null), null)
})

test('bet settings: a non-number is refused', () => {
  assert.equal(betSettingsProblem({ maxWin: Number.NaN }), 'Max win must be a number')
})

// The driver error drizzle raises: the failed statement as the message, the pg error as the cause.
const uniqueViolation = (constraint?: string) =>
  Object.assign(new Error('Failed query: insert into "casino_categories" ... params: grandwinn-com,live_casino,...'), {
    cause: { code: '23505', constraint },
  })

test('category slug: a unique violation becomes the reason, never the SQL', () => {
  const message = duplicateCategorySlugMessage(uniqueViolation('casino_categories_tenant_main_slug_unique'), 'vfy-alpha', 'LIVE_CASINO')
  assert.equal(message, 'A category with slug "vfy-alpha" already exists in Live Casino')
  assert.ok(!message?.includes('insert into'))
  assert.equal(duplicateCategorySlugMessage(uniqueViolation(), undefined, undefined), 'A category with this slug already exists')
})

test('category slug: other errors are left alone', () => {
  assert.equal(duplicateCategorySlugMessage(new Error('connection reset'), 'x', 'SLOTS'), null)
  assert.equal(duplicateCategorySlugMessage(uniqueViolation('some_other_index'), 'x', 'SLOTS'), null)
  assert.equal(duplicateCategorySlugMessage(null, 'x', 'SLOTS'), null)
})
