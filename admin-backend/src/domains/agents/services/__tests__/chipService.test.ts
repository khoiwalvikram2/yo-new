/**
 * ChipService's pure rules: amount validation, the figure maths, the direct-parent rule, the free-chip guards,
 * the two ledger rows of a transfer, the pool reason text, the pool's own refusal and the caller shape. No database.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/domains/agents/services/__tests__/chipService.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ChipError,
  agentChipFigures,
  buildChipTransferLedger,
  chipActorOf,
  chipCallerFromCtx,
  cleanRemark,
  directParentError,
  formatChips,
  planChipTransfer,
  playerChipFigures,
  poolReason,
  poolRefusalFrom,
  roundChips,
  sumChipTotals,
  toChipAmount,
  toCreditReference,
  type LockedChipChild,
  type LockedChipParent,
} from '../ChipService.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

const isChipError = (code: string, message?: string | RegExp) => (err: unknown) => {
  assert.ok(err instanceof ChipError, `expected a ChipError, got ${String(err)}`)
  assert.equal(err.code, code)
  if (typeof message === 'string') assert.equal(err.message, message)
  else if (message) assert.match(err.message, message)
  return true
}

const agentParent = (over: Partial<Extract<LockedChipParent, { kind: 'agent' }>> = {}): LockedChipParent => ({
  kind: 'agent',
  id: A,
  username: 'boss',
  status: 'ACTIVE',
  schemeType: 'CREDIT',
  chipBalance: 1000,
  creditReference: 5000,
  ...over,
})

const pool = (available: number): LockedChipParent => ({ kind: 'whitelabel', tenant: 'wl-1', name: 'WL', available })

const agentChild = (over: Partial<Extract<LockedChipChild, { accountType: 'AGENT' }>> = {}): LockedChipChild => ({
  accountType: 'AGENT',
  id: B,
  username: 'sub',
  status: 'ACTIVE',
  schemeType: 'CREDIT',
  parentAgentId: A,
  chipBalance: 200,
  creditReference: 1000,
  ...over,
})

const playerChild = (over: Partial<Extract<LockedChipChild, { accountType: 'PLAYER' }>> = {}): LockedChipChild => ({
  accountType: 'PLAYER',
  id: '42',
  username: 'punter',
  status: 'active',
  playerType: 'AGENT_CREDIT',
  agentId: A,
  creditReference: 500,
  cash: 500,
  exposure: 0,
  ...over,
})

describe('amounts', () => {
  it('refuses NaN, Infinity, negatives, zero and amounts that round to zero', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'abc', '', null, undefined, {}]) {
      assert.throws(() => toChipAmount(bad), isChipError('INVALID_INPUT', 'Amount must be a number'))
    }
    for (const bad of [-5, -0.01, 0, 0.004]) {
      assert.throws(() => toChipAmount(bad), isChipError('INVALID_INPUT', 'Amount must be greater than zero'))
    }
    assert.throws(() => toChipAmount(1e13), isChipError('INVALID_INPUT', 'Amount is too large'))
  })

  it('rounds to 2 decimals, half away from zero, without binary noise', () => {
    assert.equal(toChipAmount(100), 100)
    assert.equal(toChipAmount('250.50'), 250.5)
    assert.equal(toChipAmount(1.005), 1.01)
    assert.equal(toChipAmount(10.005), 10.01)
    assert.equal(toChipAmount(0.005), 0.01)
    assert.equal(roundChips(-10.005), -10.01)
    assert.ok(Object.is(roundChips(-0.001), 0), 'no negative zero')
    assert.equal(roundChips(0.1 + 0.2), 0.3)
  })

  it('a credit reference may be zero but not negative', () => {
    assert.equal(toCreditReference(0), 0)
    assert.equal(toCreditReference('1500.555'), 1500.56)
    assert.throws(() => toCreditReference(-0.01), isChipError('INVALID_INPUT', 'Credit reference cannot be negative'))
    assert.throws(() => toCreditReference(Number.NaN), isChipError('INVALID_INPUT'))
  })

  it('trims remarks and caps their length', () => {
    assert.equal(cleanRemark('   '), null)
    assert.equal(cleanRemark(null), null)
    assert.equal(cleanRemark('  settle  '), 'settle')
    assert.throws(() => cleanRemark('x'.repeat(501)), isChipError('INVALID_INPUT'))
  })

  it('formats like the UI messages', () => {
    assert.equal(formatChips(1200), '1,200.00')
    assert.equal(formatChips(0.5), '0.50')
  })
})

describe('figures (spec §2)', () => {
  it('agent: available = balance; Ref P/L = balance + downline balance - credit reference', () => {
    const f = agentChipFigures({ creditReference: 10000, balance: 6000, downlineBalance: 4000, exposure: 200 })
    assert.deepEqual(f, { creditReference: 10000, balance: 6000, exposure: 200, available: 6000, downlineBalance: 4000, refPnl: 0 })
    assert.equal(agentChipFigures({ creditReference: 10000, balance: 1000, downlineBalance: 2500.5, exposure: 0 }).refPnl, -6499.5)
  })

  it('player: available = balance - exposure; Ref P/L = balance - credit reference; no downline', () => {
    const f = playerChipFigures({ creditReference: 1000, cash: 1250.5, exposure: 300 })
    assert.deepEqual(f, { creditReference: 1000, balance: 1250.5, exposure: 300, available: 950.5, downlineBalance: 0, refPnl: 250.5 })
    assert.equal(playerChipFigures({ creditReference: 1000, cash: 400, exposure: 0 }).refPnl, -600)
  })

  it('totals add in cents', () => {
    const t = sumChipTotals([
      playerChipFigures({ creditReference: 0.1, cash: 0.1, exposure: 0 }),
      playerChipFigures({ creditReference: 0.2, cash: 0.2, exposure: 0.1 }),
    ])
    assert.deepEqual(t, { creditReference: 0.3, balance: 0.3, exposure: 0.1, available: 0.2, downlineBalance: 0, refPnl: 0 })
    assert.deepEqual(sumChipTotals([]), { creditReference: 0, balance: 0, exposure: 0, available: 0, downlineBalance: 0, refPnl: 0 })
  })
})

describe('the direct-parent rule (spec §4.1 step 2)', () => {
  const byAgent = { kind: 'agent', agentId: A } as const
  const byWhitelabel = { kind: 'whitelabel' } as const

  it('an agent acts on its direct CREDIT sub-agents and its own AGENT_CREDIT players only', () => {
    assert.equal(directParentError(byAgent, agentChild()), null)
    assert.equal(directParentError({ kind: 'agent', agentId: A.toUpperCase() }, agentChild()), null, 'ids compare case-insensitively')
    assert.equal(directParentError(byAgent, playerChild()), null)
    assert.equal(directParentError(byAgent, agentChild({ id: C, parentAgentId: B }))?.code, 'NOT_DIRECT_PARENT', 'a grandchild')
    assert.equal(directParentError(byAgent, playerChild({ agentId: B }))?.code, 'NOT_DIRECT_PARENT', 'another agent\'s player')
    assert.equal(directParentError(byAgent, playerChild({ playerType: 'WHITELABEL_CREDIT', agentId: A }))?.code, 'NOT_DIRECT_PARENT')
    assert.equal(directParentError(byAgent, agentChild({ parentAgentId: null }))?.code, 'NOT_DIRECT_PARENT', 'a root agent')
  })

  it('the whitelabel acts on root CREDIT agents and WHITELABEL_CREDIT players only', () => {
    assert.equal(directParentError(byWhitelabel, agentChild({ parentAgentId: null })), null)
    assert.equal(directParentError(byWhitelabel, playerChild({ playerType: 'WHITELABEL_CREDIT', agentId: null })), null)
    assert.equal(directParentError(byWhitelabel, agentChild())?.code, 'NOT_DIRECT_PARENT')
    assert.equal(directParentError(byWhitelabel, playerChild())?.code, 'NOT_DIRECT_PARENT', 'an AGENT_CREDIT player')
  })

  it('refuses accounts outside the CREDIT scheme', () => {
    assert.equal(directParentError(byAgent, agentChild({ schemeType: 'SHARING' }))?.code, 'NOT_CREDIT')
    assert.equal(directParentError(byWhitelabel, playerChild({ playerType: 'REGULAR', agentId: null }))?.code, 'NOT_CREDIT')
    assert.equal(
      directParentError(byAgent, playerChild({ playerType: 'SHARING_AGENT_PLAYER' }))?.message,
      'Chips are only for CREDIT agents and credit players'
    )
  })
})

describe('planChipTransfer guards (spec §4.1, §4.2)', () => {
  it('deposit: moves the amount from the parent agent to the child', () => {
    const plan = planChipTransfer('DEPOSIT', agentParent(), agentChild(), 400)
    assert.deepEqual(plan, {
      amount: 400,
      parentBefore: 1000,
      parentAfter: 600,
      parentDelta: -400,
      childBefore: 200,
      childAfter: 600,
      childDelta: 400,
    })
    assert.equal(planChipTransfer('DEPOSIT', agentParent({ chipBalance: 400 }), agentChild(), 400).parentAfter, 0, 'the whole balance')
  })

  it('deposit: the parent needs the chips', () => {
    assert.throws(
      () => planChipTransfer('DEPOSIT', agentParent({ chipBalance: 300.5 }), agentChild(), 400),
      isChipError('INSUFFICIENT', 'Not enough chips: available 300.50')
    )
    assert.throws(
      () => planChipTransfer('DEPOSIT', pool(50), agentChild({ parentAgentId: null }), 50.01),
      isChipError('INSUFFICIENT', 'Not enough chips in the whitelabel pool: available 50.00')
    )
    assert.equal(planChipTransfer('DEPOSIT', pool(50), agentChild({ parentAgentId: null }), 50).parentAfter, 0)
  })

  it('deposit: refused to or by an account that is not ACTIVE', () => {
    for (const status of ['SUSPENDED', 'BLOCKED', 'INACTIVE']) {
      assert.throws(
        () => planChipTransfer('DEPOSIT', agentParent(), agentChild({ status }), 10),
        isChipError('NOT_ACTIVE', `Chips cannot be deposited while agent sub is ${status.toLowerCase()}`)
      )
      assert.throws(
        () => planChipTransfer('DEPOSIT', agentParent({ status }), agentChild(), 10),
        isChipError('NOT_ACTIVE', `Chips cannot be deposited while agent boss is ${status.toLowerCase()}`)
      )
    }
    for (const status of ['suspended', 'inactive']) {
      assert.throws(() => planChipTransfer('DEPOSIT', agentParent(), playerChild({ status }), 10), isChipError('NOT_ACTIVE'))
    }
  })

  it('withdraw: allowed from a suspended account, but only its free chips', () => {
    const plan = planChipTransfer('WITHDRAW', agentParent({ status: 'SUSPENDED' }), agentChild({ status: 'SUSPENDED' }), 200)
    assert.deepEqual([plan.parentAfter, plan.childAfter, plan.parentDelta, plan.childDelta], [1200, 0, 200, -200])
    assert.throws(
      () => planChipTransfer('WITHDRAW', agentParent(), agentChild({ chipBalance: 100 }), 100.01),
      isChipError('INSUFFICIENT', 'Not enough chips: available 100.00')
    )
    // A player's free chips are cash - exposure.
    assert.throws(
      () => planChipTransfer('WITHDRAW', agentParent(), playerChild({ cash: 500, exposure: 200 }), 301),
      isChipError('INSUFFICIENT', 'Not enough chips: available 300.00')
    )
    assert.equal(planChipTransfer('WITHDRAW', agentParent(), playerChild({ cash: 500, exposure: 200 }), 300).childAfter, 200)
    assert.throws(
      () => planChipTransfer('WITHDRAW', agentParent(), playerChild({ cash: 100, exposure: 250, status: 'suspended' }), 1),
      isChipError('INSUFFICIENT', 'Not enough chips: available 0.00')
    )
    assert.equal(planChipTransfer('WITHDRAW', pool(0), playerChild({ playerType: 'WHITELABEL_CREDIT', agentId: null }), 500).parentAfter, 500)
  })

  it('the direct-parent rule is checked before any balance, and the parent must be a CREDIT agent', () => {
    assert.throws(
      () => planChipTransfer('DEPOSIT', agentParent({ chipBalance: 0 }), agentChild({ parentAgentId: B }), 10),
      isChipError('NOT_DIRECT_PARENT', 'Only the direct upline can move chips for this account')
    )
    assert.throws(
      () => planChipTransfer('DEPOSIT', agentParent({ schemeType: 'SHARING' }), agentChild(), 10),
      isChipError('NOT_CREDIT', 'Only CREDIT agents hold chips')
    )
  })
})

describe('the ledger rows of one transfer', () => {
  const actor = { createdBy: A, createdByType: 'agent' as const }

  it('deposit by an agent: two rows, one transfer id, signed from each side', () => {
    const rows = buildChipTransferLedger({
      tenant: 'wl-1',
      transferId: 'tx-1',
      direction: 'DEPOSIT',
      parent: agentParent(),
      child: agentChild(),
      amount: 400,
      parentBefore: 1000,
      parentAfter: 600,
      childBefore: 200,
      childAfter: 600,
      remark: 'top up',
      actor,
    })
    assert.equal(rows.length, 2)
    assert.ok(rows.every((r) => r.transferId === 'tx-1' && r.kind === 'DEPOSIT' && r.tenantId === 'wl-1'))
    assert.ok(rows.every((r) => r.remark === 'top up' && r.createdBy === A && r.createdByType === 'agent'))
    const [parent, child] = rows
    assert.deepEqual(
      [parent.accountType, parent.accountId, parent.counterpartyType, parent.counterpartyId, parent.amount, parent.balanceBefore, parent.balanceAfter],
      ['agent', A, 'agent', B, -400, 1000, 600]
    )
    assert.deepEqual([parent.creditReferenceBefore, parent.creditReferenceAfter], [5000, 5000])
    assert.deepEqual(
      [child.accountType, child.accountId, child.counterpartyType, child.counterpartyId, child.amount, child.balanceBefore, child.balanceAfter],
      ['agent', B, 'agent', A, 400, 200, 600]
    )
    assert.deepEqual([child.creditReferenceBefore, child.creditReferenceAfter], [1000, 1000])
  })

  it('withdrawal to the whitelabel pool: the pool row is the tenant, with no credit reference', () => {
    const [parent, child] = buildChipTransferLedger({
      tenant: 'wl-1',
      transferId: 'tx-2',
      direction: 'WITHDRAW',
      parent: pool(1000),
      child: playerChild({ playerType: 'WHITELABEL_CREDIT', agentId: null }),
      amount: 300,
      parentBefore: 1000,
      parentAfter: 1300,
      childBefore: 500,
      childAfter: 200,
      remark: null,
      actor: { createdBy: '7', createdByType: 'admin' },
    })
    assert.deepEqual(
      [parent.accountType, parent.accountId, parent.amount, parent.balanceBefore, parent.balanceAfter, parent.creditReferenceBefore],
      ['whitelabel', 'wl-1', 300, 1000, 1300, null]
    )
    assert.deepEqual(
      [child.accountType, child.accountId, child.counterpartyType, child.counterpartyId, child.amount, child.kind],
      ['player', '42', 'whitelabel', 'wl-1', -300, 'WITHDRAW']
    )
  })
})

describe('the pool reason never says "deposit"', () => {
  it('names the account, falling back to its id when the username contains the word', () => {
    assert.equal(poolReason('DEPOSIT', { accountType: 'AGENT', id: A, username: 'bob' }), 'Chips to agent bob')
    assert.equal(poolReason('WITHDRAW', { accountType: 'PLAYER', id: '42', username: 'alice' }), 'Chips from player alice')
    const reason = poolReason('DEPOSIT', { accountType: 'PLAYER', id: '42', username: 'DepositKing' })
    assert.equal(reason, 'Chips to player #42')
    assert.doesNotMatch(reason, /deposit/i)
  })
})

describe("the pool's own refusal becomes a chip refusal", () => {
  it('maps WhitelabelCreditService "Insufficient whitelabel credit" to INSUFFICIENT; anything else is left alone', () => {
    const refusal = poolRefusalFrom(new Error('Insufficient whitelabel credit. Available: 1234.5, Requested: 5000'))
    assert.ok(refusal instanceof ChipError)
    assert.equal(refusal.code, 'INSUFFICIENT')
    assert.equal(refusal.message, 'Not enough chips in the whitelabel pool: available 1,234.50')
    assert.equal(
      poolRefusalFrom(new Error('Insufficient whitelabel credit. Available: -20, Requested: 5'))?.message,
      'Not enough chips in the whitelabel pool: available 0.00'
    )
    assert.equal(
      poolRefusalFrom(new Error('Insufficient whitelabel credit. Available: NaN, Requested: 5'))?.message,
      'Not enough chips in the whitelabel pool'
    )
    assert.equal(poolRefusalFrom(new Error('Whitelabel not found')), null)
    assert.equal(poolRefusalFrom(new Error('connection terminated')), null)
    assert.equal(poolRefusalFrom('Insufficient whitelabel credit'), null, 'only Error instances')
  })
})

describe('the caller', () => {
  it('reads an agent principal and an admin from the GraphQL context', () => {
    const agentCaller = chipCallerFromCtx({ user: { type: 'agent', agentId: A, isReadOnly: true }, tenant: 'wl-1' })
    assert.deepEqual(agentCaller, { kind: 'agent', tenant: 'wl-1', agentId: A, readOnly: true })
    assert.deepEqual(chipActorOf(agentCaller), { createdBy: A, createdByType: 'agent' })
    const adminCaller = chipCallerFromCtx({ user: { sub: 7, type: 'admin', roles: [] }, whitelabel: { id: 'wl-2' } })
    assert.deepEqual(adminCaller, { kind: 'admin', tenant: 'wl-2', userId: '7' })
    assert.deepEqual(chipActorOf(adminCaller), { createdBy: '7', createdByType: 'admin' })
  })

  it('refuses a context with nobody signed in or no tenant', () => {
    assert.throws(() => chipCallerFromCtx({}), isChipError('FORBIDDEN'))
    assert.throws(() => chipCallerFromCtx({ user: { sub: 7 } }), /Tenant ID is required/)
  })
})
