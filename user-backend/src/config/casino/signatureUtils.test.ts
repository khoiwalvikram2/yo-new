import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync } from 'crypto'
import {
  deepSortObject,
  stringifyCanonical,
  createCasinoSignature,
  checkCasinoSignature,
} from './signatureUtils.js'

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const TEST_PRIVATE_PEM = keyPair.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
const TEST_PUBLIC_PEM = keyPair.publicKey.export({ type: 'spki', format: 'pem' }) as string

function setTestPrivateKey() {
  process.env.CASINO_PRIVATE_KEY = TEST_PRIVATE_PEM
}

test('deepSortObject sorts object keys recursively', () => {
  const input = { z: 1, a: 2, m: { y: 1, b: 2 } }
  const out = deepSortObject(input) as Record<string, unknown>
  assert.deepEqual(Object.keys(out), ['a', 'm', 'z'])
  assert.deepEqual(Object.keys((out.m as Record<string, unknown>)), ['b', 'y'])
})

test('deepSortObject leaves arrays in order', () => {
  const input = { keys: ['z', 'a'], nested: [{ c: 1, a: 2 }] }
  const out = deepSortObject(input) as Record<string, unknown>
  assert.deepEqual(out.keys, ['z', 'a'])
  const inner = (out.nested as unknown[])[0] as Record<string, unknown>
  assert.deepEqual(Object.keys(inner), ['a', 'c'])
})

test('stringifyCanonical produces deterministic JSON', () => {
  const obj1 = { b: 2, a: 1 }
  const obj2 = { a: 1, b: 2 }
  assert.equal(stringifyCanonical(obj1), stringifyCanonical(obj2))
  assert.equal(stringifyCanonical(obj1), '{"a":1,"b":2}')
})

test('createCasinoSignature returns base64 string', () => {
  setTestPrivateKey()
  const sig = createCasinoSignature('{"userId":1}')
  assert.equal(typeof sig, 'string')
  assert.match(sig, /^[A-Za-z0-9+/]+=*$/)
  assert.ok(sig.length > 0)
})

test('createCasinoSignature is deterministic', () => {
  setTestPrivateKey()
  const payload = '{"a":1,"b":2}'
  assert.equal(createCasinoSignature(payload), createCasinoSignature(payload))
})

test('checkCasinoSignature returns true for valid signature', () => {
  setTestPrivateKey()
  const data = '{"userId":1,"token":"abc"}'
  const sig = createCasinoSignature(data)
  assert.equal(checkCasinoSignature(data, sig, TEST_PUBLIC_PEM), true)
})

test('checkCasinoSignature returns false for wrong signature', () => {
  setTestPrivateKey()
  const data = '{"userId":1}'
  const wrongSig = createCasinoSignature('{"userId":2}')
  assert.equal(checkCasinoSignature(data, wrongSig, TEST_PUBLIC_PEM), false)
})

test('checkCasinoSignature returns false for tampered data', () => {
  setTestPrivateKey()
  const data = '{"userId":1}'
  const sig = createCasinoSignature(data)
  assert.equal(checkCasinoSignature('{"userId":2}', sig, TEST_PUBLIC_PEM), false)
})

test('checkCasinoSignature returns false for empty signature', () => {
  assert.equal(checkCasinoSignature('{}', '', TEST_PUBLIC_PEM), false)
})

test('checkCasinoSignature returns false for invalid base64 signature', () => {
  setTestPrivateKey()
  const data = '{}'
  const sig = createCasinoSignature(data)
  assert.equal(checkCasinoSignature(data, 'not-valid-base64!!!', TEST_PUBLIC_PEM), false)
})

test('round-trip: stringifyCanonical then createCasinoSignature then checkCasinoSignature', () => {
  setTestPrivateKey()
  const body = { userId: 42, token: 'sess-xyz', request_uuid: 'req-1' }
  const canonical = stringifyCanonical(body)
  const sig = createCasinoSignature(canonical)
  assert.equal(checkCasinoSignature(canonical, sig, TEST_PUBLIC_PEM), true)
})

test('createCasinoSignature throws when no private key configured', () => {
  const prev = process.env.CASINO_PRIVATE_KEY
  const prevPath = process.env.CASINO_PRIVATE_KEY_PATH
  delete process.env.CASINO_PRIVATE_KEY
  delete process.env.CASINO_PRIVATE_KEY_PATH
  try {
    assert.throws(
      () => createCasinoSignature('{}'),
      /Casino private key not configured/
    )
  } finally {
    if (prev !== undefined) process.env.CASINO_PRIVATE_KEY = prev
    if (prevPath !== undefined) process.env.CASINO_PRIVATE_KEY_PATH = prevPath
  }
})
