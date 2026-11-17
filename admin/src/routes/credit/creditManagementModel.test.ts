import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import {
  CHIPS_PAGE_TABS,
  isPoolInflow,
  isWhitelabelAdminRole,
  poolMovementLabel,
  poolSignedAmount,
  poolStatementHasNextPage,
  poolStatementPlayerLink,
  poolStatementRange,
  poolStatementSub,
} from './creditManagementModel'

const row = (transactionType: string, balanceBefore = 1000, balanceAfter = 500, amount = 500) => ({ transactionType, amount, balanceBefore, balanceAfter })

describe('the Chips page model', () => {
  test('the root accounts come first, then the pool statement', () => {
    assert.deepEqual(CHIPS_PAGE_TABS.map((tab) => tab.label), ['Root accounts', 'Pool statement'])
  })

  test('a whitelabel admin passes on its role name, in any of its spellings', () => {
    assert.equal(isWhitelabelAdminRole(['Whitelabel Admin']), true)
    assert.equal(isWhitelabelAdminRole(['WHITELABEL_ADMIN']), true)
    assert.equal(isWhitelabelAdminRole(['Senior Whitelabel Manager']), true)
    assert.equal(isWhitelabelAdminRole(['Super Admin', 'Support']), false)
  })

  test('each pool movement is named for the chips it moved', () => {
    assert.equal(poolMovementLabel('USAGE'), 'Chips out')
    assert.equal(poolMovementLabel('DEPOSIT'), 'Chips out')
    assert.equal(poolMovementLabel('RELEASE'), 'Chips in')
    assert.equal(poolMovementLabel('ALLOCATION'), 'Pool top-up')
    assert.equal(poolMovementLabel('ADJUSTMENT'), 'Pool adjustment')
    assert.equal(poolMovementLabel('CREDIT_LIMIT_ADJUSTMENT'), 'Credit limit adjustment')
  })

  test('amounts are signed from the pool side: top-ups and withdrawals in, deposits out, adjustments by the change', () => {
    assert.equal(isPoolInflow(row('ALLOCATION', 0, 1000)), true)
    assert.equal(isPoolInflow(row('RELEASE', 500, 1000)), true)
    assert.equal(isPoolInflow(row('USAGE')), false)
    assert.equal(isPoolInflow(row('DEPOSIT')), false)
    assert.equal(isPoolInflow(row('ADJUSTMENT', 500, 800)), true)
    assert.equal(isPoolInflow(row('ADJUSTMENT', 800, 500)), false)
    assert.equal(poolSignedAmount(row('USAGE', 1000, 500, 500)), -500)
    assert.equal(poolSignedAmount(row('RELEASE', 500, 750, -250)), 250)
  })

  test('a row that names a player links to the profile by username, else phone', () => {
    assert.equal(poolStatementPlayerLink({ playerId: null }), null)
    assert.deepEqual(poolStatementPlayerLink({ playerId: 7, playerUsername: ' ravi ', playerPhone: '9000000001' }), { to: '/players/profile/7', label: 'ravi' })
    assert.deepEqual(poolStatementPlayerLink({ playerId: '8', playerPhone: 9000000002 }), { to: '/players/profile/8', label: '9000000002' })
    assert.deepEqual(poolStatementPlayerLink({ playerId: 9 }), { to: '/players/profile/9', label: 'View player' })
  })

  test('paging reads the lookahead row: a range, "more", and Next only when the extra row came back', () => {
    assert.equal(poolStatementSub(1, 20, 3), '3 movements')
    assert.equal(poolStatementSub(1, 20, 1), '1 movement')
    assert.equal(poolStatementSub(2, 20, 21), 'Page 2 • 20 rows')
    assert.deepEqual(poolStatementRange(2, 20, 21), { range: '21–40', more: true })
    assert.deepEqual(poolStatementRange(1, 20, 5), { range: '1–5', more: false })
    assert.equal(poolStatementHasNextPage(21, 20), true)
    assert.equal(poolStatementHasNextPage(20, 20), false)
  })
})
