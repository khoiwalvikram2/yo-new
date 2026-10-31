import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import {
  CREDIT_STATEMENT_CSV_HEADER,
  balanceMeaning,
  creditStatementCsv,
  creditStatementTypeLabel,
  domainLabel,
  isCreditPlayerType,
  rowAmountMeaning,
  showCreditStatementTab,
} from './creditStatementModel'

describe('showCreditStatementTab', () => {
  test('credit players only: AGENT_CREDIT and WHITELABEL_CREDIT', () => {
    const admin = { isAgent: false, permissions: [{ domain: 'players.credit', actions: ['view'] }] }
    assert.equal(showCreditStatementTab({ ...admin, playerType: 'AGENT_CREDIT' }), true)
    assert.equal(showCreditStatementTab({ ...admin, playerType: 'WHITELABEL_CREDIT' }), true)
    for (const playerType of ['REGULAR', 'SHARING_AGENT_PLAYER', 'COMMISSION_AGENT_PLAYER', undefined]) {
      assert.equal(showCreditStatementTab({ ...admin, playerType }), false)
    }
    assert.equal(showCreditStatementTab({ isAgent: true, permissions: [], playerType: 'REGULAR' }), false)
  })

  test('admins need players.credit:view (flat players:view grants it); agents see their own players', () => {
    assert.equal(showCreditStatementTab({ isAgent: false, permissions: [{ domain: 'players.profile', actions: ['view'] }], playerType: 'AGENT_CREDIT' }), false)
    assert.equal(showCreditStatementTab({ isAgent: false, permissions: [{ domain: 'players', actions: ['view'] }], playerType: 'AGENT_CREDIT' }), true)
    assert.equal(showCreditStatementTab({ isAgent: false, permissions: [{ domain: 'all', actions: ['*'] }], playerType: 'WHITELABEL_CREDIT' }), true)
    assert.equal(showCreditStatementTab({ isAgent: true, permissions: [], playerType: 'AGENT_CREDIT' }), true)
  })
})

describe('direction words', () => {
  test('bet rows: positive is a win, negative a loss, coloured by sign', () => {
    assert.deepEqual(rowAmountMeaning({ type: 'BET_SETTLED', amount: 500 }), { sign: '+', magnitude: 500, tone: 'positive', word: 'Player won' })
    assert.deepEqual(rowAmountMeaning({ type: 'BET_SETTLED', amount: -250 }), { sign: '−', magnitude: 250, tone: 'negative', word: 'Player lost' })
    assert.deepEqual(rowAmountMeaning({ type: 'BET_SETTLED', amount: 0 }), { sign: '', magnitude: 0, tone: 'neutral', word: 'Level' })
  })

  test('settlement rows say which way the money went', () => {
    assert.deepEqual(rowAmountMeaning({ type: 'SETTLEMENT', amount: -500 }), { sign: '−', magnitude: 500, tone: 'negative', word: 'Paid to player' })
    assert.deepEqual(rowAmountMeaning({ type: 'SETTLEMENT', amount: 300 }), { sign: '+', magnitude: 300, tone: 'positive', word: 'Collected from player' })
  })

  test('informational rows are worded but not coloured', () => {
    assert.deepEqual(rowAmountMeaning({ type: 'LIMIT_CHANGE', amount: 2000 }), { sign: '+', magnitude: 2000, tone: 'neutral', word: 'Limit raised' })
    assert.equal(rowAmountMeaning({ type: 'LIMIT_CHANGE', amount: -1000 }).word, 'Limit lowered')
    assert.equal(rowAmountMeaning({ type: 'CREDIT_USED_CHANGE', amount: 100 }).word, 'Credit used increased')
    assert.equal(rowAmountMeaning({ type: 'CREDIT_USED_CHANGE', amount: -100 }).word, 'Credit used decreased')
    assert.deepEqual(rowAmountMeaning({ type: 'ALLOCATION', amount: 5000 }), { sign: '+', magnitude: 5000, tone: 'neutral', word: 'Credit given' })
  })

  test('balances: positive is owed to the player, negative is owed by the player', () => {
    assert.deepEqual(balanceMeaning(150), { sign: '+', magnitude: 150, tone: 'positive', word: 'Pay to player' })
    assert.deepEqual(balanceMeaning(-250), { sign: '−', magnitude: 250, tone: 'negative', word: 'Collect from player' })
    assert.deepEqual(balanceMeaning(0), { sign: '', magnitude: 0, tone: 'neutral', word: 'Settled' })
  })

  test('labels', () => {
    assert.equal(creditStatementTypeLabel('BET_SETTLED'), 'Bet settled')
    assert.equal(creditStatementTypeLabel('CREDIT_USED_CHANGE'), 'Credit used change')
    assert.equal(domainLabel('matka'), 'Matka')
    assert.equal(domainLabel(null), '')
    assert.equal(isCreditPlayerType('WHITELABEL_CREDIT'), true)
    assert.equal(isCreditPlayerType('REGULAR'), false)
  })
})

describe('creditStatementCsv', () => {
  test('one line per row: signed plain numbers, the meaning in words, blank balance on informational rows, safe text', () => {
    const csv = creditStatementCsv([
      { id: 'sports:1', type: 'BET_SETTLED', occurredAt: '2026-10-01T04:30:00.000Z', domain: 'sports', reference: 'India v Australia', details: 'Match Odds', amount: 500, affectsBalance: true, balanceAfter: 500 },
      { id: 'ledger:2', type: 'LIMIT_CHANGE', occurredAt: '2026-10-02T04:30:00.000Z', domain: null, reference: null, details: 'Raise, as agreed', amount: 2000, affectsBalance: false, balanceAfter: null, valueBefore: 10000, valueAfter: 12000 },
      { id: 'casino:3', type: 'BET_SETTLED', occurredAt: '2026-10-04T04:30:00.000Z', domain: 'casino', reference: '=HYPERLINK("x")', details: null, amount: -250, affectsBalance: true, balanceAfter: -250 },
    ])
    assert.deepEqual(csv.split('\n'), [
      CREDIT_STATEMENT_CSV_HEADER.join(','),
      '2026-10-01T04:30:00.000Z,Bet settled,Sports,India v Australia,Match Odds,500.00,Player won,500.00,,',
      '2026-10-02T04:30:00.000Z,Limit change,,,"Raise, as agreed",2000.00,Limit raised,,10000.00,12000.00',
      `2026-10-04T04:30:00.000Z,Bet settled,Casino,"'=HYPERLINK(""x"")",,-250.00,Player lost,-250.00,,`,
    ])
    assert.equal(CREDIT_STATEMENT_CSV_HEADER.join(','), 'Date,Type,Domain,Reference,Details,Amount,Meaning,Balance after,Before,After')
  })
})
