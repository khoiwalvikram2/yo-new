/**
 * One export permission must not export everything.
 *
 * `createExportJob` was gated on `reporting.exports:create` alone while the
 * caller names the report type in the request, and `ExportJobProcessor`
 * dispatches on that string across twenty reports — AUDIT_LOGS, PLAYERS,
 * TRANSACTIONS, DEPOSITS and WITHDRAWALS among them — consulting no further
 * permission. One grant therefore exported the tenant's whole audit trail,
 * player roster and payment history into an S3 file the same caller could
 * download.
 *
 * The catalogue had carried a separate export permission for each of those
 * screens all along; the only one any resolver read was `audit.events:export`,
 * on the audit domain's own export route. The trail was guarded on one road and
 * open on the other.
 *
 * The table this pins is keyed the way the processor dispatches, so the two
 * cannot drift: a report type added there without a permission is refused rather
 * than inheriting one, and this test fails the build instead of waiting for it.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EXPORT_REPORT_PERMISSIONS,
  requireExportReportPermission,
} from '../services/exportReportPermissions.js'
import { NESTED_PERMISSIONS } from '@src/config/nestedPermissions.js'
import { deriveAgentPermissions } from '@src/domains/agents/services/AgentPermissionsService.js'

const CATALOGUE = new Set(NESTED_PERMISSIONS.map((p) => `${p.domain}:${p.action}`))

/** The report types the processor actually switches on. */
function dispatchedTypes(): string[] {
  const src = readFileSync(
    join('src', 'domains', 'reporting', 'services', 'ExportJobProcessor.ts'),
    'utf8'
  )
  const i = src.indexOf('const normalizedType = this.normalizeReportType(reportType)')
  assert.ok(i >= 0, 'could not find the processor dispatch — has it been rewritten?')
  const block = src.slice(i, src.indexOf('\n  }', i))
  return [...new Set([...block.matchAll(/case '([A-Z_]+)':/g)].map((m) => m[1]))].sort()
}

const ctx = (pairs: Array<[string, string]>) => ({
  permissions: pairs.map(([domain, action]) => ({ domain, actions: [action] })),
})

describe('export report permissions', () => {
  const types = dispatchedTypes()

  it('found the dispatch table at all', () => {
    assert.ok(types.length >= 15, `only found ${types.length} report types`)
  })

  it('covers every report type the processor serves', () => {
    const unmapped = types.filter((t) => !EXPORT_REPORT_PERMISSIONS[t])
    assert.deepEqual(
      unmapped,
      [],
      `these would be refused at runtime because nobody decided what they cost: ${unmapped.join(', ')}`
    )
  })

  it('has no entry for a report type the processor no longer serves', () => {
    const stale = Object.keys(EXPORT_REPORT_PERMISSIONS).filter((t) => !types.includes(t))
    assert.deepEqual(stale, [], `these protect nothing and hide a rename: ${stale.join(', ')}`)
  })

  it('names no permission an administrator cannot grant', () => {
    const unknown = [
      ...new Set(
        Object.values(EXPORT_REPORT_PERMISSIONS)
          .flat()
          .map(([d, a]) => `${d}:${a}`)
      ),
    ].filter((p) => !CATALOGUE.has(p))
    assert.deepEqual(unknown, [], `not in the catalogue, so unreachable: ${unknown.join(', ')}`)
  })

  it('refuses the audit trail to a caller who may only run exports', () => {
    // The exact hole: this caller passes the old gate and nothing else was asked.
    const exporter = ctx([['reporting.exports', 'create']])
    for (const t of ['AUDIT_LOGS', 'AUDITLOGS']) {
      assert.throws(
        () => requireExportReportPermission(exporter, t),
        /audit\.events:export/,
        `${t} was exportable with reporting.exports:create alone`
      )
    }
  })

  it('refuses the player roster and the payment history to the same caller', () => {
    const exporter = ctx([['reporting.exports', 'create']])
    for (const t of ['PLAYERS', 'TRANSACTIONS', 'DEPOSITS', 'WITHDRAWALS']) {
      assert.throws(
        () => requireExportReportPermission(exporter, t),
        /insufficient permissions to export/,
        `${t} was exportable with reporting.exports:create alone`
      )
    }
  })

  it('allows each report to the caller who holds its own permission', () => {
    assert.doesNotThrow(() => requireExportReportPermission(ctx([['audit.events', 'export']]), 'AUDIT_LOGS'))
    assert.doesNotThrow(() => requireExportReportPermission(ctx([['players.list', 'export']]), 'PLAYERS'))
    assert.doesNotThrow(() => requireExportReportPermission(ctx([['reporting.casino', 'export']]), 'CASINO_BETS'))
  })

  it('allows a platform super admin everything', () => {
    const superAdmin = { permissions: [{ domain: 'all', actions: ['*'] }] }
    for (const t of types) {
      assert.doesNotThrow(
        () => requireExportReportPermission(superAdmin, t),
        `a super admin was refused ${t}`
      )
    }
  })

  it('refuses a report type nobody has decided about', () => {
    assert.throws(
      () => requireExportReportPermission({ permissions: [{ domain: 'all', actions: ['*'] }] }, 'PAYROLL'),
      /unknown export report type/,
      'an unmapped report type inherited a permission'
    )
  })

  it('normalises the way the processor does', () => {
    // The processor uppercases and swaps hyphens; the table must be reachable
    // through the same spelling a client would send.
    assert.doesNotThrow(() =>
      requireExportReportPermission(ctx([['audit.events', 'export']]), 'audit-logs')
    )
  })
})

