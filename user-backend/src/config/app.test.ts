import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCorsOrigins, parseTrustProxy } from './app.js'

test('production CORS requires at least one explicit origin', () => {
  assert.throws(() => parseCorsOrigins(undefined, 'production'), /CORS_ORIGIN is required/)
  assert.throws(
    () => parseCorsOrigins('*', 'production'),
    /wildcards are not allowed/
  )
  assert.throws(
    () => parseCorsOrigins('https:\/\/*.example.com', 'test'),
    /wildcards are not allowed/
  )
})

test('production CORS accepts and normalises explicit origins', () => {
  assert.deepEqual(
    parseCorsOrigins('https://play.example.com/, https://www.example.com', 'production'),
    ['https://play.example.com', 'https://www.example.com']
  )
})

test('development CORS has localhost defaults when unset', () => {
  const origins = parseCorsOrigins(undefined, 'development')
  assert.ok(origins.includes('http://localhost:5173'))
  assert.ok(origins.includes('http://localhost:5177'))
  assert.equal(origins.some((origin) => origin.includes('*')), false)
})

test('TRUST_PROXY defaults off and parses explicit values', () => {
  assert.equal(parseTrustProxy(undefined), false)
  assert.equal(parseTrustProxy('false'), false)
  assert.equal(parseTrustProxy('true'), true)
  assert.equal(parseTrustProxy('loopback'), 'loopback')
  assert.deepEqual(parseTrustProxy('loopback, 10.0.0.0/8'), ['loopback', '10.0.0.0/8'])
})
