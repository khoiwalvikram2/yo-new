/**
 * Orphaned-QR cleanup logic for UPI payment methods.
 * Run with: node --import tsx --test src/repos/payments/qrKeyCleanup.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { computeOrphanedQrKeys } from './qrKeyCleanup.js'

const B64 = 'data:image/png;base64,iVBORw0KGgo='
const KEY_A = 'deposits/1774793306939-aaaa.png'
const KEY_B = 'deposits/1780750875563-bbbb.jpg'

test('QR replaced (old S3 key -> new base64): old key is orphaned', () => {
  const oldUpis = [{ id: 'u1', qrKey: KEY_A }]
  const newUpis = [{ id: 'u1', qrKey: B64 }]
  assert.deepEqual(computeOrphanedQrKeys(oldUpis, newUpis), [KEY_A])
})

test('QR replaced (old S3 key -> new S3 key): old key is orphaned', () => {
  const oldUpis = [{ id: 'u1', qrKey: KEY_A }]
  const newUpis = [{ id: 'u1', qrKey: KEY_B }]
  assert.deepEqual(computeOrphanedQrKeys(oldUpis, newUpis), [KEY_A])
})

test('QR unchanged (same S3 key): nothing orphaned', () => {
  const oldUpis = [{ id: 'u1', qrKey: KEY_A }]
  const newUpis = [{ id: 'u1', qrKey: KEY_A }]
  assert.deepEqual(computeOrphanedQrKeys(oldUpis, newUpis), [])
})

test('QR removed (old S3 key -> null): old key is orphaned', () => {
  const oldUpis = [{ id: 'u1', qrKey: KEY_A }]
  const newUpis = [{ id: 'u1', qrKey: null }]
  assert.deepEqual(computeOrphanedQrKeys(oldUpis, newUpis), [KEY_A])
})

test('whole UPI deleted (dropped from new list): its S3 key is orphaned', () => {
  const oldUpis = [{ id: 'u1', qrKey: KEY_A }, { id: 'u2', qrKey: KEY_B }]
  const newUpis = [{ id: 'u2', qrKey: KEY_B }]
  assert.deepEqual(computeOrphanedQrKeys(oldUpis, newUpis), [KEY_A])
})

test('old QR was inline base64: no file to delete', () => {
  const oldUpis = [{ id: 'u1', qrKey: B64 }]
  const newUpis = [{ id: 'u1', qrKey: KEY_A }]
  assert.deepEqual(computeOrphanedQrKeys(oldUpis, newUpis), [])
})

test('key still referenced by another UPI: not orphaned', () => {
  const oldUpis = [{ id: 'u1', qrKey: KEY_A }]
  // KEY_A moved/reused by u2 in the new state
  const newUpis = [{ id: 'u1', qrKey: B64 }, { id: 'u2', qrKey: KEY_A }]
  assert.deepEqual(computeOrphanedQrKeys(oldUpis, newUpis), [])
})

test('sentinels and external URLs are never deleted', () => {
  const oldUpis = [
    { id: 'u1', qrKey: 'welivepay' },
    { id: 'u2', qrKey: 'manual' },
    { id: 'u3', qrKey: 'https://cdn.example.com/x.png' },
  ]
  const newUpis: { id: string; qrKey: string | null }[] = []
  assert.deepEqual(computeOrphanedQrKeys(oldUpis, newUpis), [])
})

test('duplicate old keys are collapsed', () => {
  const oldUpis = [{ id: 'u1', qrKey: KEY_A }, { id: 'u2', qrKey: KEY_A }]
  const newUpis: { id: string; qrKey: string | null }[] = []
  assert.deepEqual(computeOrphanedQrKeys(oldUpis, newUpis), [KEY_A])
})

test('empty / no-qr UPIs are ignored', () => {
  const oldUpis = [{ id: 'u1' }, { id: 'u2', qrKey: '' }, { id: 'u3', qrKey: null }]
  const newUpis: { id: string }[] = []
  assert.deepEqual(computeOrphanedQrKeys(oldUpis, newUpis), [])
})
