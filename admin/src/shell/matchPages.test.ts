/**
 * matchPages ranks and caps the Pages group in GlobalSearch (decision 10): label and keyword
 * matches only (never the section title), a 2-character threshold, ties keep row order, and
 * searchablePageRows builds the row list matchPages searches from each visible section.
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { IconPoint } from '@tabler/icons-react'
import type { ShellRow, ShellSection } from './shellTypes'
import { PAGE_MATCH_LIMIT, PAGE_QUERY_MIN_LENGTH, matchPages, rankPageRow, searchablePageRows } from './matchPages'

function makeRow(overrides: Partial<ShellRow> & Pick<ShellRow, 'to' | 'label'>): ShellRow {
  return {
    id: `test|${overrides.to}`,
    sectionKey: 'trading',
    sectionTitle: 'Trading',
    icon: IconPoint,
    keywords: [],
    badgeKey: null,
    ...overrides,
  }
}

function makeSection(key: string, title: string, rows: ShellRow[]): ShellSection {
  return {
    key,
    title,
    subtitle: null,
    icon: IconPoint,
    badgeKey: null,
    entries: rows.map((row) => ({ kind: 'row' as const, row })),
    rows,
  }
}

describe('rankPageRow', () => {
  test('rank 0: label starts with the query', () => {
    const row = makeRow({ to: '/payments/deposits', label: 'Deposit Requests' })
    assert.equal(rankPageRow('deposit', row), 0)
  })

  test('rank 1: label contains the query but does not start with it', () => {
    const row = makeRow({ to: '/somewhere', label: 'Something Casino' })
    assert.equal(rankPageRow('casino', row), 1)
  })

  test('rank 2: a keyword starts with the query', () => {
    const row = makeRow({ to: '/casino/management', label: 'Management', keywords: ['casino management'] })
    assert.equal(rankPageRow('casino', row), 2)
  })

  test('rank 3: a keyword contains the query but no keyword starts with it', () => {
    const row = makeRow({ to: '/bets', label: 'Bet List', keywords: ['legacy casino bets'] })
    assert.equal(rankPageRow('casino', row), 3)
  })

  test('null: neither the label nor any keyword matches', () => {
    const row = makeRow({ to: '/bets', label: 'Bet List', keywords: ['wagers'] })
    assert.equal(rankPageRow('casino', row), null)
  })
})

describe('matchPages', () => {
  test('M1 needs a trimmed query of at least 2 characters', () => {
    const rows = [makeRow({ to: '/players', label: 'Players' })]
    assert.deepEqual(matchPages('p', rows), [])
    assert.deepEqual(matchPages(' p ', rows), [])
    assert.deepEqual(matchPages('', rows), [])
    assert.equal(PAGE_QUERY_MIN_LENGTH, 2)
    assert.notDeepEqual(matchPages('pl', rows), [])
  })

  test('M2 ranks label-starts before label-contains before keyword-starts before keyword-contains', () => {
    const casinoReport = makeRow({ to: '/reporting/casino', label: 'Casino Report' })
    const somethingCasino = makeRow({ to: '/somewhere', label: 'Something Casino' })
    const management = makeRow({ to: '/casino/management', label: 'Management', keywords: ['casino management'] })
    const betList = makeRow({ to: '/bets', label: 'Bet List', keywords: ['legacy casino bets'] })
    const rows = [betList, management, somethingCasino, casinoReport]
    assert.deepEqual(
      matchPages('casino', rows).map((row) => row.to),
      ['/reporting/casino', '/somewhere', '/casino/management', '/bets'],
    )
  })

  test('M2b ties (same rank) keep the input order, not label order', () => {
    const zeta = makeRow({ to: '/zeta', label: 'Zeta Dashboard', keywords: ['dashboard'] })
    const alpha = makeRow({ to: '/alpha', label: 'Alpha Dashboard', keywords: ['dashboard'] })
    assert.deepEqual(
      matchPages('dash', [zeta, alpha]).map((row) => row.to),
      ['/zeta', '/alpha'],
    )
  })

  test('M3 is case-insensitive', () => {
    const row = makeRow({ to: '/reporting/casino', label: 'Casino Report' })
    assert.deepEqual(matchPages('CASINO', [row]), matchPages('casino', [row]))
  })

  test('M4 caps at 8 by default, honours a custom limit, and limit 0 returns nothing', () => {
    const rows = Array.from({ length: 9 }, (_, i) => makeRow({ to: `/report-${i}`, label: `Report ${i}` }))
    assert.equal(PAGE_MATCH_LIMIT, 8)
    const capped = matchPages('report', rows)
    assert.equal(capped.length, 8)
    assert.deepEqual(
      capped.map((row) => row.to),
      rows.slice(0, 8).map((row) => row.to),
    )
    assert.equal(matchPages('report', rows, 3).length, 3)
    assert.deepEqual(matchPages('report', rows, 0), [])
  })

  test('M6 de-duplicates by normalised `to`, keeping the first match', () => {
    const first = makeRow({ to: '/bets', label: 'Bet List' })
    const second = makeRow({ to: '/bets/', label: 'Bet List (copy)' })
    assert.deepEqual(
      matchPages('bet', [first, second]).map((row) => row.label),
      ['Bet List'],
    )
  })

  test('rows keep their own sectionKey/sectionTitle for the result meta', () => {
    const row = makeRow({ to: '/config/crm-access', label: 'CRM Access', sectionKey: 'system', sectionTitle: 'System' })
    const [match] = matchPages('crm', [row])
    assert.equal(match.sectionKey, 'system')
    assert.equal(match.sectionTitle, 'System')
  })
})

describe('searchablePageRows', () => {
  test("flattens every section's rows in order", () => {
    const tradingRow = makeRow({ to: '/bets', label: 'Bet List', sectionKey: 'trading', sectionTitle: 'Trading' })
    const reportingRow = makeRow({
      to: '/reporting/casino',
      label: 'Casino Report',
      sectionKey: 'reporting',
      sectionTitle: 'Reporting',
    })
    const sections = [makeSection('trading', 'Trading', [tradingRow]), makeSection('reporting', 'Reporting', [reportingRow])]

    const rows = searchablePageRows(sections)

    assert.deepEqual(
      rows.map((row) => row.to),
      ['/bets', '/reporting/casino'],
    )
  })

  test("de-duplicates across sections too, keeping the earlier section's row", () => {
    const first = makeRow({ to: '/players', label: 'All Players', sectionKey: 'userManagement', sectionTitle: 'User management' })
    const second = makeRow({ to: '/players/', label: 'Players (duplicate)', sectionKey: 'other', sectionTitle: 'Other' })
    const sections = [makeSection('userManagement', 'User management', [first]), makeSection('other', 'Other', [second])]

    const rows = searchablePageRows(sections)

    assert.deepEqual(
      rows.filter((row) => row.to === '/players' || row.to === '/players/').map((row) => row.label),
      ['All Players'],
    )
  })
})
