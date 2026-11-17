import assert from 'node:assert/strict'
import test from 'node:test'
import { deductWhitelabelCredit, releaseWhitelabelCredit } from './whitelabelCreditDeduct.js'

test('releaseWhitelabelCredit is a no-op for the default tenant and for non-positive amounts', async () => {
  const mockExecutor = {} as any // never used: any call on it would throw
  await releaseWhitelabelCredit(mockExecutor, 'default', 100, 'INR', 'test')
  await releaseWhitelabelCredit(mockExecutor, '', 100, 'INR', 'test')
  await releaseWhitelabelCredit(mockExecutor, 'whitelabel-1', 0, 'INR', 'test')
  await releaseWhitelabelCredit(mockExecutor, 'whitelabel-1', -50, 'INR', 'test')
})

test('releaseWhitelabelCredit lowers credit_used under the row lock and records a RELEASE', async () => {
  const writes: Array<{ kind: string; values: any }> = []
  const executor = {
    execute: async () => ({ rows: [{ credit_limit: '1000', credit_used: '600', settlement_balance: '50' }] }),
    update: () => ({ set: (values: any) => ({ where: async () => { writes.push({ kind: 'update', values }) } }) }),
    insert: () => ({ values: async (values: any) => { writes.push({ kind: 'insert', values }) } }),
  }
  await releaseWhitelabelCredit(executor, 'whitelabel-1', 200, 'INR', 'Withdrawal completed #7', { userId: 9 })
  assert.equal(writes[0].values.creditUsed, '400')
  assert.equal(writes[0].values.creditAvailable, '650') // 1000 - 400 + 50
  assert.equal(writes[1].values.transactionType, 'RELEASE')
  assert.equal(writes[1].values.amount, '200')
  assert.equal(writes[1].values.balanceBefore, '450') // 1000 - 600 + 50
  assert.equal(writes[1].values.balanceAfter, '650')
  assert.equal(writes[1].values.meta.playerId, 9)
})

test('deductWhitelabelCredit is no-op for default tenant', async () => {
  const mockExecutor = {} as any
  await deductWhitelabelCredit(mockExecutor, 'default', 100, 'INR', 'test')
  // No error, no DB calls (executor is never used)
})

test('deductWhitelabelCredit is no-op for empty tenant', async () => {
  const mockExecutor = {} as any
  await deductWhitelabelCredit(mockExecutor, '', 100, 'INR', 'test')
})

test('deductWhitelabelCredit is no-op for zero amount', async () => {
  const mockExecutor = {} as any
  await deductWhitelabelCredit(mockExecutor, 'whitelabel-1', 0, 'INR', 'test')
})

test('deductWhitelabelCredit is no-op for negative amount', async () => {
  const mockExecutor = {} as any
  await deductWhitelabelCredit(mockExecutor, 'whitelabel-1', -50, 'INR', 'test')
})
