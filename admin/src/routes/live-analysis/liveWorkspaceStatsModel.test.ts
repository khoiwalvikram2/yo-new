import assert from 'node:assert/strict'
import { describe, test } from 'vitest'
import { casinoRtpStanding, formatLiveMetric, liveMetrics } from './liveWorkspaceStatsModel'

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
    const metrics = liveMetrics('matka', { kpis: { wagered: 100, payouts: 0, potentialPayouts: 60 },
      breakdown: { byType: [{ bets: 10 }, { bets: 15 }, {}] } }, null)
    assert.equal(metrics.find((metric) => metric.key === 'exposure')?.value, 0)
    assert.equal(metrics.find((metric) => metric.key === 'total-bets')?.value, 25)
    assert.equal(metrics.find((metric) => metric.key === 'payouts')?.value, 60)
  })

  test('matka Potential Payouts and Exposure come from what the open bets pay if they all win (MAT-13)', () => {
    // The finding's figures: open bets wagered 1,310 and would pay 43,100; settled wins (payouts) stay 0 on open bets.
    const metrics = liveMetrics('matka', { kpis: { wagered: 1310, payouts: 0, potentialPayouts: 43100 } }, null)
    const tile = (key: string) => metrics.find((metric) => metric.key === key)
    assert.equal(tile('payouts')?.label, 'Potential Payouts')
    assert.equal(tile('payouts')?.value, 43100)
    assert.equal(tile('exposure')?.value, 41790, 'net liability: potential payouts less the stakes already taken')
    assert.equal(tile('exposure')?.tooltip, 'Net liability if every open bet wins (Potential Payouts - Wagered)')
    // Exposure no longer echoes Wagered when payouts is 0 (it showed 1,310 / 1,310 / 0).
    assert.notEqual(tile('exposure')?.value, tile('wagered')?.value)
    // An older cached snapshot without the field reads 0, never NaN.
    const older = liveMetrics('matka', { kpis: { wagered: 1310, payouts: 0, potentialPayouts: null } }, null)
    assert.equal(older.find((metric) => metric.key === 'payouts')?.value, 0)
    assert.equal(older.find((metric) => metric.key === 'exposure')?.value, 0)
  })

  test('casino RTP is graded on the alert band, and only with enough bets to judge', () => {
    const rtpQuality = (rtp: number, wagered = 1000) =>
      liveMetrics('casino', { kpis: { wagered, rtp, ggr: 0 } }, null).find((metric) => metric.key === 'rtp')?.quality
    // One band with Alerts & Anomalies: 85% was "Good" here while the alert called it critical.
    assert.deepEqual(rtpQuality(85), { label: 'Low', tone: 'neg' })
    assert.deepEqual(rtpQuality(89.99), { label: 'Low', tone: 'neg' })
    assert.deepEqual(rtpQuality(90), { label: 'Normal', tone: 'ok' })
    assert.deepEqual(rtpQuality(110), { label: 'Normal', tone: 'ok' })
    assert.deepEqual(rtpQuality(110.01), { label: 'High', tone: 'warn' })
    // No bets reads RTP 0%, which said "Good"; a thin window is not graded either.
    assert.equal(rtpQuality(0, 0), undefined)
    assert.equal(rtpQuality(50, 100), undefined)
    assert.equal(casinoRtpStanding(0, 0), 'no-data')
    assert.equal(casinoRtpStanding(120, 100.01), 'high')
  })

  test('casino preserves the margin thresholds including equality boundaries', () => {
    const build = (rtp: number, ggr: number) => liveMetrics('casino', { kpis: { wagered: 100, rtp, ggr } }, null, 120)
    assert.equal(build(95, 5.01).find((metric) => metric.key === 'margin')?.quality?.label, 'Strong')
    assert.equal(build(95, 5).find((metric) => metric.key === 'margin')?.quality?.label, 'Normal')
    assert.equal(build(95, 2).find((metric) => metric.key === 'margin')?.quality?.label, 'Low')
    assert.equal(build(95, 2)[0].tooltip, 'Total wagered in last 120 minutes')
  })

  test('casino zero-wagered snapshots do not render an infinite house edge', () => {
    const margin = liveMetrics('casino', { kpis: { wagered: 0, ggr: 100 } }, null).find((metric) => metric.key === 'margin')
    assert.ok(margin)
    assert.equal(formatLiveMetric(margin, String), '0.00%')
    assert.equal(margin.quality, undefined, 'nothing wagered has no house edge to call "Low"')
  })

  test('missing snapshots have no statistics and malformed numeric values stay finite', () => {
    assert.deepEqual(liveMetrics('sports', undefined, null), [])
    assert.deepEqual(liveMetrics('matka', { breakdown: {} }, null), [])
    const metrics = liveMetrics('sports', { kpis: { betsPerMin: NaN, activePlayers: Infinity } }, null)
    assert.ok(metrics.every((metric) => Number.isFinite(metric.value)))
  })
})
