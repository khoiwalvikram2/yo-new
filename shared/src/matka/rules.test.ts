import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedBids, cutoffSession, evaluateMatkaSelection, moneyDecimal, moneyMinor, normalizeBid, normalizeSelection, pannaType, payoutMinor, resultDigit, validateMatkaResult } from './rules.js'
import { matkaSchedule } from './schedule.js'

test('Pana families contain all 220 canonical combinations with zero ranked last', () => {
  const counts: Record<string, number> = {}
  for (let n = 0; n < 1000; n++) { const kind = pannaType(String(n).padStart(3, '0')); if (kind) counts[kind] = (counts[kind] || 0) + 1 }
  assert.deepEqual(counts, { TRIPLE_PANNA: 10, DOUBLE_PANNA: 90, SINGLE_PANNA: 120 })
  assert.equal(pannaType('120'), 'SINGLE_PANNA'); assert.equal(pannaType('012'), null)
})
test('reference Single, Jodi, Pana and both Sangam directions settle exactly in their session', () => {
  const sample = (bidType: string, betNumbers: string, marketSession = 'close') => ({ bidType, betNumbers, marketSession, matkaType: 'worli' })
  assert.equal(resultDigit('267'), '5'); assert.equal(resultDigit('279'), '8')
  for (const bet of [sample('Single', '8'), sample('Jodi', '58'), sample('Single Patti', '279'), sample('Half Sangam', '5-279'), sample('Half Sangam', '267-8'), sample('Full Sangam', '267-279')]) assert.equal(evaluateMatkaSelection(bet, 'close', '279', '267'), true)
  assert.equal(evaluateMatkaSelection(sample('Jodi', '85'), 'close', '279', '267'), false)
  assert.equal(evaluateMatkaSelection(sample('Jodi', '58'), 'open', '267'), null)
  assert.equal(evaluateMatkaSelection(sample('Single', '5', 'open'), 'open', '267'), true)
  assert.throws(() => evaluateMatkaSelection(sample('Jodi', '58'), 'close', '279'))
})
test('all UI form variants normalize to server selections and preserve leading zeros', () => {
  assert.equal(normalizeBid('single-patti-bulk'), 'SINGLE_PANNA'); assert.equal(normalizeBid('sp-motor'), 'SINGLE_PANNA')
  assert.equal(normalizeBid('sp-dp-tp', '110'), 'DOUBLE_PANNA'); assert.equal(normalizeSelection('JODI', '02'), '02')
  assert.equal(normalizeSelection('HALF_SANGAM', '0 / 120'), '0-120')
  for (const value of ['2', '002', '2 OR 1=1']) assert.throws(() => normalizeSelection('JODI', value))
  assert.throws(() => normalizeSelection('FULL_SANGAM', '321-123'))
})
test('market type restrictions and combination deadlines match the result dependency', () => {
  assert.deepEqual(allowedBids('jackpot'), ['JODI']); assert.deepEqual(allowedBids('sattaMatka'), ['AB', 'A', 'B'])
  assert.equal(evaluateMatkaSelection({ bidType: 'A', betNumbers: '0', matkaType: 'sattaMatka' }, 'close', '02'), true)
  assert.equal(cutoffSession('JODI', 'worli', 'close'), 'open'); assert.equal(cutoffSession('FULL_SANGAM', 'worli', 'close'), 'open')
  assert.equal(validateMatkaResult('jackpot', 'close', '02'), '02'); assert.throws(() => validateMatkaResult('worli', 'open', '27'))
  assert.throws(() => validateMatkaResult('starline', 'close', '267'))
})
test('money uses integer minor units, rejects fractions beyond cents and rounds payouts once', () => {
  assert.equal(moneyMinor('0.10') + moneyMinor('0.20'), 30n); assert.equal(moneyDecimal(-123n), '-1.23')
  assert.equal(payoutMinor(125n, '9.5000'), 1188n); assert.throws(() => moneyMinor('1.001')); assert.throws(() => payoutMinor(10n, 'NaN'))
})
test('IST cutoffs, active days, overnight service date and operator pause are enforced', () => {
  const market = { status: 'active', timezone: 'Asia/Kolkata', schedule: { openTime: '12:00', closeTime: '21:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }, settings: { betWindowMinsBeforeOpen: 15, betWindowMinsBeforeClose: 10 } }
  assert.equal(matkaSchedule(market, new Date('2026-10-25T06:14:59Z')).open.accepting, true)
  const locked = matkaSchedule(market, new Date('2026-10-25T06:15:00Z')); assert.equal(locked.open.accepting, false); assert.equal(locked.close.accepting, true)
  assert.equal(matkaSchedule(market, new Date('2026-10-25T06:00:00Z'), [{ side: 'OPEN', status: 'PAUSED' }]).open.accepting, false)
  assert.equal(matkaSchedule({ ...market, schedule: { ...market.schedule, daysOfWeek: [1] } }, new Date('2026-10-25T06:00:00Z')).status, 'Closed')
  const overnight = matkaSchedule({ ...market, schedule: { ...market.schedule, openTime: '21:00', closeTime: '02:00', closesNextDay: true } }, new Date('2026-10-25T19:30:00Z'))
  assert.equal(overnight.runDate, '2026-10-25'); assert.equal(overnight.close.accepting, true); assert.equal(overnight.open.accepting, false)
})
