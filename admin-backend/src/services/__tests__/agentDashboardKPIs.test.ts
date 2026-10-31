/**
 * overviewKPIs for an agent caller (W4).
 *
 * The resolver gave agents the whitelabel's own dashboard. The agent version
 * must hand every data source the agent's id, and must not carry the
 * operator's pending approvals, alerts or commission bill. Data sources are
 * injected here; the database-backed path is covered read-only by
 * repos/reporting/__tests__/agentReportingScope.integration.test.ts.
 *   node --env-file-if-exists=.env --test --import tsx src/services/__tests__/agentDashboardKPIs.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAgentDashboardKPIs, type AgentDashboardDeps } from '@src/services/agentDashboardKPIs.js'

function recordingDeps() {
  const calls: Array<{ source: string; arg: any }> = []
  const domain = (source: string, stakes: number, ggr: number, bets: number, exposure = 0) => async (f: any) => {
    calls.push({ source, arg: f })
    return { totalStakes: stakes, grossGamingRevenue: ggr, totalExposure: exposure, betCount: bets }
  }
  const deps: AgentDashboardDeps = {
    currency: async () => 'INR',
    sportsKPIs: domain('sports', 1000, 100, 10, 50),
    casinoKPIs: domain('casino', 500, 40, 20),
    matkaKPIs: domain('matka', 0, 0, 0, 7),
    bonusKPIs: async (f) => { calls.push({ source: 'bonus', arg: f }); return { totalRedeemed: 15 } },
    moneyTotals: async (scope) => { calls.push({ source: 'money', arg: scope }); return { depositVolume: 900, depositCount: 3, withdrawalVolume: 400, withdrawalCount: 1 } },
    playerTotals: async (scope) => { calls.push({ source: 'players', arg: scope }); return { totalPlayers: 4, newPlayers: 1, activePlayers: 2 } },
  }
  return { deps, calls }
}

describe('getAgentDashboardKPIs', () => {
  it('scopes every data source to the agent', async () => {
    const { deps, calls } = recordingDeps()
    await getAgentDashboardKPIs({ tenant: 'brand-a', whitelabelId: 'brand-a', agentId: 'agent-1' }, { dateFrom: '2026-10-01', dateTo: '2026-10-20' }, deps)
    const sources = calls.map((c) => c.source).sort()
    assert.deepEqual(sources, ['bonus', 'casino', 'matka', 'money', 'players', 'sports'])
    for (const c of calls) {
      assert.equal(c.arg.agentId, 'agent-1', `${c.source} was not given the agent`)
      assert.equal(c.arg.tenant, 'brand-a', `${c.source} was not given the tenant`)
    }
  })

  it('reports the agent’s own figures and none of the operator’s', async () => {
    const { deps } = recordingDeps()
    const k = await getAgentDashboardKPIs({ tenant: 'brand-a', agentId: 'agent-1' }, undefined, deps)
    assert.equal(k.turnover, 1500)
    assert.equal(k.ggr, 140)
    assert.equal(k.ngr, 125, 'GGR less the agent players’ redeemed bonuses')
    assert.equal(k.exposure, 57)
    assert.equal(k.totalBets, 30)
    assert.equal(k.totalDeposits, 900)
    assert.equal(k.totalWithdrawals, 400)
    assert.equal(k.netDeposits, 500)
    assert.equal(k.activePlayers, 2)
    assert.equal(k.totalPlayers, 4)
    assert.deepEqual(k.approvalsPending, [])
    assert.deepEqual(k.alerts, [])
    assert.equal(k.agentCommission, 0)
    assert.equal(k.totalSettlement, 0)
  })

  it('refuses to run without an agent', async () => {
    const { deps } = recordingDeps()
    await assert.rejects(getAgentDashboardKPIs({ tenant: 'brand-a', agentId: '' }, undefined, deps))
  })
})

describe('the overviewKPIs resolver', () => {
  it('sends an agent caller to the agent dashboard before the whitelabel one', () => {
    const src = readFileSync(join(process.cwd(), 'src/domains/common/resolvers/queries.ts'), 'utf8')
    const start = src.indexOf('overviewKPIs: async')
    const body = src.slice(start, src.indexOf('dashboardTrends: async', start))
    const agentBranch = body.indexOf("ctx?.user?.type === 'agent'")
    const agentCall = body.indexOf('getAgentDashboardKPIs(')
    const tenantCall = body.indexOf('getDashboardKPIs(tenant')
    assert.ok(agentBranch > 0 && agentCall > agentBranch, 'agent branch calls getAgentDashboardKPIs')
    assert.ok(tenantCall > agentCall, 'the whitelabel dashboard is reached only after the agent branch returned')
  })
})
