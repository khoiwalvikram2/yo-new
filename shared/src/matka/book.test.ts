import test from 'node:test'
import assert from 'node:assert/strict'
import { worstMatkaOutcome, type MatkaBookEntry } from './book.js'

const entry = (bidType: string, selection: string, stake: number, payout: number): MatkaBookEntry => ({ bidType, selection, stakeMinor: BigInt(stake * 100), payoutMinor: BigInt(payout * 100) })

test('Single digits: the worst digit costs its payout less every stake (the Worli session page example)', () => {
  // Four Single bets of 10 on 4, 6, 1 and 2, each paying 100: whichever comes, 40 staked - 100 paid = -60.
  const worst = worstMatkaOutcome([entry('SINGLE', '4', 10, 100), entry('SINGLE', '6', 10, 100), entry('SINGLE', '1', 10, 100), entry('SINGLE', '2', 10, 100)], 'worli', 'open')
  assert.deepEqual(worst, { key: '1', plMinor: -6000n })
  assert.equal(worstMatkaOutcome([], 'worli', 'open'), null)
})

test('a Pana and the Single digit it makes win together on one result', () => {
  // 267 is digit 5: both bets win on 267, which is worse than any other digit-5 Pana.
  const worst = worstMatkaOutcome([entry('SINGLE', '5', 10, 90), entry('SINGLE_PANNA', '267', 10, 1500), entry('SINGLE', '3', 10, 90)], 'worli', 'open')
  assert.deepEqual(worst, { key: '267', plMinor: 3000n - 159000n })
})

test('Close-session Jodi and Sangam use the declared Open result, and every Open/Close pair while it is unknown', () => {
  const book = [entry('JODI', '58', 10, 900), entry('SINGLE', '8', 10, 90)]
  // Open 267 is digit 5: a Close digit 8 pays the Jodi and the Single.
  assert.deepEqual(worstMatkaOutcome(book, 'worli', 'close', '267'), { key: '8', plMinor: 2000n - 99000n })
  // Open 123 is digit 6: the Jodi can no longer win, only the Single.
  assert.deepEqual(worstMatkaOutcome(book, 'worli', 'close', '123'), { key: '8', plMinor: 2000n - 9000n })
  // Open not declared: the worst pair is digit 5 then digit 8, read as the Jodi.
  assert.deepEqual(worstMatkaOutcome(book, 'worli', 'close'), { key: '58', plMinor: 2000n - 99000n })
  const sangam = worstMatkaOutcome([entry('FULL_SANGAM', '267-279', 10, 10000), entry('HALF_SANGAM', '5-279', 10, 1000)], 'worli', 'close')
  assert.deepEqual(sangam, { key: '267-279', plMinor: 2000n - 1100000n })
})

test('Jackpot and Satta try every two-digit result; an unsupported legacy selection keeps its stake and never wins', () => {
  assert.deepEqual(worstMatkaOutcome([entry('JODI', '05', 10, 900), entry('JODI', '77', 20, 1800)], 'jackpot', 'close'), { key: '77', plMinor: 3000n - 180000n })
  assert.deepEqual(worstMatkaOutcome([entry('AB', '02', 10, 900), entry('A', '0', 10, 90), entry('B', '9', 10, 90)], 'sattaMatka', 'close'), { key: '02', plMinor: 3000n - 99000n })
  assert.deepEqual(worstMatkaOutcome([entry('MYSTERY', 'x', 5, 999)], 'worli', 'open'), { key: null, plMinor: 500n })
})
