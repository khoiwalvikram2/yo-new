import assert from 'node:assert/strict'
import { test } from 'vitest'
import { agentRestrictionNotice } from './agentProfileModel'

test('an ancestor that blocks the agent is named as its parent or as its upline (AGE-16)', () => {
  // The finding: a child of a suspended agent read ACTIVE on its profile, with no hint, while its sign-in was refused.
  assert.deepEqual(agentRestrictionNotice({ id: 'p1', username: 'vfyageshkhk8uc', status: 'SUSPENDED' }, 'p1'), {
    tone: 'error',
    title: 'Blocked by its parent',
    text: ', its parent, is suspended. Until it is active again this agent cannot sign in and its players cannot place new bets, whatever its own status shows.',
  })
  const higher = agentRestrictionNotice({ id: 'g1', status: 'BLOCKED' }, 'p1')
  assert.equal(higher.title, 'Blocked by its upline')
  assert.ok(higher.text.startsWith(', higher in its upline, is blocked.'))
})

test('an INACTIVE ancestor makes the agent read-only, as a warning', () => {
  const notice = agentRestrictionNotice({ id: 'p1', status: 'inactive' }, 'p1')
  assert.equal(notice.tone, 'warn')
  assert.equal(notice.title, 'Read-only through its parent')
  assert.ok(notice.text.includes('this agent can only view and its players cannot place new bets'))
})
