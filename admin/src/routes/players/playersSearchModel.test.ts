import assert from 'node:assert/strict'
import { test } from 'vitest'
import { playerQueryScope, playerTabOptions, getAllHeaders, shouldShowColumnForParentType, shouldShowColumnForPlayer } from './playersSearchModel'
test('agent/admin query ownership and tabs retain the original scope contract', () => {
  assert.deepEqual(playerQueryScope('ALL', false), { parentType: undefined, onlyDirect: undefined })
  assert.deepEqual(playerQueryScope('CREDIT', false), { parentType: 'CREDIT', onlyDirect: undefined })
  assert.deepEqual(playerQueryScope('DIRECT', true), { parentType: undefined, onlyDirect: true })
  assert.deepEqual(playerQueryScope('SUB_AGENTS', true), { parentType: undefined, onlyDirect: false })
  assert.equal(playerTabOptions('COMMISSION').length, 0); assert.equal(playerTabOptions('SHARING').length, 3); assert.equal(playerTabOptions().length, 5)
})
test('scheme column priority, mixed admin rows and per-player cells preserve every type', () => {
  assert.equal(getAllHeaders().length, 12)
  // Credit players are on chips: Credit Ref and Ref P/L replace the old Credit and Settlement columns.
  assert.equal(getAllHeaders().includes('Credit'), false); assert.equal(getAllHeaders().includes('Settlement'), false)
  assert.equal(shouldShowColumnForParentType('Deposits/Withdrawals', 'ALL', 'CREDIT'), false)
  for (const column of ['Balance', 'Credit Ref', 'Ref P/L', 'Exposure']) assert.equal(shouldShowColumnForParentType(column, 'ALL', 'CREDIT'), true, column)
  assert.equal(shouldShowColumnForParentType('Credit Ref', 'ALL', 'SHARING'), false)
  assert.equal(shouldShowColumnForParentType('Commission', 'DIRECT', 'COMMISSION'), true)
  assert.equal(shouldShowColumnForParentType('Credit Ref', 'DIRECT'), true)
  assert.equal(shouldShowColumnForParentType('Ref P/L', 'CREDIT'), true)
  assert.equal(shouldShowColumnForPlayer('Balance', 'WHITELABEL_CREDIT'), true)
  assert.equal(shouldShowColumnForPlayer('Credit Ref', 'REGULAR'), false)
  assert.equal(shouldShowColumnForPlayer('Ref P/L', 'AGENT_CREDIT'), true)
  assert.equal(shouldShowColumnForPlayer('Performance', 'COMMISSION_AGENT_PLAYER'), true)
  assert.equal(shouldShowColumnForPlayer('Commission', 'SHARING_AGENT_PLAYER'), false)
  assert.equal(shouldShowColumnForPlayer('Turnover', 'COMMISSION_AGENT_PLAYER'), true)
})
