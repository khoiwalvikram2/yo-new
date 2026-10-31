import test from 'node:test'
import assert from 'node:assert/strict'
import { selectWhitelabelAdminTarget } from '../whitelabelAdminTarget.js'

test('picks the single whitelabel admin when no email is passed', () => {
  const admins = [{ id: 7, email: 'admin@wl.com' }]
  const target = selectWhitelabelAdminTarget(admins, undefined, 'wl1')
  assert.deepEqual(target, { id: 7, email: 'admin@wl.com' })
})

test('matches by email case-insensitively when multiple admins exist', () => {
  const admins = [
    { id: 7, email: 'First@wl.com' },
    { id: 8, email: 'second@wl.com' },
  ]
  const target = selectWhitelabelAdminTarget(admins, ' FIRST@WL.COM ', 'wl1')
  assert.equal(target.id, 7)
})

test('throws when no admin exists for the whitelabel', () => {
  assert.throws(
    () => selectWhitelabelAdminTarget([], undefined, 'wl1'),
    /No whitelabel admin found for wl1/
  )
})

test('throws listing emails when multiple admins and no email passed', () => {
  const admins = [
    { id: 7, email: 'a@wl.com' },
    { id: 8, email: 'b@wl.com' },
  ]
  assert.throws(
    () => selectWhitelabelAdminTarget(admins, undefined, 'wl1'),
    /Multiple whitelabel admins exist \(a@wl.com, b@wl.com\)\. Pass adminEmail to choose\./
  )
})

test('throws when the requested email is not a whitelabel admin', () => {
  const admins = [{ id: 7, email: 'a@wl.com' }]
  assert.throws(
    () => selectWhitelabelAdminTarget(admins, 'ghost@wl.com', 'wl1'),
    /No whitelabel admin found with email ghost@wl.com for wl1/
  )
})
