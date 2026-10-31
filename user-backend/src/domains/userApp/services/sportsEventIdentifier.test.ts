import test from 'node:test'
import assert from 'node:assert/strict'
import { sportsEventIdentifier } from './sportsEventIdentifier.js'
test('event route identifiers distinguish UUID, provider code and slug', () => {
  assert.equal(sportsEventIdentifier('00000000-0000-4000-8000-000000000001')?.kind, 'uuid')
  assert.deepEqual(sportsEventIdentifier(' 36187761 '), { kind: 'code', value: '36187761' })
  assert.deepEqual(sportsEventIdentifier('india-v-australia'), { kind: 'slug', value: 'india-v-australia' })
})
test('malformed or unbounded identifiers are rejected before a UUID database comparison', () => {
  for (const input of ['', '../event', '<script>', 'a'.repeat(201), 'event%20name']) assert.equal(sportsEventIdentifier(input), null)
})
