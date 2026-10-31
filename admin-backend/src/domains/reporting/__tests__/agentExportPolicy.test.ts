/**
 * Which report types an agent may export (agent features spec §4, owner decision 4, 2026-10-22).
 * Every scheme gets the Export Center; what it may export depends on the scheme and the agent's
 * domains, and the whitelabel-level reports are never an agent's. Pure: no database.
 *   node --env-file-if-exists=.env --test --import tsx src/domains/reporting/__tests__/agentExportPolicy.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_FORBIDDEN_EXPORT_TYPES,
  agentExportPermissions,
  agentExportReportTypes,
  assertAgentMayExport,
  isAgentExportAllowed,
  normaliseAgentExportType,
} from '../services/agentExportPolicy.js'
import { EXPORT_REPORT_PERMISSIONS, normaliseExportReportType } from '../services/exportReportPermissions.js'

const ALL_DOMAINS = ['sports', 'casino', 'matka']
const SCHEMES = ['COMMISSION', 'SHARING', 'CREDIT'] as const

describe('agent export policy', () => {
  it('gives every scheme its players, deposits, withdrawals and sub-agents', () => {
    for (const scheme of SCHEMES) {
      for (const type of ['PLAYERS', 'DEPOSITS', 'WITHDRAWALS', 'SUBAGENTS', 'players', 'subagents']) {
        assert.equal(isAgentExportAllowed(type, scheme, []), true, `${scheme} ${type}`)
      }
    }
  })

  it('gives COMMISSION agents the commission export and SHARING/CREDIT agents the settlement export, never the other', () => {
    assert.equal(isAgentExportAllowed('commission', 'COMMISSION', ALL_DOMAINS), true)
    assert.equal(isAgentExportAllowed('settlement', 'COMMISSION', ALL_DOMAINS), false)
    assert.equal(isAgentExportAllowed('SETTLEMENTS', 'COMMISSION', ALL_DOMAINS), false)
    for (const scheme of ['SHARING', 'CREDIT']) {
      assert.equal(isAgentExportAllowed('settlement', scheme, ALL_DOMAINS), true, scheme)
      assert.equal(isAgentExportAllowed('SETTLEMENTS', scheme, ALL_DOMAINS), true, scheme)
      assert.equal(isAgentExportAllowed('commission', scheme, ALL_DOMAINS), false, scheme)
    }
  })

  it("limits bet exports to the agent's allowed domains", () => {
    assert.equal(isAgentExportAllowed('casino-bets', 'SHARING', ['casino']), true)
    assert.equal(isAgentExportAllowed('CASINOBETS', 'SHARING', ['casino']), true)
    assert.equal(isAgentExportAllowed('sports-bets', 'SHARING', ['casino']), false)
    assert.equal(isAgentExportAllowed('matka-bets', 'SHARING', ['casino']), false)
    assert.equal(isAgentExportAllowed('sports-bets', 'CREDIT', []), false)
    assert.equal(isAgentExportAllowed('matka-bets', 'COMMISSION', ['MATKA']), true, 'domain case does not matter')
  })

  it('never lets an agent export whitelabel-level or unscoped reports', () => {
    assert.deepEqual(
      [...AGENT_FORBIDDEN_EXPORT_TYPES].sort(),
      ['AUDITLOGS', 'AUDIT_LOGS', 'BONUSCAMPAIGNS', 'BONUS_CAMPAIGNS', 'GGR'],
    )
    for (const scheme of SCHEMES) {
      for (const type of [...AGENT_FORBIDDEN_EXPORT_TYPES, 'audit-logs', 'bonus-campaigns', 'ggr', 'TRANSACTIONS', 'AGENTS']) {
        assert.equal(isAgentExportAllowed(type, scheme, ALL_DOMAINS), false, `${scheme} could export ${type}`)
      }
    }
  })

  it('gives an unknown scheme nothing', () => {
    assert.deepEqual(agentExportReportTypes(undefined, ALL_DOMAINS), [])
    assert.deepEqual(agentExportReportTypes('ADMIN', ALL_DOMAINS), [])
    assert.equal(isAgentExportAllowed('PLAYERS', null, ALL_DOMAINS), false)
  })

  it('names only report types the processor serves, normalised the way it dispatches', () => {
    for (const scheme of SCHEMES) {
      for (const type of agentExportReportTypes(scheme, ALL_DOMAINS)) {
        assert.ok(EXPORT_REPORT_PERMISSIONS[type], `${type} is not a processor report type`)
      }
    }
    for (const raw of ['sports-bets', 'Casino-Bets', 'settlement', 'SUBAGENTS', undefined, null]) {
      assert.equal(normaliseAgentExportType(raw), normaliseExportReportType(raw))
    }
  })

  it('asserts with the message createExportJob, the processor and the row count all give', () => {
    assert.throws(() => assertAgentMayExport('audit-logs', 'SHARING', ALL_DOMAINS), /Forbidden: agents may not export AUDIT_LOGS/)
    assert.doesNotThrow(() => assertAgentMayExport('players', 'SHARING', []))
  })

  it('derives export and create actions only, per scheme and domain', () => {
    const commission = agentExportPermissions('COMMISSION', ['casino'])
    assert.deepEqual(commission, [
      { domain: 'reporting.exports', actions: ['create'] },
      { domain: 'players.list', actions: ['export'] },
      { domain: 'agents.list', actions: ['export'] },
      { domain: 'reporting.casino', actions: ['export'] },
      { domain: 'reporting.agents-commission', actions: ['export'] },
    ])
    const sharing = agentExportPermissions('SHARING', ALL_DOMAINS)
    assert.equal(sharing.some((p) => p.domain === 'reporting.agents-commission'), false)
    for (const p of [...commission, ...sharing]) {
      assert.ok(p.domain.includes('.'), `${p.domain} is a flat permission`)
      assert.ok(p.actions.every((a) => a === 'export' || a === 'create'), `${p.domain}: ${p.actions.join(',')}`)
    }
    assert.deepEqual(agentExportPermissions(undefined, ALL_DOMAINS), [])
  })
})
