/**
 * resolveSection picks which contextual-panel section is shown, and which row is active, for the
 * current pathname (spec "Contextual panel > Which section it shows", decision 7). It replaces the
 * old per-item longest-prefix rule with one pure function: the longest row match wins across every
 * section; failing that, a 4-entry prefix fallback table; failing that, the section already shown;
 * failing that, the first section on a cold load.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { IconPoint } from '@tabler/icons-react'
import type { ShellRow, ShellSection } from './shellTypes'
import { SECTION_PREFIX_FALLBACKS, fallbackSectionKey, findActiveRow, resolveSection } from './resolveSection'

function makeRow(sectionKey: string, to: string, label: string): ShellRow {
  return {
    id: `${sectionKey}|${to}|${to}`,
    sectionKey,
    sectionTitle: sectionKey,
    to,
    label,
    icon: IconPoint,
    keywords: [],
    badgeKey: null,
  }
}

function makeSection(key: string, rows: ShellRow[]): ShellSection {
  return {
    key,
    title: key,
    subtitle: null,
    icon: IconPoint,
    badgeKey: null,
    entries: rows.map((row) => ({ kind: 'row' as const, row })),
    rows,
  }
}

describe('findActiveRow', () => {
  test('longest match wins across sections, not the first found', () => {
    const sections = [
      makeSection('overview', [makeRow('overview', '/agent', 'Dashboard')]),
      makeSection('userManagement', [makeRow('userManagement', '/agent/create', 'Create Agent')]),
      makeSection('marketing', [makeRow('marketing', '/agent/referral', 'My Referral Link')]),
    ]
    assert.equal(findActiveRow('/agent/create', sections)?.label, 'Create Agent')
    assert.equal(findActiveRow('/agent/referral', sections)?.label, 'My Referral Link')
    assert.equal(findActiveRow('/agent', sections)?.label, 'Dashboard')
  })

  test('/players/create matches only the create row, not /players', () => {
    const sections = [
      makeSection('userManagement', [
        makeRow('userManagement', '/players', 'All Players'),
        makeRow('userManagement', '/players/create', 'Create Player'),
      ]),
    ]
    const active = findActiveRow('/players/create', sections)
    assert.equal(active?.to, '/players/create')
    assert.equal(active?.label, 'Create Player')
  })

  test('ties keep the earlier section', () => {
    const sections = [
      makeSection('a', [makeRow('a', '/bets', 'Bets A')]),
      makeSection('b', [makeRow('b', '/bets', 'Bets B')]),
    ]
    const active = findActiveRow('/bets', sections)
    assert.equal(active?.label, 'Bets A')
    assert.equal(active?.sectionKey, 'a')
  })

  test('normalises a trailing slash on the pathname', () => {
    const sections = [makeSection('trading', [makeRow('trading', '/bets', 'Bet List')])]
    assert.equal(findActiveRow('/bets/', sections)?.label, 'Bet List')
  })

  test('no row matches -> null', () => {
    const sections = [makeSection('overview', [makeRow('overview', '/overview', 'Overview')])]
    assert.equal(findActiveRow('/unknown-page', sections), null)
  })
})

describe('fallbackSectionKey', () => {
  test('each of the four prefixes, including the "-" form for /sports-exchange', () => {
    const sections = [
      makeSection('trading', [makeRow('trading', '/trading-home', 'Trading Home')]),
      makeSection('system', [makeRow('system', '/system-home', 'System Home')]),
      makeSection('reporting', [makeRow('reporting', '/reporting-home', 'Reporting Home')]),
    ]
    assert.equal(fallbackSectionKey('/sports/event/123', sections), 'trading')
    assert.equal(fallbackSectionKey('/sports-exchange/x', sections), 'trading')
    assert.equal(fallbackSectionKey('/matka/42', sections), 'trading')
    assert.equal(fallbackSectionKey('/matka/edit/42', sections), 'trading')
    assert.equal(fallbackSectionKey('/config/sports-advanced', sections), 'system')
    assert.equal(fallbackSectionKey('/reporting/agent-overview', sections), 'reporting')
  })

  test('returns null when the matching section is not visible', () => {
    const sections = [makeSection('system', [makeRow('system', '/system-home', 'System Home')])]
    assert.equal(fallbackSectionKey('/sports/event/123', sections), null)
  })

  test('returns null when no prefix matches', () => {
    const sections = [makeSection('overview', [makeRow('overview', '/overview', 'Overview')])]
    assert.equal(fallbackSectionKey('/notifications', sections), null)
  })

  test("table has exactly the spec's four entries", () => {
    assert.deepEqual(SECTION_PREFIX_FALLBACKS, [
      ['/sports', 'trading'],
      ['/matka', 'trading'],
      ['/config', 'system'],
      ['/reporting', 'reporting'],
    ])
  })
})

describe('resolveSection', () => {
  test('step 1: an active row wins outright, even when its section differs from previousKey', () => {
    const sections = [
      makeSection('overview', [makeRow('overview', '/overview', 'Overview')]),
      makeSection('userManagement', [
        makeRow('userManagement', '/players', 'All Players'),
        makeRow('userManagement', '/players/create', 'Create Player'),
      ]),
    ]
    const resolved = resolveSection('/players/create', sections, 'overview')
    assert.equal(resolved.sectionKey, 'userManagement')
    assert.equal(resolved.activeTo, '/players/create')
  })

  test('step 1: SHARING agent /agent/create resolves to userManagement / Create Agent', () => {
    const sections = [
      makeSection('overview', [makeRow('overview', '/agent', 'Dashboard')]),
      makeSection('userManagement', [makeRow('userManagement', '/agent/create', 'Create Agent')]),
      makeSection('marketing', [makeRow('marketing', '/agent/referral', 'My Referral Link')]),
    ]
    const resolved = resolveSection('/agent/create', sections, null)
    assert.equal(resolved.sectionKey, 'userManagement')
    assert.equal(resolved.activeTo, '/agent/create')
  })

  test('step 2: no active row falls back to the prefix table, with no active row', () => {
    const sections = [
      makeSection('overview', [makeRow('overview', '/overview', 'Overview')]),
      makeSection('trading', [makeRow('trading', '/bets', 'Bet List')]),
      makeSection('system', [makeRow('system', '/audit/events', 'Audit Trail')]),
    ]
    const resolved = resolveSection('/sports-exchange/x', sections, 'system')
    assert.equal(resolved.sectionKey, 'trading')
    assert.equal(resolved.activeTo, null)
  })

  test('step 3: /audit matches no row and no prefix, so the section already shown is kept', () => {
    const sections = [
      makeSection('overview', [makeRow('overview', '/overview', 'Overview')]),
      makeSection('system', [makeRow('system', '/audit/events', 'Audit Trail')]),
    ]
    const resolved = resolveSection('/audit', sections, 'overview')
    assert.equal(resolved.sectionKey, 'overview')
    assert.equal(resolved.activeTo, null)
  })

  test('step 3 is skipped once previousKey has disappeared, falling through to step 4', () => {
    const sections = [
      makeSection('overview', [makeRow('overview', '/overview', 'Overview')]),
      makeSection('trading', [makeRow('trading', '/bets', 'Bet List')]),
    ]
    const resolved = resolveSection('/notifications', sections, 'marketing')
    assert.equal(resolved.sectionKey, 'overview')
    assert.equal(resolved.activeTo, null)
  })

  test('step 4: a cold load (no previous section) on an unmatched route picks the first section', () => {
    const sections = [
      makeSection('overview', [makeRow('overview', '/overview', 'Overview')]),
      makeSection('trading', [makeRow('trading', '/bets', 'Bet List')]),
    ]
    const resolved = resolveSection('/notifications', sections, null)
    assert.equal(resolved.sectionKey, 'overview')
    assert.equal(resolved.activeTo, null)
  })

  test('no sections at all -> { sectionKey: null, activeTo: null }', () => {
    const resolved = resolveSection('/anything', [], 'overview')
    assert.deepEqual(resolved, { sectionKey: null, activeTo: null })
  })
})
