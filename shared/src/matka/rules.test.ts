import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedBids, cutoffSession, evaluateMatkaSelection, moneyDecimal, moneyMinor, normalizeBid, normalizeSelection, pannaType, payoutMinor, resultDigit, validateMatkaResult } from './rules.js'
import { matkaSchedule, matkaSessionResults, stoppedByOperator, worliLockAt, worliSessionStatus } from './schedule.js'

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
test('Lock Now / Close Now stop betting by status and by their stamps, also on sessions locked before the status was written', () => {
  const market = { status: 'active', timezone: 'Asia/Kolkata', schedule: { openTime: '12:00', closeTime: '21:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }, settings: { betWindowMinsBeforeOpen: 15, betWindowMinsBeforeClose: 10 } }
  const now = new Date('2026-10-25T06:00:00Z'), earlier = new Date('2026-10-25T05:59:00Z'), later = new Date('2026-10-25T06:01:00Z')
  assert.equal(matkaSchedule(market, now, [{ side: 'OPEN', status: 'OPEN' }]).open.accepting, true)
  assert.equal(matkaSchedule(market, now, [{ side: 'OPEN', status: 'LOCKED', actualLockAtUtc: earlier }]).open.accepting, false)
  assert.equal(matkaSchedule(market, now, [{ side: 'CLOSE', status: 'CLOSED', actualCloseAtUtc: earlier }]).close.accepting, false)
  // A stamp blocks even when the stored status stayed OPEN (rows locked by the old Lock Now), but only once reached.
  assert.equal(matkaSchedule(market, now, [{ side: 'OPEN', status: 'OPEN', actualLockAtUtc: earlier }]).open.accepting, false)
  assert.equal(matkaSchedule(market, now, [{ side: 'CLOSE', status: 'OPEN', actualCloseAtUtc: earlier }]).close.accepting, false)
  assert.equal(matkaSchedule(market, now, [{ side: 'OPEN', status: 'OPEN', actualLockAtUtc: later }]).open.accepting, true)
  assert.equal(stoppedByOperator({ actualLockAtUtc: null, actualCloseAtUtc: null }, now), false)
})
test('the operator status of a stored session follows the clock, the suspend override and the operator stamps', () => {
  const at = (iso: string) => new Date(iso)
  const session = { status: 'OPEN', scheduledOpenAtUtc: at('2026-10-25T00:00:00Z'), scheduledLockAtUtc: at('2026-10-25T06:15:00Z'), scheduledCloseAtUtc: at('2026-10-25T06:30:00Z'), suspendMinutesOverride: null, actualLockAtUtc: null, actualCloseAtUtc: null }
  assert.equal(worliSessionStatus(session, at('2026-10-25T06:14:59Z')), 'OPEN')
  assert.equal(worliSessionStatus(session, at('2026-10-25T06:15:00Z')), 'LOCKED')
  assert.equal(worliSessionStatus(session, at('2026-10-25T06:30:00Z')), 'CLOSED')
  assert.equal(worliSessionStatus(session, at('2026-11-01T00:00:00Z')), 'CLOSED', 'six days after the lock it is no longer live')
  // Adjust Suspend Minutes 20: players lock at close - 20 min, and so does the operator's view.
  const adjusted = { ...session, suspendMinutesOverride: 20 }
  assert.equal(worliLockAt(adjusted)?.toISOString(), '2026-10-25T06:10:00.000Z')
  assert.equal(worliLockAt(session)?.toISOString(), '2026-10-25T06:15:00.000Z')
  assert.equal(worliSessionStatus(adjusted, at('2026-10-25T06:12:00Z')), 'LOCKED')
  assert.equal(worliSessionStatus({ ...session, actualLockAtUtc: at('2026-10-25T05:00:00Z') }, at('2026-10-25T05:00:01Z')), 'LOCKED')
  assert.equal(worliSessionStatus({ ...session, actualCloseAtUtc: at('2026-10-25T05:00:00Z') }, at('2026-10-25T05:00:01Z')), 'CLOSED')
  assert.equal(worliSessionStatus({ ...session, status: 'LOCKED' }, at('2026-10-25T05:00:00Z')), 'LOCKED')
  assert.equal(worliSessionStatus({ ...session, status: 'SCHEDULED' }, at('2026-10-24T23:00:00Z')), 'SCHEDULED')
  assert.equal(worliSessionStatus({ ...session, status: 'SCHEDULED' }, at('2026-10-25T01:00:00Z')), 'OPEN')
  for (const status of ['PAUSED', 'SETTLED', 'VOIDED', 'SETTLING']) assert.equal(worliSessionStatus({ ...session, status }, at('2026-11-01T00:00:00Z')), status)
})
test('a session whose result was ever declared, rolled back since or not, takes no entries, with or without its row', () => {
  const market = { status: 'active', timezone: 'Asia/Kolkata', schedule: { openTime: '12:00', closeTime: '21:00', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }, settings: { betWindowMinsBeforeOpen: 15, betWindowMinsBeforeClose: 10 } }
  const now = new Date('2026-10-25T06:00:00Z'), rolledBackAt = new Date('2026-10-25T05:30:00Z')
  // A result in force is published and declared; a rolled-back one is declared only, so it is no longer shown.
  assert.deepEqual(matkaSessionResults([{ type: 'open', result: '267', rolledBackAt: null }]), { published: { open: '267' }, declared: { open: true } })
  const rolledBack = matkaSessionResults([{ type: 'open', result: '267', rolledBackAt }])
  assert.deepEqual(rolledBack, { published: {}, declared: { open: true } })
  assert.deepEqual(matkaSessionResults([]), { published: {}, declared: {} })
  // With no session row, the clock alone reopened the rolled-back Open session; declared keeps it shut while Close is open.
  assert.equal(matkaSchedule(market, now, [], rolledBack.published).open.accepting, true)
  const shut = matkaSchedule(market, now, [], rolledBack.published, rolledBack.declared)
  assert.deepEqual([shut.open.accepting, shut.open.status, shut.close.accepting, shut.status], [false, 'Closed', true, 'Open'])
  // A stored row OPEN by status changes nothing, and with both sessions declared the market is closed.
  assert.equal(matkaSchedule(market, now, [{ side: 'OPEN', status: 'OPEN' }], {}, { open: true }).open.accepting, false)
  assert.equal(matkaSchedule(market, now, [], {}, { open: true, close: true }).status, 'Closed')
})
