import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { formatLiveMetric, liveMetrics } from './liveWorkspaceStatsModel'

describe('live statistics contracts', () => {
  test('sports metrics retain stake, liability, markets, players, rate and odds precision', () => {
    const metrics = liveMetrics('sports', { kpis: {
      totalStake: 999999999, totalLiability: 1000, activeMarkets: 42,
      activePlayers: 12, betsPerMin: 3.46, avgOdds: 2.135,
    } }, { stakeTrend: -2.56, playersTrend: 5 })
    assert.deepEqual(metrics.map((metric) => metric.key), ['stake', 'liability', 'markets', 'players', 'bets', 'odds'])
    assert.equal(formatLiveMetric(metrics[0], (value) => `INR ${value}`), 'INR 999999999')
    assert.equal(formatLiveMetric(metrics[4], String), '3.5')
    assert.equal(formatLiveMetric(metrics[5], String), '2.13')
    assert.deepEqual(metrics[0].delta, { value: '2.6%', dir: 'down' })
  })

  test('matka exposure is floored at zero and total bets comes from all type breakdowns', () => {
    const metrics = liveMetrics('matka', { kpis: { wagered: 100, payouts: 200 },
      breakdown: { byType: [{ bets: 10 }, { bets: 15 }, {}] } }, null)
    assert.equal(metrics.find((metric) => metric.key === 'exposure')?.value, 0)
    assert.equal(metrics.find((metric) => metric.key === 'total-bets')?.value, 25)
    assert.equal(metrics.find((metric) => metric.key === 'payouts')?.value, 200)
  })

  test('casino preserves RTP and margin thresholds including equality boundaries', () => {
    const build = (rtp: number, ggr: number) => liveMetrics('casino', { kpis: { wagered: 100, rtp, ggr } }, null, 120)
    assert.equal(build(94.99, 5.01).find((metric) => metric.key === 'rtp')?.quality?.label, 'Good')
    assert.equal(build(95, 5).find((metric) => metric.key === 'rtp')?.quality?.label, 'Fair')
    assert.equal(build(105, 2).find((metric) => metric.key === 'rtp')?.quality?.label, 'High')
    assert.equal(build(95, 5.01).find((metric) => metric.key === 'margin')?.quality?.label, 'Strong')
    assert.equal(build(95, 5).find((metric) => metric.key === 'margin')?.quality?.label, 'Normal')
    assert.equal(build(95, 2).find((metric) => metric.key === 'margin')?.quality?.label, 'Low')
    assert.equal(build(95, 2)[0].tooltip, 'Total wagered in last 120 minutes')
  })

  test('casino zero-wagered snapshots do not render an infinite house edge', () => {
    const margin = liveMetrics('casino', { kpis: { wagered: 0, ggr: 100 } }, null).find((metric) => metric.key === 'margin')
    assert.ok(margin)
    assert.equal(formatLiveMetric(margin, String), '0.00%')
  })

  test('missing snapshots have no statistics and malformed numeric values stay finite', () => {
    assert.deepEqual(liveMetrics('sports', undefined, null), [])
    assert.deepEqual(liveMetrics('matka', { breakdown: {} }, null), [])
    const metrics = liveMetrics('sports', { kpis: { betsPerMin: NaN, activePlayers: Infinity } }, null)
    assert.ok(metrics.every((metric) => Number.isFinite(metric.value)))
  })
})
