import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import type { ChipAccount } from '@/lib/graphql/chips'
import {
  chipCounterparty,
  chipErrorMessage,
  chipFigures,
  chipKindLabel,
  chipProfilePath,
  chipTone,
  creditReferenceProblem,
  depositPausedReason,
  isDirectParent,
  refPnlAfterReference,
  refPnlNote,
  roundChips,
  settlePlan,
  signedChips,
  transferProblem,
  type TransferCheck,
} from './chipModel'

const format = (value: number) => `INR ${value.toFixed(2)}`

function account(overrides: Partial<ChipAccount> = {}): ChipAccount {
  return {
    accountType: 'AGENT',
    id: 'agent-2',
    username: 'agent2',
    name: null,
    status: 'ACTIVE',
    parentAgentId: 'agent-1',
    playerType: null,
    currency: 'INR',
    creditReference: 10000,
    balance: 8000,
    exposure: 300,
    available: 8000,
    downlineBalance: 4000,
    refPnl: 2000,
    downlineCount: 3,
    ...overrides,
  }
}

describe('chip arithmetic and words', () => {
  test('amounts round half away from zero to 2 decimals, without floating-point drift', () => {
    assert.equal(roundChips(1.005), 1.01)
    assert.equal(roundChips(-1.005), -1.01)
    assert.equal(roundChips(2.344), 2.34)
    assert.equal(roundChips(1234567.895), 1234567.9)
    assert.ok(Object.is(roundChips(-0.001), 0), 'a negative that rounds to nothing is plain 0, not -0')
    assert.ok(Number.isNaN(roundChips(Number.NaN)))
  })

  test('a signed figure is green in, rose out, uncoloured at zero, and spells its sign', () => {
    assert.equal(chipTone(0.01), 'gain')
    assert.equal(chipTone(-0.01), 'loss')
    assert.equal(chipTone(0.004), undefined)
    assert.equal(signedChips(500, format), '+INR 500.00')
    assert.equal(signedChips(-500, format), '−INR 500.00')
    assert.equal(signedChips(-0.001, format), 'INR 0.00')
  })

  test('Ref P/L reads as who owes whom (spec §2)', () => {
    assert.equal(refPnlNote(10), 'Upline owes')
    assert.equal(refPnlNote(-10), 'Owes upline')
    assert.equal(refPnlNote(0), 'Nothing owed')
  })

  test('on the signed-in agent\'s own figures, Ref P/L speaks to it', () => {
    assert.equal(refPnlNote(10, true), 'Upline owes you')
    assert.equal(refPnlNote(-10, true), 'You owe upline')
    assert.equal(refPnlNote(0.001, true), 'Nothing owed')
    assert.equal(chipFigures(account(), format, true)[4].note, 'Upline owes you')
    assert.equal(chipFigures(account({ refPnl: -1500 }), format, true)[4].note, 'You owe upline')
  })

  test('an agent shows its downline under the balance; a player its wallet', () => {
    const agentFigures = chipFigures(account(), format)
    assert.deepEqual(agentFigures.map((figure) => figure.label), ['Credit Reference', 'Balance', 'Exposure', 'Available', 'Ref P/L'])
    assert.deepEqual(agentFigures.map((figure) => figure.value), ['INR 10000.00', 'INR 8000.00', 'INR 300.00', 'INR 8000.00', '+INR 2000.00'])
    assert.equal(agentFigures[1].note, 'Downline holds INR 4000.00')
    assert.equal(agentFigures[4].note, 'Upline owes')
    assert.equal(agentFigures[4].tone, 'gain')

    const playerFigures = chipFigures(account({ accountType: 'PLAYER', refPnl: -1500, downlineBalance: 0 }), format)
    assert.deepEqual(playerFigures.map((figure) => figure.note), ['Reference only', 'Chips in the wallet', 'Held for open bets', 'Balance − exposure', 'Owes upline'])
    assert.equal(playerFigures[4].tone, 'loss')
  })

  test('only the direct parent acts: an agent on its children, an admin on the root accounts (decision 3)', () => {
    assert.equal(isDirectParent(account({ parentAgentId: 'agent-1' }), 'agent-1'), true)
    assert.equal(isDirectParent(account({ parentAgentId: 'agent-9' }), 'agent-1'), false, 'a grandchild is not the agent’s to move')
    assert.equal(isDirectParent(account({ parentAgentId: null }), null), true, 'an admin acts on root accounts')
    assert.equal(isDirectParent(account({ parentAgentId: 'agent-1' }), null), false, 'an admin does not reach below the root')
    assert.equal(isDirectParent(account({ parentAgentId: null }), 'agent-1'), false)
  })

  test('deposits pause for an account that is not active; an unknown status is left to the server', () => {
    assert.equal(depositPausedReason(account()), null)
    assert.equal(depositPausedReason(account({ status: null })), null)
    assert.equal(depositPausedReason(account({ status: 'SUSPENDED' })), 'Deposits are paused while agent2 is suspended')
    assert.equal(depositPausedReason(account({ status: 'BLOCKED' })), 'Deposits are paused while agent2 is blocked')
  })

  test('"Settle to credit reference" withdraws a positive Ref P/L and deposits a negative one (decision 8)', () => {
    assert.deepEqual(settlePlan(500), { direction: 'withdraw', amount: 500 })
    assert.deepEqual(settlePlan(-250.555), { direction: 'deposit', amount: 250.56 })
    assert.equal(settlePlan(0), null)
    assert.equal(settlePlan(0.004), null)
  })

  test('a deposit is capped by the parent’s free chips, a withdrawal by the account’s (decision 4)', () => {
    const check = (overrides: Partial<TransferCheck>): TransferCheck => ({
      direction: 'deposit',
      amount: 100,
      parentFree: 1000,
      parentName: 'agent1',
      childFree: 50,
      childName: 'player1',
      ...overrides,
    })
    assert.equal(transferProblem(check({ amount: null }), format), null, 'no amount yet is not an error')
    assert.equal(transferProblem(check({ amount: 0 }), format), 'Enter an amount above 0')
    assert.equal(transferProblem(check({ amount: -5 }), format), 'Enter an amount above 0')
    assert.equal(transferProblem(check({ amount: 1000 }), format), null, 'all of the parent’s free chips may go')
    assert.equal(transferProblem(check({ amount: 1000.01 }), format), 'Not enough chips: agent1 has INR 1000.00 free')
    assert.equal(transferProblem(check({ amount: 5000, parentFree: null }), format), null, 'an unknown parent balance is left to the server')
    assert.equal(transferProblem(check({ parentFree: 0, amount: 1 }), format), 'Not enough chips: agent1 has no free chips')
    assert.equal(transferProblem(check({ direction: 'withdraw', amount: 50 }), format), null)
    assert.equal(transferProblem(check({ direction: 'withdraw', amount: 50.01 }), format), 'Not enough free chips: player1 has INR 50.00 free')
    assert.equal(transferProblem(check({ direction: 'withdraw', amount: 99999 }), format), 'Not enough free chips: player1 has INR 50.00 free', 'a withdrawal ignores the parent')
  })

  test('a credit reference is 0 or more, and moves Ref P/L by the difference', () => {
    assert.equal(creditReferenceProblem(null), null)
    assert.equal(creditReferenceProblem(0), null)
    assert.equal(creditReferenceProblem(-1), 'The credit reference cannot be below 0')
    assert.equal(refPnlAfterReference({ refPnl: -5000, creditReference: 100000 }, 90000), 5000)
    assert.equal(refPnlAfterReference({ refPnl: 2000, creditReference: 10000 }, 12000.5), -0.5)
  })

  test('statement words: kinds, the other side, profile links', () => {
    assert.equal(chipKindLabel('CREDIT_REFERENCE'), 'Credit reference')
    assert.equal(chipKindLabel('OPENING'), 'Opening')
    assert.equal(chipKindLabel('SOMETHING_NEW'), 'something new')
    assert.deepEqual(chipCounterparty({ counterpartyType: 'whitelabel', counterpartyId: 'tenant-1', counterpartyName: null }), { name: 'Whitelabel pool', type: 'Whitelabel' })
    assert.deepEqual(chipCounterparty({ counterpartyType: 'agent', counterpartyId: 'agent-1', counterpartyName: 'agent1' }), { name: 'agent1', type: 'Agent' })
    assert.deepEqual(chipCounterparty({ counterpartyType: null, counterpartyId: null, counterpartyName: null }), { name: null, type: null })
    assert.equal(chipProfilePath({ accountType: 'AGENT', id: 'a1' }), '/agents/a1')
    assert.equal(chipProfilePath({ accountType: 'PLAYER', id: 'p1' }), '/players/profile/p1')
  })

  test('a failed request shows the server’s own words first', () => {
    assert.equal(chipErrorMessage({ graphQLErrors: [{ message: 'Not enough chips: available 1,200.00' }], message: 'x' }), 'Not enough chips: available 1,200.00')
    assert.equal(chipErrorMessage(new Error('Network down')), 'Network down')
    assert.equal(chipErrorMessage(undefined, 'Fallback'), 'Fallback')
    assert.equal(chipErrorMessage({ graphQLErrors: [], message: '' }, 'Fallback'), 'Fallback')
  })
})
