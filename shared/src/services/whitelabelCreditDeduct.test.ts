import assert from 'node:assert/strict'
import test from 'node:test'
import { deductWhitelabelCredit } from './whitelabelCreditDeduct.js'

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
