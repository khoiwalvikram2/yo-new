/**
 * An agent may restrict agents below it, but may not lift a restriction that an admin or a
 * higher-level agent set — not directly, and not by first making it stricter (which would record
 * the agent as the setter) and then lifting it.
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { agentMayChangeStatus } from '../agentStatusGuard.js'

const CALLER = 'agent-parent'
const subtree = [CALLER, 'agent-child', 'agent-grandchild']

describe('agentMayChangeStatus', () => {
  test('an active agent below the caller may be restricted', () => {
    assert.deepEqual(agentMayChangeStatus({ currentStatus: 'ACTIVE', nextStatus: 'SUSPENDED', lastSetter: null, callerSubtreeIds: subtree }), { ok: true })
    assert.deepEqual(agentMayChangeStatus({ currentStatus: 'ACTIVE', nextStatus: 'BLOCKED', lastSetter: null, callerSubtreeIds: subtree }), { ok: true })
  })

  test('the caller may lift a restriction it set itself', () => {
    const verdict = agentMayChangeStatus({ currentStatus: 'SUSPENDED', nextStatus: 'ACTIVE', lastSetter: { actorId: CALLER, status: 'SUSPENDED' }, callerSubtreeIds: subtree })
    assert.deepEqual(verdict, { ok: true })
  })

  test('the caller may lift a restriction an agent below it set', () => {
    const verdict = agentMayChangeStatus({ currentStatus: 'INACTIVE', nextStatus: 'ACTIVE', lastSetter: { actorId: 'agent-child', status: 'INACTIVE' }, callerSubtreeIds: subtree })
    assert.deepEqual(verdict, { ok: true })
  })

  test('a restriction an admin set cannot be lifted by the agent', () => {
    const verdict = agentMayChangeStatus({ currentStatus: 'SUSPENDED', nextStatus: 'ACTIVE', lastSetter: { actorId: 'admin-user-1', status: 'SUSPENDED' }, callerSubtreeIds: subtree })
    assert.equal(verdict.ok, false)
  })

  test('nor made stricter first (that would make the agent its setter)', () => {
    const verdict = agentMayChangeStatus({ currentStatus: 'SUSPENDED', nextStatus: 'BLOCKED', lastSetter: { actorId: 'admin-user-1', status: 'SUSPENDED' }, callerSubtreeIds: subtree })
    assert.equal(verdict.ok, false)
  })

  test('a restriction set by an agent above the caller cannot be lifted', () => {
    const verdict = agentMayChangeStatus({ currentStatus: 'BLOCKED', nextStatus: 'ACTIVE', lastSetter: { actorId: 'agent-grandparent', status: 'BLOCKED' }, callerSubtreeIds: subtree })
    assert.equal(verdict.ok, false)
  })

  test('an unknown setter, or an audit entry for an older status, refuses', () => {
    assert.equal(agentMayChangeStatus({ currentStatus: 'SUSPENDED', nextStatus: 'ACTIVE', lastSetter: null, callerSubtreeIds: subtree }).ok, false)
    assert.equal(agentMayChangeStatus({ currentStatus: 'SUSPENDED', nextStatus: 'ACTIVE', lastSetter: { actorId: CALLER, status: 'INACTIVE' }, callerSubtreeIds: subtree }).ok, false)
  })

  test('an unchanged status is always allowed, and statuses compare case-insensitively', () => {
    assert.deepEqual(agentMayChangeStatus({ currentStatus: 'SUSPENDED', nextStatus: 'suspended', lastSetter: null, callerSubtreeIds: subtree }), { ok: true })
    assert.deepEqual(agentMayChangeStatus({ currentStatus: 'suspended', nextStatus: 'ACTIVE', lastSetter: { actorId: CALLER, status: 'SUSPENDED' }, callerSubtreeIds: subtree }), { ok: true })
  })
})
