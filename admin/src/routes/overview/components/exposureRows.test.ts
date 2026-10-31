/**
 * The "Exposure by market" card prints a Share column that must add up to exactly 100, folds anything past
 * six markets into one "Others" row, and draws each bar at the unrounded share. A slip in any of these shows
 * a wrong number on the dashboard without an error, so each rule is pinned here.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import {
  MAX_ROWS,
  OTHERS_KEY,
  OTHERS_LABEL,
  OTHERS_PRODUCT,
  buildExposureRows,
  foldMarkets,
  fullLabel,
  largestRemainderPercents,
  type ExposureMarket,
} from './exposureRows'

function sport(key: string, label: string, amount: number): ExposureMarket {
  return { key: `sports:${key}`, product: 'sports', label, amount }
}

const MATKA = (amount: number): ExposureMarket => ({ key: 'matka', product: 'matka', label: 'Matka', amount })

const sum = (values: readonly number[]) => values.reduce((total, v) => total + v, 0)

describe('foldMarkets', () => {
  test('shows six or fewer markets as they are, in the server order', () => {
    const six = [
      sport('cricket', 'Cricket', 600),
      MATKA(500),
      sport('football', 'Football', 400),
      sport('tennis', 'Tennis', 300),
      sport('esports', 'eSports', 200),
      sport('basketball', 'Basketball', 100),
    ]
    assert.equal(MAX_ROWS, 6)
    assert.deepStrictEqual(foldMarkets(six), six)
    assert.deepStrictEqual(foldMarkets(six.slice(0, 1)), six.slice(0, 1))
    assert.deepStrictEqual(foldMarkets([]), [])
  })

  test('with seven or more, keeps the first five and folds the rest into "Others", with its count kept apart', () => {
    const eight = [
      sport('cricket', 'Cricket', 800),
      sport('football', 'Football', 700),
      MATKA(600),
      sport('tennis', 'Tennis', 500),
      sport('esports', 'eSports', 400),
      sport('basketball', 'Basketball', 300),
      sport('golf', 'Golf', 200),
      sport('politics', 'Politics', 100),
    ]
    const folded = foldMarkets(eight)
    assert.equal(folded.length, MAX_ROWS)
    assert.deepStrictEqual(folded.slice(0, 5), eight.slice(0, 5))
    assert.deepStrictEqual(folded[5], {
      key: OTHERS_KEY,
      product: OTHERS_PRODUCT,
      label: OTHERS_LABEL,
      foldedCount: 3,
      amount: 600,
    })
    assert.equal(OTHERS_LABEL, 'Others')
    // the markets kept as they are carry no count
    folded.slice(0, 5).forEach(m => assert.equal(m.foldedCount, undefined))
  })

  test('seven markets fold two, never a lone "Others (1)"', () => {
    const seven = Array.from({ length: 7 }, (_, i) => sport(`s${i}`, `Sport ${i}`, 70 - i * 10))
    const folded = foldMarkets(seven)
    assert.equal(folded[5].label, 'Others')
    assert.equal(folded[5].foldedCount, 2)
    assert.equal(folded[5].amount, 20 + 10)
  })

  test('drops rows with no positive, finite amount before counting', () => {
    const rows = [
      sport('cricket', 'Cricket', 100),
      sport('zero', 'Zero', 0),
      sport('negative', 'Negative', -5),
      sport('nan', 'NaN', Number.NaN),
      sport('inf', 'Inf', Number.POSITIVE_INFINITY),
      MATKA(50),
    ]
    assert.deepStrictEqual(foldMarkets(rows), [rows[0], rows[5]])
  })
})

describe('largestRemainderPercents', () => {
  test('gives the missing points to the largest remainders, ties to the earlier row', () => {
    assert.deepStrictEqual(largestRemainderPercents([1, 1, 1]), [34, 33, 33])
    assert.deepStrictEqual(largestRemainderPercents([2, 1]), [67, 33])
    assert.deepStrictEqual(largestRemainderPercents([1]), [100])
  })

  test('is all zeros when there is nothing to share', () => {
    assert.deepStrictEqual(largestRemainderPercents([]), [])
    assert.deepStrictEqual(largestRemainderPercents([0, 0]), [0, 0])
  })

  test('always adds up to exactly 100', () => {
    // The mockup's own six amounts (M:2723), then a deterministic spread of awkward ones.
    assert.equal(sum(largestRemainderPercents([784200, 238700, 241900, 112400, 98600, 289000])), 100)
    let seed = 7
    const next = () => {
      seed = (seed * 48271) % 2147483647
      return seed
    }
    for (let run = 0; run < 500; run += 1) {
      const count = 1 + (next() % MAX_ROWS)
      const amounts = Array.from({ length: count }, () => (next() % 1_000_000) / 7 + 0.01)
      const percents = largestRemainderPercents(amounts)
      assert.equal(sum(percents), 100, `amounts=${JSON.stringify(amounts)}`)
      percents.forEach((p, i) => {
        const exact = (amounts[i] / sum(amounts)) * 100
        assert.ok(p === Math.floor(exact) || p === Math.floor(exact) + 1, `row ${i}: ${p} vs ${exact}`)
      })
    }
  })
})

describe('buildExposureRows', () => {
  test('draws the bar at the exact share and prints the whole percent', () => {
    const rows = buildExposureRows([sport('cricket', 'Cricket', 2), MATKA(1)])
    assert.deepStrictEqual(
      rows.map(r => [r.key, r.percent, r.percentLabel]),
      [
        ['sports:cricket', 67, '67%'],
        ['matka', 33, '33%'],
      ]
    )
    assert.ok(Math.abs(rows[0].share - 200 / 3) < 1e-9)
    assert.ok(Math.abs(rows[1].share - 100 / 3) < 1e-9)
  })

  test('prints "<1%" for a share that is not zero but rounds to 0', () => {
    const rows = buildExposureRows([sport('cricket', 'Cricket', 1000), MATKA(1)])
    assert.deepStrictEqual(rows.map(r => r.percentLabel), ['100%', '<1%'])
    assert.equal(rows[1].percent, 0)
    assert.ok(rows[1].share > 0)
  })

  test('shares the folded total, so the Others row carries its part of the 100', () => {
    const markets = Array.from({ length: 9 }, (_, i) => sport(`s${i}`, `Sport ${i}`, 100 - i))
    const rows = buildExposureRows(markets)
    assert.equal(rows.length, MAX_ROWS)
    assert.equal(rows[5].label, 'Others')
    assert.equal(rows[5].foldedCount, 4)
    assert.equal(fullLabel(rows[5]), 'Others (4)')
    assert.deepStrictEqual(rows.slice(0, 5).map(r => r.foldedCount), [0, 0, 0, 0, 0])
    assert.deepStrictEqual(rows.slice(0, 5).map(fullLabel), ['Sport 0', 'Sport 1', 'Sport 2', 'Sport 3', 'Sport 4'])
    assert.equal(rows[5].amount, 95 + 94 + 93 + 92)
    assert.equal(sum(rows.map(r => r.percent)), 100)
    assert.ok(Math.abs(sum(rows.map(r => r.share)) - 100) < 1e-9)
  })

  test('is empty when nothing is open', () => {
    assert.deepStrictEqual(buildExposureRows([]), [])
    assert.deepStrictEqual(buildExposureRows([sport('cricket', 'Cricket', 0)]), [])
  })
})
