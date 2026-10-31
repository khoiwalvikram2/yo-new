import { after, afterEach, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '@src/db/client.js'
import { QueryCache } from '@src/services/QueryCache.js'
import { computeRiskAlerts } from '../RiskAlertService.js'

afterEach(() => mock.restoreAll())
after(async () => { await pool.end() })
const scope = { tenant: 'rtp-qa', whitelabelId: 'rtp-qa' }
function snapshot(wagered = 0, betsPerMin = 0) {
  return { kpis: { at: '', wagered, payouts: 0, ggr: wagered, rtp: 0, betsPerMin, activePlayers: wagered ? 1 : 0 },
    breakdown: { byType: [], byMarket: [], byBidType: [], bySession: [], byDigit: [], bySelection: [],
      byMatka: wagered ? [{ matkaId: 'qa', matkaName: 'QA Market', wagered, payouts: 0, ggr: wagered, bets: 10 }] : [] } }
}
test('empty Matka scope never raises an overall RTP incident', async () => {
  mock.method(QueryCache, 'getLive', async () => snapshot())
  assert.deepEqual((await computeRiskAlerts(scope)).items, [])
})
test('pending bets with zero final payout cannot raise realised RTP alerts', async () => {
  mock.method(QueryCache, 'getLive', async () => snapshot(1000))
  const alerts = (await computeRiskAlerts(scope)).items
  assert.equal(alerts.some(alert => alert.type === 'rtp'), false)
  assert.ok(alerts.some(alert => alert.type === 'concentration'))
})
test('valid volume-spike alerts remain active after removing pending-bet RTP comparisons', async () => {
  mock.method(QueryCache, 'getLive', async () => snapshot(1000, 5))
  const alerts = (await computeRiskAlerts(scope, { kpis: { betsPerMin: 1 } })).items
  assert.ok(alerts.some(alert => alert.id === 'volume-spike-bets' && alert.value === 400))
  assert.equal(alerts.some(alert => alert.type === 'rtp'), false)
})
