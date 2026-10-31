import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { casinoBetsFixture, casinoDashboardFixture } from '../../../../test/casinoLivePreviewData'
import { filterCasinoBets, isGoodCasinoSnapshot } from './casinoLiveModel'

describe('casino live snapshot model', () => {
  test('accepts only finite numeric KPI snapshots, keeping zero snapshots valid', () => {
    assert.equal(isGoodCasinoSnapshot(casinoDashboardFixture), true)
    assert.equal(isGoodCasinoSnapshot({ ...casinoDashboardFixture, kpis: { ...casinoDashboardFixture.kpis, ggr: NaN } }), false)
    assert.equal(isGoodCasinoSnapshot(undefined), false)
    assert.equal(isGoodCasinoSnapshot({ ...casinoDashboardFixture, kpis: { at: '', wagered: 0, payouts: 0, ggr: 0, activePlayers: 0, betsPerMin: 0, rtp: 0 } }), true)
  })
  test('retains case-insensitive text and inclusive stake bracket filtering without mutating data', () => {
    assert.equal(filterCasinoBets(casinoBetsFixture, 'ASHA').length, 8)
    assert.equal(filterCasinoBets(casinoBetsFixture, 'txn-reference-0').length, 1)
    assert.ok(filterCasinoBets(casinoBetsFixture, '', 'Evolution', 'Roulette', '100+').every(bet => bet.vendorName === 'Evolution' && bet.gameName === 'Roulette' && bet.stake >= 100))
    assert.deepEqual(filterCasinoBets([{ ...casinoBetsFixture[0], stake: 10 }, { ...casinoBetsFixture[1], stake: 100 }], '', undefined, undefined, '10-100').map(bet => bet.stake), [10, 100])
    assert.equal(casinoBetsFixture.length, 24)
  })
})
