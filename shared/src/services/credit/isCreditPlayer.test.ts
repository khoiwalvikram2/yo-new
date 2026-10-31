import test from 'node:test'
import assert from 'node:assert/strict'
import { isCreditPlayer } from './isCreditPlayer.js'

test('only AGENT_CREDIT and WHITELABEL_CREDIT are credit players', () => {
  assert.equal(isCreditPlayer('AGENT_CREDIT'), true)
  assert.equal(isCreditPlayer('WHITELABEL_CREDIT'), true)
  assert.equal(isCreditPlayer('REGULAR'), false)
  assert.equal(isCreditPlayer('SHARING_AGENT_PLAYER'), false)
  assert.equal(isCreditPlayer('COMMISSION_AGENT_PLAYER'), false)
  assert.equal(isCreditPlayer(null), false)
  assert.equal(isCreditPlayer(undefined), false)
})
