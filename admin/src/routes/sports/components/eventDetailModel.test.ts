import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { calculateProfit, fancyBookCsv, fancyBookSummary, filterProfileBets, profileBetPnL, profileBetsCsv, riskTone } from './eventDetailModel'

describe('event player intelligence models', () => {
  test('retains original back and lay profit/liability arithmetic for every settled status', () => {
    for (const [status, side, expected] of [['won', 'back', 125], ['won', 'lay', 50], ['lost', 'back', -50], ['lost', 'lay', -125], ['void', 'back', 0], ['cancelled', 'lay', 0], ['matched', 'back', 0]] as const) {
      assert.equal(profileBetPnL({ id: 'bet', status, side, stake: 50, liability: 125 }), expected)
    }
    assert.equal(profileBetPnL({ id: 'zero', status: 'WON', side: 'BACK', stake: 50, liability: 0 }), 0)
  })
  test('applies search/status and inclusive calendar bounds only to the loaded snapshot', () => {
    const bets = [{ id: 'b1', marketId: 'Cricket', status: 'WON', createdAt: '2026-10-09T23:00:00Z' }, { id: 'b2', marketId: 'Tennis', status: 'lost', createdAt: '2026-10-10T05:00:00Z' }, { id: 'b3', marketId: 'Cricket', status: 'won' }]
    assert.deepEqual(filterProfileBets(bets, { search: ' cric ', status: 'won', from: '2026-10-10', to: '2026-10-10' }, () => '2026-10-10').map(bet => bet.id), ['b1'])
    assert.equal(bets.length, 3)
    assert.deepEqual(filterProfileBets(bets, { search: '', status: '', from: '', to: '' }, () => '').map(bet => bet.id), ['b1', 'b2', 'b3'])
  })
  test('quotes CSV text safely, exports raw currency and omits unsettled P&L', () => {
    const csv = profileBetsCsv([{ id: 'a,"b', marketId: 'market\nnew', stake: 0, liability: 9, status: 'won', side: 'back', currency: 'USD' }, { id: 'pending', status: 'matched' }])
    assert.ok(csv.includes('"a,""b"'))
    assert.ok(csv.includes('"market\nnew"'))
    assert.ok(csv.includes('"0"'))
    assert.ok(csv.includes('"9","USD"'))
    assert.ok(csv.endsWith('"matched","",""'))
  })
  test('retains risk thresholds and uses neutral for unknown risk levels', () => {
    assert.deepEqual(['critical', 'HIGH', 'Medium', 'LOW', 'unknown'].map(riskTone), ['neg', 'neg', 'warn', 'ok', 'neutral'])
  })
  test('retains exact back/lay calculator commissions, liability and return rounding', () => {
    assert.deepEqual(calculateProfit('back', 100, 2.5, 2), { side: 'back', profit: '147.00', totalReturn: '247.00', loss: '100.00', roi: '147.00' })
    assert.deepEqual(calculateProfit('lay', 100, 2.5, 2), { side: 'lay', profit: '98.00', liability: '150.00', loss: '150.00', roi: '65.33' })
    assert.equal(calculateProfit('back', 25, 2, 0).profit, '25.00')
  })
  test('keeps fancy summary top five profits/losses, one zero and original position order without mutating the full book', () => {
    const entries = Array.from({ length: 21 }, (_, index) => ({ position: index + 1, pnl: index - 10 }))
    const summary = fancyBookSummary(entries, false)
    assert.deepEqual(summary.map(entry => entry.position), [1, 2, 3, 4, 5, 11, 17, 18, 19, 20, 21])
    assert.equal(fancyBookSummary(entries, true).length, 21)
    assert.deepEqual(entries.map(entry => entry.position), Array.from({ length: 21 }, (_, index) => index + 1))
    assert.equal(fancyBookCsv([{ position: 1, pnl: -25.125 }, { position: 2, pnl: Infinity }]), 'Position,P/L\n1,-25.13\n2,0.00')
  })
})