/** An agent session as buildAuthContext builds it, with the permissions login derives. */
const agentCtx = (scheme: string, domains: string[]) => ({
  user: { type: 'agent', agentId: 'agent-1', sub: 'agent-1', agentSchemeType: scheme, agentAllowedDomains: domains },
  permissions: deriveAgentPermissions(domains as never, scheme),
})

describe('export report permissions for agent callers', () => {
  it('lets every scheme export its players, payment requests and sub-agents', () => {
    for (const scheme of ['COMMISSION', 'SHARING', 'CREDIT']) {
      for (const type of ['players', 'deposits', 'withdrawals', 'subagents']) {
        assert.doesNotThrow(() => requireExportReportPermission(agentCtx(scheme, []), type), `${scheme} ${type}`)
      }
    }
  })

  it('lets a COMMISSION agent export commission, and a SHARING or CREDIT agent its settlements', () => {
    assert.doesNotThrow(() => requireExportReportPermission(agentCtx('COMMISSION', []), 'commission'))
    assert.throws(() => requireExportReportPermission(agentCtx('COMMISSION', []), 'settlement'), /agents may not export SETTLEMENT/)
    for (const scheme of ['SHARING', 'CREDIT']) {
      assert.doesNotThrow(() => requireExportReportPermission(agentCtx(scheme, []), 'settlement'), scheme)
      assert.throws(() => requireExportReportPermission(agentCtx(scheme, []), 'commission'), /agents may not export COMMISSION/)
    }
  })

  it("keeps an agent's bet exports to its domains", () => {
    assert.doesNotThrow(() => requireExportReportPermission(agentCtx('SHARING', ['casino']), 'casino-bets'))
    assert.throws(() => requireExportReportPermission(agentCtx('SHARING', ['casino']), 'sports-bets'), /agents may not export SPORTS_BETS/)
  })

  it('refuses the whitelabel-level and unscoped reports to every agent, whatever it holds', () => {
    for (const scheme of ['COMMISSION', 'SHARING', 'CREDIT']) {
      const loaded = { ...agentCtx(scheme, ['sports', 'casino', 'matka']), permissions: [{ domain: 'all', actions: ['*'] }] }
      for (const type of ['AUDIT_LOGS', 'audit-logs', 'BONUS_CAMPAIGNS', 'GGR', 'TRANSACTIONS', 'AGENTS']) {
        assert.throws(() => requireExportReportPermission(loaded, type), /Forbidden: agents may not export/, `${scheme} ${type}`)
      }
    }
  })

  it('still refuses an unknown type before anything else', () => {
    assert.throws(() => requireExportReportPermission(agentCtx('SHARING', []), 'PAYROLL'), /unknown export report type/)
  })

  it('leaves admins on the per-type table', () => {
    assert.doesNotThrow(() => requireExportReportPermission(ctx([['payments.deposits', 'view']]), 'DEPOSITS'))
    assert.throws(
      () => requireExportReportPermission(ctx([['reporting.exports', 'create']]), 'DEPOSITS'),
      /insufficient permissions to export DEPOSITS/,
    )
  })
})
